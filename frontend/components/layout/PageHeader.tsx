import Link from "next/link";
import type { ReactNode } from "react";

type BackLink = {
  href: string;
  label: string;
};

type PageHeaderProps = {
  /** Primary page heading (left). Prefer over `leading`. */
  title?: ReactNode;
  /** Optional subtitle below the title. */
  description?: ReactNode;
  /** Primary/secondary actions (right). Prefer over `trailing`. */
  actions?: ReactNode;
  back?: BackLink;
  /** @deprecated Use `title` instead. */
  leading?: ReactNode;
  /** @deprecated Use `actions` instead. */
  trailing?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  actions,
  back,
  leading,
  trailing,
  className = "",
}: PageHeaderProps) {
  const titleNode = title ?? leading;
  const actionsNode = actions ?? trailing;

  return (
    <div className={`flex flex-col gap-3 ${className}`.trim()}>
      {back && (
        <Link href={back.href} className="text-sm text-blue-400 hover:underline w-fit">
          {back.label}
        </Link>
      )}
      {(titleNode || actionsNode || description) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {titleNode}
            {description != null && (
              <p className="mt-1 text-xs text-muted">{description}</p>
            )}
          </div>
          {actionsNode}
        </div>
      )}
    </div>
  );
}

export function PageTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h1 className={className ?? "text-base font-semibold text-fg"}>{children}</h1>
  );
}
