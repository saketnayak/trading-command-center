import type { ReactNode } from "react";
import { Logo } from "./Logo";

type AuthCardProps = {
  children: ReactNode;
  subtitle?: ReactNode;
};

export function AuthCard({ children, subtitle }: AuthCardProps) {
  return (
    <div className="w-full max-w-sm mx-4 bg-surface border border-border rounded-lg p-8">
      <div className={`flex justify-center ${subtitle ? "mb-4" : "mb-6"}`}>
        <Logo height={44} />
      </div>
      {subtitle}
      {children}
    </div>
  );
}
