import { auth } from "@clerk/nextjs/server";
import SkillsForm from "./components/SkillsForm";
import ScheduleDisplay from "./components/ScheduleDisplay";

export default async function Home() {
  const session = await auth();
  const userId = session?.userId;

  if (!userId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <h1 className="text-4xl font-bold mb-4">Welcome to LinkCode Scheduler</h1>
        <p className="text-lg text-gray-600">
          Please sign in to start scheduling your coding sessions.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh]">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-4">Welcome to Your Dashboard</h1>
        <p className="text-lg text-gray-600">
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
