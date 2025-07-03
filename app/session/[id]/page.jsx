'use client';
import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';

export default function SessionDetails({ params }) {
  const { isLoaded, userId } = useAuth();
  const { id } = use(params);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    topic: '',
    notes: '',
    schedule: {
      date: '',
      startTime: '',
      endTime: '',
      timezone: 'UTC'
    },
    meetingLink: ''
  });
  const router = useRouter();

  // Check if current user is a teacher based on session data
  const isTeacher = session?.teacherId?._id === userId || session?.teacherId?.clerkId === userId;

  useEffect(() => {
    const fetchSession = async () => {
      try {
        setLoading(true);
        
        const sessionRes = await fetch(`/api/lecture/${id}`);
        if (!sessionRes.ok) throw new Error('Failed to fetch session');
        const sessionData = await sessionRes.json();
        setSession(sessionData);
        
        // Initialize form data
        setFormData({
          topic: sessionData.topic,
          notes: sessionData.notes || '',
          schedule: {
            date: sessionData.schedule.date.split('T')[0],
            startTime: sessionData.schedule.startTime,
            endTime: sessionData.schedule.endTime,
            timezone: sessionData.schedule.timezone || 'UTC'
          },
          meetingLink: sessionData.meetingLink || ''
        });

      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (isLoaded) {
      fetchSession();
    }
  }, [id, isLoaded]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    if (name.startsWith('schedule.')) {
      const field = name.split('.')[1];
      setFormData(prev => ({
        ...prev,
        schedule: {
          ...prev.schedule,
          [field]: value
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`/api/lecture/${id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-User-ID': userId
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update session');
      }

      const updatedSession = await response.json();
      setSession(updatedSession);
      setIsEditing(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this session?')) {
      try {
        const response = await fetch(`/api/lecture/${id}`, {
          method: 'DELETE',
          headers: {
            'X-Auth-User-ID': userId
          }
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to delete session');
        }

        router.push('/dashboard');
      } catch (err) {
        setError(err.message);
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading session details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-lg max-w-md">
          <h3 className="font-medium">Error</h3>
          <p className="mt-1">{error}</p>
          <button 
            onClick={() => router.push('/dashboard')}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            Back to Sessions
          </button>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-6 py-4 rounded-lg max-w-md">
          <h3 className="font-medium">Session Not Found</h3>
          <p className="mt-1">The session you're looking for doesn't exist.</p>
          <button 
            onClick={() => router.push('/dashboard')}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            Back to Sessions
          </button>
        </div>
      </div>
    );
  }

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return format(date, 'MMMM d, yyyy');
  };

  const formatTime = (timeString) => {
    return format(new Date(`2000-01-01T${timeString}`), 'h:mm a');
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'scheduled':
        return 'bg-blue-100 text-blue-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <nav className="flex items-center space-x-2 text-sm text-gray-500 mb-4">
            <Link href="/dashboard" className="hover:text-gray-700">Sessions</Link>
            <span>/</span>
            <span className="text-gray-900">{session.topic}</span>
          </nav>
          
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900">{session.topic}</h1>
            <div className="flex items-center space-x-3">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(session.status)}`}>
                {session.status}
              </span>
              {!isEditing && isTeacher && (
                <div className="flex space-x-2">
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  >
                    Edit
                  </button>
                  <button
                    onClick={handleDelete}
                    className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {isEditing ? (
          <div className="bg-white shadow-lg rounded-lg overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">Edit Session</h2>
                <button
                  onClick={() => setIsEditing(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-6 space-y-6">
              <div>
                <label htmlFor="topic" className="block text-sm font-medium text-gray-700 mb-2">
                  Topic
                </label>
                <input
                  type="text"
                  id="topic"
                  name="topic"
                  value={formData.topic}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="schedule.date" className="block text-sm font-medium text-gray-700 mb-2">
                    Date
                  </label>
                  <input
                    type="date"
                    id="schedule.date"
                    name="schedule.date"
                    value={formData.schedule.date}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="schedule.startTime" className="block text-sm font-medium text-gray-700 mb-2">
                    Start Time
                  </label>
                  <input
                    type="time"
                    id="schedule.startTime"
                    name="schedule.startTime"
                    value={formData.schedule.startTime}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="schedule.endTime" className="block text-sm font-medium text-gray-700 mb-2">
                    End Time
                  </label>
                  <input
                    type="time"
                    id="schedule.endTime"
                    name="schedule.endTime"
                    value={formData.schedule.endTime}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="meetingLink" className="block text-sm font-medium text-gray-700 mb-2">
                  Meeting Link
                </label>
                <input
                  type="url"
                  id="meetingLink"
                  name="meetingLink"
                  value={formData.meetingLink}
                  onChange={handleInputChange}
                  placeholder="https://meet.google.com/..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-2">
                  Notes
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={4}
                  value={formData.notes}
                  onChange={handleInputChange}
                  placeholder="Add any additional notes about this session..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="bg-white shadow-lg rounded-lg overflow-hidden">
            <div className="px-6 py-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className='text-zinc-600'>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Schedule</h3>
                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      <div className="flex items-center">
                        <svg className="w-5 h-5 text-gray-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-sm text-gray-600">Date:</span>
                        <span className="ml-2 font-medium">{formatDate(session.schedule.date)}</span>
                      </div>
                      <div className="flex items-center">
                        <svg className="w-5 h-5 text-gray-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-sm text-gray-600">Time:</span>
                        <span className="ml-2 font-medium">
                          {formatTime(session.schedule.startTime)} - {formatTime(session.schedule.endTime)}
                        </span>
                      </div>
                      <div className="flex items-center">
                        <svg className="w-5 h-5 text-gray-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-sm text-gray-600">Timezone:</span>
                        <span className="ml-2 font-medium">{session.schedule.timezone}</span>
                      </div>
                    </div>
                  </div>

                  {session.meetingLink && (
                    <div>
                      <h3 className="text-lg font-medium text-gray-900 mb-4">Meeting</h3>
                      <div className="bg-blue-50 rounded-lg p-4">
                        <a
                          href={session.meetingLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center text-blue-600 hover:text-blue-800 font-medium"
                        >
                          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          Join Meeting
                          <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Participants</h3>
                    <div className="space-y-3">
                      {session.teacherId && (
                        <div className="flex items-center p-3 bg-green-50 rounded-lg">
                          <div className="flex-shrink-0">
                            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                            </div>
                          </div>
                          <div className="ml-3">
                            <p className="text-sm font-medium text-gray-900">{session.teacherId.name}</p>
                            <p className="text-sm text-gray-500">Teacher • {session.teacherId.email}</p>
                          </div>
                        </div>
                      )}

                      {session.studentIds && session.studentIds.map((student) => (
                        <div key={student._id} className="flex items-center p-3 bg-blue-50 rounded-lg">
                          <div className="flex-shrink-0">
                            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                            </div>
                          </div>
                          <div className="ml-3">
                            <p className="text-sm font-medium text-gray-900">{student.name}</p>
                            <p className="text-sm text-gray-500">Student • {student.email}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className='text-zinc-600'>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Session Info</h3>
                    <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Session ID:</span>
                        <span className="text-sm font-mono">{session._id}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Created:</span>
                        <span className="text-sm">{formatDate(session.createdAt)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Last Updated:</span>
                        <span className="text-sm">{formatDate(session.updatedAt)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {session.notes && (
                <div className="mt-8 pt-6 border-t border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Notes</h3>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-gray-700 whitespace-pre-wrap">{session.notes}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}