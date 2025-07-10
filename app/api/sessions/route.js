// app/api/sessions/route.js
import { NextResponse } from 'next/server';
import connectDB from '@/config/db';
import { Session } from '@/models/session';
import { User } from '@/models/user';
import { Context } from '@/models/context';
import { queryPineconeVectorStore } from '@/lib/pinecone';
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
    const useVectorSearch = searchParams.get('useVectorSearch') === 'true';
    const minScore = parseFloat(searchParams.get('minScore')) || 0.7;
    const limit = parseInt(searchParams.get('limit')) || 50;
    const page = parseInt(searchParams.get('page')) || 1;
    const skip = (page - 1) * limit;
    
    // Build base query object
    let query = {};
    let user = null;
    let vectorResults = null;
    
    // Helper function to find user's MongoDB _id from Clerk ID
    const findUserByClerkId = async (clerkId) => {
      if (!clerkId) return null;
      try {
        return await User.findOne({ clerkId }).select('_id role name email').lean();
      } catch (error) {
        console.error('Error finding user by Clerk ID:', error);
        return null;
      }
    };
    
    // Find user if clerkId is provided
    if (userId) {
      user = await findUserByClerkId(userId);
      if (!user) {
        return NextResponse.json({
          success: false,
          error: 'User not found',
          data: []
        }, { status: 404 });
      }
    }
    
    // Role-based access control with improved error handling
    if (userRole === 'teacher' && user) {
      if (user.role !== 'teacher') {
        return NextResponse.json({
          success: false,
          error: 'Access denied - insufficient permissions',
          data: []
        }, { status: 403 });
      }
      query.teacherId = user._id;
    } 
    else if (userRole === 'student' && user) {
      if (user.role !== 'student') {
        return NextResponse.json({
          success: false,
          error: 'Access denied - insufficient permissions',
          data: []
        }, { status: 403 });
      }
      
      // Base query for student's sessions
      query.studentIds = { $in: [user._id] };
      
      // Enhanced vector search for students
      if (useVectorSearch) {
        try {
          // Find the most recent context for this student user
          const latestContext = await Context.findOne({ 
            userId: user._id,
            role: 'student' // Match the role field in your schema
          })
            .sort({ timestamp: -1 })
            .limit(1)
            .lean();
          
          if (latestContext?.embedding?.length > 0) {
            console.log(`Using context embedding for user ${user._id}, message: "${latestContext.message.substring(0, 50)}..."`);
            
            // Build vector search filters - align with your session structure
            const vectorFilters = {
              studentIds: [user._id.toString()],
              ...(status && { status }),
              ...(date && { 
                date: {
                  $gte: new Date(date + 'T00:00:00.000Z').toISOString(),
                  $lte: new Date(date + 'T23:59:59.999Z').toISOString()
                }
              }),
              ...(topic && { topic })
            };
            
            vectorResults = await queryPineconeVectorStore({
              userId: user._id.toString(),
              embedding: latestContext.embedding,
              filter: vectorFilters,
              topK: Math.min(limit * 2, 20), // Get more results for better filtering
              minScore
            });
            
            if (vectorResults?.length > 0) {
              console.log(`Vector search found ${vectorResults.length} relevant sessions`);
              // Combine vector results with regular query
              const vectorSessionIds = vectorResults.map(r => {
                try {
                  return new mongoose.Types.ObjectId(r.id);
                } catch (err) {
                  console.warn(`Invalid ObjectId in vector results: ${r.id}`);
                  return null;
                }
              }).filter(Boolean);
              
              if (vectorSessionIds.length > 0) {
                query._id = { $in: vectorSessionIds };
              }
            } else {
              // No vector results found, fall back to regular search
              console.log('No vector results found with sufficient similarity, using regular search');
            }
          } else {
            console.log('No valid embedding found in latest context, using regular search');
          }
        } catch (contextError) {
          console.error('Vector search error:', contextError);
          // Continue with regular query if vector search fails
        }
      }
    }
    
    // Additional filters with validation
    if (status) {
      const validStatuses = ['pending', 'scheduled', 'completed', 'cancelled'];
      const statuses = status.split(',').filter(s => validStatuses.includes(s));
      
      if (statuses.length === 0) {
        return NextResponse.json({
          success: false,
          error: 'Invalid status values provided',
          data: []
        }, { status: 400 });
      }
      
      query.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
    }
    
    if (teacherId && (userRole === 'admin' || !userRole)) {
      const teacherUser = await findUserByClerkId(teacherId);
      if (teacherUser) {
        query.teacherId = teacherUser._id;
      } else {
        return NextResponse.json({
          success: false,
          error: 'Teacher not found',
          data: []
        }, { status: 404 });
      }
    }
    
    if (studentId && (userRole === 'admin' || !userRole)) {
      const studentUser = await findUserByClerkId(studentId);
      if (studentUser) {
        query.studentIds = { $in: [studentUser._id] };
      } else {
        return NextResponse.json({
          success: false,
          error: 'Student not found',
          data: []
        }, { status: 404 });
      }
    }
    
    if (topic) {
      query.topic = { $regex: topic, $options: 'i' };
    }
    
    if (date) {
      try {
        const targetDate = new Date(date);
        if (isNaN(targetDate.getTime())) {
          throw new Error('Invalid date format');
        }
        
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);
        
        query['schedule.date'] = { $gte: startOfDay, $lte: endOfDay };
      } catch (dateError) {
        return NextResponse.json({
          success: false,
          error: 'Invalid date format provided',
          data: []
        }, { status: 400 });
      }
    }
    
    // Special case: No role specified but user provided
    if (!userRole && user) {
      query = {
        $or: [
          { teacherId: user._id },
          { studentIds: { $in: [user._id] } }
        ]
      };
    }
    
    // Get total count for pagination
    const totalCount = await Session.countDocuments(query);
    
    // Build and execute query with pagination
    let sessionQuery = Session.find(query)
      .populate('teacherId', 'name email clerkId')
      .populate('studentIds', 'name email clerkId')
      .sort({ 'schedule.date': 1, 'schedule.startTime': 1 })
      .skip(skip)
      .limit(limit);
    
    if (includeAvailability) {
      sessionQuery = sessionQuery.populate({
        path: 'studentTimingPreferences.studentId',
        select: 'name email'
      });
    }
    
    const sessions = await sessionQuery.lean();
    
    // If we used vector search, sort by similarity score
    let sortedSessions = sessions;
    if (vectorResults?.length > 0) {
      const scoreMap = new Map(vectorResults.map(r => [r.id, r.score]));
      
      sortedSessions = sessions
        .map(session => ({
          ...session,
          similarityScore: scoreMap.get(session._id.toString()) || 0
        }))
        .sort((a, b) => b.similarityScore - a.similarityScore);
    }
    
    // Transform sessions with enhanced data
    const transformedSessions = sortedSessions.map(session => {
      const transformed = {
        ...session,
        totalStudents: session.studentIds?.length || 0,
        hasTeacherAvailability: session.teacherAvailability?.length > 0,
        hasStudentPreferences: session.studentTimingPreferences?.length > 0,
        isCoordinated: session.status === 'scheduled',
        ...(session.similarityScore !== undefined && { 
          similarityScore: session.similarityScore 
        })
      };
      
      if (session.schedule) {
        transformed.formattedSchedule = {
          ...session.schedule,
          dateString: session.schedule.date?.toISOString().split('T')[0],
          timeSlot: `${session.schedule.startTime} - ${session.schedule.endTime}`,
          timezone: session.schedule.timezone || 'UTC'
        };
      }
      
      if (includeAvailability && session.teacherAvailability) {
        transformed.availabilityOptions = session.teacherAvailability.map(slot => ({
          ...slot,
          dateString: slot.date?.toISOString().split('T')[0],
          timeSlot: `${slot.startTime} - ${slot.endTime}`
        }));
      }
      
      if (includeAvailability && session.studentTimingPreferences) {
        transformed.studentPreferences = session.studentTimingPreferences.map(pref => ({
          studentId: pref.studentId,
          preferences: pref.preferences?.map(p => ({
            ...p,
            dateString: p.date?.toISOString().split('T')[0]
          }))
        }));
      }
      
      return transformed;
    });
    
    // Calculate enhanced aggregations
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const aggregation = {
      total: totalCount,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      hasNextPage: page < Math.ceil(totalCount / limit),
      hasPrevPage: page > 1,
      byStatus: transformedSessions.reduce((acc, session) => {
        acc[session.status] = (acc[session.status] || 0) + 1;
        return acc;
      }, {}),
      upcomingSessions: transformedSessions.filter(s => 
        s.schedule?.date && new Date(s.schedule.date) >= today
      ).length,
      todaySessions: transformedSessions.filter(s => 
        s.schedule?.date && 
        new Date(s.schedule.date).toDateString() === today.toDateString()
      ).length,
      vectorSearchUsed: !!vectorResults?.length,
      averageScore: vectorResults?.length > 0 ? 
        vectorResults.reduce((sum, r) => sum + r.score, 0) / vectorResults.length : null
    };
    
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
          userRole,
          useVectorSearch,
          minScore
        },
        pagination: {
          page,
          limit,
          skip
        },
        includeAvailability
      }
    });
    
  } catch (error) {
    console.error('Error fetching sessions:', error);
    
    // Enhanced error response
    const errorResponse = {
      success: false,
      error: 'Failed to fetch sessions',
      message: error.message,
      timestamp: new Date().toISOString()
    };
    
    // Include stack trace in development
    if (process.env.NODE_ENV === 'development') {
      errorResponse.details = error.stack;
    }
    
    // Different status codes for different error types
    let statusCode = 500;
    if (error.message.includes('not found')) statusCode = 404;
    if (error.message.includes('Access denied')) statusCode = 403;
    if (error.message.includes('Invalid')) statusCode = 400;
    
    return NextResponse.json(errorResponse, { status: statusCode });
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