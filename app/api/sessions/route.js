// app/api/sessions/route.js
import { NextResponse } from 'next/server';
import { Session } from '@/models/session'; // Adjust path as needed
import connectDB from '@/config/db';

export async function GET(request) {
  try {
    await connectDB();
    
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const teacherId = searchParams.get('teacherId');
    const studentId = searchParams.get('studentId');
    const date = searchParams.get('date');
    
    // Build query object
    let query = {};
    
    if (status) {
      query.status = status;
    }
    
    if (teacherId) {
      query.teacherId = teacherId;
    }
    
    if (studentId) {
      query.studentIds = { $in: [studentId] };
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
    
    // Fetch sessions with populated teacher and student data
    const sessions = await Session.find(query)
      .populate('teacherId', 'name email') // Adjust fields as needed
      .populate('studentIds', 'name email') // Adjust fields as needed
      .sort({ 'schedule.date': 1, 'schedule.startTime': 1 })
      .lean();
    
    return NextResponse.json({
      success: true,
      data: sessions,
      count: sessions.length
    });
    
  } catch (error) {
    console.error('Error fetching sessions:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch sessions',
        message: error.message
      },
      { status: 500 }
    );
  }
}