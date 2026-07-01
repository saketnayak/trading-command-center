"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMenuFocusTrap } from "@/lib/useMenuFocusTrap";

const MENU_MIN_WIDTH = 168;
const VIEWPORT_PADDING = 12;
const GAP = 4;

export type NavDropdownItem = {
  href: string;
  label: string;
  active?: boolean;
};

type NavDropdownProps = {
  label: string;
  items: NavDropdownItem[];
  active?: boolean;
  onNavigate?: () => void;
};

function triggerClass(active: boolean) {
  return active
    ? "text-blue-500 dark:text-blue-400 border-b border-blue-500 dark:border-blue-400"
    : "text-muted hover:text-fg-secondary";
}

export function NavDropdown({ label, items, active = false, onNavigate }: NavDropdownProps) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setMenuPosition(null);
      return;
    }

    const updatePosition = () => {
      const anchor = triggerRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const width = Math.max(MENU_MIN_WIDTH, rect.width);
      let left = rect.left;
      if (left + width > window.innerWidth - VIEWPORT_PADDING) {
        left = window.innerWidth - VIEWPORT_PADDING - width;
      }
      left = Math.max(VIEWPORT_PADDING, left);

      setMenuPosition({
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

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  useMenuFocusTrap(open, menuRef);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={`text-xs px-1 pb-0.5 whitespace-nowrap inline-flex items-center gap-0.5 ${triggerClass(active)}`}
      >
        <span>{label}</span>
        <span className="text-[10px] opacity-70" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open &&
        menuPosition &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            className="fixed z-50 rounded-md border border-border bg-surface py-1 shadow-lg"
            style={{
              top: menuPosition.top,
              left: menuPosition.left,
              minWidth: menuPosition.width,
            }}
          >
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onNavigate?.();
                }}
                className={`block px-3 py-2 text-sm transition-colors ${
                  item.active
                    ? "bg-elevated text-fg font-medium"
                    : "text-fg-secondary hover:bg-elevated"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
