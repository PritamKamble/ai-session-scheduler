import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { User } from '@/models/user';
import { Session } from '@/models/session';
import { Context } from '@/models/context';
import { StudentAvailability } from '@/models/studentAvailability';
import { TeacherAvailability } from '@/models/teacherAvailability';
import { NextResponse } from 'next/server';
import connectDB from '@/config/db';

// Initialize OpenAI
const openai = new OpenAI({
  apiKey:process.env.OPENAI_API_KEY,
});

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const indexName = process.env.PINECONE_INDEX_NAME || 'conversations';
const index = pinecone.index(indexName);

// Connect to MongoDB
await connectDB();

// GPT-4o analysis prompt for availability extraction
const AVAILABILITY_ANALYSIS_PROMPT = `
You are an AI assistant that analyzes messages to extract availability information.

For STUDENTS: Extract subject they want to learn AND their availability.
For TEACHERS: Extract ONLY their availability (no subject needed).

Extract the following information:
1. Availability (days, times, dates if mentioned)
2. For students only: Subject they want to learn
3. Learning/teaching preferences (duration, level, format if mentioned)

Return JSON in this format:
{
  "intent": "availability_submission" | "general_inquiry",
  "availability": [
    {
      "day": "monday",
      "startTime": "14:00",
      "endTime": "16:00",
      "date": "2025-07-20" // if specific date mentioned, otherwise null
    }
  ],
  "subject": "extracted_subject_for_students_only",
  "preferences": {
    "duration": "2 hours",
    "level": "beginner",
    "format": "interactive"
  }
}

If no availability information is found, return:
{
  "intent": "general_inquiry",
  "message": "Please provide your availability information"
}

Examples:
- Student: "I want to learn React and I'm available Monday 2-4 PM" → extract subject "react" + availability
- Teacher: "I'm available Monday 2-4 PM and Wednesday 3-5 PM" → extract only availability
- Student: "I want to learn React hooks on weekends" → subject "react" + weekend availability
`;

// Function to analyze message with GPT-4o
async function analyzeAvailabilityMessage(message, userRole) {
  try {
    const roleContext = userRole === 'teacher' ? 
      'This is a TEACHER message - extract only availability.' : 
      'This is a STUDENT message - extract subject and availability.';
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: AVAILABILITY_ANALYSIS_PROMPT + '\n\n' + roleContext },
        { role: 'user', content: message }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Error analyzing message:', error);
    return { intent: 'general_inquiry', message: 'Could not analyze message' };
  }
}

// Function to normalize subject for better matching
function normalizeSubject(subject) {
  if (!subject) return null;
  
  const normalized = subject.toLowerCase().trim();
  
  // Subject mapping for related topics
  const subjectMap = {
    'react': ['react', 'reactjs', 'react.js', 'react hooks', 'react components', 'react native'],
    'javascript': ['javascript', 'js', 'vanilla js', 'es6', 'node.js', 'nodejs'],
    'python': ['python', 'python3', 'django', 'flask', 'fastapi'],
    'java': ['java', 'spring', 'spring boot', 'hibernate'],
    'css': ['css', 'css3', 'styling', 'bootstrap', 'tailwind'],
    'html': ['html', 'html5', 'markup', 'web development'],
    'database': ['sql', 'mysql', 'postgresql', 'mongodb', 'database'],
    'web': ['web development', 'frontend', 'backend', 'fullstack']
  };
  
  // Find the main subject category
  for (const [mainSubject, variants] of Object.entries(subjectMap)) {
    if (variants.some(variant => normalized.includes(variant))) {
      return mainSubject;
    }
  }
  
  return normalized;
}

// Function to process and normalize availability slots
function processAvailabilitySlots(availability) {
  if (!availability || !Array.isArray(availability)) {
    return [];
  }

  return availability.map(slot => {
    const processedSlot = {
      day: slot.day,
      startTime: slot.startTime,
      endTime: slot.endTime
    };

    // Handle date field - if null/undefined, provide a default future date
    if (slot.date && slot.date !== null && slot.date !== undefined) {
      // Validate date format (basic check)
      const dateObj = new Date(slot.date);
      if (!isNaN(dateObj.getTime())) {
        processedSlot.date = slot.date;
      } else {
        // If invalid date, use next week as default
        processedSlot.date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      }
    } else {
      // If no date provided, use next week as default
      processedSlot.date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }

    return processedSlot;
  });
}

// Function to store student availability
async function storeStudentAvailability(studentId, subject, availability, preferences) {
  try {
    const normalizedSubject = normalizeSubject(subject);
    const processedAvailability = processAvailabilitySlots(availability);
    
    // Validate processed availability has required fields
    const validatedAvailability = processedAvailability.map(slot => ({
      day: slot.day || 'monday',
      startTime: slot.startTime || '09:00',
      endTime: slot.endTime || '10:00',
      date: slot.date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    }));
    
    // Check if student already has availability for this subject
    let existingAvailability = await StudentAvailability.findOne({
      studentId,
      subject: normalizedSubject,
      status: 'pending'
    });

    if (existingAvailability) {
      // Update existing availability
      existingAvailability.availability = validatedAvailability;
      existingAvailability.preferences = preferences || {};
      existingAvailability.createdAt = new Date();
      existingAvailability.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      await existingAvailability.save();
      return existingAvailability;
    } else {
      // Create new availability
      const newAvailability = new StudentAvailability({
        studentId,
        subject: normalizedSubject,
        availability: validatedAvailability,
        preferences: preferences || {}
      });
      await newAvailability.save();
      return newAvailability;
    }
  } catch (error) {
    console.error('Error storing student availability:', error);
    console.error('Data being saved:', {
      studentId,
      subject: normalizeSubject(subject),
      availability: processAvailabilitySlots(availability),
      preferences
    });
    throw error;
  }
}

// Function to store teacher availability
async function storeTeacherAvailability(teacherId, availability) {
  try {
    const processedAvailability = processAvailabilitySlots(availability);
    
    // Check if teacher already has availability
    let existingAvailability = await TeacherAvailability.findOne({ teacherId });

    if (existingAvailability) {
      // Update existing availability
      existingAvailability.availability = processedAvailability;
      existingAvailability.updatedAt = new Date();
      await existingAvailability.save();
      return existingAvailability;
    } else {
      // Create new availability
      const newAvailability = new TeacherAvailability({
        teacherId,
        availability: processedAvailability
      });
      await newAvailability.save();
      return newAvailability;
    }
  } catch (error) {
    console.error('Error storing teacher availability:', error);
    throw error;
  }
}

// Function to find overlapping time windows
function findOverlappingTimeWindows(studentAvailabilities, teacherAvailabilities) {
  const overlaps = [];
  
  // Group students by time windows
  const timeWindowGroups = {};
  
  studentAvailabilities.forEach(studentAvail => {
    studentAvail.availability.forEach(slot => {
      const key = `${slot.day}_${slot.startTime}_${slot.endTime}`;
      if (!timeWindowGroups[key]) {
        timeWindowGroups[key] = {
          day: slot.day,
          startTime: slot.startTime,
          endTime: slot.endTime,
          date: slot.date,
          students: [],
          subject: studentAvail.subject
        };
      }
      timeWindowGroups[key].students.push({
        studentId: studentAvail.studentId,
        availabilityId: studentAvail._id
      });
    });
  });
  
  // Check which time windows have teacher availability and enough students
  Object.values(timeWindowGroups).forEach(window => {
    if (window.students.length >= 5) {
      // Check if any teacher is available at this time
      const teacherAvailable = teacherAvailabilities.some(teacherAvail =>
        teacherAvail.availability.some(slot =>
          slot.day === window.day &&
          slot.startTime <= window.startTime &&
          slot.endTime >= window.endTime
        )
      );
      
      if (teacherAvailable) {
        overlaps.push(window);
      }
    }
  });
  
  return overlaps;
}

// Function to create sessions from overlapping windows
async function createSessionsFromOverlaps(overlaps) {
  const createdSessions = [];
  
  // Get teacher (assuming single teacher for now)
  const teacher = await User.findOne({ role: 'teacher' });
  if (!teacher) {
    throw new Error('No teacher found');
  }
  
  for (const overlap of overlaps) {
    try {
      // Create session
      const session = new Session({
        topic: overlap.subject,
        teacherId: teacher._id,
        studentIds: overlap.students.map(s => s.studentId),
        schedule: {
          day: overlap.day,
          startTime: overlap.startTime,
          endTime: overlap.endTime,
          date: overlap.date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Default to next week
          timezone: 'UTC'
        },
        status: 'pending',
        preferences: {
          duration: calculateDuration(overlap.startTime, overlap.endTime),
          format: 'group',
          level: 'mixed'
        }
      });

      await session.save();
      createdSessions.push(session);

      // Update student availabilities to 'matched' status
      await StudentAvailability.updateMany(
        { _id: { $in: overlap.students.map(s => s.availabilityId) } },
        { status: 'matched' }
      );

    } catch (error) {
      console.error('Error creating session:', error);
    }
  }
  
  return createdSessions;
}

// Function to check and create sessions
async function checkAndCreateSessions(subject = null) {
  try {
    // Get all pending student availabilities
    const studentQuery = { status: 'pending' };
    if (subject) {
      studentQuery.subject = normalizeSubject(subject);
    }
    
    const studentAvailabilities = await StudentAvailability.find(studentQuery);
    
    // Get all teacher availabilities
    const teacherAvailabilities = await TeacherAvailability.find({});
    
    // Find overlapping time windows
    const overlaps = findOverlappingTimeWindows(studentAvailabilities, teacherAvailabilities);
    
    // Create sessions from overlaps
    const createdSessions = await createSessionsFromOverlaps(overlaps);
    
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
  const hours = Math.abs(end - start) / (1000 * 60 * 60);
  return `${hours} hours`;
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
      role: (await User.findById(userId)).role,
      message,
      embedding,
      metadata: {
        intent: analysis.intent,
        extractedData: analysis
      }
    });
    await context.save();

    // Store in Pinecone - handle null/undefined subject for teachers
    const contextId = `context_${context._id}`;
    const pineconeMetadata = {
      userId: userId.toString(),
      intent: analysis.intent || 'general_inquiry',
      timestamp: new Date().toISOString()
    };

    // Only add subject if it exists (for students)
    if (analysis.subject) {
      pineconeMetadata.subject = analysis.subject;
    }

    // Only add sessionId if it exists
    if (sessionId) {
      pineconeMetadata.sessionId = sessionId.toString();
    }

    await index.namespace('conversations').upsert([{
      id: contextId,
      values: embedding,
      metadata: pineconeMetadata
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

    // Analyze message with GPT-4o
    const analysis = await analyzeAvailabilityMessage(message, user.role);
    
    // Store context
    await storeContext(user._id, message, analysis, sessionId);

    // Handle based on user role and intent
    if (analysis.intent === 'availability_submission' && analysis.availability) {
      
      if (user.role === 'student') {
        // Handle student availability
        if (!analysis.subject) {
          return NextResponse.json({
            message: "Please specify what subject you want to learn along with your availability.",
            analysis
          });
        }

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
          response.message += ` Excellent! I created ${createdSessions.length} session(s) with enough students and teacher availability.`;
          response.sessions = createdSessions.map(session => ({
            id: session._id,
            topic: session.topic,
            schedule: session.schedule,
            studentCount: session.studentIds.length
          }));
        } else {
          // Check current status
          const currentStudents = await StudentAvailability.countDocuments({
            subject: normalizeSubject(analysis.subject),
            status: 'pending'
          });
          response.message += ` Currently ${currentStudents} students are interested in ${analysis.subject}. We need 5+ students with matching availability to create a session.`;
        }

        return NextResponse.json(response);

      } else if (user.role === 'teacher') {
        // Handle teacher availability
        const availability = await storeTeacherAvailability(user._id, analysis.availability);

        // Check for viable sessions across all subjects
        const createdSessions = await checkAndCreateSessions();

        let response = {
          message: "Great! I've recorded your teaching availability.",
          analysis,
          availability: availability._id,
          sessionsCreated: createdSessions.length
        };

        if (createdSessions.length > 0) {
          response.message += ` Perfect! I created ${createdSessions.length} session(s) where your availability matches with student groups.`;
          response.sessions = createdSessions.map(session => ({
            id: session._id,
            topic: session.topic,
            schedule: session.schedule,
            studentCount: session.studentIds.length
          }));
        } else {
          response.message += " I'm monitoring for student groups that match your availability.";
        }

        return NextResponse.json(response);
      }

    } else if (analysis.intent === 'general_inquiry') {
      
      let response = {
        message: user.role === 'student' ? 
          "I can help you find learning sessions! Please provide the subject you want to learn and your availability." :
          "I can help you manage your teaching schedule! Please provide your availability times.",
        analysis,
        suggestion: user.role === 'student' ? 
          "Try saying: 'I want to learn React and I'm available Monday 2-4 PM and Wednesday 3-5 PM'" :
          "Try saying: 'I'm available Monday 2-4 PM, Wednesday 3-5 PM, and Friday 1-3 PM'"
      };

      return NextResponse.json(response);

    } else {
      return NextResponse.json({
        message: user.role === 'student' ? 
          "Please provide your subject preference and availability times." :
          "Please provide your availability times for teaching.",
        analysis
      });
    }

  } catch (error) {
    console.error('Error in availability route:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET handler to check current status
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

    if (user.role === 'student') {
      let query = { studentId: user._id, status: 'pending' };
      if (subject) {
        query.subject = normalizeSubject(subject);
      }

      const availabilities = await StudentAvailability.find(query);
      
      const response = {
        userRole: 'student',
        availabilities,
        totalActive: availabilities.length
      };

      // Subject-specific stats
      if (subject) {
        const normalizedSubject = normalizeSubject(subject);
        const subjectStats = await StudentAvailability.aggregate([
          { $match: { subject: normalizedSubject, status: 'pending' } },
          { $group: { _id: null, count: { $sum: 1 } } }
        ]);
        response.subjectStats = {
          subject: normalizedSubject,
          studentsWaiting: subjectStats[0]?.count || 0,
          needsMore: Math.max(0, 5 - (subjectStats[0]?.count || 0))
        };
      }

      return NextResponse.json(response);

    } else if (user.role === 'teacher') {
      const availability = await TeacherAvailability.findOne({ teacherId: user._id });
      
      // Get sessions where this teacher is assigned
      const sessions = await Session.find({ teacherId: user._id }).populate('studentIds', 'name');
      
      const response = {
        userRole: 'teacher',
        availability,
        sessions: sessions.map(session => ({
          id: session._id,
          topic: session.topic,
          schedule: session.schedule,
          studentCount: session.studentIds.length,
          status: session.status
        })),
        totalSessions: sessions.length
      };

      return NextResponse.json(response);
    }

  } catch (error) {
    console.error('Error in GET handler:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}