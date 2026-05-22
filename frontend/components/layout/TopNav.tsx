"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Logo } from "./Logo";
import { KeyboardShortcuts } from "./KeyboardShortcuts";

const NAV = [
  { href: "/runs/new", label: "New Run" },
  { href: "/runs", label: "History" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/runs/performance", label: "Performance" },
  { href: "/settings", label: "Settings" },
];

export function TopNav() {
  const path = usePathname();
  const { data: session } = useSession();
  const isActive = (href: string) => {
    if (path === href) return true;
    if (href === "/runs") return path.startsWith("/runs/") && !path.startsWith("/runs/performance") && path !== "/runs/new";
    return false;
  };

  return (
    <>
      <KeyboardShortcuts />
      <nav className="bg-navy-700 border-b border-slate-800 px-4 py-2 flex items-center gap-4 sticky top-0 z-50">
        <Link href="/runs" className="mr-3 flex items-center" aria-label="AgentFloor home">
          <Logo height={28} />
        </Link>
        <span className="text-slate-700 text-lg">|</span>
        {NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`text-xs px-1 pb-0.5 ${isActive(href) ? "text-blue-400 border-b border-blue-400" : "text-slate-500 hover:text-slate-300"}`}
          >
            {label}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-3">
          {(session?.user as { role?: string })?.role === "admin" && (
            <span className="bg-blue-900 text-blue-300 text-xs px-1.5 py-0.5 rounded">ADMIN</span>
          )}
          <span className="text-slate-500 text-xs" title="Press ? for keyboard shortcuts">
            {session?.user?.email}
          </span>
          <button onClick={() => signOut()} className="text-slate-600 text-xs hover:text-slate-400">Sign out</button>
        </div>
      </nav>
    </>
  );
}
