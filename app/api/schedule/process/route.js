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

// Function to check if student availability overlaps with ANY teacher availability
function checkStudentTeacherOverlap(studentAvailability, teacherAvailabilities) {
  const conflicts = [];
  const validSlots = [];
  
  for (const studentSlot of studentAvailability) {
    const studentStart = timeToMinutes(studentSlot.startTime);
    const studentEnd = timeToMinutes(studentSlot.endTime);
    
    let hasOverlap = false;
    
    for (const teacherAvail of teacherAvailabilities) {
      for (const teacherSlot of teacherAvail.availability) {
        if (teacherSlot.day.toLowerCase() === studentSlot.day.toLowerCase()) {
          const teacherStart = timeToMinutes(teacherSlot.startTime);
          const teacherEnd = timeToMinutes(teacherSlot.endTime);
          
          // Check if there's any overlap
          if (studentStart < teacherEnd && studentEnd > teacherStart) {
            hasOverlap = true;
            validSlots.push(studentSlot);
            break;
          }
        }
      }
      if (hasOverlap) break;
    }
    
    if (!hasOverlap) {
      conflicts.push(studentSlot);
    }
  }
  
  return { conflicts, validSlots };
}

// Function to format teacher availability for display
function formatTeacherAvailability(teacherAvailabilities) {
  const formatted = [];
  
  for (const teacherAvail of teacherAvailabilities) {
    for (const slot of teacherAvail.availability) {
      formatted.push(`${slot.day} ${slot.startTime}-${slot.endTime}`);
    }
  }
  
  return formatted.join(', ');
}

// Function to process and normalize availability slots
function processAvailabilitySlots(availability) {
  if (!availability || !Array.isArray(availability)) {
    return [];
  }

  return availability.map(slot => {
    const processedSlot = {
      day: normalizeDayName(slot.day), // Use normalized day
      startTime: slot.startTime || '09:00',
      endTime: slot.endTime || '10:00'
    };

    // Handle date field - if null/undefined, provide a default future date
    if (slot.date && slot.date !== null && slot.date !== undefined) {
      const dateObj = new Date(slot.date);
      if (!isNaN(dateObj.getTime())) {
        processedSlot.date = slot.date;
      } else {
        processedSlot.date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      }
    } else {
      processedSlot.date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }

    return processedSlot;
  });
}


// Function to find overlapping time windows between students
async function findStudentOverlaps(studentAvailabilities, teacherAvailabilities) {
  const viableSessions = [];
  
  // First group students by subject
  const studentsBySubject = {};
  studentAvailabilities.forEach(student => {
    if (!studentsBySubject[student.subject]) {
      studentsBySubject[student.subject] = [];
    }
    studentsBySubject[student.subject].push(student);
  });

  // For each subject group with at least 4 students
  for (const [subject, students] of Object.entries(studentsBySubject)) {
    if (students.length >= 4) {
      try {
        console.log(`\n=== Processing subject: ${subject} with ${students.length} students ===`);
        
        // Log all student availabilities for debugging
        students.forEach((student, index) => {
          console.log(`Student ${index + 1} (${student.studentId}):`);
          student.availability.forEach(slot => {
            console.log(`  - ${slot.day} ${slot.startTime}-${slot.endTime}`);
          });
        });

        // Log teacher availabilities
        console.log('\nTeacher availabilities:');
        teacherAvailabilities.forEach((teacher, index) => {
          console.log(`Teacher ${index + 1} (${teacher.teacherId}):`);
          teacher.availability.forEach(slot => {
            console.log(`  - ${slot.day} ${slot.startTime}-${slot.endTime}`);
          });
        });

        // Prepare context for AI with normalized days
        const context = {
          subject,
          teacherAvailabilities: teacherAvailabilities.map(teacher => ({
            teacherId: teacher.teacherId,
            availability: teacher.availability.map(slot => ({
              day: normalizeDayName(slot.day),
              startTime: slot.startTime,
              endTime: slot.endTime,
              date: slot.date
            }))
          })),
          studentAvailabilities: students.map(student => ({
            studentId: student.studentId,
            availability: student.availability.map(slot => ({
              day: normalizeDayName(slot.day),
              startTime: slot.startTime,
              endTime: slot.endTime,
              date: slot.date
            }))
          }))
        };

        // Get AI-suggested optimal sessions
        const aiResponse = await getAISuggestedSessions(context);
        console.log('\nAI Response:', JSON.stringify(aiResponse, null, 2));
        
        // Process AI suggestions
        if (aiResponse.optimalSlots && aiResponse.optimalSlots.length > 0) {
          for (const slot of aiResponse.optimalSlots) {
            console.log(`\n--- Processing AI slot ---`);
            console.log(`Day: ${slot.day} (normalized: ${normalizeDayName(slot.day)})`);
            console.log(`Time: ${slot.startTime}-${slot.endTime}`);
            console.log(`Student count: ${slot.studentCount}, Teacher ID: ${slot.teacherId}`);
            
            // Normalize the AI slot day
            const normalizedSlot = {
              ...slot,
              day: normalizeDayName(slot.day)
            };
            
            // Verify the slot meets our requirements
            if (slot.studentCount >= 4 && slot.teacherId) {
              // Find which students are actually available for this slot
              const matchingStudents = students.filter(student => {
                const hasMatch = student.availability.some(avail => {
                  const normalizedAvail = {
                    ...avail,
                    day: normalizeDayName(avail.day)
                  };
                  const dayMatch = normalizedAvail.day === normalizedSlot.day;
                  const timeOverlap = hasTimeOverlap(normalizedAvail, normalizedSlot);
                  console.log(`  Student ${student.studentId}: day match: ${dayMatch}, time overlap: ${timeOverlap}`);
                  console.log(`    Student slot: ${normalizedAvail.day} ${normalizedAvail.startTime}-${normalizedAvail.endTime}`);
                  console.log(`    AI slot: ${normalizedSlot.day} ${normalizedSlot.startTime}-${normalizedSlot.endTime}`);
                  return dayMatch && timeOverlap;
                });
                return hasMatch;
              }).map(student => ({
                studentId: student.studentId,
                availabilityId: student._id
              }));

              console.log(`Found ${matchingStudents.length} matching students:`, matchingStudents);

              if (matchingStudents.length >= 4) {
                const session = {
                  subject,
                  day: normalizedSlot.day,
                  startTime: normalizedSlot.startTime,
                  endTime: normalizedSlot.endTime,
                  date: normalizedSlot.date,
                  students: matchingStudents,
                  teacherId: slot.teacherId
                };
                console.log('✓ Adding viable session:', session);
                viableSessions.push(session);
              } else {
                console.log(`✗ Not enough matching students: ${matchingStudents.length} < 4`);
              }
            } else {
              console.log(`✗ Slot doesn't meet requirements: studentCount=${slot.studentCount}, teacherId=${slot.teacherId}`);
            }
          }
        } else {
          console.log('No optimal slots found in AI response');
        }
      } catch (error) {
        console.error(`Error processing subject ${subject} with AI:`, error);
      }
    }
  }
  
  console.log('\n=== Final viable sessions ===');
  viableSessions.forEach((session, index) => {
    console.log(`${index + 1}. ${session.subject} - ${session.day} ${session.startTime}-${session.endTime} (${session.students.length} students)`);
  });
  
  return viableSessions;
}

// Helper function to get AI suggestions
async function getAISuggestedSessions(context) {
  const prompt = `Analyze the following teaching/learning availability data to suggest optimal session times in JSON format:

CONTEXT:
${JSON.stringify(context, null, 2)}

INSTRUCTIONS (respond in JSON format):
1. Find time slots where at least 4 students are available
2. Must overlap with teacher availability
3. Prioritize slots with most student overlap
4. Ideal duration: 1-2 hours
5. Include teacher ID for each slot
6. One slot per subject per day
7. **IMPORTANT**: Use full day names in lowercase (monday, tuesday, wednesday, thursday, friday, saturday, sunday)

Return a JSON object with optimalSlots array and analysis text. Example JSON response:
{
  "optimalSlots": [{
    "day": "monday",
    "startTime": "14:00",
    "endTime": "16:00",
    "date": "2025-07-20",
    "studentCount": 4,
    "teacherId": "teacher_123",
    "durationMinutes": 90
  }],
  "analysis": "Found 3 optimal time slots..."
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { 
          role: 'system', 
          content: 'You are an expert educational scheduler. Always respond with valid JSON.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);
    
    // Validate the response structure
    if (!result.optimalSlots || !Array.isArray(result.optimalSlots)) {
      throw new Error('AI response missing required optimalSlots array');
    }
    
    return result;
  } catch (error) {
    console.error('Error in AI scheduling:', error);
    throw new Error('Failed to get AI scheduling suggestions');
  }
}

function hasTimeOverlap(slot1, slot2) {
  // Normalize both days for comparison
  const day1 = normalizeDayName(slot1.day);
  const day2 = normalizeDayName(slot2.day);
  
  // First check if days match (quick rejection)
  if (day1 !== day2) {
    console.log(`Day mismatch: ${day1} vs ${day2}`);
    return false;
  }

  // Validate time formats
  if (!slot1.startTime || !slot1.endTime || !slot2.startTime || !slot2.endTime) {
    console.log('Invalid time format detected');
    return false;
  }

  // Convert to minutes for comparison
  const s1 = timeToMinutes(slot1.startTime);
  const e1 = timeToMinutes(slot1.endTime);
  const s2 = timeToMinutes(slot2.startTime);
  const e2 = timeToMinutes(slot2.endTime);

  // Check for valid time ranges
  if (s1 >= e1 || s2 >= e2) {
    console.log('Invalid time range detected');
    return false;
  }

  // Final overlap check
  const hasOverlap = s1 < e2 && e1 > s2;
  console.log(`Time overlap check: ${slot1.startTime}-${slot1.endTime} vs ${slot2.startTime}-${slot2.endTime} = ${hasOverlap}`);
  return hasOverlap;
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
      existingAvailability.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
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
      // Get teacher (no longer assuming single teacher)
      const teacher = await User.findById(overlap.teacherId);
      if (!teacher) {
        console.error(`Teacher not found for ID: ${overlap.teacherId}`);
        continue;
      }
      
      // Create session
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
    
    // Find viable session combinations
    const viableSessions = await findStudentOverlaps(studentAvailabilities, teacherAvailabilities);
  
    
    // Create sessions from viable combinations
    const createdSessions = await createSessionsFromOverlaps(viableSessions);
    
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

        // Get teacher availabilities to check conflicts
        const teacherAvailabilities = await TeacherAvailability.find({});
        
        if (teacherAvailabilities.length === 0) {
          return NextResponse.json({
            message: "No teachers are currently available. Please contact admin for more information.",
            analysis
          });
        }

        // Check for conflicts with teacher availability
        const { conflicts, validSlots } = checkStudentTeacherOverlap(analysis.availability, teacherAvailabilities);
        
        if (conflicts.length > 0 && validSlots.length === 0) {
          // All student slots conflict with teacher availability
          const teacherSchedule = formatTeacherAvailability(teacherAvailabilities);
          return NextResponse.json({
            message: `Please be available during teacher's schedule: ${teacherSchedule}`,
            analysis,
            teacherAvailability: teacherSchedule,
            conflicts: conflicts
          });
        }
        
        if (conflicts.length > 0) {
          // Some slots conflict, warn user but proceed with valid slots
          const teacherSchedule = formatTeacherAvailability(teacherAvailabilities);
          analysis.availability = validSlots; // Only use valid slots
          // Add warning message about conflicts
        }

        // Store student availability (only valid slots)
        const availability = await storeStudentAvailability(
          user._id,
          analysis.subject,
          validSlots.length > 0 ? validSlots : analysis.availability,
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

        // Add conflict warning if applicable
        if (conflicts.length > 0) {
          const teacherSchedule = formatTeacherAvailability(teacherAvailabilities);
          response.message += ` Note: Some of your requested times don't match teacher availability (${teacherSchedule}).`;
        }

        if (createdSessions.length > 0) {
          response.message += ` Excellent! I created ${createdSessions.length} session(s) with enough students and overlapping availability.`;
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
          response.message += ` Currently ${currentStudents} students are interested in ${analysis.subject}. We need 4+ students with overlapping availability to create a session.`;
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
          response.message += ` Perfect! I created ${createdSessions.length} session(s) where your availability overlaps with student groups.`;
          response.sessions = createdSessions.map(session => ({
            id: session._id,
            topic: session.topic,
            schedule: session.schedule,
            studentCount: session.studentIds.length
          }));
        } else {
          response.message += " I'm monitoring for student groups that overlap with your availability.";
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

