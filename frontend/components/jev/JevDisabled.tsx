import Link from "next/link";

export function JevDisabled() {
  return (
    <div className="rounded-lg border border-border bg-surface p-6 text-sm">
      <p className="text-fg font-medium">JEV Lab is turned off.</p>
      <p className="mt-1 text-muted">
        An admin can enable it under{" "}
        <Link href="/settings" className="text-link hover:text-link-hover">
          Settings → Strategy Modules
        </Link>
        , then add an Alpaca paper key and (optionally) a Vercel AI Gateway key under Settings → JEV Lab.
      </p>
    </div>
  );
}
