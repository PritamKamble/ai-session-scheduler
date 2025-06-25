
import { auth } from "@clerk/nextjs/server";
import SkillsForm from "./components/SkillsForm";
import ScheduleDisplay from "./components/ScheduleDisplay";
import { Card } from "./components/ui/Card";
import { Button } from "./components/ui/Button";
import { Code2, Clock, Users, BookOpen } from "lucide-react";

export default async function Home() {
  const session = await auth();
  const userId = session?.userId;

  if (!userId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
        <h1 className="text-4xl font-bold mb-4 text-center">Welcome to LinkCode Scheduler</h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 text-center mb-8">
          Schedule your coding sessions with ease and precision.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl w-full">
          <Card header={<div className="flex items-center gap-2"><Code2 className="h-5 w-5 text-accent" /> <span>Code</span></div>}>
            <p className="text-gray-600 dark:text-gray-400">Learn and practice coding with a personalized schedule.</p>
          </Card>
          <Card header={<div className="flex items-center gap-2"><Clock className="h-5 w-5 text-accent" /> <span>Schedule</span></div>}>
            <p className="text-gray-600 dark:text-gray-400">Plan your learning journey with a structured timeline.</p>
          </Card>
          <Card header={<div className="flex items-center gap-2"><Users className="h-5 w-5 text-accent" /> <span>Community</span></div>}>
            <p className="text-gray-600 dark:text-gray-400">Join a community of learners and instructors.</p>
          </Card>
        </div>
        <div className="mt-8">
          <Button variant="primary" leftIcon={<BookOpen className="h-5 w-5" />}>
            Get Started
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] p-4">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-4">Welcome to Your Dashboard</h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          Tell us about your technical skills to get a personalized learning schedule.
        </p>
      </div>
      <SkillsForm />
      <div className="mt-12">
        <ScheduleDisplay />
      </div>
    </div>
  );
}
