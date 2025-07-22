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

await connectDB();

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

async function findOptimalTiming(availabilities, teacherAvailabilities, subject) {
  const prompt = `
You are a smart scheduling assistant. Find the OPTIMAL time slot that accommodates the MAXIMUM number of participants.

IMPORTANT RULES:
- Find the time slot where MOST students can attend
- All participants (students + at least one teacher) must be available at the chosen time
- Return the time slot that maximizes student overlap
- If multiple slots have same student count, prefer the one with more total available hours

STUDENT AVAILABILITIES:
${JSON.stringify(availabilities, null, 2)}

TEACHER AVAILABILITIES:
${JSON.stringify(teacherAvailabilities, null, 2)}

SUBJECT: ${subject}

REQUIRED OUTPUT FORMAT:
Return JSON in this exact format:
{
  "optimalSlot": {
    "day": "day_name",
    "startTime": "HH:MM",
    "endTime": "HH:MM",
    "date": "YYYY-MM-DD"
  },
  "availableStudents": [
    {
      "studentId": "id",
      "availabilityId": "availability_id"
    }
  ],
  "teacherId": "teacher_id",
  "totalStudentsAvailable": number
}

Only return valid JSON, no explanations.
`;

  try {
    const response = await callAIService(prompt, openai);
    return JSON.parse(response);
  } catch (error) {
    console.error('❌ Error finding optimal timing:', error);
    return null;
  }
}

async function createImmediateSession(studentId, subject, availability, availabilityId) {
  try {
    console.log(`🚀 Creating immediate session for first student: ${studentId}`);
    
    // Use student's first available slot as initial session time
    const initialSlot = availability[0];
    
    // Find available teachers for this specific time slot
    const availableTeachers = await findAvailableTeacherForTimeSlot(
      initialSlot.day,
      initialSlot.startTime,
      initialSlot.endTime,
      subject
    );
    
    if (availableTeachers.length === 0) {
      throw new Error(`No teachers available for ${subject} at ${initialSlot.day} ${initialSlot.startTime}-${initialSlot.endTime}. Please try a different time slot.`);
    }

    // Use the first available teacher
    const selectedTeacher = availableTeachers[0];

    // Create session with conflict-free timing
    const session = new Session({
      topic: normalizeSubject(subject),
      teacherId: selectedTeacher.teacherId,
      studentIds: [studentId],
      schedule: {
        day: initialSlot.day,
        startTime: initialSlot.startTime,
        endTime: initialSlot.endTime,
        date: initialSlot.date || getNextDateForDay(initialSlot.day),
        timezone: 'UTC'
      },
      status: 'scheduled',
      preferences: {
        duration: calculateDuration(initialSlot.startTime, initialSlot.endTime),
        format: 'individual',
        level: 'mixed'
      }
    });

    await session.save();

    // Update student availability to matched
    await StudentAvailability.findByIdAndUpdate(availabilityId, {
      status: 'matched',
      sessionId: session._id,
      matchedAt: new Date()
    });

    console.log(`✅ Created immediate session ${session._id} with conflict-free teacher ${selectedTeacher.teacherId}`);
    return session;

  } catch (error) {
    console.error('❌ Error creating immediate session:', error);
    throw error;
  }
}

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

function getNextDateForDay(dayName) {
  const dayMap = {
    'sunday': 0,
    'monday': 1,
    'tuesday': 2,
    'wednesday': 3,
    'thursday': 4,
    'friday': 5,
    'saturday': 6
  };
  
  const today = new Date();
  const targetDay = dayMap[dayName.toLowerCase()];
  
  if (targetDay === undefined) {
    // If invalid day, default to next week same day
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    return nextWeek.toISOString().split('T')[0];
  }
  
  const currentDay = today.getDay();
  let daysUntilTarget = targetDay - currentDay;
  
  // If the target day is today or has passed this week, get next week's occurrence
  if (daysUntilTarget <= 0) {
    daysUntilTarget += 7;
  }
  
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + daysUntilTarget);
  
  return targetDate.toISOString().split('T')[0];
}

async function findAvailableTeacherForTimeSlot(day, startTime, endTime, subject) {
  try {
    console.log(`🔍 Finding available teacher for ${day} ${startTime}-${endTime}, subject: ${subject}`);
    
    // Get all teachers who have availability at this time
    const teacherAvailabilities = await TeacherAvailability.find({});
    const availableTeachers = [];
    
    for (const teacherAvail of teacherAvailabilities) {
      // Check if teacher has availability at this time
      const hasTimeSlot = teacherAvail.availability.some(slot => {
        return hasTimeOverlap(
          { day, startTime, endTime },
          { day: slot.day, startTime: slot.startTime, endTime: slot.endTime }
        );
      });
      
      if (hasTimeSlot) {
        // Check if teacher has no conflicts at this time
        const conflictCheck = await checkTeacherConflicts(
          teacherAvail.teacherId,
          day,
          startTime,
          endTime
        );
        
        if (!conflictCheck.hasConflict) {
          availableTeachers.push({
            teacherId: teacherAvail.teacherId,
            availability: teacherAvail.availability
          });
        } else {
          console.log(`❌ Teacher ${teacherAvail.teacherId} has conflict:`, conflictCheck.conflictingSession);
        }
      }
    }
    
    console.log(`✅ Found ${availableTeachers.length} available teachers`);
    return availableTeachers;
    
  } catch (error) {
    console.error('❌ Error finding available teacher:', error);
    return [];
  }
}

async function checkTeacherConflicts(teacherId, day, startTime, endTime, excludeSessionId = null) {
  try {
    console.log(`🔍 Checking teacher ${teacherId} conflicts for ${day} ${startTime}-${endTime}`);
    
    const query = {
      teacherId: teacherId,
      status: { $in: ['scheduled', 'active'] },
      'schedule.day': normalizeDayName(day)
    };
    
    // Exclude current session if updating
    if (excludeSessionId) {
      query._id = { $ne: excludeSessionId };
    }
    
    const conflictingSessions = await Session.find(query);
    
    for (const session of conflictingSessions) {
      const sessionSlot = {
        day: session.schedule.day,
        startTime: session.schedule.startTime,
        endTime: session.schedule.endTime
      };
      
      const requestedSlot = {
        day: normalizeDayName(day),
        startTime,
        endTime
      };
      
      if (hasTimeOverlap(sessionSlot, requestedSlot)) {
        console.log(`❌ Teacher conflict found with session ${session._id}`);
        return {
          hasConflict: true,
          conflictingSession: {
            id: session._id,
            topic: session.topic,
            schedule: session.schedule,
            studentCount: session.studentIds.length
          }
        };
      }
    }
    
    console.log(`✅ No teacher conflicts found`);
    return { hasConflict: false };
    
  } catch (error) {
    console.error('❌ Error checking teacher conflicts:', error);
    return { hasConflict: false }; // Default to no conflict if error
  }
}

async function updateSessionWithNewStudent(existingSession, newStudentId, newAvailabilityId, allAvailabilities, teacherAvailabilities) {
  try {
    console.log(`🔄 Updating session ${existingSession._id} with new student ${newStudentId}`);
    
    // Find optimal timing considering all students in the session
    const optimalTiming = await findOptimalTiming(allAvailabilities, teacherAvailabilities, existingSession.topic);
    
    if (!optimalTiming || !optimalTiming.optimalSlot) {
      throw new Error('Could not find optimal timing for all students');
    }

    const { optimalSlot, availableStudents, teacherId } = optimalTiming;
    
    // Update session with new timing and students
    existingSession.schedule = {
      day: optimalSlot.day,
      startTime: optimalSlot.startTime,
      endTime: optimalSlot.endTime,
      date: optimalSlot.date,
      timezone: 'UTC'
    };
    
    // Add new student if not already in the session
    if (!existingSession.studentIds.includes(newStudentId)) {
      existingSession.studentIds.push(newStudentId);
    }
    
    // Update format based on student count
    existingSession.preferences.format = existingSession.studentIds.length > 1 ? 'group' : 'individual';
    existingSession.preferences.duration = calculateDuration(optimalSlot.startTime, optimalSlot.endTime);
    
    // Update teacher if needed (use the one that's most available)
    if (teacherId && teacherId !== existingSession.teacherId.toString()) {
      existingSession.teacherId = teacherId;
    }

    await existingSession.save();

    // Update new student's availability to matched
    await StudentAvailability.findByIdAndUpdate(newAvailabilityId, {
      status: 'matched',
      sessionId: existingSession._id,
      matchedAt: new Date()
    });

    console.log(`✅ Updated session ${existingSession._id} with optimal timing for ${existingSession.studentIds.length} students`);
    return existingSession;

  } catch (error) {
    console.error('❌ Error updating session with new student:', error);
    throw error;
  }
}

function isCompatibleWithSessionTimeframe(studentAvailability, sessionSchedule, toleranceMinutes = 60) {
  for (const slot of studentAvailability) {
    // Check if same day
    if (normalizeDayName(slot.day) !== normalizeDayName(sessionSchedule.day)) {
      continue;
    }

    const slotStart = timeToMinutes(slot.startTime);
    const slotEnd = timeToMinutes(slot.endTime);
    const sessionStart = timeToMinutes(sessionSchedule.startTime);
    const sessionEnd = timeToMinutes(sessionSchedule.endTime);

    // Check if there's any overlap or they're within tolerance
    const hasOverlap = slotStart < sessionEnd && slotEnd > sessionStart;
    const isNearby = Math.abs(slotStart - sessionStart) <= toleranceMinutes || 
                     Math.abs(slotEnd - sessionEnd) <= toleranceMinutes;

    if (hasOverlap || isNearby) {
      return true;
    }
  }
  return false;
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

async function handleStudentAvailabilityEnhanced(user, analysis) {
  if (!analysis.subject) {
    return {
      message: "Please specify what subject you want to learn along with your availability.",
      analysis
    };
  }

  try {
    console.log(`\n📝 === ENHANCED STUDENT AVAILABILITY HANDLING ===`);
    console.log(`Student: ${user._id}`);
    console.log(`Subject: ${analysis.subject}`);
    console.log(`Availability:`, analysis.availability);
    
    const normalizedSubject = normalizeSubject(analysis.subject);
    
    // Check if student is already enrolled for this subject/time
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

    // Store student availability
    const studentAvailability = await storeStudentAvailability(
      user._id,
      analysis.subject,
      analysis.availability,
      analysis.preferences
    );

    console.log(`📝 Student availability stored with ID: ${studentAvailability._id}`);

    // STEP 1: Check existing sessions for SAME SUBJECT
    const existingSameSessions = await Session.find({
      topic: normalizedSubject,
      status: { $in: ['scheduled', 'active'] }
    });

    console.log(`🔍 Found ${existingSameSessions.length} existing sessions for ${normalizedSubject}`);

    // Try to join compatible existing session for SAME SUBJECT
    for (const session of existingSameSessions) {
      const isCompatible = isCompatibleWithSessionTimeframe(
        analysis.availability, 
        session.schedule, 
        60 // 60 minutes tolerance
      );

      if (isCompatible && !session.studentIds.includes(user._id)) {
        console.log(`✅ Found compatible same-subject session`);
        
        // Get all students' availabilities + new student
        const allStudentAvailabilities = await StudentAvailability.find({
          studentId: { $in: [...session.studentIds, user._id] },
          subject: normalizedSubject,
          status: { $in: ['matched', 'pending'] }
        });

        const teacherAvailabilities = await TeacherAvailability.find({});
        const updatedSession = await updateSessionWithNewStudent(
          session,
          user._id,
          studentAvailability._id,
          allStudentAvailabilities,
          teacherAvailabilities
        );

        return {
          message: `Perfect! I've added you to an existing ${analysis.subject} session. The session is now scheduled for ${updatedSession.schedule.day} ${updatedSession.schedule.startTime}-${updatedSession.schedule.endTime} with ${updatedSession.studentIds.length} students total.`,
          analysis,
          availability: studentAvailability._id,
          sessionUpdated: true,
          session: {
            id: updatedSession._id,
            topic: updatedSession.topic,
            schedule: updatedSession.schedule,
            studentCount: updatedSession.studentIds.length
          }
        };
      }
    }

    // STEP 2: Check if requested time conflicts with OTHER SUBJECT sessions
    for (const requestedSlot of analysis.availability) {
      const availableTeachers = await findAvailableTeacherForTimeSlot(
        requestedSlot.day,
        requestedSlot.startTime,
        requestedSlot.endTime,
        analysis.subject
      );

      if (availableTeachers.length === 0) {
        // Find what sessions are conflicting
        const allSessions = await Session.find({
          status: { $in: ['scheduled', 'active'] },
          'schedule.day': normalizeDayName(requestedSlot.day)
        });

        const conflictingSessions = allSessions.filter(session => {
          return hasTimeOverlap(requestedSlot, {
            day: session.schedule.day,
            startTime: session.schedule.startTime,
            endTime: session.schedule.endTime
          });
        });

        if (conflictingSessions.length > 0) {
          const conflictInfo = conflictingSessions.map(s => 
            `${s.topic} (${s.schedule.startTime}-${s.schedule.endTime})`
          ).join(', ');

          return {
            message: `I'd love to create a ${analysis.subject} session for ${requestedSlot.day} ${requestedSlot.startTime}-${requestedSlot.endTime}, but our teacher is already teaching: ${conflictInfo}. Please choose a different time slot or join an existing session if available.`,
            analysis,
            availability: studentAvailability._id,
            conflict: true,
            conflictingSessions: conflictingSessions.map(s => ({
              topic: s.topic,
              schedule: s.schedule,
              studentCount: s.studentIds.length
            }))
          };
        }
      }
    }

    // STEP 3: Create new session (only if no conflicts)
    console.log(`\n🆕 No conflicts found. Creating new session...`);
    
    const newSession = await createImmediateSession(
      user._id,
      analysis.subject,
      analysis.availability,
      studentAvailability._id
    );

    return {
      message: `Excellent! I've created a new ${analysis.subject} session for you scheduled at ${newSession.schedule.day} ${newSession.schedule.startTime}-${newSession.schedule.endTime}. As more students join, I'll optimize the timing to accommodate everyone.`,
      analysis,
      availability: studentAvailability._id,
      sessionCreated: true,
      session: {
        id: newSession._id,
        topic: newSession.topic,
        schedule: newSession.schedule,
        studentCount: newSession.studentIds.length
      }
    };

  } catch (error) {
    console.error('❌ Error in enhanced student availability handling:', error);
    
    return {
      message: `I've recorded your availability for ${analysis.subject}. ${error.message}`,
      analysis,
      error: error.message
    };
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

    const normalizedDay = normalizeDayName(slot.day);
    
    const processedSlot = {
      day: normalizedDay,
      startTime: slot.startTime,
      endTime: slot.endTime,
      // FIXED: Calculate the correct date for the specified day
      date: slot.date && slot.date !== 'undefined' ? slot.date : getNextDateForDay(normalizedDay)
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
- Students must be from the same subject
- Return sessions in the exact JSON format specified
- Include time slots even if they might have teacher conflicts (we'll check conflicts separately)

STUDENT AVAILABILITIES:
${JSON.stringify(studentAvailabilities, null, 2)}

TEACHER AVAILABILITIES:
${JSON.stringify(teacherAvailabilities, null, 2)}

REQUIRED OUTPUT FORMAT:
Return a JSON array of viable NEW sessions:
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
        "availabilityId": "availability_record_id"
      }
    ],
    "teacherId": "teacher_id"
  }
]

Only return valid JSON, no explanations.
`;

  try {
    const response = await callAIService(prompt, openai);
    const viableSessions = JSON.parse(response);
    
    // Filter sessions that have teacher conflicts
    const conflictFreeSessions = [];
    
    for (const session of viableSessions) {
      if (session.students && session.students.length >= 2) {
        // Check if teacher has conflicts at this time
        const conflictCheck = await checkTeacherConflicts(
          session.teacherId,
          session.day,
          session.startTime,
          session.endTime
        );
        
        if (!conflictCheck.hasConflict) {
          conflictFreeSessions.push(session);
          console.log(`✅ Session viable: ${session.subject} on ${session.day} with ${session.students.length} students`);
        } else {
          console.log(`❌ Session skipped due to teacher conflict: ${session.subject} on ${session.day}`);
        }
      }
    }
    
    console.log(`✓ Found ${conflictFreeSessions.length} conflict-free sessions out of ${viableSessions.length} total`);
    return conflictFreeSessions;
    
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
      
      if (stillPendingStudents.length >= 3) {
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
        // Use the enhanced handling function
        const result = await handleStudentAvailabilityEnhanced(user, analysis);
        return NextResponse.json(result);

      } else if (user.role === 'teacher') {
        // Handle teacher availability (keep existing logic)
        const availability = await storeTeacherAvailability(user._id, analysis.availability);
        
        // Process any pending students who might now be matchable
        setTimeout(async () => {
          console.log('⏰ Processing students after teacher availability...');
          await processRemainingStudents();
        }, 1000);
        
        return NextResponse.json({
          message: "Great! I've recorded your teaching availability. I'll match you with students and create sessions as they become available.",
          analysis,
          availability: availability._id
        });
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

