"use client";

import { useEffect } from "react";

/** Keep mobile overlays out of the software keyboard without disabling zoom. */
export function MobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const update = () => {
      const focused = document.activeElement;
      const editing = focused instanceof HTMLElement && focused.matches(
        'textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"]), [contenteditable="true"]',
      );
      // Browser chrome also changes viewport height; only a substantial reduction
      // during text entry counts. Pinch zoom must retain normal browser behavior.
      const keyboardOpen = window.innerWidth <= 760 && editing
        && Math.abs(viewport.scale - 1) < 0.05
        && window.innerHeight - viewport.height > 120;
      root.toggleAttribute("data-mobile-keyboard", keyboardOpen);
      root.style.setProperty("--mobile-visible-height", `${viewport.height}px`);
      root.style.setProperty("--mobile-keyboard-inset", keyboardOpen
        ? `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`
        : "0px");
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      root.removeAttribute("data-mobile-keyboard");
      root.style.removeProperty("--mobile-visible-height");
      root.style.removeProperty("--mobile-keyboard-inset");
    };
  }, []);

  return null;
}
