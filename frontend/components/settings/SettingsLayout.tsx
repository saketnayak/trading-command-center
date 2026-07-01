"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  STICKY_PANEL_MAX_HEIGHT_CLASS,
  STICKY_PANEL_TOP_CLASS,
} from "@/components/layout/constants";
import type { SettingsNavItem } from "@/lib/settingsNav";

type SettingsLayoutProps = {
  sections: SettingsNavItem[];
  children: ReactNode;
};

function navItemClass(active: boolean, variant: "sidebar" | "mobile") {
  if (variant === "sidebar") {
    return active
      ? "bg-elevated text-fg font-medium border-l-2 border-blue-500 pl-[calc(0.75rem-2px)]"
      : "text-muted hover:text-fg-secondary hover:bg-elevated/60 border-l-2 border-transparent pl-[calc(0.75rem-2px)]";
  }
  return active
    ? "border-b-2 border-blue-400 text-blue-400"
    : "border-b-2 border-transparent text-muted hover:text-fg";
}

export function SettingsLayout({ sections, children }: SettingsLayoutProps) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    if (sections.length === 0) return;

    const hash = window.location.hash.replace("#", "");
    if (hash && sections.some((section) => section.id === hash)) {
      setActiveId(hash);
      requestAnimationFrame(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [sections]);

  useEffect(() => {
    if (sections.length === 0) return;

    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => element != null);

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const topId = visible[0]?.target.id;
        if (topId) setActiveId(topId);
      },
      { rootMargin: "-15% 0px -65% 0px", threshold: 0 },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [sections]);

  function handleNavClick(id: string) {
    setActiveId(id);
    window.history.replaceState(null, "", `#${id}`);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (sections.length === 0) {
    return <div className="min-w-0 space-y-8">{children}</div>;
  }

  return (
    <div className="grid w-full min-w-0 grid-cols-1 gap-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[12rem_minmax(0,1fr)]">
      <nav
        aria-label="Settings sections"
        className="lg:hidden flex gap-1 overflow-x-auto border-b border-border pb-0 -mx-1 px-1 scrollbar-thin"
      >
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => handleNavClick(section.id)}
            className={`shrink-0 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${navItemClass(activeId === section.id, "mobile")}`}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <aside
        className={`hidden lg:block sticky ${STICKY_PANEL_TOP_CLASS} ${STICKY_PANEL_MAX_HEIGHT_CLASS} z-10 self-start overflow-y-auto overscroll-contain bg-page pb-4`}
      >
        <nav aria-label="Settings sections" className="space-y-0.5 pr-2">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => handleNavClick(section.id)}
              className={`w-full text-left py-2 pr-2 text-sm rounded-r-sm transition-colors ${navItemClass(activeId === section.id, "sidebar")}`}
            >
              {section.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 space-y-8 lg:col-start-2 lg:row-start-1">{children}</div>
    </div>
  );
}
