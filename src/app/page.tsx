import { auth } from "@clerk/nextjs/server";

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
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <h1 className="text-4xl font-bold mb-4">Welcome to Your Dashboard</h1>
      <p className="text-lg text-gray-600">
        You are signed in and ready to schedule your coding sessions.
      </p>
    </div>
  );
}
