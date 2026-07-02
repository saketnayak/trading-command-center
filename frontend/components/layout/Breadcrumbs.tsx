import Link from "next/link";
import { Fragment } from "react";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

type BreadcrumbsProps = {
  items: BreadcrumbItem[];
  className?: string;
};

export function Breadcrumbs({ items, className = "" }: BreadcrumbsProps) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              {index > 0 && (
                <li aria-hidden className="text-subtle select-none">
                  ›
                </li>
              )}
              <li
                className={isLast ? "font-medium text-fg-secondary" : undefined}
                aria-current={isLast ? "page" : undefined}
              >
                {!isLast && item.href ? (
                  <Link href={item.href} className="hover:text-fg-secondary hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  <span>{item.label}</span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/** Shared Research trail prefix for run-related pages. */
export const RESEARCH_BREADCRUMB: BreadcrumbItem = { label: "Research", href: "/runs/new" };

export const HISTORY_BREADCRUMB: BreadcrumbItem = { label: "History", href: "/runs" };
