'use client';

import { useState, useEffect } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';
import { Skeleton } from './ui/Skeleton';
import { AlertCircle, CheckCircle } from 'lucide-react';

export default function SkillsForm() {
  const [skills, setSkills] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Simulate loading state
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch('/api/skills', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ skills }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit skills');
      }

      setSkills('');
      setSuccess(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to submit skills. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Card header="Tell us about your technical skills" className="max-w-2xl mx-auto">
        <Skeleton height="160px" className="mb-4" />
        <Skeleton height="40px" />
      </Card>
    );
  }

  return (
    <Card header="Tell us about your technical skills" className="max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="skills" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            What technologies, frameworks, and programming languages do you know?
          </label>
          <textarea
            id="skills"
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            className="w-full h-40 p-3 border border-gray-300 dark:border-gray-700 rounded-md focus:ring-2 focus:ring-primary focus:border-primary dark:bg-gray-800 dark:text-white"
            placeholder="Example: I know JavaScript, React, and Node.js. I'm familiar with HTML and CSS. I want to learn Python and Django."
            required
            aria-invalid={!!error}
            aria-describedby={error ? 'skills-error' : undefined}
          />
          {error && (
            <div id="skills-error" className="mt-2 text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="mt-2 text-green-600 dark:text-green-400 flex items-center gap-1">
              <CheckCircle className="h-4 w-4" />
              <span>Skills submitted successfully! Your personalized schedule will be generated soon.</span>
            </div>
          )}
        </div>
        <Button
          type="submit"
          variant="primary"
          loading={isSubmitting}
          disabled={isSubmitting}
        >
          Submit Skills
        </Button>
      </form>
    </Card>
  );
} 