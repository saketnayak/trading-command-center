"use client";

import type { ReactNode } from "react";
import { Bell, RefreshCw, RotateCw } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";

interface PortfolioActionsProps {
  freshnessLabel?: ReactNode;
  hasMissingPrices?: boolean;
  isRefreshing?: boolean;
  isSyncing?: boolean;
  onRefreshClick?: () => void;
  onSyncAllClick?: () => void;
  onUploadClick: () => void;
  onExportClick: () => void;
  onDeliveryClick: () => void;
}

function ToolbarDivider() {
  return <div className="hidden sm:block h-6 w-px shrink-0 bg-border" aria-hidden="true" />;
}

function TextActionButton({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className="text-muted hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed text-xs border border-input-border rounded px-2 py-1.5 transition-colors"
    >
      {label}
    </button>
  );
}

export function PortfolioActions({
  freshnessLabel,
  hasMissingPrices,
  isRefreshing,
  isSyncing,
  onRefreshClick,
  onSyncAllClick,
  onUploadClick,
  onExportClick,
  onDeliveryClick,
}: PortfolioActionsProps) {
  const busy = isRefreshing || isSyncing;

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-1.5">
      {(freshnessLabel || onRefreshClick || onSyncAllClick) && (
        <>
          {freshnessLabel}
          <div className="flex items-center gap-1">
            {onRefreshClick && (
              <IconButton
                icon={RefreshCw}
                label={hasMissingPrices ? "Retry fetching missing prices" : "Refresh prices"}
                title={hasMissingPrices ? "Retry fetching missing prices" : "Refresh prices"}
                disabled={busy}
                iconClassName={isRefreshing ? "animate-spin" : undefined}
                onClick={onRefreshClick}
              />
            )}
            {onSyncAllClick && (
              <IconButton
                icon={RotateCw}
                label="Sync all portfolio data"
                title="Sync all portfolio data. Regime and wave may be cached on the server for up to 4 hours."
                disabled={busy}
                iconClassName={isSyncing ? "animate-spin" : undefined}
                onClick={onSyncAllClick}
              />
            )}
          </div>
          <ToolbarDivider />
        </>
      )}

      <div className="flex items-center gap-1.5">
        <TextActionButton label="Import" onClick={onUploadClick} title="Import holdings from CSV" />
        <TextActionButton label="Export" onClick={onExportClick} title="Export holdings to CSV" />
      </div>

      <ToolbarDivider />

      <IconButton
        icon={Bell}
        label="Delivery settings"
        title="Brief delivery settings"
        onClick={onDeliveryClick}
      />
    </div>
  );
}
