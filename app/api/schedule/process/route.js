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

async function checkStudentEnrollment(studentId, subject, availability) {
  try {
    const normalizedSubject = normalizeSubject(subject);
    
    // Find sessions where student is enrolled for this subject
    const enrolledSessions = await Session.find({
      topic: normalizedSubject,
      studentIds: studentId,
      status: { $in: ['scheduled', 'active'] }
    });

    if (enrolledSessions.length === 0) {
      return { isEnrolled: false, message: null };
    }

    // Check if any enrolled session overlaps with the requested availability
    for (const session of enrolledSessions) {
      for (const requestedSlot of availability) {
        const sessionSlot = {
          day: session.schedule.day,
          startTime: session.schedule.startTime,
          endTime: session.schedule.endTime
        };

        if (hasTimeOverlap(requestedSlot, sessionSlot)) {
          return {
            isEnrolled: true,
            message: `You're already enrolled in a ${subject} session on ${session.schedule.day} from ${session.schedule.startTime} to ${session.schedule.endTime}. Session ID: ${session._id}`,
            session: {
              id: session._id,
              topic: session.topic,
              schedule: session.schedule,
              studentCount: session.studentIds.length
            }
          };
        }
      }
    }

    return { isEnrolled: false, message: null };
  } catch (error) {
    console.error('Error checking student enrollment:', error);
    return { isEnrolled: false, message: null };
  }
}


async function checkExistingSessionsForStudent(studentId, subject, availability) {
  try {
    const normalizedSubject = normalizeSubject(subject);
    
    console.log(`🔍 Checking existing sessions for student ${studentId}, subject: ${normalizedSubject}`);
    console.log('Student availability:', availability);
    
    // Find existing sessions for this subject that are scheduled or active
    const existingSessions = await Session.find({
      topic: normalizedSubject,
      status: { $in: ['scheduled', 'active'] },
      // Check if student is not already enrolled
      studentIds: { $ne: studentId }
    });

    console.log(`📋 Found ${existingSessions.length} existing sessions for ${normalizedSubject}`);
    
    // Debug: Log all existing sessions
    existingSessions.forEach((session, index) => {
      console.log(`Session ${index + 1}:`, {
        id: session._id,
        topic: session.topic,
        schedule: session.schedule,
        studentCount: session.studentIds.length
      });
    });

    const compatibleSessions = [];

    for (const session of existingSessions) {
      console.log(`🔍 Checking session ${session._id} with schedule:`, session.schedule);
      
      // Check if student's availability overlaps with session time
      for (const studentSlot of availability) {
        const sessionSlot = {
          day: session.schedule.day,
          startTime: session.schedule.startTime,
          endTime: session.schedule.endTime
        };

        console.log(`⏰ Comparing student slot:`, studentSlot);
        console.log(`⏰ With session slot:`, sessionSlot);

        if (hasTimeOverlap(studentSlot, sessionSlot)) {
          console.log(`✅ Found overlap! Adding session to compatible list`);
          compatibleSessions.push({
            sessionId: session._id,
            session: session,
            overlappingSlot: studentSlot,
            currentStudentCount: session.studentIds.length
          });
          break; // Found overlap, no need to check other slots
        } else {
          console.log(`❌ No overlap found`);
        }
      }
    }

    console.log(`🎯 Found ${compatibleSessions.length} compatible sessions`);

    // Sort by student count (prefer sessions with more students for better group dynamics)
    compatibleSessions.sort((a, b) => b.currentStudentCount - a.currentStudentCount);

    return compatibleSessions;
  } catch (error) {
    console.error('❌ Error checking existing sessions:', error);
    return [];
  }
}

// Enhanced hasTimeOverlap function with better debugging
function hasTimeOverlap(slot1, slot2) {
  console.log(`🔍 Checking time overlap between:`, slot1, 'and', slot2);
  
  // Validate inputs
  if (!slot1 || !slot2 || !slot1.startTime || !slot1.endTime || !slot2.startTime || !slot2.endTime) {
    console.log('❌ Invalid slots - missing required fields');
    return false;
  }

  // Check day match first
  const day1 = normalizeDayName(slot1.day);
  const day2 = normalizeDayName(slot2.day);
  
  console.log(`📅 Comparing days: ${day1} vs ${day2}`);
  
  if (day1 !== day2) {
    console.log('❌ Days don\'t match');
    return false;
  }

  // Convert to minutes for comparison
  const s1 = timeToMinutes(slot1.startTime);
  const s2 = timeToMinutes(slot2.startTime);
  const e1 = timeToMinutes(slot1.endTime);
  const e2 = timeToMinutes(slot2.endTime);

  console.log(`⏰ Time comparison: Slot1(${s1}-${e1}) vs Slot2(${s2}-${e2})`);

  // Check for valid time ranges
  if (s1 >= e1 || s2 >= e2) {
    console.log('❌ Invalid time ranges');
    return false;
  }

  // Check overlap: s1 < e2 AND e1 > s2
  const hasOverlap = s1 < e2 && e1 > s2;
  console.log(`✅ Overlap result: ${hasOverlap}`);
  
  return hasOverlap;
}

// Fixed handleStudentAvailability function with better error handling
async function handleStudentAvailability(user, analysis) {
  if (!analysis.subject) {
    return {
      message: "Please specify what subject you want to learn along with your availability.",
      analysis
    };
  }

  try {
    console.log(`\n📝 === HANDLING STUDENT AVAILABILITY ===`);
    console.log(`Student: ${user._id}`);
    console.log(`Subject: ${analysis.subject}`);
    console.log(`Availability:`, analysis.availability);
    
    // NEW: Check if student is already enrolled for this subject/time
    const enrollmentCheck = await checkStudentEnrollment(
      user._id,
      analysis.subject,
      analysis.availability
    );

    if (enrollmentCheck.isEnrolled) {
      console.log(`✅ Student already enrolled in matching session`);
      return {
        message: enrollmentCheck.message,
        analysis,
        alreadyEnrolled: true,
        session: enrollmentCheck.session
      };
    }

    console.log(`✅ Student not enrolled in any conflicting sessions, proceeding...`);
    
    // Store student availability FIRST
    const availability = await storeStudentAvailability(
      user._id,
      analysis.subject,
      analysis.availability,
      analysis.preferences
    );

    console.log(`📝 Student availability stored with ID: ${availability._id}`);

    // PRIORITY 1: Check if student can join existing sessions
    console.log(`\n🔍 === CHECKING EXISTING SESSIONS ===`);
    const compatibleSessions = await checkExistingSessionsForStudent(
      user._id,
      analysis.subject,
      analysis.availability
    );

    console.log(`🎯 Compatible sessions found: ${compatibleSessions.length}`);

    // If there are compatible existing sessions, try to enroll in the best one
    if (compatibleSessions.length > 0) {
      console.log(`\n✅ === ENROLLING IN EXISTING SESSION ===`);
      
      // Try each compatible session in order of preference
      for (let i = 0; i < compatibleSessions.length; i++) {
        const sessionInfo = compatibleSessions[i];
        console.log(`Attempting to enroll in session ${i + 1}/${compatibleSessions.length}: ${sessionInfo.sessionId}`);
        
        try {
          const enrolledSession = await enrollStudentInSession(
            sessionInfo.sessionId,
            user._id,
            availability._id
          );
          
          console.log(`✅ Successfully enrolled in session ${enrolledSession._id}`);
          console.log(`Session now has ${enrolledSession.studentIds.length} students`);
          
          return {
            message: `Perfect! I've enrolled you in an existing ${analysis.subject} session scheduled for ${enrolledSession.schedule.day} ${enrolledSession.schedule.startTime}-${enrolledSession.schedule.endTime}. You'll join ${enrolledSession.studentIds.length - 1} other students.`,
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
          
        } catch (enrollError) {
          console.log(`❌ Could not enroll in session ${sessionInfo.sessionId}: ${enrollError.message}`);
          console.log(`Trying next compatible session...`);
          continue; // Try next session
        }
      }
      
      // If we get here, all enrollment attempts failed
      console.log('❌ Failed to enroll in any compatible sessions, continuing to new session creation...');
      
      // Reset availability status back to pending since enrollment failed
      await StudentAvailability.findByIdAndUpdate(availability._id, {
        status: 'pending',
        $unset: { sessionId: 1, matchedAt: 1 }
      });
      
    } else {
      console.log(`\n❌ No compatible existing sessions found`);
    }

    // PRIORITY 2: Only create new sessions if no existing sessions are available
    console.log(`\n🆕 === CREATING NEW SESSIONS ===`);
    console.log(`No existing sessions available. Checking if we can create new sessions...`);
    
    // Check how many students are waiting for this subject (including current student)
    const totalWaitingStudents = await StudentAvailability.countDocuments({
      subject: normalizeSubject(analysis.subject),
      status: 'pending'
    });

    console.log(`📊 Total students waiting for ${analysis.subject}: ${totalWaitingStudents}`);

    // Only try to create new sessions if we have enough students
    if (totalWaitingStudents >= 2) {
      console.log(`✅ Sufficient students (${totalWaitingStudents}) for new session creation`);
      const createdSessions = await checkAndCreateSessions(analysis.subject);
      
      let response = {
        message: `Great! I've recorded your availability for ${analysis.subject}.`,
        analysis,
        availability: availability._id,
        sessionsCreated: createdSessions.length,
        enrolledInExisting: false
      };

      if (createdSessions.length > 0) {
        response.message += ` Excellent! I created ${createdSessions.length} new session(s) with ${totalWaitingStudents} students.`;
        response.sessions = createdSessions.map(session => ({
          id: session._id,
          topic: session.topic,
          schedule: session.schedule,
          studentCount: session.studentIds.length
        }));
      } else {
        response.message += ` Currently ${totalWaitingStudents} students are waiting for ${analysis.subject}. We'll create sessions when we have compatible schedules with teachers!`;
      }

      return response;
    } else {
      console.log(`❌ Not enough students (${totalWaitingStudents}) for new session`);
      return {
        message: `Great! I've recorded your availability for ${analysis.subject}. Currently ${totalWaitingStudents} students are waiting. We'll create sessions when we have more students or find compatible existing sessions!`,
        analysis,
        availability: availability._id,
        sessionsCreated: 0,
        enrolledInExisting: false
      };
    }

  } catch (error) {
    console.error('❌ Error handling student availability:', error);
    throw error;
  }
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

async function enrollStudentInSession(sessionId, studentId, availabilityId) {
  try {
    const session = await Session.findById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

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
- Find time slots where multiple students are available for the same subject
- Include ALL students available at each time slot (not just 4)
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
      // ... ALL students available at this time slot (include everyone who can attend)
    ],
    "teacherId": "teacher_id"
  }
]

CRITICAL: Include ALL students who are available at each time slot. Do not limit to 4 students.
Find time slots with maximum student overlap and include everyone who can attend.
Only return valid JSON, no explanations.
`;

  try {
    const response = await callAIService(prompt, openai);
    const viableSessions = JSON.parse(response);
    
    // FIXED: Remove the filter that was limiting to 4+ students
    // Now we'll create sessions with any number of students (2+)
    const validSessions = viableSessions.filter(session => 
      session.students && session.students.length >= 2 // Minimum 2 for a group session
    );
    
    console.log(`✓ AI found ${validSessions.length} viable NEW sessions with all available students`);
    
    // Log student counts for debugging
    validSessions.forEach((session, index) => {
      console.log(`Session ${index + 1}: ${session.subject} - ${session.students.length} students`);
    });
    
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
  
    if (studentAvailabilities.length < 2) {
      console.log(`⚠️  Not enough students (${studentAvailabilities.length}) for group session (need 2+)`);
      return [];
    }
    
    // Get all teacher availabilities
    const teacherAvailabilities = await TeacherAvailability.find({});
    
    // Find viable session combinations (include ALL available students)
    const viableSessions = await findStudentOverlaps(studentAvailabilities, teacherAvailabilities);
    
    // Create sessions from viable combinations
    const createdSessions = await createSessionsFromOverlaps(viableSessions);
    
    return createdSessions;
  } catch (error) {
    console.error('Error checking and creating sessions:', error);
    return [];
  }
}

async function processRemainingStudents() {
  try {
    console.log('🔄 Processing remaining pending students...');
    
    // Get all pending students grouped by subject
    const pendingStudents = await StudentAvailability.find({ status: 'pending' });
    
    if (pendingStudents.length === 0) {
      console.log('✅ No pending students to process');
      return 0;
    }

    // Group by subject
    const studentsBySubject = {};
    pendingStudents.forEach(student => {
      if (!studentsBySubject[student.subject]) {
        studentsBySubject[student.subject] = [];
      }
      studentsBySubject[student.subject].push(student);
    });
    
    let totalEnrollments = 0;
    let totalNewSessions = 0;
    
    // Process each subject
    for (const [subject, students] of Object.entries(studentsBySubject)) {
      console.log(`📚 Processing ${students.length} pending students for ${subject}`);
      
      // PRIORITY 1: Try to enroll pending students in existing sessions
      for (const studentAvailability of students) {
        const compatibleSessions = await checkExistingSessionsForStudent(
          studentAvailability.studentId,
          subject,
          studentAvailability.availability
        );

        if (compatibleSessions.length > 0) {
          try {
            await enrollStudentInSession(
              compatibleSessions[0].sessionId,
              studentAvailability.studentId,
              studentAvailability._id
            );
            totalEnrollments++;
            console.log(`✅ Enrolled pending student ${studentAvailability.studentId} in existing session`);
          } catch (error) {
            console.log(`❌ Could not enroll student ${studentAvailability.studentId}: ${error.message}`);
          }
        }
      }
      
      // PRIORITY 2: Create new sessions only for remaining students
      const stillPendingStudents = await StudentAvailability.find({
        subject: normalizeSubject(subject),
        status: 'pending'
      });
      
      if (stillPendingStudents.length >= 2) {
        console.log(`🆕 Creating new sessions for ${stillPendingStudents.length} remaining students in ${subject}`);
        const createdSessions = await checkAndCreateSessions(subject);
        totalNewSessions += createdSessions.length;
        
        if (createdSessions.length > 0) {
          console.log(`✅ Created ${createdSessions.length} new sessions for ${subject}`);
        }
      }
    }
    
    console.log(`🎉 Results: ${totalEnrollments} students enrolled in existing sessions, ${totalNewSessions} new sessions created`);
    return totalEnrollments + totalNewSessions;
    
  } catch (error) {
    console.error('❌ Error processing remaining students:', error);
    return 0;
  }
}

// 6. date the main POST handler
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
        
        // ONLY process remaining students if current student didn't join an existing session
        if (!result.enrolledInExisting) {
          setTimeout(async () => {
            console.log('⏰ Processing remaining students after new availability submission...');
            await processRemainingStudents();
          }, 2000); // Longer delay to ensure current transaction completes
        } else {
          console.log('✅ Student enrolled in existing session, skipping background processing');
        }
        
        return NextResponse.json(result);

      } else if (user.role === 'teacher') {
        // Handle teacher availability
        const availability = await storeTeacherAvailability(user._id, analysis.availability);
        
        // First, try to match with existing pending students
        setTimeout(async () => {
          console.log('⏰ Processing students after teacher availability...');
          await processRemainingStudents();
        }, 1000);
        
        // Then create new sessions if needed
        const createdSessions = await checkAndCreateSessions();

        let response = {
          message: "Great! I've recorded your teaching availability.",
          analysis,
          availability: availability._id,
          sessionsCreated: createdSessions.length
        };

        if (createdSessions.length > 0) {
          response.message += ` Perfect! I created ${createdSessions.length} session(s) with all available students.`;
          response.sessions = createdSessions.map(session => ({
            id: session._id,
            topic: session.topic,
            schedule: session.schedule,
            studentCount: session.studentIds.length
          }));
        } else {
          response.message += ` I'll match you with students as they become available.`;
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

