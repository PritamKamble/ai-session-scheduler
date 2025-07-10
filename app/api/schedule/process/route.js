import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { User } from '@/models/user';
import { Session } from '@/models/session';
import { Context } from '@/models/context';
import { NextResponse } from 'next/server';
import connectDB from '@/config/db';

// Initialize OpenAI with modern configuration
const openai = new OpenAI({
  apiKey: "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",
});

// Initialize Pinecone with latest configuration
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

// Get the index reference
const indexName = process.env.PINECONE_INDEX_NAME || 'conversations';
const index = pinecone.index(indexName);

// Connect to MongoDB
await connectDB();

// Helper function to flatten metadata for Pinecone
function preparePineconeMetadata(data) {
  const metadata = {};
  
  Object.keys(data).forEach(key => {
    const value = data[key];
    
    if (value === null || value === undefined) {
      return;
    }
    
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      metadata[key] = value;
    } else if (Array.isArray(value)) {
      metadata[key] = value.join(',');
    } else if (typeof value === 'object') {
      metadata[key] = JSON.stringify(value);
    }
  });
  
  return metadata;
}

// Helper functions for date/time handling
function convertTo24Hour(timeStr) {
  if (!timeStr) return '09:00';
  if (timeStr.includes('AM') || timeStr.includes('PM')) {
    return new Date(`1970-01-01 ${timeStr}`).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    }).slice(0, 5);
  }
  return timeStr;
}

function validateFutureDate(dateInput) {
  // Handle both Date objects and date strings
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput + 'T00:00:00.000Z');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date >= today;
}


function calculateDateFromRelative(dayName, referenceDate = new Date()) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const targetDay = days.indexOf(dayName.toLowerCase());
  if (targetDay === -1) return null;

  const today = new Date(referenceDate);
  const currentDay = today.getDay();
  let diff = targetDay - currentDay;
  
  if (diff === 0 && today.getHours() > 12) {
    diff = 7;
  } else if (diff < 0) {
    diff += 7;
  } else if (diff === 0) {
    diff = today.getHours() > 12 ? 7 : 0;
  }
  
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + diff);
  // FIX: Return Date object instead of string for schema compatibility
  return targetDate; // Changed from: targetDate.toISOString().split('T')[0]
}

// Helper function to find optimal timing based on all preferences
function findOptimalTiming(teacherAvailability, studentPreferences) {
  if (!teacherAvailability || teacherAvailability.length === 0) {
    return null;
  }

  if (!studentPreferences || studentPreferences.length === 0) {
    return teacherAvailability[0];
  }

  // Find overlapping times
  for (const teacherSlot of teacherAvailability) {
    for (const studentPref of studentPreferences) {
      // FIX: Compare dates properly (both as Date objects or strings)
      const teacherDate = teacherSlot.date instanceof Date 
        ? teacherSlot.date.toISOString().split('T')[0]
        : teacherSlot.date;
      const studentDate = studentPref.date instanceof Date
        ? studentPref.date.toISOString().split('T')[0] 
        : studentPref.date;
        
      if (teacherDate === studentDate) {
        // Check for time overlap
        const teacherStart = teacherSlot.startTime;
        const teacherEnd = teacherSlot.endTime;
        const studentStart = studentPref.startTime;
        const studentEnd = studentPref.endTime;

        if (teacherStart <= studentEnd && teacherEnd >= studentStart) {
          // Found overlap - create optimal slot
          return {
            date: teacherSlot.date, // Keep as Date object
            day: teacherSlot.day,
            startTime: teacherStart > studentStart ? teacherStart : studentStart,
            endTime: teacherEnd < studentEnd ? teacherEnd : studentEnd,
            timezone: teacherSlot.timezone || studentPref.timezone || 'UTC'
          };
        }
      }
    }
  }

  // No overlap found, prioritize teacher availability
  return teacherAvailability[0];
}

// Enhanced context retrieval function
async function getRelevantContext(userId, embedding, sessionId = null, limit = 5) {
  try {
    const filter = { userId: userId.toString() };
    if (sessionId) {
      filter.sessionId = sessionId.toString();
    }

    const queryResponse = await index.namespace('conversations').query({
      vector: embedding,
      topK: limit,
      filter,
      includeMetadata: true
    });

    return queryResponse.matches || [];
  } catch (error) {
    console.error('Error retrieving context:', error);
    return [];
  }
}

// Get conversation history from MongoDB
async function getConversationHistory(userId, sessionId = null, limit = 10) {
  try {
    const filter = { userId };
    if (sessionId) {
      filter.sessionId = sessionId;
    }

    const history = await Context.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return history.reverse();
  } catch (error) {
    console.error('Error retrieving conversation history:', error);
    return [];
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { userId, message, sessionId } = body || {};

    if (!userId || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const user = await User.findOne({ clerkId: userId });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    let session;
    if (sessionId) {
      session = await Session.findById(sessionId).populate('studentIds', 'name');
      if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: message
    });
    const embedding = embeddingResponse.data[0].embedding;

    // Get relevant context and conversation history
    const [contextMatches, conversationHistory] = await Promise.all([
      getRelevantContext(user._id, embedding, sessionId),
      getConversationHistory(user._id, sessionId)
    ]);

    if (user.role === 'teacher') {
      const result = await handleTeacherInput(user, message, embedding, session, {
        contextMatches,
        conversationHistory
      }, {
        json: (data) => NextResponse.json(data),
        status: (code) => ({
          json: (data) => NextResponse.json(data, { status: code })
        })
      });
      return result;
    } else {
      const result = await handleStudentInput(user, message, embedding, session, {
        contextMatches,
        conversationHistory
      }, {
        json: (data) => NextResponse.json(data),
        status: (code) => ({
          json: (data) => NextResponse.json(data, { status: code })
        })
      });
      return result;
    }

  } catch (error) {
    console.error('Error in scheduling processor:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Teacher processing logic - ONLY teachers can create sessions
async function handleTeacherInput(user, message, embedding, session, context, res) {
  try {
    const contextString = context.conversationHistory.length > 0 
      ? `Previous conversation context:\n${context.conversationHistory.map(c => 
          `${c.role}: ${c.message}`
        ).join('\n')}\n\n`
      : '';

    const prompt = `${contextString}Current teacher message: "${message}"

Extract from this teacher message and return ONLY valid JSON:
- expertise: array of topic strings
- availability: array of objects with:
  - date: in YYYY-MM-DD format (future dates only)
  - day: weekday name (Monday-Sunday)
  - startTime: in 24-hour format (HH:MM)
  - endTime: in 24-hour format (HH:MM)
  - timezone: if specified (e.g., "EST")
- preferences: object with any session preferences
- isUpdate: boolean (true if this is updating previous availability)
- isCancel: boolean (true if canceling/deleting session)

Current date: ${new Date().toISOString().split('T')[0]}

Example format:
{
  "expertise": ["Math", "Physics"],
  "availability": [
    {
      "date": "2025-06-29",
      "day": "Sunday",
      "startTime": "12:00",
      "endTime": "14:00",
      "timezone": "EST"
    }
  ],
  "preferences": {
    "duration": "60 minutes",
    "format": "online"
  },
  "isUpdate": true,
  "isCancel": false
}

RESPOND WITH ONLY THE JSON OBJECT, NO OTHER TEXT.`;

    const extraction = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3
    });

    let extractedData;
    try {
      extractedData = JSON.parse(extraction.choices[0].message.content);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      const fallbackExtraction = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      });
      
      const jsonString = fallbackExtraction.choices[0].message.content
        .replace(/^[^{]*/, '')
        .replace(/[^}]*$/, '');
      extractedData = JSON.parse(jsonString);
    }

    // Process availability dates
    if (extractedData.availability) {
  extractedData.availability = extractedData.availability.map(slot => {
    // Fix date handling
    if (!slot.date && slot.day) {
      const calculatedDate = calculateDateFromRelative(slot.day);
      slot.date = calculatedDate;
    } else if (typeof slot.date === 'string') {
      // Convert string dates to Date objects
      slot.date = new Date(slot.date + 'T00:00:00.000Z');
    }
    
    slot.startTime = convertTo24Hour(slot.startTime);
    slot.endTime = convertTo24Hour(slot.endTime);
    return slot;
  }).filter(slot => slot.date && validateFutureDate(slot.date));
}

    let sessionAction = 'none';
    
    // Handle session cancellation
    if (extractedData.isCancel && session) {
      await Session.findByIdAndDelete(session._id);
      session = null;
      sessionAction = 'deleted';
    }
    // Handle session creation/update
    else if (extractedData.availability && extractedData.availability.length > 0) {
      if (!session) {
  // Check for existing pending session to update
  const existingSession = await Session.findOne({
    teacherId: user._id,
    status: 'pending'
  }).sort({ createdAt: -1 });

  if (existingSession && extractedData.isUpdate) {
    session = existingSession;
    sessionAction = 'updated_existing';
  } else {
    sessionAction = 'created_new';
  }

  if (!session) {
    const firstSlot = extractedData.availability[0];
    session = new Session({
      topic: extractedData.expertise?.join(', ') || 'General Teaching',
      teacherId: user._id,
      schedule: {
        date: firstSlot.date,
        day: firstSlot.day,
        startTime: firstSlot.startTime,
        endTime: firstSlot.endTime,
        timezone: firstSlot.timezone || 'UTC'
      },
      status: 'pending',
      // FIX: Initialize teacherAvailability properly
      teacherAvailability: extractedData.availability,
      studentIds: [],
      // FIX: Initialize studentTimingPreferences as empty array
      studentTimingPreferences: []
    });
  }
} else {
  sessionAction = 'updated_current';
}

      session.teacherAvailability = extractedData.availability;

// If there are student preferences, coordinate timing
if (session.studentTimingPreferences && session.studentTimingPreferences.length > 0) {
  // FIX: Extract all student preferences correctly
  const allStudentPrefs = session.studentTimingPreferences.flatMap(
    pref => pref.preferences || []
  );
  
  const optimalTiming = findOptimalTiming(
    extractedData.availability, 
    allStudentPrefs
  );
  
  if (optimalTiming) {
    session.schedule = optimalTiming;
    session.status = 'coordinated';
  }
} else {
  // No student preferences, use first available slot
  const firstSlot = extractedData.availability[0];
  session.schedule = {
    date: firstSlot.date,
    day: firstSlot.day,
    startTime: firstSlot.startTime,
    endTime: firstSlot.endTime,
    timezone: firstSlot.timezone || 'UTC'
  };
}

      // Update topic if expertise is provided
      if (extractedData.expertise && extractedData.expertise.length > 0) {
        session.topic = extractedData.expertise.join(', ');
      }

      await session.save();
    }

    // Store context
    const newContext = new Context({
      sessionId: session?._id,
      userId: user._id,
      role: 'teacher',
      message,
      embedding,
      metadata: {
        intent: extractedData.isUpdate ? 'availability_update' : 'availability_initial',
        extractedData,
        hasValidAvailability: extractedData.availability?.length > 0,
        sessionAction: sessionAction
      }
    });

    const pineconeMetadata = preparePineconeMetadata({
      sessionId: session?._id?.toString() || '',
      userId: user._id.toString(),
      role: 'teacher',
      message: message.substring(0, 500),
      intent: extractedData.isUpdate ? 'availability_update' : 'availability_initial',
      expertise: extractedData.expertise || [],
      availability_count: extractedData.availability?.length || 0,
      next_available_date: extractedData.availability?.[0]?.date || '',
      has_valid_availability: extractedData.availability?.length > 0,
      timestamp: new Date().toISOString()
    });

    const vectorId = `ctx-teacher-${user._id}-${Date.now()}`;

    await Promise.all([
      newContext.save(),
      index.namespace('conversations').upsert([{
        id: vectorId,
        values: embedding,
        metadata: pineconeMetadata
      }])
    ]);

    // Generate response
    const previousMessages = context.conversationHistory.map(c => 
      `${c.role === 'teacher' ? 'Teacher' : 'Student'}: ${c.message}`
    ).join('\n');

    const responsePrompt = `You are responding to teacher ${user.name} in an ongoing conversation.

Previous conversation:
${previousMessages}

Current message: "${message}"
Session action taken: ${sessionAction}
Current students enrolled: ${session?.studentIds?.length || 0}

Generate a response that:
1. Acknowledges their message contextually
2. Confirms the session action taken
3. If students are enrolled, mentions coordination with student preferences
4. Provides clear next steps
5. Maintains professional but friendly tone

Keep response concise and helpful.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: responsePrompt }],
      temperature: 0.7
    });

    return res.json({
      success: true,
      response: response.choices[0].message.content,
      session: session || null,
      sessionAction: sessionAction,
      extractedData,
      contextUsed: {
        previousMessages: context.conversationHistory.length,
        contextMatches: context.contextMatches.length
      }
    });

  } catch (error) {
    console.error('Error in handleTeacherInput:', error);
    return res.status(500).json({ error: 'Error processing teacher input' });
  }
}

// Student processing logic - Students can only join and influence timing
// FIXED: Student processing logic - Students can only join and influence timing
async function handleStudentInput(user, message, embedding, session, context, res) {
  try {
    const contextString = context.conversationHistory.length > 0 
      ? `Previous conversation context:\n${context.conversationHistory.map(c => 
          `${c.role}: ${c.message}`
        ).join('\n')}\n\n`
      : '';

    const prompt = `${contextString}Current student message: "${message}"

Extract from this student message and return ONLY valid JSON:
- topics: array of desired topic strings
- availability: array of objects with:
  - date: in YYYY-MM-DD format (future dates only)
  - day: weekday name (Monday-Sunday)
  - startTime: in 24-hour format (HH:MM)
  - endTime: in 24-hour format (HH:MM)
  - timezone: if specified
- preferences: object with learning preferences
- isJoinRequest: boolean (true if wanting to join a session)
- isTimingUpdate: boolean (true if updating timing preferences)
- isLeaving: boolean (true if wanting to leave session)

Current date: ${new Date().toISOString().split('T')[0]}

Example format:
{
  "topics": ["React", "JavaScript"],
  "availability": [
    {
      "date": "2025-06-29",
      "day": "Saturday",
      "startTime": "10:00",
      "endTime": "12:00",
      "timezone": "PST"
    }
  ],
  "preferences": {
    "style": "interactive",
    "level": "beginner"
  },
  "isJoinRequest": true,
  "isTimingUpdate": false,
  "isLeaving": false
}

RESPOND WITH ONLY THE JSON OBJECT, NO OTHER TEXT.`;

    const extraction = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3
    });

    let extractedData;
    try {
      extractedData = JSON.parse(extraction.choices[0].message.content);
    } catch (parseError) {
      const fallbackExtraction = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      });
      
      const jsonString = fallbackExtraction.choices[0].message.content
        .replace(/^[^{]*/, '')
        .replace(/[^}]*$/, '');
      extractedData = JSON.parse(jsonString);
    }

    // Process availability dates and times
    if (extractedData.availability) {
      extractedData.availability = extractedData.availability.map(slot => {
        if (!slot.date && slot.day) {
          const calculatedDate = calculateDateFromRelative(slot.day);
          slot.date = calculatedDate;
        } else if (typeof slot.date === 'string') {
          slot.date = new Date(slot.date + 'T00:00:00.000Z');
        }
        
        slot.startTime = convertTo24Hour(slot.startTime);
        slot.endTime = convertTo24Hour(slot.endTime);
        return slot;
      }).filter(slot => slot.date && validateFutureDate(slot.date));
    }

    let sessionAction = 'none';
    let matchingSessions = [];

    // Handle leaving session
    if (extractedData.isLeaving && session) {
      session.studentIds = session.studentIds.filter(id => !id.equals(user._id));
      if (session.studentTimingPreferences) {
        session.studentTimingPreferences = session.studentTimingPreferences.filter(
          pref => !pref.studentId.equals(user._id)
        );
      }
      await session.save();
      sessionAction = 'left_session';
    }
    // FIXED: Handle joining or timing updates - Check for topics OR general session joining
    else if ((extractedData.topics && extractedData.topics.length > 0) || extractedData.isJoinRequest) {
      // FIXED: Find matching sessions - Include sessions with students already enrolled
      matchingSessions = await Session.find({
        $and: [
          // FIXED: Match by topic if provided, otherwise find any available session
          extractedData.topics && extractedData.topics.length > 0 ? {
            $or: [
              { topic: { $in: extractedData.topics } },
              { topic: { $regex: extractedData.topics.join('|'), $options: 'i' } }
            ]
          } : { topic: { $exists: true } },
          // FIXED: Include sessions that are pending, coordinated, OR scheduled
          { status: { $in: ['pending', 'coordinated', 'scheduled'] } },
          { teacherId: { $exists: true, $ne: null } }
        ]
      })
      .populate('teacherId', 'name email')
      .populate('studentIds', 'name email') // FIXED: Also populate student info for debugging
      .limit(5);

      console.log(`Found ${matchingSessions.length} matching sessions for student ${user.name}`);
      
      // FIXED: If student wants to join and there are matching sessions
      if (extractedData.isJoinRequest && matchingSessions.length > 0) {
        const bestMatch = matchingSessions[0];
        
        console.log(`Checking enrollment for student ${user._id} in session ${bestMatch._id}`);
        console.log(`Current students: ${bestMatch.studentIds.map(s => s._id).join(', ')}`);
        
        // FIXED: Proper ObjectId comparison using toString()
        const isAlreadyEnrolled = bestMatch.studentIds.some(student => 
          student._id.toString() === user._id.toString()
        );
        
        console.log(`Student already enrolled: ${isAlreadyEnrolled}`);
        
        if (!isAlreadyEnrolled) {
          bestMatch.studentIds.push(user._id);
          
          // Add timing preferences if provided
          if (extractedData.availability && extractedData.availability.length > 0) {
            if (!bestMatch.studentTimingPreferences) {
              bestMatch.studentTimingPreferences = [];
            }
            
            bestMatch.studentTimingPreferences.push({
              studentId: user._id,
              preferences: extractedData.availability,
              updatedAt: new Date()
            });

            // Coordinate timing with teacher availability
            if (bestMatch.teacherAvailability) {
              const optimalTiming = findOptimalTiming(
                bestMatch.teacherAvailability,
                extractedData.availability
              );
              
              if (optimalTiming) {
                bestMatch.schedule = optimalTiming;
                bestMatch.status = 'scheduled';
              }
            }
          }
          
          await bestMatch.save();
          session = bestMatch;
          sessionAction = 'joined_session';
          
          console.log(`Student ${user.name} successfully joined session ${bestMatch._id}`);
        } else {
          session = bestMatch;
          sessionAction = 'already_enrolled';
          
          console.log(`Student ${user.name} already enrolled in session ${bestMatch._id}`);
        }
      }
      // FIXED: Handle case where no isJoinRequest but topics are provided
      else if (extractedData.topics && extractedData.topics.length > 0 && !extractedData.isJoinRequest) {
        // FIXED: Set default join request to true if topics are mentioned
        extractedData.isJoinRequest = true;
        
        if (matchingSessions.length > 0) {
          const bestMatch = matchingSessions[0];
          const isAlreadyEnrolled = bestMatch.studentIds.some(student => 
            student._id.toString() === user._id.toString()
          );
          
          if (!isAlreadyEnrolled) {
            bestMatch.studentIds.push(user._id);
            
            if (extractedData.availability && extractedData.availability.length > 0) {
              if (!bestMatch.studentTimingPreferences) {
                bestMatch.studentTimingPreferences = [];
              }
              
              bestMatch.studentTimingPreferences.push({
                studentId: user._id,
                preferences: extractedData.availability,
                updatedAt: new Date()
              });

              if (bestMatch.teacherAvailability) {
                const optimalTiming = findOptimalTiming(
                  bestMatch.teacherAvailability,
                  extractedData.availability
                );
                
                if (optimalTiming) {
                  bestMatch.schedule = optimalTiming;
                  bestMatch.status = 'scheduled';
                }
              }
            }
            
            await bestMatch.save();
            session = bestMatch;
            sessionAction = 'joined_session';
          } else {
            session = bestMatch;
            sessionAction = 'already_enrolled';
          }
        } else {
          sessionAction = 'no_matching_sessions';
        }
      }
      // Handle timing updates for existing session
      else if (session && extractedData.isTimingUpdate && extractedData.availability) {
        if (!session.studentTimingPreferences) {
          session.studentTimingPreferences = [];
        }
        
        // Remove existing preferences for this student
        session.studentTimingPreferences = session.studentTimingPreferences.filter(
          pref => !pref.studentId.equals(user._id)
        );
        
        // Add new preferences
        session.studentTimingPreferences.push({
          studentId: user._id,
          preferences: extractedData.availability,
          updatedAt: new Date()
        });

        // Coordinate with teacher availability
        if (session.teacherAvailability) {
          const allStudentPrefs = session.studentTimingPreferences.flatMap(
            pref => pref.preferences
          );
          
          const optimalTiming = findOptimalTiming(
            session.teacherAvailability,
            allStudentPrefs
          );
          
          if (optimalTiming) {
            session.schedule = optimalTiming;
            session.status = 'scheduled';
          }
        }
        
        await session.save();
        sessionAction = 'updated_timing';
      }
      else {
        sessionAction = 'awaiting_teacher';
      }
    }

    // Store context
    const newContext = new Context({
      sessionId: session?._id,
      userId: user._id,
      role: 'student',
      message,
      embedding,
      metadata: {
        intent: extractedData.isTimingUpdate ? 'timing_update' : 'session_inquiry',
        extractedData,
        sessionAction: sessionAction,
        matchingSessionsCount: matchingSessions.length
      }
    });

    const pineconeMetadata = preparePineconeMetadata({
      sessionId: session?._id?.toString() || '',
      userId: user._id.toString(),
      role: 'student',
      message: message.substring(0, 500),
      intent: extractedData.isTimingUpdate ? 'timing_update' : 'session_inquiry',
      topics: extractedData.topics || [],
      session_action: sessionAction,
      timestamp: new Date().toISOString()
    });

    const vectorId = `ctx-student-${user._id}-${Date.now()}`;

    await Promise.all([
      newContext.save(),
      index.namespace('conversations').upsert([{
        id: vectorId,
        values: embedding,
        metadata: pineconeMetadata
      }])
    ]);

    // Generate response
    const previousMessages = context.conversationHistory.map(c => 
      `${c.role === 'student' ? 'Student' : 'Teacher'}: ${c.message}`
    ).join('\n');

    const responsePrompt = `You are responding to student ${user.name} in an ongoing conversation.

Previous conversation:
${previousMessages}

Current message: "${message}"
Session action taken: ${sessionAction}
Matching sessions found: ${matchingSessions.length}

${session ? `Current session: ${session.topic} with ${session.studentIds.length} students` : 'No current session'}

Generate a helpful response that:
1. Acknowledges their message contextually
2. Explains the action taken
3. If joined/updated session, confirms coordination with teacher
4. If no matches, explains options available
5. Provides clear next steps
6. Maintains encouraging tone

Keep response helpful and conversational.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: responsePrompt }],
      temperature: 0.7
    });

    return res.json({
      success: true,
      response: response.choices[0].message.content,
      session: session || null,
      sessionAction: sessionAction,
      matchingSessions: matchingSessions.map(s => ({
        id: s._id,
        topic: s.topic,
        teacherName: s.teacherId?.name,
        currentStudents: s.studentIds.length,
        schedule: s.schedule,
        status: s.status
      })),
      extractedData,
      contextUsed: {
        previousMessages: context.conversationHistory.length,
        contextMatches: context.contextMatches.length
      }
    });

  } catch (error) {
    console.error('Error in handleStudentInput:', error);
    return res.status(500).json({ error: 'Error processing student input' });
  }
}