import { TopNav } from "@/components/layout/TopNav";
import { AppContent } from "@/components/layout/AppContent";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <AppContent>{children}</AppContent>
    </div>
  );
}
