"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const POPOVER_WIDTH = 288;
const VIEWPORT_PADDING = 12;
const GAP = 8;

interface InfoPopoverProps {
  label: string;
  tooltip: string;
  open: boolean;
  onToggle: () => void;
}

export function InfoPopover({ label, tooltip, open, onToggle }: InfoPopoverProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const anchor = buttonRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2);
      let left = rect.left;
      if (left + width > window.innerWidth - VIEWPORT_PADDING) {
        left = window.innerWidth - VIEWPORT_PADDING - width;
      }
      left = Math.max(VIEWPORT_PADDING, left);

      setPosition({
        top: rect.bottom + GAP,
        left,
        width,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      onToggle();
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open, onToggle]);

  return (
    <>
      <div className="flex items-center gap-1.5 text-muted text-xs sm:w-44 shrink-0">
        <span>{label}</span>
        <button
          ref={buttonRef}
          type="button"
          onClick={onToggle}
          aria-label={`Explain ${label}`}
          aria-expanded={open}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-input-border text-[10px] text-muted hover:border-blue-500 hover:text-blue-400"
        >
          i
        </button>
      </div>
      {open &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            role="tooltip"
            style={{
              position: "fixed",
              top: position.top,
              left: position.left,
              width: position.width,
              zIndex: 1000,
            }}
            className="rounded-md border border-input-border bg-elevated p-3 text-xs leading-relaxed text-fg-secondary shadow-lg"
          >
            {tooltip}
          </div>,
          document.body,
        )}
    </>
  );
}
