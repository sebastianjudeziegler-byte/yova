"use client";

import {
  useEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";

type AccessibleModalDialogProps = Readonly<{
  children: ReactNode;
  className: string;
  labelledBy: string;
  describedBy?: string;
  dismissible?: boolean;
  initialFocusSelector?: string;
  onDismiss: () => void;
}>;

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/**
 * A native modal boundary for app overlays.
 *
 * `showModal()` gives us the browser's focus loop and makes the rest of the
 * document inert. The wrapper also keeps React state authoritative on Escape
 * and returns focus to the control that opened the modal when it closes.
 */
export function AccessibleModalDialog({
  children,
  className,
  labelledBy,
  describedBy,
  dismissible = true,
  initialFocusSelector = "[data-modal-initial-focus]",
  onDismiss,
}: AccessibleModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (!dialog.open) dialog.showModal();

    const focusFrame = window.requestAnimationFrame(() => {
      const requestedTarget = dialog.querySelector<HTMLElement>(initialFocusSelector);
      const firstFocusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (requestedTarget ?? firstFocusable ?? dialog).focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (dialog.open) dialog.close();
      const restoreTarget = restoreFocusRef.current;
      window.requestAnimationFrame(() => {
        if (restoreTarget?.isConnected) restoreTarget.focus();
      });
    };
  }, [initialFocusSelector]);

  const dismiss = () => {
    if (dismissible) onDismiss();
  };

  return (
    <dialog
      ref={dialogRef}
      className={`accessible-modal ${className}`}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-busy={!dismissible || undefined}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          dismiss();
          return;
        }
        if (event.key !== "Tab") return;

        const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
          .filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) {
          event.preventDefault();
          event.currentTarget.focus();
          return;
        }

        const active = document.activeElement;
        const leavingBackward = event.shiftKey
          && (active === first || !event.currentTarget.contains(active));
        const leavingForward = !event.shiftKey
          && (active === last || !event.currentTarget.contains(active));
        if (leavingBackward || leavingForward) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }}
      onClick={(event: MouseEvent<HTMLDialogElement>) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      {children}
    </dialog>
  );
}
