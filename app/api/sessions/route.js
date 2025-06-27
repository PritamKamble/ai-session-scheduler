// app/api/sessions/route.js
import { NextResponse } from 'next/server';
import { Session } from '@/models/session';
import { User } from '@/models/user';
import connectDB from '@/config/db';
import mongoose from 'mongoose';

export async function GET(request) {
  try {
    await connectDB();
    
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const teacherId = searchParams.get('teacherId');
    const studentId = searchParams.get('studentId');
    const date = searchParams.get('date');
    const topic = searchParams.get('topic');
    const userId = searchParams.get('userId');
    const userRole = searchParams.get('userRole');
    const includeAvailability = searchParams.get('includeAvailability') === 'true';
    
    console.log('=== SESSION FETCH DEBUG ===');
    console.log('Query params:', { status, teacherId, studentId, date, topic, userId, userRole, includeAvailability });
    
    // Build base query object
    let query = {};
    
    // Helper function to check if a string is a valid ObjectId
    const isValidObjectId = (id) => {
      return mongoose.Types.ObjectId.isValid(id) && 
             (String(new mongoose.Types.ObjectId(id)) === id);
    };
    
    // Helper function to find user's MongoDB _id from Clerk ID or ObjectId
    const findUserMongoId = async (userIdentifier) => {
      if (!userIdentifier) return null;
      
      console.log('Finding user for identifier:', userIdentifier);
      
      let searchQuery;
      if (isValidObjectId(userIdentifier)) {
        // If it's a valid ObjectId, search by both _id and clerkId
        searchQuery = {
          $or: [
            { _id: userIdentifier },
            { clerkId: userIdentifier }
          ]
        };
      } else {
        // If it's not a valid ObjectId, only search by clerkId
        searchQuery = { clerkId: userIdentifier };
      }
      
      console.log('User search query:', JSON.stringify(searchQuery, null, 2));
      const user = await User.findOne(searchQuery).select('_id role clerkId name email');
      console.log('User search result:', user);
      return user;
    };
    
    // Add access control based on user role
    if (userRole === 'teacher' && userId) {
      // Teachers can only see their own sessions
      const teacherUser = await findUserMongoId(userId);
      console.log('Teacher lookup - userId:', userId, 'found user:', teacherUser);
      
      if (teacherUser) {
        // Verify the user is actually a teacher
        if (teacherUser.role !== 'teacher') {
          console.log('User is not a teacher, role:', teacherUser.role);
          return NextResponse.json({
            success: false,
            error: 'Access denied - user is not a teacher',
            data: []
          }, { status: 403 });
        }
        
        query.teacherId = teacherUser._id;
        console.log('Teacher query set:', { teacherId: teacherUser._id });
      } else {
        console.log('Teacher not found, returning empty result');
        return NextResponse.json({
          success: true,
          data: [],
          aggregation: { total: 0, byStatus: {}, upcomingSessions: 0, todaySessions: 0 },
          query: { filters: { status, teacherId, studentId, date, topic, userId, userRole }, includeAvailability }
        });
      }
    } else if (userRole === 'student' && userId) {
      // Students can only see sessions they've joined
      const studentUser = await findUserMongoId(userId);
      console.log('Student lookup - userId:', userId, 'found user:', studentUser);
      
      if (studentUser) {
        // Verify the user is actually a student
        if (studentUser.role !== 'student') {
          console.log('User is not a student, role:', studentUser.role);
          return NextResponse.json({
            success: false,
            error: 'Access denied - user is not a student',
            data: []
          }, { status: 403 });
        }
        
        query.studentIds = { $in: [studentUser._id] };
        console.log('Student query set:', { studentIds: { $in: [studentUser._id] } });
      } else {
        console.log('Student not found, returning empty result');
        return NextResponse.json({
          success: true,
          data: [],
          aggregation: { total: 0, byStatus: {}, upcomingSessions: 0, todaySessions: 0 },
          query: { filters: { status, teacherId, studentId, date, topic, userId, userRole }, includeAvailability }
        });
      }
    }
    
    // Add additional filters only if no role-based restrictions or if admin
    if (status) {
      const statuses = status.split(',');
      query.status = statuses.length > 1 ? { $in: statuses } : status;
      console.log('Status filter added:', query.status);
    }
    
    if (teacherId && (userRole === 'admin' || !userRole)) {
      // Only allow teacherId filter for admins or when no role is specified
      const teacherUser = await findUserMongoId(teacherId);
      if (teacherUser) {
        query.teacherId = teacherUser._id;
        console.log('Additional teacherId filter added:', teacherUser._id);
      }
    }
    
    if (studentId && (userRole === 'admin' || !userRole)) {
      // Only allow studentId filter for admins or when no role is specified
      const studentUser = await findUserMongoId(studentId);
      if (studentUser) {
        query.studentIds = { $in: [studentUser._id] };
        console.log('Additional studentId filter added:', studentUser._id);
      }
    }
    
    if (topic) {
      query.topic = { $regex: topic, $options: 'i' };
      console.log('Topic filter added:', query.topic);
    }
    
    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      
      query['schedule.date'] = {
        $gte: startOfDay,
        $lte: endOfDay
      };
      console.log('Date filter added:', query['schedule.date']);
    }
    
    // Special handling for debugging - if no role-based restrictions, show more info
    if (!userRole && userId) {
      console.log('No role specified, checking user:', userId);
      const user = await findUserMongoId(userId);
      console.log('Found user:', user);
      
      // Show all sessions for this user (both as teacher and student)
      if (user) {
        query = {
          $or: [
            { teacherId: user._id },
            { studentIds: { $in: [user._id] } }
          ]
        };
        console.log('User-based query (no role):', JSON.stringify(query, null, 2));
      }
    }
    
    // Build the query with population
    console.log('=== FINAL QUERY ===');
    console.log('Final query before database:', JSON.stringify(query, null, 2));
    
    let sessionQuery = Session.find(query)
      .populate('teacherId', 'name email clerkId')
      .populate('studentIds', 'name email clerkId')
      .sort({ 'schedule.date': 1, 'schedule.startTime': 1 });
    
    if (includeAvailability) {
      sessionQuery = sessionQuery.populate('studentTimingPreferences.studentId', 'name email');
    }
    
    const sessions = await sessionQuery.lean();
    console.log('=== QUERY RESULTS ===');
    console.log('Sessions found:', sessions.length);
    console.log('Sample session (first one):', sessions[0] ? {
      _id: sessions[0]._id,
      topic: sessions[0].topic,
      teacherId: sessions[0].teacherId,
      status: sessions[0].status,
      schedule: sessions[0].schedule
    } : 'No sessions found');
    
    // Transform sessions to include computed fields
    const transformedSessions = sessions.map(session => {
      const transformed = {
        ...session,
        totalStudents: session.studentIds?.length || 0,
        hasTeacherAvailability: session.teacherAvailability?.length > 0,
        hasStudentPreferences: session.studentTimingPreferences?.length > 0,
        isCoordinated: session.status === 'scheduled',
        
        formattedSchedule: session.schedule ? {
          ...session.schedule,
          dateString: session.schedule.date?.toISOString().split('T')[0],
          timeSlot: `${session.schedule.startTime} - ${session.schedule.endTime}`,
          timezone: session.schedule.timezone || 'UTC'
        } : null
      };
      
      if (includeAvailability && session.teacherAvailability) {
        transformed.availabilityOptions = session.teacherAvailability.map(slot => ({
          ...slot,
          dateString: slot.date?.toISOString().split('T')[0],
          timeSlot: `${slot.startTime} - ${slot.endTime}`
        }));
      }
      
      if (includeAvailability && session.studentTimingPreferences) {
        transformed.studentPreferencesCount = session.studentTimingPreferences.length;
        transformed.studentsWithPreferences = session.studentTimingPreferences.map(pref => ({
          studentId: pref.studentId,
          preferenceCount: pref.preferences?.length || 0,
          lastUpdated: pref.updatedAt
        }));
      }
      
      return transformed;
    });
    
    // Add aggregation data
    const aggregation = {
      total: transformedSessions.length,
      byStatus: {},
      upcomingSessions: 0,
      todaySessions: 0
    };
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    transformedSessions.forEach(session => {
      aggregation.byStatus[session.status] = (aggregation.byStatus[session.status] || 0) + 1;
      
      if (session.schedule?.date) {
        const sessionDate = new Date(session.schedule.date);
        sessionDate.setHours(0, 0, 0, 0);
        
        if (sessionDate >= today) {
          aggregation.upcomingSessions++;
        }
        
        if (sessionDate.getTime() === today.getTime()) {
          aggregation.todaySessions++;
        }
      }
    });
    
    console.log('=== RESPONSE SUMMARY ===');
    console.log('Returning', transformedSessions.length, 'sessions');
    console.log('Aggregation:', aggregation);
    
    return NextResponse.json({
      success: true,
      data: transformedSessions,
      aggregation,
      query: {
        filters: {
          status,
          teacherId,
          studentId,
          date,
          topic,
          userId,
          userRole
        },
        includeAvailability
      }
    });
    
  } catch (error) {
    console.error('Error fetching sessions:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch sessions',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    await connectDB();
    
    const body = await request.json();
    const { 
      topic, 
      teacherId, 
      schedule, 
      teacherAvailability = [],
      preferences = {},
      notes = ''
    } = body;
    
    // Validate required fields
    if (!topic || !teacherId) {
      return NextResponse.json(
        { success: false, error: 'Topic and teacherId are required' },
        { status: 400 }
      );
    }
    
    // Helper function to check if a string is a valid ObjectId
    const isValidObjectId = (id) => {
      return mongoose.Types.ObjectId.isValid(id) && 
             (String(new mongoose.Types.ObjectId(id)) === id);
    };
    
    // Verify teacher exists and get MongoDB _id
    let teacherQuery;
    if (isValidObjectId(teacherId)) {
      teacherQuery = {
        $or: [
          { _id: teacherId },
          { clerkId: teacherId }
        ]
      };
    } else {
      teacherQuery = { clerkId: teacherId };
    }
    
    const teacher = await User.findOne(teacherQuery);
    
    if (!teacher) {
      return NextResponse.json(
        { success: false, error: 'Teacher not found' },
        { status: 404 }
      );
    }
    
    if (teacher.role !== 'teacher') {
      return NextResponse.json(
        { success: false, error: 'User is not a teacher' },
        { status: 403 }
      );
    }
    
    // Process teacher availability - convert string dates to Date objects
    const processedAvailability = teacherAvailability.map(slot => ({
      ...slot,
      date: new Date(slot.date)
    }));
    
    // Create session using the teacher's MongoDB _id
    const session = new Session({
      topic: topic.trim(),
      teacherId: teacher._id,
      schedule: schedule ? {
        ...schedule,
        date: new Date(schedule.date)
      } : undefined,
      teacherAvailability: processedAvailability,
      preferences,
      notes: notes.trim(),
      status: 'pending',
      studentIds: [],
      studentTimingPreferences: []
    });
    
    await session.save();
    
    // Populate the created session
    const populatedSession = await Session.findById(session._id)
      .populate('teacherId', 'name email clerkId')
      .lean();
    
    return NextResponse.json({
      success: true,
      data: populatedSession,
      message: 'Session created successfully'
    }, { status: 201 });
    
  } catch (error) {
    console.error('Error creating session:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          details: validationErrors
        },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create session',
        message: error.message
      },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  try {
    await connectDB();
    
    const body = await request.json();
    const { sessionId, ...updateData } = body;
    
    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Session ID is required' },
        { status: 400 }
      );
    }
    
    // Helper function to check if a string is a valid ObjectId
    const isValidObjectId = (id) => {
      return mongoose.Types.ObjectId.isValid(id) && 
             (String(new mongoose.Types.ObjectId(id)) === id);
    };
    
    // Process dates in update data
    if (updateData.schedule?.date) {
      updateData.schedule.date = new Date(updateData.schedule.date);
    }
    
    if (updateData.teacherAvailability) {
      updateData.teacherAvailability = updateData.teacherAvailability.map(slot => ({
        ...slot,
        date: new Date(slot.date)
      }));
    }
    
    if (updateData.studentTimingPreferences) {
      updateData.studentTimingPreferences = updateData.studentTimingPreferences.map(pref => ({
        ...pref,
        preferences: pref.preferences?.map(slot => ({
          ...slot,
          date: new Date(slot.date)
        }))
      }));
    }
    
    // If updating studentIds, convert Clerk IDs to MongoDB IDs
    if (updateData.studentIds) {
      const studentMongoIds = [];
      for (const studentId of updateData.studentIds) {
        let studentQuery;
        if (isValidObjectId(studentId)) {
          studentQuery = {
            $or: [
              { _id: studentId },
              { clerkId: studentId }
            ]
          };
        } else {
          studentQuery = { clerkId: studentId };
        }
        
        const student = await User.findOne(studentQuery).select('_id');
        if (student) {
          studentMongoIds.push(student._id);
        }
      }
      updateData.studentIds = studentMongoIds;
    }
    
    const updatedSession = await Session.findByIdAndUpdate(
      sessionId,
      updateData,
      { 
        new: true, 
        runValidators: true 
      }
    )
    .populate('teacherId', 'name email clerkId')
    .populate('studentIds', 'name email clerkId')
    .lean();
    
    if (!updatedSession) {
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      data: updatedSession,
      message: 'Session updated successfully'
    });
    
  } catch (error) {
    console.error('Error updating session:', error);
    
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          details: validationErrors
        },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update session',
        message: error.message
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    await connectDB();
    
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    
    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Session ID is required' },
        { status: 400 }
      );
    }
    
    const deletedSession = await Session.findByIdAndDelete(sessionId).lean();
    
    if (!deletedSession) {
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      data: deletedSession,
      message: 'Session deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting session:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete session',
        message: error.message
      },
      { status: 500 }
    );
  }
}