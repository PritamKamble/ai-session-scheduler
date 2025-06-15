'use client';

import { useState, useEffect } from 'react';

interface Student {
  userId: string;
  email: string;
  skills: string;
  schedule?: any;
  createdAt: Date;
}

export default function AdminDashboard() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [teachingSchedule, setTeachingSchedule] = useState<any>(null);

  useEffect(() => {
    fetchStudents();
  }, []);

  const fetchStudents = async () => {
    try {
      const response = await fetch('/api/admin/students');
      const data = await response.json();
      setStudents(data.students);
    } catch (error) {
      console.error('Error fetching students:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateTeachingSchedule = async () => {
    try {
      const response = await fetch('/api/admin/generate-teaching-schedule', {
        method: 'POST',
      });
      const data = await response.json();
      setTeachingSchedule(data.schedule);
    } catch (error) {
      console.error('Error generating teaching schedule:', error);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Student List */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Students</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Skills
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {students.map((student) => (
                <tr key={student.userId}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {student.email}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {student.skills}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <button
                      onClick={() => setSelectedStudent(student)}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      View Schedule
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Teaching Schedule Generation */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Teaching Schedule</h2>
        <button
          onClick={generateTeachingSchedule}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
        >
          Generate Teaching Schedule
        </button>

        {teachingSchedule && (
          <div className="mt-6">
            <h3 className="text-lg font-medium mb-4">Generated Schedule</h3>
            <div className="space-y-4">
              {teachingSchedule.weeks.map((week: any, index: number) => (
                <div key={index} className="border rounded-lg p-4">
                  <h4 className="font-medium">Week {week.week}</h4>
                  <div className="mt-2">
                    <p className="text-sm text-gray-600">Topics:</p>
                    <ul className="list-disc list-inside">
                      {week.topics.map((topic: string, i: number) => (
                        <li key={i}>{topic}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-2">
                    <p className="text-sm text-gray-600">Students:</p>
                    <ul className="list-disc list-inside">
                      {week.students.map((student: string, i: number) => (
                        <li key={i}>{student}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Student Schedule Modal */}
      {selectedStudent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full">
            <h3 className="text-xl font-semibold mb-4">
              Schedule for {selectedStudent.email}
            </h3>
            {selectedStudent.schedule ? (
              <div className="space-y-4">
                {selectedStudent.schedule.schedule.map((week: any, index: number) => (
                  <div key={index} className="border rounded-lg p-4">
                    <h4 className="font-medium">Week {week.week}</h4>
                    <div className="mt-2">
                      <p className="text-sm text-gray-600">Topics:</p>
                      <ul className="list-disc list-inside">
                        {week.topics.map((topic: string, i: number) => (
                          <li key={i}>{topic}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p>No schedule generated yet.</p>
            )}
            <button
              onClick={() => setSelectedStudent(null)}
              className="mt-4 bg-gray-200 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-300"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
} 