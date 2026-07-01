"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMenuFocusTrap } from "@/lib/useMenuFocusTrap";

const MENU_MIN_WIDTH = 160;
const VIEWPORT_PADDING = 12;
const GAP = 4;

export type TabBarItem = {
  id: string;
  label: string;
  shortLabel?: string;
  badge?: string;
  alertCount?: number;
};

type TabBarProps = {
  primaryTabs: TabBarItem[];
  overflowTabs: TabBarItem[];
  activeId: string;
  onChange: (id: string) => void;
  overflowLabel?: string;
  /** Prefix for tab button ids (used with tabpanel aria-labelledby). */
  tabIdPrefix?: string;
  className?: string;
};

function TabButton({
  tab,
  active,
  onSelect,
  tabId,
}: {
  tab: TabBarItem;
  active: boolean;
  onSelect: () => void;
  tabId: string;
}) {
  return (
    <button
      type="button"
      id={tabId}
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px whitespace-nowrap sm:px-4 ${
        active
          ? "border-purple-500 text-fg"
          : "border-transparent text-muted hover:text-fg"
      }`}
    >
      {tab.shortLabel ? (
        <>
          <span className="sm:hidden">{tab.shortLabel}</span>
          <span className="hidden sm:inline">{tab.label}</span>
        </>
      ) : (
        <span>{tab.label}</span>
      )}
      {tab.alertCount != null && tab.alertCount > 0 && (
        <span className="min-w-[16px] rounded-sm bg-red-500 px-1 py-0.5 text-center font-mono text-xs leading-none text-fg">
          {tab.alertCount}
        </span>
      )}
      {!(tab.alertCount != null && tab.alertCount > 0) && tab.badge && (
        <span className="text-xs text-purple-400">{tab.badge}</span>
      )}
    </button>
  );
}

export function TabBar({
  primaryTabs,
  overflowTabs,
  activeId,
  onChange,
  overflowLabel = "More",
  tabIdPrefix = "tab",
  className = "",
}: TabBarProps) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );

  const activeOverflow = overflowTabs.some((tab) => tab.id === activeId);
  const activeOverflowTab = overflowTabs.find((tab) => tab.id === activeId);

  useLayoutEffect(() => {
    if (!menuOpen || !triggerRef.current) {
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
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    }

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        menuRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      setMenuOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [menuOpen]);

  useMenuFocusTrap(menuOpen, menuRef);

  if (primaryTabs.length === 0 && overflowTabs.length === 0) {
    return null;
  }

  return (
    <div
      role="tablist"
      className={`flex gap-1 overflow-x-auto border-b border-border scrollbar-thin ${className}`.trim()}
    >
      {primaryTabs.map((tab) => (
        <TabButton
          key={tab.id}
          tab={tab}
          active={activeId === tab.id}
          onSelect={() => onChange(tab.id)}
          tabId={`${tabIdPrefix}-${tab.id}`}
        />
      ))}

      {overflowTabs.length > 0 && (
        <>
          <button
            ref={triggerRef}
            type="button"
            id={activeOverflowTab ? `${tabIdPrefix}-${activeOverflowTab.id}` : `${tabIdPrefix}-overflow`}
            role="tab"
            aria-selected={activeOverflow}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            onClick={() => setMenuOpen((open) => !open)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px whitespace-nowrap sm:px-4 ${
              activeOverflow
                ? "border-purple-500 text-fg"
                : "border-transparent text-muted hover:text-fg"
            }`}
          >
            <span>
              {activeOverflow && activeOverflowTab ? (
                activeOverflowTab.shortLabel ? (
                  <>
                    <span className="sm:hidden">{activeOverflowTab.shortLabel}</span>
                    <span className="hidden sm:inline">{activeOverflowTab.label}</span>
                  </>
                ) : (
                  activeOverflowTab.label
                )
              ) : (
                overflowLabel
              )}
            </span>
            <span className="text-xs text-muted" aria-hidden>
              {menuOpen ? "▴" : "▾"}
            </span>
          </button>

          {menuOpen &&
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
                {overflowTabs.map((tab) => {
                  const selected = tab.id === activeId;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onChange(tab.id);
                        setMenuOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                        selected
                          ? "bg-elevated text-fg"
                          : "text-fg-secondary hover:bg-elevated"
                      }`}
                    >
                      <span className="flex-1">{tab.label}</span>
                      {tab.alertCount != null && tab.alertCount > 0 && (
                        <span className="min-w-[16px] rounded-sm bg-red-500 px-1 py-0.5 text-center font-mono text-xs leading-none text-fg">
                          {tab.alertCount}
                        </span>
                      )}
                      {!(tab.alertCount != null && tab.alertCount > 0) && tab.badge && (
                        <span className="text-xs text-purple-400">{tab.badge}</span>
                      )}
                    </button>
                  );
                })}
              </div>,
              document.body,
            )}
        </>
      )}
    </div>
  );
}
