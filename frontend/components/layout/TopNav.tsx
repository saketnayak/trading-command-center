"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState, type FocusEvent, type MouseEvent } from "react";
import { Logo } from "./Logo";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { ThemeToggle } from "./ThemeToggle";
import { TOP_NAV_OFFSET_PX, APP_CONTENT_CONTAINER_CLASS } from "./constants";
import { usePortfolioPrefetch } from "@/lib/usePortfolioPrefetch";

const NAV = [
  { href: "/runs/new", label: "New Run" },
  { href: "/runs", label: "History" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/portfolio", label: "Portfolio", prefetchPortfolio: true },
  { href: "/runs/performance", label: "Performance" },
  { href: "/settings", label: "Settings" },
];

function navLinkClass(active: boolean) {
  return active
    ? "text-blue-500 dark:text-blue-400 border-b border-blue-500 dark:border-blue-400"
    : "text-muted hover:text-fg-secondary";
}

function NavLink({
  href,
  label,
  active,
  className,
  onPrefetch,
}: {
  href: string;
  label: string;
  active: boolean;
  className: string;
  onPrefetch?: () => void;
}) {
  function handleIntent(_event: MouseEvent<HTMLAnchorElement> | FocusEvent<HTMLAnchorElement>) {
    onPrefetch?.();
  }

  return (
    <Link
      href={href}
      onMouseEnter={onPrefetch ? handleIntent : undefined}
      onFocus={onPrefetch ? handleIntent : undefined}
      className={className}
    >
      {label}
    </Link>
  );
}

export function TopNav() {
  const path = usePathname();
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const prefetchPortfolio = usePortfolioPrefetch();

  const isActive = (href: string) => {
    if (path === href) return true;
    if (href === "/runs") {
      return (
        path.startsWith("/runs/") &&
        !path.startsWith("/runs/performance") &&
        path !== "/runs/new"
      );
    }
    return false;
  };

  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  return (
    <>
      <KeyboardShortcuts />
      <nav className="bg-surface border-b border-border sticky top-0 z-50 shrink-0">
        <div className={`${APP_CONTENT_CONTAINER_CLASS} flex items-center gap-2 sm:gap-4 px-3 sm:px-4 py-2`}>
        <Link href="/runs" className="flex items-center shrink-0" aria-label="AgentFloor home">
          <Logo height={28} />
        </Link>

        <span className="hidden lg:inline text-nav-divider text-lg">|</span>

        <div className="hidden lg:flex items-center gap-3 min-w-0">
          {NAV.map(({ href, label, prefetchPortfolio: shouldPrefetch }) => (
            <NavLink
              key={href}
              href={href}
              label={label}
              active={isActive(href)}
              onPrefetch={shouldPrefetch ? prefetchPortfolio : undefined}
              className={`text-xs px-1 pb-0.5 whitespace-nowrap ${navLinkClass(isActive(href))}`}
            />
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <span className="hidden md:inline text-muted text-xs max-w-[10rem] truncate" title="Press ? for keyboard shortcuts">
            {session?.user?.email}
          </span>
          <button
            type="button"
            onClick={() => signOut()}
            className="hidden sm:inline text-subtle text-xs hover:text-muted"
          >
            Sign out
          </button>
          <button
            type="button"
            className="lg:hidden p-1.5 rounded border border-border text-fg-secondary hover:text-fg hover:bg-elevated"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5" aria-hidden>
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5" aria-hidden>
                <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        </div>
        </div>
      </nav>

      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-40" role="dialog" aria-label="Navigation menu">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div
            className="absolute left-0 right-0 overflow-y-auto bg-surface border-b border-border shadow-lg p-4 flex flex-col gap-4"
            style={{
              top: TOP_NAV_OFFSET_PX,
              maxHeight: `calc(100vh - ${TOP_NAV_OFFSET_PX}px)`,
            }}
          >
            <div className="flex flex-col gap-1">
              {NAV.map(({ href, label, prefetchPortfolio: shouldPrefetch }) => (
                <NavLink
                  key={href}
                  href={href}
                  label={label}
                  active={isActive(href)}
                  onPrefetch={shouldPrefetch ? prefetchPortfolio : undefined}
                  className={`text-sm px-3 py-2.5 rounded-sm ${isActive(href) ? "bg-elevated text-fg font-medium" : "text-fg-secondary hover:bg-elevated"}`}
                />
              ))}
            </div>
            <div className="border-t border-border pt-3 flex flex-col gap-2 text-sm">
              {(session?.user as { role?: string })?.role === "admin" && (
                <span className="self-start bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 text-xs px-1.5 py-0.5 rounded">
                  ADMIN
                </span>
              )}
              {session?.user?.email && (
                <span className="text-muted text-xs break-all">{session.user.email}</span>
              )}
              <button
                type="button"
                onClick={() => signOut()}
                className="text-left text-subtle hover:text-muted text-xs"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
