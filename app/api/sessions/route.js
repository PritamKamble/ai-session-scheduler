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
    const userId = searchParams.get('userId'); // For user-specific queries
    const includeAvailability = searchParams.get('includeAvailability') === 'true';
    
    // Build query object
    let query = {};
    
    if (status) {
      // Support multiple statuses separated by comma
      const statuses = status.split(',');
      query.status = statuses.length > 1 ? { $in: statuses } : status;
    }
    
    if (teacherId) {
      query.teacherId = teacherId;
    }
    
    if (studentId) {
      query.studentIds = { $in: [studentId] };
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
    if (userId && !teacherId && !studentId) {
      query = {
        ...query,
        $or: [
          { teacherId: userId },
          { studentIds: { $in: [userId] } }
        ]
      };
    }
    
    // Build the query with population
    let sessionQuery = Session.find(query)
      .populate('teacherId', 'name email clerkId')
      .populate('studentIds', 'name email clerkId')
      .sort({ 'schedule.date': 1, 'schedule.startTime': 1 });
    
    // Add populate for student timing preferences if needed
    if (includeAvailability) {
      sessionQuery = sessionQuery.populate('studentTimingPreferences.studentId', 'name email');
    }
    
    const sessions = await sessionQuery.lean();
    
    // Transform sessions to include computed fields
    const transformedSessions = sessions.map(session => {
      const transformed = {
        ...session,
        // Add computed fields
        totalStudents: session.studentIds?.length || 0,
        hasTeacherAvailability: session.teacherAvailability?.length > 0,
        hasStudentPreferences: session.studentTimingPreferences?.length > 0,
        isCoordinated: session.status === 'coordinated',
        
        // Format schedule for easier consumption
        formattedSchedule: session.schedule ? {
          ...session.schedule,
          dateString: session.schedule.date?.toISOString().split('T')[0],
          timeSlot: `${session.schedule.startTime} - ${session.schedule.endTime}`,
          timezone: session.schedule.timezone || 'UTC'
        } : null
      };
      
      // Add availability summary if requested
      if (includeAvailability && session.teacherAvailability) {
        transformed.availabilityOptions = session.teacherAvailability.map(slot => ({
          ...slot,
          dateString: slot.date?.toISOString().split('T')[0],
          timeSlot: `${slot.startTime} - ${slot.endTime}`
        }));
      }
      
      // Add student preferences summary if requested
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
      // Count by status
      aggregation.byStatus[session.status] = (aggregation.byStatus[session.status] || 0) + 1;
      
      // Count upcoming and today's sessions
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
          userId
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
    
    // Verify teacher exists
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
    
    // Create session
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