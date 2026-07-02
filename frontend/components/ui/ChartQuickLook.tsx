"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useMenuFocusTrap } from "@/lib/useMenuFocusTrap";

type ChartQuickLookProps = {
  label: string;
  thumbnail: ReactNode;
  /** Rendered only while the quick look is open. Pass a function to defer mounting heavy charts. */
  preview: ReactNode | (() => ReactNode);
  maxWidth?: number;
  /** Let preview content expand to fill the modal body (for full-size Plotly charts). */
  fillContent?: boolean;
  className?: string;
};

export function ChartQuickLook({
  label,
  thumbnail,
  preview,
  maxWidth = 720,
  fillContent = false,
  className = "",
}: ChartQuickLookProps) {
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useMenuFocusTrap(open, modalRef);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus();
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className={`w-full rounded-md text-left transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-elevated ${className}`}
        aria-label={`Quick Look: ${label}`}
      >
        <span className="pointer-events-none block">{thumbnail}</span>
        <span className="mt-1 block text-[10px] text-muted">Click to expand</span>
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] flex items-center justify-center p-4 sm:p-8"
            role="presentation"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
              onClick={close}
              aria-label="Close preview"
            />
            <div
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              style={{ maxWidth: `min(${maxWidth}px, 92vw)` }}
              className={`chart-quicklook-panel relative flex w-full flex-col overflow-hidden rounded-xl border border-input-border bg-elevated shadow-2xl ${
                fillContent ? "h-[min(90vh,820px)]" : "max-h-[min(90vh,820px)]"
              }`}
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-input-border px-4 py-3">
                <h4 id={titleId} className="text-sm font-semibold text-fg">
                  {label}
                </h4>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-sm border border-input-border px-2.5 py-1 text-xs text-muted hover:border-border-strong hover:text-fg"
                >
                  Close
                </button>
              </div>
              <div
                className={
                  fillContent
                    ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                    : "min-h-0 flex-1 overflow-auto p-5 sm:p-6"
                }
              >
                {fillContent ? (
                  <div className="flex min-h-0 flex-1 flex-col">
                    {typeof preview === "function" ? preview() : preview}
                  </div>
                ) : (
                  typeof preview === "function" ? preview() : preview
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
