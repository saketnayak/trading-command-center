"use client";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <span
        className="inline-block h-[22px] w-10 rounded-[11px] border border-border bg-input/70"
        aria-hidden
      />
    );
  }

  const isDark = resolvedTheme === "dark";
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="relative block h-[22px] w-10 shrink-0 rounded-[11px] border border-input-border bg-input/70 p-0 transition-colors hover:border-blue-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/60"
    >
      <span
        className={`absolute left-px top-px flex h-[18px] w-[18px] items-center justify-center rounded-full bg-elevated text-muted shadow-sm transition-transform duration-200 ${
          isDark ? "translate-x-[18px]" : "translate-x-0"
        }`}
      >
        <Sun
          className={`absolute h-3 w-3 transition-opacity ${isDark ? "opacity-0" : "opacity-100"}`}
          aria-hidden="true"
        />
        <Moon
          className={`absolute h-3 w-3 transition-opacity ${isDark ? "opacity-100" : "opacity-0"}`}
          aria-hidden="true"
        />
      </span>
    </button>
  );
}
