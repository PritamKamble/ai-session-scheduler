import { Sidebar } from "../components/ui/Sidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full">
      <Sidebar />
      <main className="flex-1 p-6">
        {children}
      </main>
    </div>
  );
} 