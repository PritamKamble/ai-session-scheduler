"use client"
import React, { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { Calendar, Clock, Users } from 'lucide-react';
import { Skeleton } from "@/components/ui/skeleton";

const Sessions = ({ userId, role }) => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/sessions?userId=${userId}&role=${role}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch sessions');
        }
        
        const data = await response.json();
        setSessions(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (userId && role) {
      fetchSessions();
    }
  }, [userId, role]);

  if (loading) {
    return (
      <div className="space-y-4 w-full max-w-2xl mx-auto">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="text-red-500 text-center py-4">Error: {error}</div>;
  }

  if (sessions.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No sessions found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full max-w-2xl mx-auto">
      {sessions.map((session) => (
        <div key={session._id} className="p-4 border rounded-xl shadow-sm bg-white dark:bg-gray-800">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <h3 className="font-medium text-lg">{session.title}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">{session.subject}</p>
              
              <div className="flex items-center gap-2 mt-1 text-sm text-gray-600 dark:text-gray-300">
                <Calendar className="h-4 w-4" />
                <span>{format(parseISO(session.date), 'MMMM d, yyyy')}</span>
              </div>
              
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <Clock className="h-4 w-4" />
                <span>
                  {session.startTime} - {session.endTime}
                </span>
              </div>

              {role === 'student' && session.teacher && (
                <div className="mt-2 text-sm">
                  <span className="font-medium">Teacher: </span>
                  {session.teacher.firstName} {session.teacher.lastName}
                </div>
              )}

              {role === 'teacher' && session.studentsEnrolled?.length > 0 && (
                <div className="mt-2 text-sm">
                  <span className="font-medium flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    Students: {session.studentsEnrolled.length}/{session.maxCapacity}
                  </span>
                </div>
              )}
              
              <div className="mt-2">
                <span className={`px-2 py-1 text-xs rounded-full ${
                  session.status === 'completed' 
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : session.status === 'upcoming'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                }`}>
                  {session.status}
                </span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default Sessions;