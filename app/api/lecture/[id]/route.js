import connectDB from "@/config/db";
import { Session } from "@/models/session";
import { User } from "@/models/user";

export async function GET(req, { params }) {
  const { id } = await params;
  
  if (!id) {
    return Response.json({ error: 'Session ID is required' }, { status: 400 });
  }
  
  try {
    await connectDB();
    console.log(`Fetching session details for ID: ${id}`);
    
    const session = await Session.findById(id)
      .populate('teacherId', 'name email')
      .populate('studentIds', 'name email')
      .lean();
    
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    
    return Response.json(session, { status: 200 });
    
  } catch (error) {
    console.error('Error fetching session:', error);
    return Response.json({ error: 'Failed to fetch session' }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  const { id } = await params;
  
  if (!id) {
    return Response.json({ error: 'Session ID is required' }, { status: 400 });
  }
  
  try {
    await connectDB();
    
    // Get user from Clerk auth
    const authUserId = req.headers.get('X-Auth-User-ID');
    if (!authUserId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check user role
    const user = await User.findOne({ clerkId: authUserId });
    if (!user || user.role !== 'teacher') {
      return Response.json({ error: 'Only teachers can modify sessions' }, { status: 403 });
    }

    const sessionData = await req.json();
    console.log(`Updating session ${id} with data:`, sessionData);

    // Validate the data
    if (sessionData.schedule && sessionData.schedule.date) {
      const scheduleDate = new Date(sessionData.schedule.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (scheduleDate < today) {
        return Response.json({ error: 'Schedule date cannot be in the past' }, { status: 400 });
      }
    }

    // Update the session
    const updatedSession = await Session.findByIdAndUpdate(
      id,
      sessionData,
      { new: true, runValidators: true }
    )
      .populate('teacherId', 'name email')
      .populate('studentIds', 'name email');

    if (!updatedSession) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    return Response.json(updatedSession, { status: 200 });
    
  } catch (error) {
    console.error('Error updating session:', error);
    return Response.json({ error: 'Failed to update session' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const { id } = await params;
  
  if (!id) {
    return Response.json({ error: 'Session ID is required' }, { status: 400 });
  }
  
  try {
    await connectDB();
    
    // Get user from Clerk auth
    const authUserId = req.headers.get('X-Auth-User-ID');
    if (!authUserId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check user role
    const user = await User.findOne({ clerkId: authUserId });
    if (!user || user.role !== 'teacher') {
      return Response.json({ error: 'Only teachers can delete sessions' }, { status: 403 });
    }

    // Check if session exists
    const session = await Session.findById(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    
    // Delete the session
    await Session.findByIdAndDelete(id);
    
    return Response.json({ 
      message: 'Session deleted successfully',
      deletedId: id 
    }, { status: 200 });
    
  } catch (error) {
    console.error('Error deleting session:', error);
    return Response.json({ error: 'Failed to delete session' }, { status: 500 });
  }
}