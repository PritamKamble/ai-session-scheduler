'use client';

import { useState, useEffect } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Spinner } from './ui/Spinner';
import { Skeleton } from './ui/Skeleton';
import { Users, Calendar, Clock, AlertCircle } from 'lucide-react';

interface Week {
  week: number;
  topics: string[];
  students?: string[]; // Only present in teaching schedule
  learningObjectives?: string[];
  resources?: string[];
  estimatedHours?: number; // Only present in student schedule
}


interface StudentSchedule {
  schedule: Week[];
  summary: {
    currentLevel: string;
    targetLevel: string;
    keyFocusAreas: string[];
    totalEstimatedHours: number;
  };
}

interface Student {
  userId: string;
  email: string;
  skills: string;
  schedule?: StudentSchedule;
  createdAt: Date;
}

export default function AdminDashboard() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [teachingSchedule, setTeachingSchedule] = useState<{ weeks: Week[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStudents();
  }, []);

  const fetchStudents = async () => {
    try {
      const response = await fetch('/api/admin/students');
      const data = await response.json();
      setStudents(data.students);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to fetch students');
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
      setError(error instanceof Error ? error.message : 'Failed to generate teaching schedule');
    }
  };

  if (loading) {
    return (
      <div className="space-y-8">
        <Card header="Students" className="animate-fadeIn">
          <Skeleton height="200px" />
        </Card>
        <Card header="Teaching Schedule" className="animate-fadeIn">
          <Skeleton height="100px" />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="max-w-4xl mx-auto">
        <div className="text-center text-red-600 dark:text-red-400 p-4">
          <p>Error: {error}</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {/* Student List */}
      <Card header="Students" className="animate-fadeIn">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead>
              <tr>
                <th className="px-6 py-3 bg-gray-50 dark:bg-gray-800 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 bg-gray-50 dark:bg-gray-800 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Skills
                </th>
                <th className="px-6 py-3 bg-gray-50 dark:bg-gray-800 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
              {students.map((student) => (
                <tr key={student.userId}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {student.email}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                    {student.skills}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    <Button
                      variant="secondary"
                      onClick={() => setSelectedStudent(student)}
                      leftIcon={<Calendar className="h-4 w-4" />}
                    >
                      View Schedule
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Teaching Schedule Generation */}
      <Card header="Teaching Schedule" className="animate-fadeIn">
        <Button
          variant="primary"
          onClick={generateTeachingSchedule}
          leftIcon={<Clock className="h-5 w-5" />}
        >
          Generate Teaching Schedule
        </Button>

        {teachingSchedule && (
          <div className="mt-6">
            <h3 className="text-lg font-medium mb-4">Generated Schedule</h3>
            <div className="space-y-4">
              {teachingSchedule.weeks.map((week: Week, index: number) => (
                <Card key={index} header={`Week ${week.week}`} className="animate-scaleIn">
                  <div className="mt-2">
                    <p className="text-sm text-gray-600 dark:text-gray-400">Topics:</p>
                    <ul className="list-disc list-inside">
                      {week.topics.map((topic: string, i: number) => (
                        <li key={i}>{topic}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-2">
                    <p className="text-sm text-gray-600 dark:text-gray-400">Students:</p>
                    <ul className="list-disc list-inside">
                      {week.students?.map((student: string, i: number) => (
                        <li key={i}>{student}</li>
                      ))}
                    </ul>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Student Schedule Modal */}
      {selectedStudent && (
        <Modal
          open={!!selectedStudent}
          onClose={() => setSelectedStudent(null)}
          title={`Schedule for ${selectedStudent.email}`}
        >
          {selectedStudent.schedule ? (
            <div className="space-y-4">
              {selectedStudent.schedule.schedule.map((week: Week, index: number) => (
                <Card key={index} header={`Week ${week.week}`} className="animate-scaleIn">
                  <div className="mt-2">
                    <p className="text-sm text-gray-600 dark:text-gray-400">Topics:</p>
                    <ul className="list-disc list-inside">
                      {week.topics.map((topic: string, i: number) => (
                        <li key={i}>{topic}</li>
                      ))}
                    </ul>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <p>No schedule generated yet.</p>
          )}
        </Modal>
      )}
    </div>
  );
} 