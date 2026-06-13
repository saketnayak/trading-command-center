"use client";
import { useQuery } from "@tanstack/react-query";
import { getPortfolioNews } from "@/lib/api";
import { finnhubUnavailableMessage } from "@/lib/finnhubMessages";

interface Props {
  portfolioId: string;
  priceUnavailableReason: string | null;
}

const TICKER_COLORS = [
  "bg-purple-500/20 text-purple-300 border-purple-500/30",
  "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "bg-teal-500/20 text-teal-300 border-teal-500/30",
  "bg-orange-500/20 text-orange-300 border-orange-500/30",
  "bg-pink-500/20 text-pink-300 border-pink-500/30",
];

function timeAgo(unixTs: number): string {
  const secs = Math.floor(Date.now() / 1000) - unixTs;
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function UnavailableMessage({ message }: { message: string }) {
  return (
    <div className="text-muted text-sm py-6 text-center space-y-1">
      <p>{message}</p>
      <p>
        <a href="/settings" className="text-blue-400 hover:underline">Open Settings</a>
      </p>
    </div>
  );
}

export function NewsPanel({ portfolioId, priceUnavailableReason }: Props) {
  const noKey = priceUnavailableReason === "no_finnhub_key";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["portfolio-news", portfolioId],
    queryFn: () => getPortfolioNews(portfolioId, 7),
    staleTime: 1000 * 60 * 15,
    enabled: !noKey,
  });

  const articles = data?.articles ?? [];
  const unavailableReason = data?.news_unavailable_reason ?? (noKey ? "no_finnhub_key" : null);
  const unavailableMessage = finnhubUnavailableMessage(unavailableReason, "news");

  if (noKey && unavailableMessage) {
    return <UnavailableMessage message={unavailableMessage} />;
  }

  const tickerList = Array.from(new Set(articles.map((a) => a.ticker)));
  const colorMap: Record<string, string> = {};
  tickerList.forEach((t, i) => {
    colorMap[t] = TICKER_COLORS[i % TICKER_COLORS.length];
  });

  if (isLoading) {
    return <div className="text-muted text-sm py-8 text-center">Loading news…</div>;
  }

  if (isError) {
    return (
      <UnavailableMessage message="Could not load news. Check your Finnhub API key in Settings." />
    );
  }

  if (unavailableMessage && articles.length === 0) {
    return <UnavailableMessage message={unavailableMessage} />;
  }

  if (articles.length === 0) {
    return (
      <div className="text-muted text-sm py-8 text-center">
        No recent news found for your holdings.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {unavailableMessage && (
        <div className="text-xs text-amber-400/90 bg-amber-900/20 border border-amber-700/40 rounded-sm px-3 py-2">
          {unavailableMessage}
        </div>
      )}
      <p className="text-xs text-muted">
        Latest news for your holdings (last 7 days), sorted by recency.
      </p>
      <div className="space-y-2">
        {articles.map((a, i) => (
          <a
            key={`${a.ticker}-${a.datetime}-${i}`}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block group bg-input/40 border border-input-border/60 rounded-lg px-4 py-3 hover:border-input-border hover:bg-input/60 transition-colors"
          >
            <div className="flex items-start gap-3">
              {a.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.image}
                  alt=""
                  className="w-14 h-14 rounded-sm object-cover shrink-0 opacity-80"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border ${colorMap[a.ticker]}`}>
                    {a.ticker}
                  </span>
                  <span className="text-muted text-xs">{a.source}</span>
                  <span className="text-subtle text-xs ml-auto">{timeAgo(a.datetime)}</span>
                </div>
                <p className="text-sm text-fg group-hover:text-fg font-medium leading-snug line-clamp-2">
                  {a.headline}
                </p>
                {a.summary && (
                  <p className="text-xs text-muted mt-1 line-clamp-2">{a.summary}</p>
                )}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
