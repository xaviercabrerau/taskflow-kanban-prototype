"use client";

import { useEffect } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Small reusable hook for modal/dialog accessibility.
 * - Moves focus into the dialog container (or its first focusable element) on mount.
 * - Restores focus to the previously focused element on unmount.
 * - Traps Tab/Shift+Tab within the container's focusable elements while open.
 * - Listens for Escape and calls onClose.
 */
export function useDialogA11y(
  containerRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled: boolean = true
) {
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    function getFocusable(): HTMLElement[] {
      if (!container) return [];
      return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1
      );
    }

    const focusable = getFocusable();
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      container?.focus();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === "Tab") {
        const items = getFocusable();
        if (items.length === 0) return;

        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !container?.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !container?.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previouslyFocused?.focus();
    };
    // Intencional: efecto de mount/unmount único (abre/cierra el diálogo una
    // vez). Los callers deben pasar un onClose referencialmente estable o sin
    // estado que capture — no agregar containerRef/onClose a las deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
