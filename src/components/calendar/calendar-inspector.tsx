"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native modal semantics provide focus containment, Escape and inert background. */
export function CalendarInspector({ children, onClose, label, className = "" }: { children: ReactNode; onClose: () => void; label?: string; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    element?.querySelector<HTMLElement>("h2")?.focus();
    return () => {
      element?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className={`calendar-inspector ${className}`} aria-label={label} aria-labelledby={label ? undefined : "calendar-block-detail-title"} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    {children}
  </dialog>;
}
