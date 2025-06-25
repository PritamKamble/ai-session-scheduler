import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import AdminDashboard from "../components/AdminDashboard";

const ADMIN_EMAIL = "7276279026.pk@gmail.com";

export default async function AdminPage() {
  const session = await auth();
  const userId = session?.userId;
  const userEmail = session?.sessionClaims?.email as string;

  if (!userId || userEmail !== ADMIN_EMAIL) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Admin Dashboard</h1>
          <AdminDashboard />
        </div>
      </div>
    </div>
  );
} 