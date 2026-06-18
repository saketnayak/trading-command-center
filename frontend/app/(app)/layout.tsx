import { TopNav } from "@/components/layout/TopNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
