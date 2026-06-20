import Link from "next/link";
import type { ReactNode } from "react";

type BackLink = {
  href: string;
  label: string;
};

type PageHeaderProps = {
  leading?: ReactNode;
  trailing?: ReactNode;
  back?: BackLink;
  className?: string;
};

export function PageHeader({ leading, trailing, back, className = "" }: PageHeaderProps) {
  return (
    <div
      className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`.trim()}
    >
      {back ? (
        <Link href={back.href} className="text-blue-400 hover:underline text-sm">
          {back.label}
        </Link>
      ) : (
        leading
      )}
      {trailing}
    </div>
  );
}

export function PageTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h1 className={className ?? "text-lg font-semibold text-fg"}>{children}</h1>
  );
}
