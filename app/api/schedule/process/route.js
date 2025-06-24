import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { User } from '@/models/user';
import { Session } from '@/models/session';
import { Context } from '@/models/context';
import mongoose from 'mongoose';
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

function validateFutureDate(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  // Allow dates from today onwards (more lenient)
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
  
  // If it's the same day, assume next week unless it's still early in the day
  if (diff === 0 && today.getHours() > 12) {
    diff = 7;
  } else if (diff < 0) {
    diff += 7; // Move to next week
  } else if (diff === 0) {
    // Same day, keep it if it's early enough, otherwise next week
    diff = today.getHours() > 12 ? 7 : 0;
  }
  
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + diff);
  return targetDate.toISOString().split('T')[0];
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

    return history.reverse(); // Return in chronological order
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
      session = await Session.findById(sessionId);
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

// Teacher processing logic
async function handleTeacherInput(user, message, embedding, session, context, res) {
  try {
    // Build context for the AI to understand the conversation
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
  "isUpdate": true
}

Important rules:
1. Always convert times to 24-hour format
2. For relative days (like "Sunday", "next Monday"), calculate the actual date
3. If time isn't specified, use reasonable defaults (09:00-17:00)
4. Include timezone if mentioned
5. Set isUpdate to true if this appears to be updating/adding to previous availability

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
      // Fallback without structured output
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

    // Process availability dates with improved logic
    if (extractedData.availability) {
      extractedData.availability = extractedData.availability.map(slot => {
        // Calculate date if only day is provided
        if (!slot.date && slot.day) {
          slot.date = calculateDateFromRelative(slot.day);
        }
        // Convert times to 24-hour format
        slot.startTime = convertTo24Hour(slot.startTime);
        slot.endTime = convertTo24Hour(slot.endTime);
        return slot;
      }).filter(slot => {
        // More lenient date validation
        return slot.date && validateFutureDate(slot.date);
      });
    }

    // Enhanced session management with proper CRUD operations
    let sessionAction = 'none';
    
    if (extractedData.availability && extractedData.availability.length > 0) {
      if (!session) {
        // Check if teacher has any existing pending sessions to update instead of creating new
        const existingSession = await Session.findOne({
          teacherId: user._id,
          status: 'pending'
        }).sort({ createdAt: -1 });

        if (existingSession && extractedData.isUpdate) {
          // Update existing session
          session = existingSession;
          sessionAction = 'updated_existing';
        } else {
          // Create new session
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
            status: 'pending'
          });
        }
      } else {
        sessionAction = 'updated_current';
      }

      // Update session with new availability (either new or existing)
      if (extractedData.availability.length === 1) {
        // Single slot - update main schedule
        const newSlot = extractedData.availability[0];
        session.schedule = {
          date: newSlot.date,
          day: newSlot.day,
          startTime: newSlot.startTime,
          endTime: newSlot.endTime,
          timezone: newSlot.timezone || session.schedule?.timezone || 'UTC'
        };
      } else {
        // Multiple slots - store additional slots
        const mainSlot = extractedData.availability[0];
        session.schedule = {
          date: mainSlot.date,
          day: mainSlot.day,
          startTime: mainSlot.startTime,
          endTime: mainSlot.endTime,
          timezone: mainSlot.timezone || session.schedule?.timezone || 'UTC'
        };
        
        // Store additional slots in metadata
        session.additionalSlots = extractedData.availability.slice(1);
      }

      // Update topic if expertise is provided
      if (extractedData.expertise && extractedData.expertise.length > 0) {
        session.topic = extractedData.expertise.join(', ');
      }

      await session.save();
    }

    // Handle session deletion/cancellation
    const cancelKeywords = ['cancel', 'delete', 'remove', 'not available', 'unavailable', 'withdraw'];
    const hasCancelIntent = cancelKeywords.some(keyword => 
      message.toLowerCase().includes(keyword)
    );

    if (hasCancelIntent && session) {
      // Check if they want to cancel the session
      const cancelConfirmation = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{
          role: 'user',
          content: `Does this message indicate the teacher wants to cancel/delete their teaching session? Message: "${message}". Answer only YES or NO.`
        }],
        temperature: 0.1
      });

      if (cancelConfirmation.choices[0].message.content.trim().toUpperCase() === 'YES') {
        await Session.findByIdAndDelete(session._id);
        session = null;
        sessionAction = 'deleted';
      }
    }

    // Find matching sessions after handling student session management
    let matchingSessions = [];
    if (extractedData.topics && extractedData.topics.length > 0) {
      matchingSessions = await Session.find({
        $or: [
          { topic: { $in: extractedData.topics } },
          { topic: { $regex: extractedData.topics.join('|'), $options: 'i' } }
        ],
        status: 'pending',
        teacherId: { $exists: true, $ne: null } // Only sessions with teachers
      })
      .populate('teacherId', 'name')
      .limit(5);
    }
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

    // Generate contextual response
    const previousMessages = context.conversationHistory.map(c => 
      `${c.role === 'teacher' ? 'Teacher' : 'Student'}: ${c.message}`
    ).join('\n');

    const responsePrompt = `You are responding to teacher ${user.name} in an ongoing conversation.

Previous conversation:
${previousMessages}

Current message: "${message}"

Session action taken: ${sessionAction}

Extracted information:
- Topics: ${extractedData.expertise?.join(', ') || 'Not specified'}
- Availability slots: ${extractedData.availability?.length || 0}
${extractedData.availability?.map(slot => 
  `  - ${slot.day} ${slot.date} from ${slot.startTime} to ${slot.endTime}`
).join('\n') || '  - None specified'}
- Is this an update: ${extractedData.isUpdate ? 'Yes' : 'No'}

Generate a personalized response that:
1. Acknowledges their current message in context of the conversation
2. ${sessionAction === 'created_new' ? 'Confirms the new session has been created' : 
    sessionAction === 'updated_existing' || sessionAction === 'updated_current' ? 'Confirms their availability has been updated' :
    sessionAction === 'deleted' ? 'Confirms their session has been cancelled/removed' :
    'Responds appropriately to their message'}
3. ${extractedData.availability?.length > 0 ? 
   'Thanks them for providing their schedule and confirms the session details' : 
   sessionAction === 'deleted' ? 'Acknowledges the cancellation' :
   'Politely notes that no specific availability was detected and asks for clarification'}
4. Maintains a professional but friendly tone
5. Uses their name appropriately

Keep the response concise and relevant to the conversation flow.`;

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

// Student processing logic
// Fixed Student processing logic
async function handleStudentInput(user, message, embedding, session, context, res) {
  try {
    // Build context for the AI to understand the conversation
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
  - timeRange: ("morning", "afternoon", "evening") or exact times in 24-hour format
  - timezone: if specified
- preferences: object with learning preferences
- isFollowUp: boolean (true if this is a follow-up to previous messages)

Current date: ${new Date().toISOString().split('T')[0]}

Example format:
{
  "topics": ["React", "JavaScript"],
  "availability": [
    {
      "date": "2025-06-29",
      "day": "Saturday",
      "timeRange": "10:00-12:00",
      "timezone": "PST"
    }
  ],
  "preferences": {
    "style": "interactive",
    "level": "beginner"
  },
  "isFollowUp": false
}

Important rules:
1. Convert all time references to 24-hour format
2. Calculate specific dates when relative days are mentioned
3. Convert time ranges to specific times (morning=09:00-12:00, afternoon=13:00-17:00, evening=18:00-21:00)
4. Include timezone if mentioned
5. Set isFollowUp to true if this appears to be continuing a previous conversation

RESPOND WITH ONLY THE JSON OBJECT, NO OTHER TEXT.`;

    const extraction = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ 
        role: 'user', 
        content: prompt
      }],
      response_format: { type: "json_object" },
      temperature: 0.3
    });

    let extractedData;
    try {
      extractedData = JSON.parse(extraction.choices[0].message.content);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      // Fallback without structured output
      const fallbackExtraction = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ 
          role: 'user', 
          content: prompt + '\n\nIMPORTANT: Respond with ONLY valid JSON in the exact format specified, with no additional text or explanation.'
        }],
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
        // Calculate date if only day is provided
        if (!slot.date && slot.day) {
          slot.date = calculateDateFromRelative(slot.day);
        }
        
        // Convert time ranges to specific times
        if (slot.timeRange) {
          if (slot.timeRange === 'morning') {
            slot.startTime = '09:00';
            slot.endTime = '12:00';
          } else if (slot.timeRange === 'afternoon') {
            slot.startTime = '13:00';
            slot.endTime = '17:00';
          } else if (slot.timeRange === 'evening') {
            slot.startTime = '18:00';
            slot.endTime = '21:00';
          } else if (slot.timeRange.includes('-')) {
            const [start, end] = slot.timeRange.split('-');
            slot.startTime = convertTo24Hour(start);
            slot.endTime = convertTo24Hour(end);
          }
        }
        return slot;
      }).filter(slot => slot.date && validateFutureDate(slot.date));
    }

    // Find matching sessions based on topics
    let matchingSessions = [];
    if (extractedData.topics && extractedData.topics.length > 0) {
      matchingSessions = await Session.find({
        $or: [
          { topic: { $in: extractedData.topics } },
          { topic: { $regex: extractedData.topics.join('|'), $options: 'i' } }
        ],
        status: 'pending',
        teacherId: { $exists: true, $ne: null } // Only sessions with teachers
      })
      .populate('teacherId', 'name email')
      .limit(5);
    }

    // Enhanced session management for students - FIX: Use correct schema
    let sessionAction = 'none';
    
    // Handle session enrollment/updates for students
    if (extractedData.topics && extractedData.topics.length > 0) {
      // Check if student wants to join an existing session
      if (matchingSessions.length > 0) {
        // Find the best matching session
        const bestMatch = matchingSessions[0];
        
        // Check if student is already enrolled in this session
        if (!bestMatch.studentIds.includes(user._id)) {
          // Add student to the session
          bestMatch.studentIds.push(user._id);
          await bestMatch.save();
          session = bestMatch;
          sessionAction = 'joined_session';
        } else {
          session = bestMatch;
          sessionAction = 'already_enrolled';
        }
      } else {
        // No matching sessions found - create a session request (using a different approach)
        // Since the schema doesn't support student-initiated sessions directly,
        // we'll store this as context and wait for teacher availability
        sessionAction = 'awaiting_teacher';
      }
    }

    // Handle session cancellation/withdrawal for students
    const cancelKeywords = ['cancel', 'delete', 'remove', 'not interested', 'withdraw', 'leave'];
    const hasCancelIntent = cancelKeywords.some(keyword => 
      message.toLowerCase().includes(keyword)
    );

    if (hasCancelIntent && session) {
      const cancelConfirmation = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{
          role: 'user',
          content: `Does this message indicate the student wants to leave/cancel their session enrollment? Message: "${message}". Answer only YES or NO.`
        }],
        temperature: 0.1
      });

      if (cancelConfirmation.choices[0].message.content.trim().toUpperCase() === 'YES') {
        // Remove student from session instead of deleting the session
        if (session.studentIds.includes(user._id)) {
          session.studentIds = session.studentIds.filter(id => !id.equals(user._id));
          await session.save();
          sessionAction = 'left_session';
        }
      }
    }

    // Store context in MongoDB
    const newContext = new Context({
      sessionId: session?._id,
      userId: user._id,
      role: 'student',
      message,
      embedding,
      metadata: {
        intent: extractedData.isFollowUp ? 'session_followup' : 'session_inquiry',
        extractedData,
        sessionAction: sessionAction,
        matchingSessionsCount: matchingSessions.length,
        availabilityProvided: extractedData.availability?.length > 0
      }
    });

    const pineconeMetadata = preparePineconeMetadata({
      sessionId: session?._id?.toString() || '',
      userId: user._id.toString(),
      role: 'student',
      message: message.substring(0, 500),
      intent: extractedData.isFollowUp ? 'session_followup' : 'session_inquiry',
      topics: extractedData.topics || [],
      topics_count: extractedData.topics?.length || 0,
      next_available_date: extractedData.availability?.[0]?.date || '',
      is_followup: extractedData.isFollowUp,
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

    // Generate contextual response
    const previousMessages = context.conversationHistory.map(c => 
      `${c.role === 'student' ? 'Student' : 'Teacher'}: ${c.message}`
    ).join('\n');

    const responsePrompt = `You are responding to student ${user.name} in an ongoing conversation.

Previous conversation:
${previousMessages}

Current message: "${message}"

Session action taken: ${sessionAction}

Extracted information:
- Topics requested: ${extractedData.topics?.join(', ') || 'Not specified'}
- Student availability: ${extractedData.availability?.length > 0 ? 
  `${extractedData.availability[0].date} at ${extractedData.availability[0].startTime}-${extractedData.availability[0].endTime}` : 
  'Not specified'}
- Is follow-up: ${extractedData.isFollowUp ? 'Yes' : 'No'}
- Matching sessions found: ${matchingSessions.length}

Available sessions:
${matchingSessions.map(s => 
  `- ${s.topic} with ${s.teacherId?.name} on ${s.schedule.day} ${s.schedule.date} from ${s.schedule.startTime} to ${s.schedule.endTime} (${s.studentIds.length} students enrolled)`
).join('\n') || 'None found'}

Generate a helpful, contextual response that:
1. Acknowledges their message in the context of the ongoing conversation
2. ${sessionAction === 'joined_session' ? 'Confirms they have been enrolled in the matching session' :
    sessionAction === 'already_enrolled' ? 'Notes they are already enrolled in this session' :
    sessionAction === 'left_session' ? 'Confirms they have been removed from the session' :
    sessionAction === 'awaiting_teacher' ? 'Explains that their request has been noted and they will be notified when matching sessions become available' :
    'Addresses their inquiry appropriately'}
3. ${matchingSessions.length > 0 ? 
   'Lists the matching sessions with clear enrollment information and current participant counts' : 
   'Explains that no matches were found and suggests they can either wait for teachers to post availability or specify different topics/times'}
4. Maintains continuity with the previous conversation
5. Uses their name appropriately
6. Provides next steps or guidance on what they can expect

Keep the response helpful, encouraging, and conversational.`;

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
        teacherEmail: s.teacherId?.email,
        currentStudents: s.studentIds.length,
        schedule: {
          date: s.schedule.date,
          day: s.schedule.day,
          startTime: s.schedule.startTime,
          endTime: s.schedule.endTime,
          timezone: s.schedule.timezone || 'UTC'
        },
        isEnrolled: s.studentIds.includes(user._id)
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