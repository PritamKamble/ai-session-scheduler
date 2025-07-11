import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { User } from '@/models/user';
import { Session } from '@/models/session';
import { Context } from '@/models/context';
import { NextResponse } from 'next/server';
import connectDB from '@/config/db';

// Initialize OpenAI with modern configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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

IMPORTANT CONTEXT: Current session status: ${session ? 'EXISTS' : 'NO_SESSION'}

Extract from this teacher message and return ONLY valid JSON:
- expertise: array of topic strings
- availability: array of objects with:
  - date: in YYYY-MM-DD format (future dates only)
  - day: weekday name (Monday-Sunday)
  - startTime: in 24-hour format (HH:MM)
  - endTime: in 24-hour format (HH:MM)
  - timezone: if specified (e.g., "EST")
- preferences: object with any session preferences
- isUpdate: boolean (true if this is updating existing availability)
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
    if (extractedData.isCancel) {
      if (session) {
        await Session.findByIdAndDelete(session._id);
        session = null;
        sessionAction = 'deleted';
      } else {
        // Try to find any pending session for this teacher
        const existingSession = await Session.findOne({
          teacherId: user._id,
          status: { $in: ['pending', 'coordinated'] }
        }).sort({ createdAt: -1 });
        
        if (existingSession) {
          await Session.findByIdAndDelete(existingSession._id);
          session = null;
          sessionAction = 'deleted';
        } else {
          sessionAction = 'no_session_to_delete';
        }
      }
    }
    // Handle session creation/update
    else if (extractedData.availability && extractedData.availability.length > 0) {
      
      // First, try to find existing session if not provided
      if (!session) {
        session = await Session.findOne({
          teacherId: user._id,
          status: { $in: ['pending', 'coordinated'] }
        }).sort({ createdAt: -1 });
      }

      // SIMPLIFIED LOGIC: If session exists, update it. If not, create new one.
      if (session) {
        // UPDATE EXISTING SESSION
        session.teacherAvailability = extractedData.availability;
        
        // Update topic if expertise is provided
        if (extractedData.expertise && extractedData.expertise.length > 0) {
          session.topic = extractedData.expertise.join(', ');
        }

        // If there are student preferences, coordinate timing
        if (session.studentTimingPreferences && session.studentTimingPreferences.length > 0) {
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

        sessionAction = 'updated_existing';
        await session.save();
      } 
      else {
        // CREATE NEW SESSION
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
          teacherAvailability: extractedData.availability,
          studentIds: [],
          studentTimingPreferences: []
        });
        sessionAction = 'created_new';
        await session.save();
      }
    }

    // Store context
    const newContext = new Context({
      sessionId: session?._id,
      userId: user._id,
      role: 'teacher',
      message,
      embedding,
      metadata: {
        intent: sessionAction === 'updated_existing' ? 'availability_update' : 'availability_initial',
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
      intent: sessionAction === 'updated_existing' ? 'availability_update' : 'availability_initial',
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

    // Generate response based on session action
    const previousMessages = context.conversationHistory.map(c => 
      `${c.role === 'teacher' ? 'Teacher' : 'Student'}: ${c.message}`
    ).join('\n');

    let responsePrompt;
    
    switch (sessionAction) {
      case 'deleted':
        responsePrompt = `You are responding to teacher ${user.name}. They have successfully cancelled/deleted their session. Acknowledge the cancellation and ask if they need anything else.`;
        break;
      case 'no_session_to_delete':
        responsePrompt = `You are responding to teacher ${user.name}. They tried to cancel a session but no active session was found. Politely inform them there's no active session to cancel.`;
        break;
      default:
        responsePrompt = `You are responding to teacher ${user.name} in an ongoing conversation.

Previous conversation:
${previousMessages}

Current message: "${message}"
Session action taken: ${sessionAction}
Current students enrolled: ${session?.studentIds?.length || 0}

Generate a response that:
1. Acknowledges their message contextually
2. Confirms the session action taken (${sessionAction === 'updated_existing' ? 'availability updated' : sessionAction === 'created_new' ? 'new session created' : 'processed'})
3. If students are enrolled, mentions coordination with student preferences
4. Provides clear next steps
5. Maintains professional but friendly tone

Keep response concise and helpful.`;
    }

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
- isReplaceTimings: boolean (true if replacing all previous timings, false if adding to existing)

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
  "isLeaving": false,
  "isReplaceTimings": false
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
        model: 'gpt-4o',
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
    let timingUpdateResult = null;

    // Handle leaving session
    if (extractedData.isLeaving && session) {
      const leaveResult = await handleStudentLeaving(user, session);
      sessionAction = leaveResult.action;
      session = leaveResult.session;
    }
    // Handle joining or timing updates
    else if ((extractedData.topics && extractedData.topics.length > 0) || extractedData.isJoinRequest) {
      // Find matching sessions
      matchingSessions = await Session.find({
        $and: [
          extractedData.topics && extractedData.topics.length > 0 ? {
            $or: [
              { topic: { $in: extractedData.topics } },
              { topic: { $regex: extractedData.topics.join('|'), $options: 'i' } }
            ]
          } : { topic: { $exists: true } },
          { status: { $in: ['pending', 'coordinated', 'scheduled'] } },
          { teacherId: { $exists: true, $ne: null } }
        ]
      })
      .populate('teacherId', 'name email')
      .populate('studentIds', 'name email')
      .limit(5);

      console.log(`Found ${matchingSessions.length} matching sessions for student ${user.name}`);
      
      // If student wants to join and there are matching sessions
      if (extractedData.isJoinRequest && matchingSessions.length > 0) {
        const bestMatch = matchingSessions[0];
        
        console.log(`Checking enrollment for student ${user._id} in session ${bestMatch._id}`);
        
        const isAlreadyEnrolled = bestMatch.studentIds.some(student => 
          student._id.toString() === user._id.toString()
        );
        
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

            timingUpdateResult = await recalculateOptimalTiming(bestMatch);
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
      // Handle case where no isJoinRequest but topics are provided
      else if (extractedData.topics && extractedData.topics.length > 0 && !extractedData.isJoinRequest) {
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

              timingUpdateResult = await recalculateOptimalTiming(bestMatch);
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
        timingUpdateResult = await handleStudentTimingUpdate(
          user, 
          session, 
          extractedData.availability, 
          extractedData.isReplaceTimings
        );
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
        matchingSessionsCount: matchingSessions.length,
        timingUpdateResult: timingUpdateResult
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
Timing update result: ${timingUpdateResult ? JSON.stringify(timingUpdateResult) : 'None'}

${session ? `Current session: ${session.topic} with ${session.studentIds.length} students` : 'No current session'}

Generate a helpful response that:
1. Acknowledges their message contextually
2. Explains the action taken
3. If timing was updated, explain the impact on scheduling
4. If joined/updated session, confirms coordination with teacher
5. If no matches, politely just inform them no lengthy text
7. Maintains encouraging tone

Keep onpoint and concise`;

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
      timingUpdateResult,
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

// NEW: Handle student leaving with proper cleanup
async function handleStudentLeaving(user, session) {
  console.log(`Student ${user.name} leaving session ${session._id}`);
  
  // Store original schedule for comparison
  const originalSchedule = session.schedule ? { ...session.schedule } : null;
  
  // Remove student from session
  session.studentIds = session.studentIds.filter(id => !id.equals(user._id));
  
  // Remove student's timing preferences
  if (session.studentTimingPreferences) {
    session.studentTimingPreferences = session.studentTimingPreferences.filter(
      pref => !pref.studentId.equals(user._id)
    );
  }
  
  let action = 'left_session';
  
  // Check if session should be deleted or updated
  if (session.studentIds.length === 0) {
    // No students left, delete the session
    await Session.deleteOne({ _id: session._id });
    action = 'session_deleted';
    session = null;
    console.log(`Session ${session._id} deleted - no students remaining`);
  } else {
    // Recalculate timing for remaining students
    const timingResult = await recalculateOptimalTiming(session);
    await session.save();
    
    // Check if schedule changed significantly
    if (originalSchedule && session.schedule) {
      const scheduleChanged = (
        originalSchedule.startTime !== session.schedule.startTime ||
        originalSchedule.endTime !== session.schedule.endTime ||
        originalSchedule.date !== session.schedule.date
      );
      
      if (scheduleChanged) {
        action = 'left_session_schedule_changed';
        console.log(`Session schedule changed after student left:`, {
          original: originalSchedule,
          new: session.schedule
        });
      }
    }
    
    console.log(`Session ${session._id} updated after student left`);
  }
  
  return { action, session };
}

// NEW: Handle timing updates with proper conflict resolution
async function handleStudentTimingUpdate(user, session, newAvailability, isReplaceTimings) {
  console.log(`Student ${user.name} updating timing preferences, replace: ${isReplaceTimings}`);
  
  if (!session.studentTimingPreferences) {
    session.studentTimingPreferences = [];
  }
  
  // Store original schedule for comparison
  const originalSchedule = session.schedule ? { ...session.schedule } : null;
  
  // Find existing preferences for this student
  const existingPrefIndex = session.studentTimingPreferences.findIndex(
    pref => pref.studentId.equals(user._id)
  );
  
  let updateResult = {
    action: 'timing_updated',
    scheduleChanged: false,
    previousSchedule: originalSchedule,
    newSchedule: null,
    conflictResolution: null
  };
  
  if (existingPrefIndex !== -1) {
    if (isReplaceTimings) {
      // Replace all existing preferences
      session.studentTimingPreferences[existingPrefIndex] = {
        studentId: user._id,
        preferences: newAvailability,
        updatedAt: new Date()
      };
      updateResult.action = 'timing_replaced';
      console.log(`Replaced all timing preferences for student ${user.name}`);
    } else {
      // Add to existing preferences (merge)
      const existingPrefs = session.studentTimingPreferences[existingPrefIndex].preferences;
      const mergedPrefs = mergeTimingPreferences(existingPrefs, newAvailability);
      
      session.studentTimingPreferences[existingPrefIndex] = {
        studentId: user._id,
        preferences: mergedPrefs,
        updatedAt: new Date()
      };
      updateResult.action = 'timing_merged';
      console.log(`Merged timing preferences for student ${user.name}`);
    }
  } else {
    // Add new preferences
    session.studentTimingPreferences.push({
      studentId: user._id,
      preferences: newAvailability,
      updatedAt: new Date()
    });
    updateResult.action = 'timing_added';
    console.log(`Added new timing preferences for student ${user.name}`);
  }
  
  // Recalculate optimal timing
  const timingResult = await recalculateOptimalTiming(session);
  updateResult.newSchedule = session.schedule;
  
  // Check if schedule changed
  if (originalSchedule && session.schedule) {
    const scheduleChanged = (
      originalSchedule.startTime !== session.schedule.startTime ||
      originalSchedule.endTime !== session.schedule.endTime ||
      originalSchedule.date !== session.schedule.date
    );
    
    updateResult.scheduleChanged = scheduleChanged;
    
    if (scheduleChanged) {
      console.log(`Schedule changed after timing update:`, {
        original: originalSchedule,
        new: session.schedule
      });
    }
  }
  
  // Check for conflicts
  updateResult.conflictResolution = timingResult.conflictResolution;
  
  await session.save();
  
  return updateResult;
}

// NEW: Merge timing preferences intelligently
function mergeTimingPreferences(existingPrefs, newPrefs) {
  const merged = [...existingPrefs];
  
  newPrefs.forEach(newPref => {
    const newDate = newPref.date instanceof Date 
      ? newPref.date.toISOString().split('T')[0] 
      : newPref.date;
    
    // Check if there's an existing preference for the same date
    const existingIndex = merged.findIndex(existing => {
      const existingDate = existing.date instanceof Date 
        ? existing.date.toISOString().split('T')[0] 
        : existing.date;
      return existingDate === newDate;
    });
    
    if (existingIndex !== -1) {
      // Replace existing preference for this date
      merged[existingIndex] = newPref;
    } else {
      // Add new preference
      merged.push(newPref);
    }
  });
  
  return merged;
}

// IMPROVED: Enhanced timing calculation with better conflict resolution
async function recalculateOptimalTiming(session) {
  console.log(`Recalculating timing for session ${session._id}`);
  
  let result = {
    success: false,
    conflictResolution: null,
    studentsAccommodated: 0,
    totalStudents: session.studentIds.length
  };
  
  if (!session.teacherAvailability || session.teacherAvailability.length === 0) {
    console.log('No teacher availability found for session', session._id);
    session.status = 'pending';
    result.conflictResolution = 'no_teacher_availability';
    return result;
  }

  if (!session.studentTimingPreferences || session.studentTimingPreferences.length === 0) {
    // If no student preferences, use first teacher slot
    session.schedule = session.teacherAvailability[0];
    session.status = 'scheduled';
    result.success = true;
    result.conflictResolution = 'using_teacher_availability_only';
    console.log('No student preferences, using first teacher slot');
    return result;
  }

  // Collect all student preferences
  const allStudentPreferences = session.studentTimingPreferences.flatMap(
    pref => pref.preferences
  );

  console.log(`Processing ${session.studentTimingPreferences.length} students with ${allStudentPreferences.length} total preferences`);

  // Try to find optimal timing for ALL students
  const optimalTiming = findOptimalTimingForAllStudents(
    session.teacherAvailability,
    allStudentPreferences
  );

  if (optimalTiming) {
    session.schedule = optimalTiming;
    session.status = 'scheduled';
    result.success = true;
    result.studentsAccommodated = session.studentIds.length;
    result.conflictResolution = 'perfect_match';
    console.log('Found optimal timing for all students:', optimalTiming);
  } else {
    // Find best compromise
    const compromiseResult = findBestCompromiseTiming(
      session.teacherAvailability,
      allStudentPreferences,
      session.studentIds.length
    );
    
    if (compromiseResult.timing) {
      session.schedule = compromiseResult.timing;
      session.status = compromiseResult.studentsAccommodated === session.studentIds.length ? 'scheduled' : 'coordinated';
      result.success = true;
      result.studentsAccommodated = compromiseResult.studentsAccommodated;
      result.conflictResolution = 'compromise_solution';
      console.log(`Using compromise timing accommodating ${compromiseResult.studentsAccommodated}/${session.studentIds.length} students`);
    } else {
      session.status = 'pending';
      result.conflictResolution = 'no_suitable_timing';
      console.log('No suitable timing found, session remains pending');
    }
  }
  
  return result;
}

function findOptimalTimingForAllStudents(teacherAvailability, allStudentPreferences) {
  if (!teacherAvailability || teacherAvailability.length === 0) {
    return null;
  }

  if (!allStudentPreferences || allStudentPreferences.length === 0) {
    return teacherAvailability[0];
  }

  // Group student preferences by date
  const preferencesByDate = {};
  allStudentPreferences.forEach(pref => {
    const dateKey = pref.date instanceof Date 
      ? pref.date.toISOString().split('T')[0]
      : pref.date;
    
    if (!preferencesByDate[dateKey]) {
      preferencesByDate[dateKey] = [];
    }
    preferencesByDate[dateKey].push(pref);
  });

  // Find overlapping times for each date
  for (const teacherSlot of teacherAvailability) {
    const teacherDate = teacherSlot.date instanceof Date
      ? teacherSlot.date.toISOString().split('T')[0]
      : teacherSlot.date;
    
    const studentPrefsForDate = preferencesByDate[teacherDate];
    
    if (!studentPrefsForDate || studentPrefsForDate.length === 0) {
      continue;
    }

    // Find time window that overlaps with ALL student preferences for this date
    const overlap = findTimeOverlapForAllStudents(teacherSlot, studentPrefsForDate);
    
    if (overlap) {
      return {
        date: teacherSlot.date,
        day: teacherSlot.day,
        startTime: overlap.startTime,
        endTime: overlap.endTime,
        timezone: teacherSlot.timezone || 'UTC'
      };
    }
  }

  return null;
}

function findTimeOverlapForAllStudents(teacherSlot, studentPrefsForDate) {
  let overlapStart = teacherSlot.startTime;
  let overlapEnd = teacherSlot.endTime;

  // For each student preference, narrow down the overlap window
  for (const studentPref of studentPrefsForDate) {
    const studentStart = studentPref.startTime;
    const studentEnd = studentPref.endTime;

    // Check if there's any overlap with this student
    if (studentStart >= overlapEnd || studentEnd <= overlapStart) {
      return null; // No overlap with this student
    }

    // Narrow the overlap window
    overlapStart = overlapStart > studentStart ? overlapStart : studentStart;
    overlapEnd = overlapEnd < studentEnd ? overlapEnd : studentEnd;
  }

  // Check if we still have a valid time window (at least 30 minutes)
  const startMinutes = parseInt(overlapStart.split(':')[0]) * 60 + parseInt(overlapStart.split(':')[1]);
  const endMinutes = parseInt(overlapEnd.split(':')[0]) * 60 + parseInt(overlapEnd.split(':')[1]);
  
  if (endMinutes - startMinutes >= 30) {
    return {
      startTime: overlapStart,
      endTime: overlapEnd
    };
  }

  return null;
}

// IMPROVED: Better compromise timing with detailed metrics
function findBestCompromiseTiming(teacherAvailability, allStudentPreferences, totalStudents) {
  if (!teacherAvailability || teacherAvailability.length === 0) {
    return { timing: null, studentsAccommodated: 0 };
  }

  let bestMatch = null;
  let maxCompatibleStudents = 0;
  let bestCompromiseWindow = null;

  // Try each teacher slot
  for (const teacherSlot of teacherAvailability) {
    const teacherDate = teacherSlot.date instanceof Date
      ? teacherSlot.date.toISOString().split('T')[0]
      : teacherSlot.date;

    // Find all student preferences for this date
    const relevantStudentPrefs = allStudentPreferences.filter(pref => {
      const studentDate = pref.date instanceof Date
        ? pref.date.toISOString().split('T')[0]
        : pref.date;
      return teacherDate === studentDate;
    });

    if (relevantStudentPrefs.length === 0) {
      continue;
    }

    // Find the best compromise window for this teacher slot
    const compromiseResult = findBestCompromiseWindow(teacherSlot, relevantStudentPrefs);
    
    if (compromiseResult.studentsAccommodated > maxCompatibleStudents) {
      maxCompatibleStudents = compromiseResult.studentsAccommodated;
      bestMatch = {
        date: teacherSlot.date,
        day: teacherSlot.day,
        startTime: compromiseResult.startTime,
        endTime: compromiseResult.endTime,
        timezone: teacherSlot.timezone || 'UTC'
      };
    }
  }

  return {
    timing: bestMatch,
    studentsAccommodated: maxCompatibleStudents
  };
}

// NEW: Find best compromise window within a teacher slot
function findBestCompromiseWindow(teacherSlot, studentPrefs) {
  let bestWindow = null;
  let maxStudents = 0;

  // Try different time windows within the teacher slot
  const teacherStartMinutes = timeToMinutes(teacherSlot.startTime);
  const teacherEndMinutes = timeToMinutes(teacherSlot.endTime);

  // Generate possible time windows (30-minute intervals)
  for (let startMinutes = teacherStartMinutes; startMinutes < teacherEndMinutes - 30; startMinutes += 15) {
    for (let endMinutes = startMinutes + 30; endMinutes <= teacherEndMinutes; endMinutes += 15) {
      const windowStart = minutesToTime(startMinutes);
      const windowEnd = minutesToTime(endMinutes);

      // Count how many students can work in this window
      let compatibleStudents = 0;
      for (const studentPref of studentPrefs) {
        if (studentPref.startTime <= windowStart && studentPref.endTime >= windowEnd) {
          compatibleStudents++;
        }
      }

      if (compatibleStudents > maxStudents) {
        maxStudents = compatibleStudents;
        bestWindow = {
          startTime: windowStart,
          endTime: windowEnd,
          studentsAccommodated: compatibleStudents
        };
      }
    }
  }

  return bestWindow || { startTime: teacherSlot.startTime, endTime: teacherSlot.endTime, studentsAccommodated: 0 };
}

// Helper functions
function timeToMinutes(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}