"use client";

import { useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Clock3, Mail } from "lucide-react";
import {
  captureStudyProfileAttribution,
  getStudyProfileVisitorId,
} from "@/lib/study-profile/analytics-client";
import styles from "./waitlist-form.module.css";

type WaitlistStatus = "idle" | "submitting" | "pending" | "joined" | "limited";

type WaitlistResponse = {
  error?: unknown;
  waitlistJoined?: unknown;
  confirmationPending?: unknown;
  dailyCapReached?: unknown;
};

export function LandingWaitlistForm({
  idPrefix,
  compact = false,
}: {
  idPrefix: string;
  compact?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [status, setStatus] = useState<WaitlistStatus>("idle");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const requestInFlight = useRef(false);
  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const submitting = status === "submitting";
  const disabled = !emailIsValid || !consent || !ageConfirmed || submitting;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || requestInFlight.current || status !== "idle") return;

    requestInFlight.current = true;
    setError(null);
    setStatus("submitting");
    const requestedEmail = email.trim();
    setSubmittedEmail(requestedEmail);

    try {
      const visitorId = getStudyProfileVisitorId();
      if (!visitorId) {
        throw new Error("Your browser could not create a private waitlist session. Refresh and try again.");
      }

      const response = await fetch("/api/study-profile/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: requestedEmail,
          visitorId,
          consent,
          ageConfirmed,
          under18: false,
          attribution: captureStudyProfileAttribution(),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      const payload: WaitlistResponse = body && typeof body === "object" && !Array.isArray(body)
        ? body as WaitlistResponse
        : {};

      if (!response.ok) {
        throw new Error(typeof payload.error === "string"
          ? payload.error
          : "YOVA could not send the confirmation email. Try again.");
      }
      if (payload.dailyCapReached === true) setStatus("limited");
      else if (payload.waitlistJoined === true) setStatus("joined");
      else if (payload.confirmationPending === true) setStatus("pending");
      else throw new Error("YOVA could not confirm the email request. Try again.");
    } catch (submitError) {
      setStatus("idle");
      setError(submitError instanceof Error
        ? submitError.message
        : "YOVA could not send the confirmation email. Try again.");
    } finally {
      requestInFlight.current = false;
    }
  }

  if (status === "joined" || status === "limited" || status === "pending") {
    const StatusIcon = status === "joined" ? CheckCircle2 : status === "limited" ? Clock3 : Mail;
    return (
      <div className={`${styles.status} ${compact ? styles.compactStatus : ""}`} role="status">
        <StatusIcon size={20} aria-hidden="true" />
        {status === "joined" ? (
          <span><strong>You are on the list.</strong>{" "}We will email you when YOVA is ready. You can unsubscribe at any time.</span>
        ) : status === "limited" ? (
          <span><strong>Try again later.</strong>{" "}To protect this inbox, YOVA cannot send another email today.</span>
        ) : (
          <span><strong>Check your inbox.</strong>{" "}We sent a confirmation link to {submittedEmail}. Select it to hold your founding place.</span>
        )}
      </div>
    );
  }

  const emailInput = (
    <input
      id={`${idPrefix}-email`}
      name="email"
      className={styles.emailInput}
      type="email"
      inputMode="email"
      autoComplete="email"
      maxLength={254}
      required
      disabled={submitting}
      value={email}
      placeholder="you@example.com"
      onChange={(event) => setEmail(event.target.value)}
    />
  );
  const submitButton = (
    <button type="submit" className={`button ${styles.submitButton}`} disabled={disabled}>
      {submitting ? "Sending…" : compact ? "Join the waitlist" : "Hold my founding place"}
    </button>
  );

  return (
    <form
      className={`${styles.form} ${compact ? styles.compact : ""}`}
      aria-label={compact ? "Join the YOVA waitlist" : "Hold your founding place"}
      aria-busy={submitting}
      onSubmit={submit}
    >
      <label htmlFor={`${idPrefix}-email`} className={compact ? styles.visuallyHidden : styles.emailLabel}>
        Email address
      </label>
      {compact ? <div className={styles.inlineFields}>{emailInput}{submitButton}</div> : emailInput}
      <label className={styles.consent}>
        <input
          type="checkbox"
          name="ageConfirmed"
          required
          disabled={submitting}
          checked={ageConfirmed}
          onChange={(event) => setAgeConfirmed(event.target.checked)}
        />
        <span>I confirm I am 13 or older.</span>
      </label>
      <label className={styles.consent}>
        <input
          type="checkbox"
          name="consent"
          required
          disabled={submitting}
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>Email me when YOVA launches. I can unsubscribe at any time.</span>
      </label>
      {!compact && submitButton}
      {!compact && (
        <p className={styles.legalNote}>
          You will receive a confirmation link first. Opening it alone does not join you.{" "}
          <a href="/privacy">Privacy Notice</a>.
        </p>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </form>
  );
}
