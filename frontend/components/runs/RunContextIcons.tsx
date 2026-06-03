import {
  BarChart3,
  BookOpen,
  Building2,
  MessageCircle,
  Newspaper,
  type LucideIcon,
} from "lucide-react";
import { responseLanguageLabel } from "@/lib/responseLanguage";

const analystIcon: Record<string, { icon: LucideIcon; label: string; className: string }> = {
  market: {
    icon: BarChart3,
    label: "Market analyst",
    className: "text-blue-300 bg-blue-950/50 border-blue-700/50",
  },
  social: {
    icon: MessageCircle,
    label: "Social sentiment analyst",
    className: "text-pink-300 bg-pink-950/40 border-pink-700/40",
  },
  news: {
    icon: Newspaper,
    label: "News analyst",
    className: "text-amber-300 bg-amber-950/40 border-amber-700/40",
  },
  fundamentals: {
    icon: Building2,
    label: "Fundamentals analyst",
    className: "text-emerald-300 bg-emerald-950/40 border-emerald-700/40",
  },
};

const languageFlag: Record<string, string> = {
  "en-US": "🇺🇸",
  "zh-TW": "🇹🇼",
  "zh-CN": "🇨🇳",
  "ja-JP": "🇯🇵",
  "ko-KR": "🇰🇷",
  "de-DE": "🇩🇪",
};

function InfoIcon({
  icon: Icon,
  label,
  className,
}: {
  icon: LucideIcon;
  label: string;
  className: string;
}) {
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${className}`}
      title={label}
      aria-label={label}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  );
}

export function AnalystIcons({ analysts }: { analysts: string[] }) {
  return (
    <>
      {analysts.map((analyst) => {
        return (
          <AnalystIconBadge key={analyst} analyst={analyst} />
        );
      })}
    </>
  );
}

export function AnalystIconBadge({ analyst }: { analyst: string }) {
  const config = analystIcon[analyst] ?? {
    icon: BookOpen,
    label: `${analyst} analyst`,
    className: "text-muted bg-input border-input-border",
  };

  return (
    <InfoIcon
      icon={config.icon}
      label={config.label}
      className={config.className}
    />
  );
}

export function LanguageFlag({ value }: { value: string }) {
  const language = responseLanguageLabel(value);
  const flag = languageFlag[value] ?? "🌐";

  return (
    <span
      className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-violet-700/40 bg-violet-950/40 px-1.5 text-sm leading-none"
      title={`Response language: ${language}`}
      aria-label={`Response language: ${language}`}
    >
      {flag}
    </span>
  );
}

export function RunContextIcons({
  analysts,
  responseLanguage,
}: {
  analysts: string[];
  responseLanguage: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <AnalystIcons analysts={analysts} />
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
      <LanguageFlag value={responseLanguage} />
    </div>
  );
}
