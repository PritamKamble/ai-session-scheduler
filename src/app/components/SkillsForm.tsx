'use client';

import { useState } from 'react';

export default function SkillsForm() {
  const [skills, setSkills] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
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

      // Handle successful submission
      setSkills('');
      alert('Skills submitted successfully! Your personalized schedule will be generated soon.');
    } catch (error) {
      console.error('Error submitting skills:', error);
      alert('Failed to submit skills. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-4">Tell us about your technical skills</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="skills" className="block text-sm font-medium text-gray-700 mb-2">
            What technologies, frameworks, and programming languages do you know?
          </label>
          <textarea
            id="skills"
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            className="w-full h-40 p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Example: I know JavaScript, React, and Node.js. I'm familiar with HTML and CSS. I want to learn Python and Django."
            required
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {isSubmitting ? 'Submitting...' : 'Submit Skills'}
        </button>
      </form>
    </div>
  );
} 