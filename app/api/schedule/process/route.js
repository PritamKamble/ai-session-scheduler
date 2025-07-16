import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { User } from '@/models/user';
import { Session } from '@/models/session';
import { Context } from '@/models/context';
import { StudentAvailability } from '@/models/studentAvailability';
import { NextResponse } from 'next/server';
import connectDB from '@/config/db';

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const indexName = process.env.PINECONE_INDEX_NAME || 'conversations';
const index = pinecone.index(indexName);

// Connect to MongoDB
await connectDB();

// GPT-4o analysis prompt for student availability
const AVAILABILITY_ANALYSIS_PROMPT = `
You are an AI assistant that analyzes student messages to extract learning subject preferences and availability information.

Extract the following information from the student's message:
1. Subject they want to learn (normalize related topics - e.g., "React hooks" → "react")
2. Their availability (days, times, dates if mentioned)
3. Learning preferences (duration, level, format if mentioned)

Return JSON in this format:
{
  "subject": "extracted_subject",
  "availability": [
    {
      "day": "monday",
      "startTime": "14:00",
      "endTime": "16:00",
      "date": "2025-07-20" // if specific date mentioned
    }
  ],
  "preferences": {
    "duration": "2 hours",
    "level": "beginner",
    "format": "interactive"
  },
  "intent": "availability_submission"
}

If the message doesn't contain availability information, return:
{
  "intent": "general_inquiry",
  "subject": "extracted_subject_if_any"
}
`;

// Function to analyze message with GPT-4o
async function analyzeStudentMessage(message) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: AVAILABILITY_ANALYSIS_PROMPT },
        { role: 'user', content: message }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Error analyzing message:', error);
    return { intent: 'general_inquiry' };
  }
}

// Function to store student availability
async function storeStudentAvailability(studentId, subject, availability, preferences) {
  try {
    // Normalize subject for better matching
    const normalizedSubject = StudentAvailability.normalizeSubject(subject);
    
    // Check if student already has availability for this subject
    let existingAvailability = await StudentAvailability.findOne({
      studentId,
      subject: normalizedSubject,
      status: 'pending'
    });

    if (existingAvailability) {
      // Update existing availability
      existingAvailability.availability = availability;
      existingAvailability.createdAt = new Date();
      existingAvailability.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      await existingAvailability.save();
      return existingAvailability;
    } else {
      // Create new availability
      const newAvailability = new StudentAvailability({
        studentId,
        subject: normalizedSubject,
        availability,
        preferences
      });
      await newAvailability.save();
      return newAvailability;
    }
  } catch (error) {
    console.error('Error storing availability:', error);
    throw error;
  }
}

// Function to check for viable sessions and create them
async function checkAndCreateSessions(subject, minStudents = 5) {
  try {
    const normalizedSubject = StudentAvailability.normalizeSubject(subject);
    
    // Find overlapping availabilities
    const viableWindows = await StudentAvailability.findOverlappingAvailability(
      normalizedSubject, 
      minStudents
    );

    const createdSessions = [];

    for (const window of viableWindows) {
      // Create session for this time window
      const session = new Session({
        topic: normalizedSubject,
        teacherId: null, // Will be assigned later when teacher joins
        studentIds: window.students.map(s => s.studentId),
        schedule: {
          day: window.day,
          startTime: window.startTime,
          endTime: window.endTime,
          date: window.date,
          timezone: window.timezone
        },
        status: 'pending',
        preferences: {
          duration: `${calculateDuration(window.startTime, window.endTime)} hours`,
          format: 'group',
          level: 'mixed'
        }
      });

      await session.save();
      createdSessions.push(session);

      // Update student availabilities to 'matched' status
      await StudentAvailability.updateMany(
        { 
          _id: { $in: window.students.map(s => s.availabilityId) }
        },
        { status: 'matched' }
      );
    }

    return createdSessions;
  } catch (error) {
    console.error('Error checking and creating sessions:', error);
    return [];
  }
}

// Helper function to calculate duration
function calculateDuration(startTime, endTime) {
  const start = new Date(`2000-01-01T${startTime}:00`);
  const end = new Date(`2000-01-01T${endTime}:00`);
  return Math.abs(end - start) / (1000 * 60 * 60); // hours
}

// Function to store context in Pinecone
async function storeContext(userId, message, analysis, sessionId = null) {
  try {
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: message
    });
    const embedding = embeddingResponse.data[0].embedding;

    // Store in MongoDB
    const context = new Context({
      sessionId,
      userId,
      role: 'student',
      message,
      embedding,
      metadata: {
        intent: analysis.intent,
        extractedData: analysis
      }
    });
    await context.save();

    // Store in Pinecone
    const contextId = `context_${context._id}`;
    await index.namespace('conversations').upsert([{
      id: contextId,
      values: embedding,
      metadata: {
        userId: userId.toString(),
        sessionId: sessionId?.toString(),
        intent: analysis.intent,
        subject: analysis.subject,
        timestamp: new Date().toISOString()
      }
    }]);

    return context;
  } catch (error) {
    console.error('Error storing context:', error);
    throw error;
  }
}

// Main POST handler
export async function POST(req) {
  try {
    const body = await req.json();
    const { userId, message, sessionId } = body || {};

    if (!userId || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get user
    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Only handle student requests
    if (user.role !== 'student') {
      return NextResponse.json({ error: 'This endpoint is for students only' }, { status: 403 });
    }

    // Analyze message with GPT-4o
    const analysis = await analyzeStudentMessage(message);
    
    // Store context
    await storeContext(user._id, message, analysis, sessionId);

    // Handle based on intent
    if (analysis.intent === 'availability_submission' && analysis.subject && analysis.availability) {
      
      // Store student availability
      const availability = await storeStudentAvailability(
        user._id,
        analysis.subject,
        analysis.availability,
        analysis.preferences
      );

      // Check for viable sessions
      const createdSessions = await checkAndCreateSessions(analysis.subject);

      let response = {
        message: `Great! I've recorded your availability for ${analysis.subject}.`,
        analysis,
        availability: availability._id,
        sessionsCreated: createdSessions.length
      };

      if (createdSessions.length > 0) {
        response.message += ` Good news! I found ${createdSessions.length} viable session(s) with enough students. Sessions have been created and you'll be notified when teachers join.`;
        response.sessions = createdSessions.map(session => ({
          id: session._id,
          topic: session.topic,
          schedule: session.schedule,
          studentCount: session.studentIds.length
        }));
      } else {
        // Check how many students are currently available for this subject
        const currentAvailability = await StudentAvailability.countDocuments({
          subject: StudentAvailability.normalizeSubject(analysis.subject),
          status: 'pending'
        });
        response.message += ` Currently ${currentAvailability} students are available for ${analysis.subject}. We need at least 5 students to create a session.`;
      }

      return NextResponse.json(response);

    } else if (analysis.intent === 'general_inquiry') {
      
      // Handle general inquiries about subjects or availability
      let response = {
        message: "I can help you find learning sessions! Please provide your availability for the subject you want to learn.",
        analysis,
        suggestion: "Try saying something like: 'I want to learn React and I'm available Monday 2-4 PM and Wednesday 3-5 PM'"
      };

      if (analysis.subject) {
        // Check existing sessions for this subject
        const existingSessions = await Session.find({
          topic: StudentAvailability.normalizeSubject(analysis.subject),
          status: 'pending'
        }).populate('studentIds', 'name');

        if (existingSessions.length > 0) {
          response.message += ` I found ${existingSessions.length} existing session(s) for ${analysis.subject}. Would you like to join one or create your own availability?`;
          response.existingSessions = existingSessions.map(session => ({
            id: session._id,
            schedule: session.schedule,
            studentCount: session.studentIds.length
          }));
        }
      }

      return NextResponse.json(response);

    } else {
      return NextResponse.json({
        message: "I didn't understand your request. Please provide your subject preference and availability times.",
        analysis
      });
    }

  } catch (error) {
    console.error('Error in student availability route:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET handler to check current availability status
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const subject = searchParams.get('subject');

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    let query = { studentId: user._id, status: 'pending' };
    if (subject) {
      query.subject = StudentAvailability.normalizeSubject(subject);
    }

    const availabilities = await StudentAvailability.find(query);
    
    const response = {
      availabilities,
      totalActive: availabilities.length
    };

    // If specific subject requested, also show potential sessions
    if (subject) {
      const viableWindows = await StudentAvailability.findOverlappingAvailability(subject, 5);
      response.potentialSessions = viableWindows.length;
      
      const currentCount = await StudentAvailability.countDocuments({
        subject: StudentAvailability.normalizeSubject(subject),
        status: 'pending'
      });
      response.studentsWaiting = currentCount;
    }

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in GET handler:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}