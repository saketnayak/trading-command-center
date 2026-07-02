import type { ElementType, ReactNode } from "react";
import { APP_CONTENT_CONTAINER_CLASS, APP_PAGE_PADDING_X_CLASS } from "./constants";

export type PageGap = "none" | "4" | "6" | "8";

const GAP_CLASSES: Record<PageGap, string> = {
  none: "",
  "4": "space-y-4",
  "6": "flex flex-col gap-6",
  "8": "flex flex-col gap-8",
};

type PageShellProps = {
  children: ReactNode;
  gap?: PageGap;
  as?: ElementType;
  className?: string;
};

/**
 * Standard page wrapper — full viewport width with responsive edge padding.
 * All authenticated routes should use this (or matching padding constants) for alignment.
 */
export function PageShell({
  children,
  gap = "none",
  as: Component = "main",
  className = "",
}: PageShellProps) {
  const classes = [
    APP_CONTENT_CONTAINER_CLASS,
    APP_PAGE_PADDING_X_CLASS,
    "py-4 sm:py-6",
    GAP_CLASSES[gap],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <Component className={classes}>{children}</Component>;
}
