"use client";
import { useEffect, useRef } from "react";

export type HotkeyHandler = (e: KeyboardEvent) => void;

export interface HotkeyBinding {
  /** A single key (e.g. "n", "/", "?") matched case-insensitively. */
  key: string;
  /** Optional sequence prefix, e.g. "g" for "g r" navigation. */
  sequencePrefix?: string;
  handler: HotkeyHandler;
  description: string;
}

function isTypingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Register global keyboard shortcuts. Ignores key events while the user is
 * typing in inputs/textareas/contenteditable. Supports two-key sequences via
 * `sequencePrefix` — the prefix is buffered for ~1s.
 */
export function useHotkeys(bindings: HotkeyBinding[]) {
  const pendingPrefix = useRef<string | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingInField(e.target)) return;

      const key = e.key.toLowerCase();

      // Sequence completion: a prefix is buffered and this key matches a
      // binding's sequencePrefix.
      if (pendingPrefix.current) {
        const match = bindings.find(
          (b) => b.sequencePrefix === pendingPrefix.current && b.key.toLowerCase() === key,
        );
        pendingPrefix.current = null;
        if (clearTimer.current) clearTimeout(clearTimer.current);
        if (match) {
          e.preventDefault();
          match.handler(e);
          return;
        }
        // fall through — the user pressed something else after the prefix
      }

      // Is this key a prefix used by any binding?
      const isPrefix = bindings.some((b) => b.sequencePrefix && b.sequencePrefix.toLowerCase() === key);
      if (isPrefix) {
        pendingPrefix.current = key;
        clearTimer.current = setTimeout(() => { pendingPrefix.current = null; }, 1000);
        return;
      }

      const single = bindings.find((b) => !b.sequencePrefix && b.key.toLowerCase() === key);
      if (single) {
        e.preventDefault();
        single.handler(e);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, [bindings]);
}
