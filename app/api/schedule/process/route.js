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

// Function to convert time string to minutes for comparison
function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {
    console.log('Invalid time string:', timeStr);
    return 0;
  }
  
  const parts = timeStr.split(':');
  if (parts.length !== 2) {
    console.log('Invalid time format:', timeStr);
    return 0;
  }
  
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    console.log('Invalid time values:', timeStr);
    return 0;
  }
  
  return hours * 60 + minutes;
}

function normalizeDayName(day) {
  if (!day || typeof day !== 'string') {
    return 'monday'; // default fallback
  }
  
  const dayMap = {
    'mon': 'monday',
    'tue': 'tuesday', 
    'wed': 'wednesday',
    'thu': 'thursday',
    'fri': 'friday',
    'sat': 'saturday',
    'sun': 'sunday',
    'monday': 'monday',
    'tuesday': 'tuesday',
    'wednesday': 'wednesday', 
    'thursday': 'thursday',
    'friday': 'friday',
    'saturday': 'saturday',
    'sunday': 'sunday'
  };
  
  const normalized = day.toLowerCase().trim();
  return dayMap[normalized] || normalized;
}


// Function to process and normalize availability slots
function hasTimeOverlap(slot1, slot2) {
  // Validate inputs
  if (!slot1 || !slot2 || !slot1.startTime || !slot1.endTime || !slot2.startTime || !slot2.endTime) {
    return false;
  }

  // Check day match first
  const day1 = normalizeDayName(slot1.day);
  const day2 = normalizeDayName(slot2.day);
  if (day1 !== day2) {
    return false;
  }

  // Convert to minutes for comparison
  const s1 = timeToMinutes(slot1.startTime);
  const s2 = timeToMinutes(slot2.startTime);
  const e1 = timeToMinutes(slot1.endTime);
  const e2 = timeToMinutes(slot2.endTime);

  // Check for valid time ranges
  if (s1 >= e1 || s2 >= e2) {
    return false;
  }

  // Check overlap: s1 < e2 AND e1 > s2
  return s1 < e2 && e1 > s2;
}

// 2. Fix the processAvailabilitySlots function - ensure proper default values
function processAvailabilitySlots(availability) {
  if (!availability || !Array.isArray(availability)) {
    console.log('Invalid availability input:', availability);
    return [];
  }

  const validSlots = [];
  
  for (const slot of availability) {
    // Skip slots with undefined/null/empty values
    if (!slot || 
        !slot.day || slot.day === 'undefined' || slot.day === '' ||
        !slot.startTime || slot.startTime === 'undefined' || slot.startTime === '' ||
        !slot.endTime || slot.endTime === 'undefined' || slot.endTime === '') {
      console.log('⚠️  Skipping invalid slot:', slot);
      continue;
    }

    // Validate time format (HH:MM)
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(slot.startTime) || !timeRegex.test(slot.endTime)) {
      console.log('⚠️  Invalid time format:', slot);
      continue;
    }

    // Validate time range (start < end)
    const startMinutes = timeToMinutes(slot.startTime);
    const endMinutes = timeToMinutes(slot.endTime);
    if (startMinutes >= endMinutes) {
      console.log('⚠️  Invalid time range:', slot);
      continue;
    }

    const processedSlot = {
      day: normalizeDayName(slot.day),
      startTime: slot.startTime,
      endTime: slot.endTime,
      date: slot.date && slot.date !== 'undefined' ? slot.date : 
             new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    };

    validSlots.push(processedSlot);
  }

  console.log(`✓ Processed ${validSlots.length} valid slots out of ${availability.length} total slots`);
  return validSlots;
}
// Using OpenAI client
async function callAIService(prompt, openai) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: 'You are a scheduling assistant. Return only valid JSON responses.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.1
  });
  
  return completion.choices[0].message.content;
}


async function storeStudentAvailability(studentId, subject, availability, preferences) {
  try {
    console.log(`📝 Storing availability for student ${studentId}, subject: ${subject}`);
    console.log('Raw availability input:', availability);

    // Process and validate availability slots
    const validSlots = processAvailabilitySlots(availability);
    
    if (validSlots.length === 0) {
      throw new Error('No valid availability slots provided');
    }

    const normalizedSubject = normalizeSubject(subject);
    
    console.log('✓ Valid slots after processing:', validSlots);
    
    // Check if student already has availability for this subject
    let existingAvailability = await StudentAvailability.findOne({
      studentId,
      subject: normalizedSubject,
      status: 'pending'
    });

    if (existingAvailability) {
      // Update existing availability
      existingAvailability.availability = validSlots;
      existingAvailability.preferences = preferences || {};
      existingAvailability.createdAt = new Date();
      existingAvailability.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await existingAvailability.save();
      console.log('✓ Updated existing availability');
      return existingAvailability;
    } else {
      // Create new availability
      const newAvailability = new StudentAvailability({
        studentId,
        subject: normalizedSubject,
        availability: validSlots,
        preferences: preferences || {}
      });
      await newAvailability.save();
      console.log('✓ Created new availability');
      return newAvailability;
    }
  } catch (error) {
    console.error('❌ Error storing student availability:', error);
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

// Function to create sessions from overlapping windows
async function createSessionsFromOverlaps(overlaps) {
  const createdSessions = [];
  
  for (const overlap of overlaps) {
    try {
      // Get teacher
      const teacher = await User.findById(overlap.teacherId);
      if (!teacher) {
        console.error(`Teacher not found for ID: ${overlap.teacherId}`);
        continue;
      }
      
      // Create session with all available students
      const session = new Session({
        topic: overlap.subject,
        teacherId: teacher._id,
        studentIds: overlap.students.map(s => s.studentId),
        schedule: {
          day: overlap.day,
          startTime: overlap.startTime,
          endTime: overlap.endTime,
          date: overlap.date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          timezone: 'UTC'
        },
        status: 'scheduled',
        preferences: {
          duration: calculateDuration(overlap.startTime, overlap.endTime),
          format: overlap.students.length > 6 ? 'large_group' : 'group',
          level: 'mixed'
        }
      });

      await session.save();
      createdSessions.push(session);

      console.log(`✅ Created session with ${overlap.students.length} students for ${overlap.subject}`);

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

    // Store in Pinecone
    const contextId = `context_${context._id}`;
    const pineconeMetadata = {
      userId: userId.toString(),
      intent: analysis.intent || 'general_inquiry',
      timestamp: new Date().toISOString()
    };

    if (analysis.subject) {
      pineconeMetadata.subject = analysis.subject;
    }

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

// Enhanced session checking and creation logic

// 1. First, add a function to check for existing sessions
async function checkExistingSessionsForStudent(studentId, subject, availability) {
  try {
    const normalizedSubject = normalizeSubject(subject);
    
    // Find existing sessions for this subject that are scheduled or active
    const existingSessions = await Session.find({
      topic: normalizedSubject,
      status: { $in: ['scheduled', 'active'] },
      // Check if student is not already enrolled
      studentIds: { $ne: studentId }
      // REMOVED: Session capacity check - now allows unlimited enrollment
      // $expr: { $lt: [{ $size: "$studentIds" }, 4] }
    });

    console.log(`🔍 Found ${existingSessions.length} existing sessions for ${normalizedSubject}`);

    const compatibleSessions = [];

    for (const session of existingSessions) {
      // Check if student's availability overlaps with session time
      for (const studentSlot of availability) {
        const sessionSlot = {
          day: session.schedule.day,
          startTime: session.schedule.startTime,
          endTime: session.schedule.endTime
        };

        if (hasTimeOverlap(studentSlot, sessionSlot)) {
          compatibleSessions.push({
            sessionId: session._id,
            session: session,
            overlappingSlot: studentSlot,
            currentStudentCount: session.studentIds.length
          });
          break; // Found overlap, no need to check other slots
        }
      }
    }

    // Sort by student count (prefer sessions with more students for better group dynamics)
    compatibleSessions.sort((a, b) => b.currentStudentCount - a.currentStudentCount);

    return compatibleSessions;
  } catch (error) {
    console.error('❌ Error checking existing sessions:', error);
    return [];
  }
}

// 2. Function to enroll student in existing session
async function enrollStudentInSession(sessionId, studentId, availabilityId) {
  try {
    const session = await Session.findById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // REMOVED: Check if session has space - now allows unlimited enrollment
    // if (session.studentIds.length >= 4) {
    //   throw new Error('Session is full');
    // }

    // Add student to session
    session.studentIds.push(studentId);
    await session.save();

    // Update student availability status
    await StudentAvailability.findByIdAndUpdate(availabilityId, {
      status: 'matched',
      sessionId: sessionId
    });

    console.log(`✅ Enrolled student ${studentId} in existing session ${sessionId} (${session.studentIds.length} students total)`);
    return session;
  } catch (error) {
    console.error('❌ Error enrolling student in session:', error);
    throw error;
  }
}

// 3. Modified findStudentOverlaps function to only create new sessions
async function findStudentOverlaps(studentAvailabilities, teacherAvailabilities) {
  const prompt = `
You are a smart scheduling assistant. Analyze the following data and extract viable NEW group sessions.

IMPORTANT RULES:
- Find the optimal time slots where at least 4 students are available (this is for optimal timing)
- Students must be from the same subject
- All participants (students + teacher) must be available at the same time slot
- Prioritize time slots with maximum student overlap
- Return sessions in the exact JSON format specified

STUDENT AVAILABILITIES:
${JSON.stringify(studentAvailabilities, null, 2)}

TEACHER AVAILABILITIES:
${JSON.stringify(teacherAvailabilities, null, 2)}

REQUIRED OUTPUT FORMAT:
Return a JSON array of viable NEW sessions in this exact format:
[
  {
    "subject": "subject_name",
    "day": "day_name",
    "startTime": "HH:MM",
    "endTime": "HH:MM", 
    "date": "YYYY-MM-DD",
    "students": [
      {
        "studentId": "id1",
        "name": "student_name",
        "availability": [...],
        "availabilityId": "availability_record_id"
      }
      // ... all students available at this time (minimum 4 for optimal timing)
    ],
    "teacherId": "teacher_id"
  }
]

Find time slots with maximum student overlap. Prioritize slots with 4+ students but include all available students for each time slot.
Only return valid JSON, no explanations.
`;

  try {
    const response = await callAIService(prompt, openai);
    const viableSessions = JSON.parse(response);
    
    // Filter to ensure at least 4 students per session (for optimal timing)
    const validSessions = viableSessions.filter(session => 
      session.students && session.students.length >= 4
    );
    
    console.log(`✓ AI found ${validSessions.length} viable NEW sessions (4+ students each)`);
    
    return validSessions;
  } catch (error) {
    console.error('❌ Error processing AI response:', error);
    return [];
  }
}

// 4. Enhanced checkAndCreateSessions function
async function checkAndCreateSessions(subject = null, excludeStudentId = null) {
  try {
    // Get all pending student availabilities
    const studentQuery = { status: 'pending' };
    if (subject) {
      studentQuery.subject = normalizeSubject(subject);
    }
    
    let studentAvailabilities = await StudentAvailability.find(studentQuery);
    
    // If we have a specific student, filter them out from new session creation
    if (excludeStudentId) {
      studentAvailabilities = studentAvailabilities.filter(
        avail => avail.studentId.toString() !== excludeStudentId.toString()
      );
    }
    
    // Only proceed with session creation if we have enough students for optimal timing
    if (studentAvailabilities.length < 4) {
      console.log(`⚠️  Not enough students (${studentAvailabilities.length}) for optimal timing (4+ students)`);
      return [];
    }
    
    // Get all teacher availabilities
    const teacherAvailabilities = await TeacherAvailability.find({});
    
    // Find viable session combinations (4+ students for optimal timing)
    const viableSessions = await findStudentOverlaps(studentAvailabilities, teacherAvailabilities);
    
    // Create sessions from viable combinations
    const createdSessions = await createSessionsFromOverlaps(viableSessions);
    
    return createdSessions;
  } catch (error) {
    console.error('Error checking and creating sessions:', error);
    return [];
  }
}

// 5. Modified main POST handler logic for student availability
async function handleStudentAvailability(user, analysis) {
  if (!analysis.subject) {
    return {
      message: "Please specify what subject you want to learn along with your availability.",
      analysis
    };
  }

  try {
    // Store student availability
    const availability = await storeStudentAvailability(
      user._id,
      analysis.subject,
      analysis.availability,
      analysis.preferences
    );

    // First, check if student can join existing sessions
    const compatibleSessions = await checkExistingSessionsForStudent(
      user._id,
      analysis.subject,
      analysis.availability
    );

    let enrolledSession = null;
    if (compatibleSessions.length > 0) {
      // Try to enroll in the first compatible session (sorted by student count)
      try {
        enrolledSession = await enrollStudentInSession(
          compatibleSessions[0].sessionId,
          user._id,
          availability._id
        );
        
        console.log(`✅ Student ${user._id} enrolled in existing session ${enrolledSession._id}`);
      } catch (enrollError) {
        console.log('Could not enroll in existing session:', enrollError.message);
      }
    }

    // If enrolled in existing session, return success
    if (enrolledSession) {
      return {
        message: `Great! I've enrolled you in an existing ${analysis.subject} session scheduled for ${enrolledSession.schedule.day} ${enrolledSession.schedule.startTime}-${enrolledSession.schedule.endTime}. You'll join ${enrolledSession.studentIds.length - 1} other students.`,
        analysis,
        availability: availability._id,
        enrolledInExisting: true,
        session: {
          id: enrolledSession._id,
          topic: enrolledSession.topic,
          schedule: enrolledSession.schedule,
          studentCount: enrolledSession.studentIds.length
        }
      };
    }

    // If no existing session available, try to create new sessions
    // Only create new sessions when we have optimal timing (4+ students)
    const createdSessions = await checkAndCreateSessions(analysis.subject, user._id);

    let response = {
      message: `Great! I've recorded your availability for ${analysis.subject}.`,
      analysis,
      availability: availability._id,
      sessionsCreated: createdSessions.length,
      enrolledInExisting: false
    };

    if (createdSessions.length > 0) {
      response.message += ` Excellent! I created ${createdSessions.length} new session(s) based on optimal timing with 4+ students.`;
      response.sessions = createdSessions.map(session => ({
        id: session._id,
        topic: session.topic,
        schedule: session.schedule,
        studentCount: session.studentIds.length
      }));
    } else {
      // Count current students waiting
      const currentStudents = await StudentAvailability.countDocuments({
        subject: normalizeSubject(analysis.subject),
        status: 'pending',
        studentId: { $ne: user._id }
      });
      
      response.message += ` Currently ${currentStudents + 1} students are waiting for ${analysis.subject}. We create sessions when we have optimal timing with 4+ students, but you can always join existing sessions!`;
    }

    return response;

  } catch (error) {
    console.error('Error handling student availability:', error);
    throw error;
  }
}


// 6. Update the main POST handler
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

    console.log(`\n📝 Processing request from ${user.role}: ${user._id}`);
    console.log('Analysis:', analysis);

    // Handle based on user role and intent
    if (analysis.intent === 'availability_submission' && analysis.availability) {
      
      if (user.role === 'student') {
        const result = await handleStudentAvailability(user, analysis);
        return NextResponse.json(result);

      } else if (user.role === 'teacher') {
        // Handle teacher availability (existing logic)
        const availability = await storeTeacherAvailability(user._id, analysis.availability);
        const createdSessions = await checkAndCreateSessions();

        let response = {
          message: "Great! I've recorded your teaching availability.",
          analysis,
          availability: availability._id,
          sessionsCreated: createdSessions.length
        };

        if (createdSessions.length > 0) {
          response.message += ` Perfect! I created ${createdSessions.length} session(s) with overlapping student availability.`;
          response.sessions = createdSessions.map(session => ({
            id: session._id,
            topic: session.topic,
            schedule: session.schedule,
            studentCount: session.studentIds.length
          }));
        }

        return NextResponse.json(response);
      }
    }

    // Handle general inquiries
    return NextResponse.json({
      message: user.role === 'student' ? 
        "I can help you find learning sessions! Please provide the subject and your availability." :
        "I can help you manage your teaching schedule! Please provide your availability times.",
      analysis
    });

  } catch (error) {
    console.error('❌ Error in availability route:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

