import type { ReactNode } from "react";
import { SETTINGS_SECTION_SCROLL_MARGIN } from "@/lib/settingsNav";

type SectionCardProps = {
  id?: string;
  title: string;
  description?: string;
  children: ReactNode;
};

export function SectionCard({ id, title, description, children }: SectionCardProps) {
  return (
    <section id={id} className={id ? SETTINGS_SECTION_SCROLL_MARGIN : undefined}>
      <div className="mb-3">
        <h2 className="text-fg text-sm font-medium">{title}</h2>
        {description && <p className="text-muted text-xs mt-0.5">{description}</p>}
      </div>
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        {children}
      </div>
    </section>
  );
}
