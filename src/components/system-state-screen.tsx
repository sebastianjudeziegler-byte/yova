"use client";

import Link from "next/link";

import styles from "./system-state-screen.module.css";

type SystemStateScreenProps = {
  eyebrow: string;
  title: string;
  description: string;
  documentTitle?: string;
  reload?: boolean;
  retry?: () => void;
  reference?: string;
  showHomeAction?: boolean;
};

function YovaSystemMark() {
  return (
    <Link className={styles.brand} href="/" aria-label="Go to YOVA home">
      <span className={styles.mark} aria-hidden="true">
        <svg viewBox="0 0 48 48">
          <path d="M13 14.5 24 26l11-11.5" />
          <path d="M24 26v10" />
          <path className={styles.spark} d="M34 6v6M31 9h6" />
        </svg>
      </span>
      <span className={styles.wordmark}>YOVA</span>
    </Link>
  );
}

function StatusIcon({ isError }: { isError: boolean }) {
  return (
    <span className={styles.status} aria-hidden="true">
      {isError ? (
        <svg viewBox="0 0 24 24">
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
          <path d="M10.3 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
          <path d="M8.5 11h5" />
        </svg>
      )}
    </span>
  );
}

export function SystemStateScreen({
  eyebrow,
  title,
  description,
  documentTitle,
  reload = false,
  retry,
  reference,
  showHomeAction = true,
}: SystemStateScreenProps) {
  const isError = Boolean(retry || reload);
  const showActions = isError || showHomeAction;

  return (
    <main className={styles.shell}>
      {documentTitle && <title>{documentTitle}</title>}
      <section className={styles.card} aria-labelledby="system-state-title">
        <YovaSystemMark />
        <StatusIcon isError={isError} />
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 id="system-state-title">{title}</h1>
        <p className={styles.description}>{description}</p>
        {showActions && (
          <div className={styles.actions}>
            {(retry || reload) && (
              <button
                className={styles.primary}
                type="button"
                onClick={retry ?? (() => window.location.reload())}
              >
                Try again
              </button>
            )}
            {showHomeAction && (
              <Link className={isError ? styles.secondary : styles.primary} href="/">
                Go to YOVA home
              </Link>
            )}
          </div>
        )}
        {reference && <p className={styles.reference}>Support reference: {reference}</p>}
      </section>
    </main>
  );
}
