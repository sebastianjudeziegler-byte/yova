"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { PLAN_DELETION_CONFIRMATION } from "@/lib/learning/status-schema";
import styles from "./plan-deletion-dialog.module.css";

export function PlanDeletionControl({
  planTitle,
  onDelete,
}: {
  planTitle: string;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>("[data-plan-deletion-initial-focus]")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const close = () => {
    if (pending) return;
    dialogRef.current?.close();
    setOpen(false);
    setConfirmation("");
    setIssue(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const submit = async () => {
    if (confirmation !== PLAN_DELETION_CONFIRMATION) {
      setIssue(`Type ${PLAN_DELETION_CONFIRMATION} exactly to continue.`);
      return;
    }
    setPending(true);
    setIssue(null);
    try {
      await onDelete();
      dialogRef.current?.close();
      setOpen(false);
    } catch (error) {
      setIssue(error instanceof Error
        ? error.message
        : "YOVA could not permanently delete this archived goal. Nothing was changed.");
    } finally {
      setPending(false);
    }
  };

  return <>
    <button
      ref={triggerRef}
      type="button"
      className="button danger-outline"
      onClick={() => {
        setConfirmation("");
        setIssue(null);
        setOpen(true);
      }}
    >
      <Trash2 size={16} aria-hidden="true" /> Delete permanently
    </button>
    {open && <dialog
      ref={dialogRef}
      className={styles.dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-deletion-title"
      aria-describedby="plan-deletion-description"
      aria-busy={pending || undefined}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <form className={styles.content} onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}>
        <header className={styles.header}>
          <span className={styles.icon}><AlertTriangle size={20} aria-hidden="true" /></span>
          <div><span>PERMANENT ACTION</span><h2 id="plan-deletion-title">Delete this archived goal?</h2></div>
        </header>
        <div id="plan-deletion-description" className={styles.body}>
          <p><strong>{planTitle}</strong> will be permanently removed with its sessions, results, tutor conversation, linked deadlines, and attached materials.</p>
          <p>Your YOVA account, learning profile, and other goals will stay. This cannot be undone.</p>
          <label htmlFor="plan-deletion-confirmation">
            <span>Type {PLAN_DELETION_CONFIRMATION} to confirm</span>
            <input
              id="plan-deletion-confirmation"
              value={confirmation}
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
              aria-invalid={Boolean(issue)}
              onChange={(event) => {
                setConfirmation(event.target.value);
                if (issue) setIssue(null);
              }}
            />
          </label>
          {issue && <p className={styles.error} role="alert">{issue}</p>}
        </div>
        <footer className={styles.actions}>
          <button className="button ghost" type="button" disabled={pending} data-plan-deletion-initial-focus onClick={close}>Keep archived</button>
          <button className="button danger" type="submit" disabled={pending || confirmation !== PLAN_DELETION_CONFIRMATION}>
            {pending ? <span className="button-spinner" /> : <Trash2 size={16} aria-hidden="true" />} Permanently delete goal
          </button>
        </footer>
      </form>
    </dialog>}
  </>;
}
