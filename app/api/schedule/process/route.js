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

// Fixed handleTeacherInput function with proper database operations
async function handleTeacherInput(user, message, embedding, session, context, res) {
  try {
    const contextString = context.conversationHistory.length > 0 
      ? `Previous conversation context:\n${context.conversationHistory.map(c => 
          `${c.role}: ${c.message}`
        ).join('\n')}\n\n`
      : '';

    const prompt = `${contextString}Current teacher message: "${message}"

IMPORTANT CONTEXT: Current session status: ${session ? 'EXISTS' : 'NO_SESSION'}
${session ? `Current session details: Topic: "${session.topic}", Scheduled: ${session.schedule?.date} ${session.schedule?.startTime}-${session.schedule?.endTime}` : ''}

Analyze this teacher message and determine intent:

CRITICAL DECISION LOGIC:
- If the message offers teaching for a DIFFERENT subject/topic than existing session → isNewSession: true
- If the message offers teaching at a COMPLETELY DIFFERENT time/date than existing session → isNewSession: true  
- If the message uses words like "also", "another", "different", "new" → isNewSession: true
- If the message uses words like "update", "change", "modify" existing session → isUpdate: true
- If the message is clearly about canceling → isCancel: true
- IMPORTANT: If canceling, specify the cancelSubject (what subject/topic they're canceling)
- If they mention canceling a different subject than current session → check if cancelSubject matches current session topic
- Default for new availability offerings → isNewSession: true

Extract and return ONLY valid JSON:
- expertise: array of topic strings
- availability: array of objects with:
  - date: in YYYY-MM-DD format (future dates only)
  - day: weekday name (Monday-Sunday)
  - startTime: in 24-hour format (HH:MM)
  - endTime: in 24-hour format (HH:MM)
  - timezone: if specified (e.g., "EST")
- preferences: object with any session preferences
- isUpdate: boolean (true ONLY if explicitly updating existing session)
- isCancel: boolean (true if canceling/deleting a session)
- isNewSession: boolean (true if this is a new/separate session - DEFAULT for new offerings)
- cancelSubject: string (if isCancel is true, what subject/topic are they canceling - extract from message)

Current date: ${new Date().toISOString().split('T')[0]}

Example format:
{
  "expertise": ["JavaScript"],
  "availability": [
    {
      "date": "2025-07-12",
      "day": "Saturday",
      "startTime": "10:00",
      "endTime": "12:00",
      "timezone": "UTC"
    }
  ],
  "preferences": {},
  "isUpdate": false,
  "isCancel": false,
  "isNewSession": true,
  "cancelSubject": ""
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

    // Helper function to check if cancellation matches session topic
    function doesCancellationMatchSession(cancelSubject, session) {
      if (!session || !cancelSubject) return false;
      
      const sessionTopic = session.topic.toLowerCase();
      const cancelTopic = cancelSubject.toLowerCase();
      
      // Direct match
      if (sessionTopic.includes(cancelTopic) || cancelTopic.includes(sessionTopic)) {
        return true;
      }
      
      // Handle common aliases
      const aliases = {
        'js': 'javascript',
        'javascript': 'js',
        'go': 'golang',
        'golang': 'go',
        'py': 'python',
        'python': 'py',
        'react': 'reactjs',
        'reactjs': 'react',
        'node': 'nodejs',
        'nodejs': 'node'
      };
      
      const normalizedCancel = aliases[cancelTopic] || cancelTopic;
      const normalizedSession = aliases[sessionTopic] || sessionTopic;
      
      return sessionTopic.includes(normalizedCancel) || 
             cancelTopic.includes(normalizedSession) ||
             normalizedSession.includes(cancelTopic) ||
             normalizedCancel.includes(sessionTopic);
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
    let currentSession = session; // Use a local variable to track session changes
    
    // Handle session cancellation with improved logic
    if (extractedData.isCancel) {
      let sessionToDelete = null;
      
      // If there's a current session in context
      if (currentSession) {
        // Check if the cancellation is for the current session's topic
        if (extractedData.cancelSubject) {
          if (doesCancellationMatchSession(extractedData.cancelSubject, currentSession)) {
            sessionToDelete = currentSession;
          } else {
            // They're trying to cancel a different topic than current session
            sessionAction = 'cancellation_topic_mismatch';
          }
        } else {
          // No specific subject mentioned, assume they mean current session
          sessionToDelete = currentSession;
        }
      } else {
        // No session in context, try to find specific session by topic
        if (extractedData.cancelSubject) {
          const existingSession = await Session.findOne({
            teacherId: user._id,
            status: { $in: ['pending', 'coordinated', 'scheduled'] }, // Added 'scheduled'
            topic: { $regex: new RegExp(extractedData.cancelSubject, 'i') }
          }).sort({ createdAt: -1 });
          
          if (existingSession) {
            sessionToDelete = existingSession;
          } else {
            sessionAction = 'no_matching_session_to_delete';
          }
        } else {
          // No specific subject and no session in context, find any session
          const existingSession = await Session.findOne({
            teacherId: user._id,
            status: { $in: ['pending', 'coordinated', 'scheduled'] } // Added 'scheduled'
          }).sort({ createdAt: -1 });
          
          if (existingSession) {
            sessionToDelete = existingSession;
          } else {
            sessionAction = 'no_session_to_delete';
          }
        }
      }
      
      // Actually delete the session if found
      if (sessionToDelete) {
        try {
          await Session.findByIdAndDelete(sessionToDelete._id);
          currentSession = null;
          sessionAction = 'deleted';
          console.log('Session deleted:', sessionToDelete._id);
        } catch (deleteError) {
          console.error('Error deleting session:', deleteError);
          sessionAction = 'delete_failed';
          return res.status(500).json({ error: 'Failed to delete session' });
        }
      }
    }
    // Handle session creation/update
    else if (extractedData.availability && extractedData.availability.length > 0) {
      
      // IMPROVED LOGIC: Default to creating new sessions unless explicitly updating
      let shouldCreateNewSession = true;
      
      // Only update existing session if explicitly marked as update
      if (extractedData.isUpdate) {
        if (currentSession) {
          shouldCreateNewSession = false;
        } else {
          // Try to find existing session for update
          try {
            const existingSession = await Session.findOne({
              teacherId: user._id,
              status: { $in: ['pending', 'coordinated', 'scheduled'] }
            }).sort({ createdAt: -1 });
            
            if (existingSession) {
              currentSession = existingSession;
              shouldCreateNewSession = false;
              console.log('Found existing session for update:', existingSession._id);
            } else {
              console.log('No existing session found for update, will create new');
            }
          } catch (findError) {
            console.error('Error finding session for update:', findError);
          }
        }
      }

      if (shouldCreateNewSession) {
        // CREATE NEW SESSION
        try {
          const firstSlot = extractedData.availability[0];
          const newSession = new Session({
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
          
          const savedSession = await newSession.save();
          currentSession = savedSession;
          sessionAction = 'created_new';
          console.log('New session created:', savedSession._id);
        } catch (createError) {
          console.error('Error creating new session:', createError);
          sessionAction = 'create_failed';
          return res.status(500).json({ error: 'Failed to create new session' });
        }
      } 
      else if (currentSession) {
        // UPDATE EXISTING SESSION
        try {
          // CRITICAL FIX: Always fetch the latest session from DB before updating
          const sessionFromDB = await Session.findById(currentSession._id);
          if (!sessionFromDB) {
            console.error('Session not found in database for update');
            sessionAction = 'session_not_found';
            return res.status(404).json({ error: 'Session not found for update' });
          }

          console.log('Updating existing session:', sessionFromDB._id);
          console.log('Previous availability:', sessionFromDB.teacherAvailability);
          console.log('New availability:', extractedData.availability);

          // Update availability
          sessionFromDB.teacherAvailability = extractedData.availability;
          
          // Update topic if expertise is provided
          if (extractedData.expertise && extractedData.expertise.length > 0) {
            sessionFromDB.topic = extractedData.expertise.join(', ');
          }

          // If there are student preferences, coordinate timing
          if (sessionFromDB.studentTimingPreferences && sessionFromDB.studentTimingPreferences.length > 0) {
            const allStudentPrefs = sessionFromDB.studentTimingPreferences.flatMap(
              pref => pref.preferences || []
            );
            
            const optimalTiming = findOptimalTiming(
              extractedData.availability, 
              allStudentPrefs
            );
            
            if (optimalTiming) {
              sessionFromDB.schedule = optimalTiming;
              sessionFromDB.status = 'coordinated';
              console.log('Updated schedule with optimal timing:', optimalTiming);
            }
          } else {
            // No student preferences, use first available slot
            const firstSlot = extractedData.availability[0];
            sessionFromDB.schedule = {
              date: firstSlot.date,
              day: firstSlot.day,
              startTime: firstSlot.startTime,
              endTime: firstSlot.endTime,
              timezone: firstSlot.timezone || 'UTC'
            };
            console.log('Updated schedule with first available slot:', sessionFromDB.schedule);
          }

          // CRITICAL FIX: Ensure we save the session properly
          const savedSession = await sessionFromDB.save();
          currentSession = savedSession;
          sessionAction = 'updated_existing';
          console.log('Session updated successfully:', savedSession._id);
          console.log('Updated availability:', savedSession.teacherAvailability);
          
        } catch (updateError) {
          console.error('Error updating session:', updateError);
          console.error('Update error details:', updateError.message);
          sessionAction = 'update_failed';
          return res.status(500).json({ error: 'Failed to update session: ' + updateError.message });
        }
      }
    }

    // Store context
    const newContext = new Context({
      sessionId: currentSession?._id,
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
      sessionId: currentSession?._id?.toString() || '',
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

    // CRITICAL FIX: Ensure context is saved properly
    try {
      await Promise.all([
        newContext.save(),
        index.namespace('conversations').upsert([{
          id: vectorId,
          values: embedding,
          metadata: pineconeMetadata
        }])
      ]);
      console.log('Context saved successfully');
    } catch (contextError) {
      console.error('Error saving context:', contextError);
      // Don't fail the entire request for context save issues
    }

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
      case 'cancellation_topic_mismatch':
        responsePrompt = `You are responding to teacher ${user.name}. They tried to cancel a session for "${extractedData.cancelSubject}" but their current active session is for "${currentSession?.topic}". Let them know their current ${currentSession?.topic} session is still active, and ask if they want to cancel that instead or if they meant something else.`;
        break;
      case 'no_matching_session_to_delete':
        responsePrompt = `You are responding to teacher ${user.name}. They tried to cancel a session for "${extractedData.cancelSubject}" but no matching session was found for that topic. Politely inform them that no matching session was found to cancel.`;
        break;
      case 'session_not_found':
        responsePrompt = `You are responding to teacher ${user.name}. They tried to update a session but the session could not be found in the database. Politely inform them that the session was not found and suggest creating a new one.`;
        break;
      case 'update_failed':
        responsePrompt = `You are responding to teacher ${user.name}. There was an error updating their session. Apologize for the technical issue and suggest they try again.`;
        break;
      case 'create_failed':
        responsePrompt = `You are responding to teacher ${user.name}. There was an error creating their new session. Apologize for the technical issue and suggest they try again.`;
        break;
      default:
        responsePrompt = `You are responding to teacher ${user.name} in an ongoing conversation.

Previous conversation:
${previousMessages}

Current message: "${message}"
Session action taken: ${sessionAction}
Current students enrolled: ${currentSession?.studentIds?.length || 0}

Generate a response that:
1. Acknowledges their message contextually
2. Confirms the session action taken (${sessionAction === 'updated_existing' ? 'availability updated' : sessionAction === 'created_new' ? 'new session created' : 'processed'})
3. If students are enrolled, mentions coordination with student preferences
4. Provides clear next steps
5. Maintains professional but friendly tone

Keep response concise and helpful.No placeholders ( keep it to the point ).`;
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: responsePrompt }],
      temperature: 0.7
    });

    // CRITICAL FIX: Return the updated session
    return res.json({
      success: true,
      response: response.choices[0].message.content,
      session: currentSession || null,
      sessionAction: sessionAction,
      extractedData,
      contextUsed: {
        previousMessages: context.conversationHistory.length,
        contextMatches: context.contextMatches.length
      }
    });

  } catch (error) {
    console.error('Error in handleTeacherInput:', error);
    console.error('Error stack:', error.stack);
    return res.status(500).json({ error: 'Error processing teacher input: ' + error.message });
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
- isLeaving: boolean (true if wanting to leave/remove from session, cancel participation, can't attend, won't be available, etc.)
- isReplaceTimings: boolean (true if replacing all previous timings, false if adding to existing)

IMPORTANT: Set isLeaving to true if the student expresses:
- Cannot attend the session
- Won't be available 
- Wants to cancel participation
- Needs to drop out
- Can't make it to the session
- Has to leave the session
- Remove me from session
- Any similar cancellation intent

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
    let removalResult = null;

    // Handle leaving session - Enhanced logic
    if (extractedData.isLeaving) {
      if (session) {
        // Remove student from current session
        removalResult = await handleStudentLeaving(user, session);
        sessionAction = removalResult.action;
        session = removalResult.session;
      } else {
        // If no current session, try to find sessions the student is enrolled in
        const enrolledSessions = await Session.find({
          studentIds: user._id,
          status: { $in: ['pending', 'coordinated', 'scheduled'] }
        }).populate('teacherId', 'name email');

        if (enrolledSessions.length > 0) {
          // Remove from all enrolled sessions or the most recent one
          const sessionToLeave = enrolledSessions[0]; // or let user choose
          removalResult = await handleStudentLeaving(user, sessionToLeave);
          sessionAction = removalResult.action;
          session = removalResult.session;
        } else {
          sessionAction = 'no_sessions_to_leave';
        }
      }
    }
    // Handle joining or timing updates - ONLY if explicit join request
    else if (extractedData.isJoinRequest) {
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
      if (matchingSessions.length > 0) {
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
    // Handle information requests (topics mentioned but no join request)
    else if (extractedData.topics && extractedData.topics.length > 0) {
      // Find matching sessions for information only
      matchingSessions = await Session.find({
        $and: [
          {
            $or: [
              { topic: { $in: extractedData.topics } },
              { topic: { $regex: extractedData.topics.join('|'), $options: 'i' } }
            ]
          },
          { status: { $in: ['pending', 'coordinated', 'scheduled'] } },
          { teacherId: { $exists: true, $ne: null } }
        ]
      })
      .populate('teacherId', 'name email')
      .populate('studentIds', 'name email')
      .limit(5);

      sessionAction = 'information_request';
    }
    // Handle general session listing requests
    else if (message.toLowerCase().includes('list all sessions') || 
             message.toLowerCase().includes('show all sessions') ||
             message.toLowerCase().includes('available sessions') ||
             message.toLowerCase().includes('all sessions')) {
      // Get all active sessions
      matchingSessions = await Session.find({
        status: { $in: ['pending', 'coordinated', 'scheduled'] },
        teacherId: { $exists: true, $ne: null }
      })
      .populate('teacherId', 'name email')
      .populate('studentIds', 'name email')
      .limit(10);

      sessionAction = 'list_all_sessions';
    }
    else {
      sessionAction = 'awaiting_teacher';
    }

    // Store context
    const newContext = new Context({
      sessionId: session?._id,
      userId: user._id,
      role: 'student',
      message,
      embedding,
      metadata: {
        intent: extractedData.isLeaving ? 'leaving_session' : 
                extractedData.isTimingUpdate ? 'timing_update' : 
                extractedData.isJoinRequest ? 'join_request' : 
                sessionAction === 'list_all_sessions' ? 'list_all_sessions' : 'information_request',
        extractedData,
        sessionAction: sessionAction,
        matchingSessionsCount: matchingSessions.length,
        timingUpdateResult: timingUpdateResult,
        removalResult: removalResult
      }
    });

    const pineconeMetadata = preparePineconeMetadata({
      sessionId: session?._id?.toString() || '',
      userId: user._id.toString(),
      role: 'student',
      message: message.substring(0, 500),
      intent: extractedData.isLeaving ? 'leaving_session' : 
              extractedData.isTimingUpdate ? 'timing_update' : 
              extractedData.isJoinRequest ? 'join_request' : 
              sessionAction === 'list_all_sessions' ? 'list_all_sessions' : 'information_request',
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
Removal result: ${removalResult ? JSON.stringify(removalResult) : 'None'}

${session ? `Current session: ${session.topic} with ${session.studentIds.length} students` : 'No current session'}

Generate a helpful response that:
1. Acknowledges their message contextually
2. Explains the action taken
3. If student was removed from session, confirm the removal and any impact
4. If timing was updated, explain the impact on scheduling
5. If joined/updated session, confirms coordination with teacher
6. If no matches, politely inform them briefly
7. If information request, provide session details without enrollment
8. If list_all_sessions,  list ONLY the actual sessions provided above - DO NOT create any dummy or example sessions
9. Maintains encouraging tone

Keep it concise and to the point. No placeholders.`;

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
      intent: extractedData.isLeaving ? 'leaving_session' : 
              extractedData.isTimingUpdate ? 'timing_update' : 
              extractedData.isJoinRequest ? 'join_request' : 
              sessionAction === 'list_all_sessions' ? 'list_request' : 'inquiry',
      matchingSessions: sessionAction === 'list_all_sessions' ? [] : matchingSessions.map(s => ({
        id: s._id,
        topic: s.topic,
        teacherName: s.teacherId?.name,
        currentStudents: s.studentIds.length,
        schedule: s.schedule,
        status: s.status
      })),
      allSessions: sessionAction === 'list_all_sessions' ? matchingSessions.map(s => ({
        id: s._id,
        topic: s.topic,
        teacherName: s.teacherId?.name,
        currentStudents: s.studentIds.length,
        schedule: s.schedule,
        status: s.status
      })) : [],
      extractedData,
      timingUpdateResult,
      removalResult,
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
// Enhanced handleStudentLeaving function
async function handleStudentLeaving(user, session) {
  try {
    console.log(`Processing student leaving: ${user.name} from session ${session._id}`);
    
    // Check if student is actually enrolled
    const isEnrolled = session.studentIds.some(studentId => 
      studentId.toString() === user._id.toString()
    );
    
    if (!isEnrolled) {
      return {
        action: 'not_enrolled',
        session: session,
        message: 'Student was not enrolled in this session'
      };
    }
    
    // Remove student from session
    session.studentIds = session.studentIds.filter(studentId => 
      studentId.toString() !== user._id.toString()
    );
    
    // Remove student's timing preferences
    if (session.studentTimingPreferences) {
      session.studentTimingPreferences = session.studentTimingPreferences.filter(pref => 
        pref.studentId.toString() !== user._id.toString()
      );
    }
    
    // Recalculate optimal timing if other students remain
    let timingRecalculated = false;
    if (session.studentIds.length > 0) {
      const recalculateResult = await recalculateOptimalTiming(session);
      timingRecalculated = recalculateResult.success;
    }
    
    // Update session status if no students left
    if (session.studentIds.length === 0) {
      session.status = 'pending'; // Reset to pending for new students
    }
    
    await session.save();
    
    console.log(`Student ${user.name} successfully removed from session ${session._id}`);
    
    return {
      action: 'student_removed',
      session: session,
      studentsRemaining: session.studentIds.length,
      timingRecalculated: timingRecalculated,
      message: `Student removed successfully. ${session.studentIds.length} students remaining.`
    };
    
  } catch (error) {
    console.error('Error in handleStudentLeaving:', error);
    return {
      action: 'error',
      session: session,
      message: 'Error removing student from session'
    };
  }
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