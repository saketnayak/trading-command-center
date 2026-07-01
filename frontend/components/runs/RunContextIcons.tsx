import {
  BarChart3,
  BookOpen,
  Building2,
  MessageCircle,
  Newspaper,
  type LucideIcon,
} from "lucide-react";
import { responseLanguageLabel } from "@/lib/responseLanguage";
import {
  ANALYST_ICON_BADGE,
  ANALYST_ICON_BADGE_FALLBACK,
  LANGUAGE_FLAG_BADGE,
} from "@/lib/uiClasses";

const analystIcon: Record<string, { icon: LucideIcon; label: string; className: string }> = {
  market: {
    icon: BarChart3,
    label: "Market analyst",
    className: ANALYST_ICON_BADGE.market,
  },
  social: {
    icon: MessageCircle,
    label: "Social sentiment analyst",
    className: ANALYST_ICON_BADGE.social,
  },
  news: {
    icon: Newspaper,
    label: "News analyst",
    className: ANALYST_ICON_BADGE.news,
  },
  fundamentals: {
    icon: Building2,
    label: "Fundamentals analyst",
    className: ANALYST_ICON_BADGE.fundamentals,
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
    className: ANALYST_ICON_BADGE_FALLBACK,
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
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-1.5 text-sm leading-none ${LANGUAGE_FLAG_BADGE}`}
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
