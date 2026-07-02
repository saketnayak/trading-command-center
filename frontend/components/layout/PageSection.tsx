import type { ReactNode } from "react";

type PageSectionProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function PageSection({
  title,
  description,
  actions,
  children,
  className = "",
}: PageSectionProps) {
  const hasHeader = title != null || description != null || actions != null;

  return (
    <section className={className.trim() || undefined}>
      {hasHeader && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title != null && (
              <h2 className="text-sm font-semibold text-fg">{title}</h2>
            )}
            {description != null && (
              <p className="mt-0.5 text-xs text-muted">{description}</p>
            )}
          </div>
          {actions != null && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
