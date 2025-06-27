// app/api/sessions/route.js
import { NextResponse } from 'next/server';
import { Session } from '@/models/session';
import { User } from '@/models/user';
import connectDB from '@/config/db';

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
    
    // Build base query object
    let query = {};
    
    // Helper function to find user's MongoDB _id from Clerk ID
    const findUserMongoId = async (userIdentifier) => {
      const user = await User.findOne({
        $or: [
          { _id: userIdentifier },
          { clerkId: userIdentifier }
        ]
      }).select('_id');
      return user?._id;
    };
    
    // Add access control based on user role
    if (userRole === 'teacher' && userId) {
      // Teachers can only see their own sessions
      const teacherMongoId = await findUserMongoId(userId);
      if (teacherMongoId) {
        query.teacherId = teacherMongoId;
      } else {
        // If user not found, return empty result
        return NextResponse.json({
          success: true,
          data: [],
          aggregation: { total: 0, byStatus: {}, upcomingSessions: 0, todaySessions: 0 },
          query: { filters: { status, teacherId, studentId, date, topic, userId, userRole }, includeAvailability }
        });
      }
    } else if (userRole === 'student' && userId) {
      // Students can only see sessions they've joined
      const studentMongoId = await findUserMongoId(userId);
      if (studentMongoId) {
        query.studentIds = { $in: [studentMongoId] };
      } else {
        // If user not found, return empty result
        return NextResponse.json({
          success: true,
          data: [],
          aggregation: { total: 0, byStatus: {}, upcomingSessions: 0, todaySessions: 0 },
          query: { filters: { status, teacherId, studentId, date, topic, userId, userRole }, includeAvailability }
        });
      }
    }
    
    // Add additional filters
    if (status) {
      const statuses = status.split(',');
      query.status = statuses.length > 1 ? { $in: statuses } : status;
    }
    
    if (teacherId && (userRole === 'admin' || !userRole)) {
      // Only allow teacherId filter for admins or when no role is specified
      const teacherMongoId = await findUserMongoId(teacherId);
      if (teacherMongoId) {
        query.teacherId = teacherMongoId;
      }
    }
    
    if (studentId && (userRole === 'admin' || !userRole)) {
      // Only allow studentId filter for admins or when no role is specified
      const studentMongoId = await findUserMongoId(studentId);
      if (studentMongoId) {
        query.studentIds = { $in: [studentMongoId] };
      }
    }
    
    if (topic) {
      query.topic = { $regex: topic, $options: 'i' };
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
    }
    
    // Special query for user-specific sessions (both as teacher and student)
    if (userId && !teacherId && !studentId && (userRole === 'admin' || !userRole)) {
      const userMongoId = await findUserMongoId(userId);
      if (userMongoId) {
        query = {
          ...query,
          $or: [
            { teacherId: userMongoId },
            { studentIds: { $in: [userMongoId] } }
          ]
        };
      }
    }
    
    // Build the query with population
    let sessionQuery = Session.find(query)
      .populate('teacherId', 'name email clerkId')
      .populate('studentIds', 'name email clerkId')
      .sort({ 'schedule.date': 1, 'schedule.startTime': 1 });
    
    if (includeAvailability) {
      sessionQuery = sessionQuery.populate('studentTimingPreferences.studentId', 'name email');
    }
    
    const sessions = await sessionQuery.lean();
    
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
    
    // Verify teacher exists and get MongoDB _id
    const teacher = await User.findOne({ 
      $or: [
        { _id: teacherId },
        { clerkId: teacherId }
      ]
    });
    
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
        const student = await User.findOne({
          $or: [
            { _id: studentId },
            { clerkId: studentId }
          ]
        }).select('_id');
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