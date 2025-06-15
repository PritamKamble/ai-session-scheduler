'use client';

import { useState, useEffect } from 'react';

interface Topic {
  week: number;
  topics: string[];
  learningObjectives: string[];
  resources: string[];
  estimatedHours: number;
}

interface ScheduleSummary {
  currentLevel: string;
  targetLevel: string;
  keyFocusAreas: string[];
  totalEstimatedHours: number;
}

interface Schedule {
  schedule: Topic[];
  summary: ScheduleSummary;
}

export default function ScheduleDisplay() {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSchedule = async () => {
      try {
        const response = await fetch('/api/generate-schedule', {
          method: 'POST',
        });

        if (!response.ok) {
          throw new Error('Failed to generate schedule');
        }

        const data = await response.json();
        setSchedule(data.schedule);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load schedule');
      } finally {
        setLoading(false);
      }
    };

    fetchSchedule();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[200px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-red-600 p-4">
        <p>Error: {error}</p>
      </div>
    );
  }

  if (!schedule) {
    return null;
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Summary Section */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <h2 className="text-2xl font-bold mb-4">Learning Plan Summary</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-gray-600">Current Level</p>
            <p className="font-semibold">{schedule.summary.currentLevel}</p>
          </div>
          <div>
            <p className="text-gray-600">Target Level</p>
            <p className="font-semibold">{schedule.summary.targetLevel}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-gray-600">Key Focus Areas</p>
            <ul className="list-disc list-inside">
              {schedule.summary.keyFocusAreas.map((area, index) => (
                <li key={index}>{area}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-gray-600">Total Estimated Hours</p>
            <p className="font-semibold">{schedule.summary.totalEstimatedHours} hours</p>
          </div>
        </div>
      </div>

      {/* Weekly Schedule */}
      <div className="space-y-6">
        <h2 className="text-2xl font-bold mb-4">Weekly Schedule</h2>
        {schedule.schedule.map((week) => (
          <div key={week.week} className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-semibold mb-4">Week {week.week}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-medium text-gray-600 mb-2">Topics</h4>
                <ul className="list-disc list-inside">
                  {week.topics.map((topic, index) => (
                    <li key={index}>{topic}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-medium text-gray-600 mb-2">Learning Objectives</h4>
                <ul className="list-disc list-inside">
                  {week.learningObjectives.map((objective, index) => (
                    <li key={index}>{objective}</li>
                  ))}
                </ul>
              </div>
              <div className="md:col-span-2">
                <h4 className="font-medium text-gray-600 mb-2">Resources</h4>
                <ul className="list-disc list-inside">
                  {week.resources.map((resource, index) => (
                    <li key={index}>{resource}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-medium text-gray-600">Estimated Hours</h4>
                <p className="font-semibold">{week.estimatedHours} hours</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
} 