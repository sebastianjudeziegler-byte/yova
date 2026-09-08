"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, MailCheck, TriangleAlert } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { getStudyProfileVisitorId } from "@/lib/study-profile/analytics-client";
import { storeStudyProfileReportTransition } from "@/lib/study-profile/report-transition";
import styles from "./study-profile.module.css";

type ConfirmationState = "loading" | "ready" | "submitting" | "confirmed" | "invalid";

type ConfirmationLink = {
  token: string;
  reportToken: string | null;
  valid: boolean;
};

type ConfirmationResponse = {
  error?: unknown;
  waitlistJoined?: unknown;
  reportUnlocked?: unknown;
  reportUrl?: unknown;
  responseId?: unknown;
};

const PRIVATE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const RESPONSE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function StudyProfileWaitlistConfirmation() {
  const [token, setToken] = useState<string | null>(null);
  const [reportToken, setReportToken] = useState<string | null>(null);
  const [reportHref, setReportHref] = useState<string | null>(null);
  const [state, setState] = useState<ConfirmationState>("loading");
  const [error, setError] = useState<string | null>(null);
  const initialLinkRef = useRef<ConfirmationLink | null>(null);

  useEffect(() => {
    if (!initialLinkRef.current) {
      const parameters = new URLSearchParams(window.location.hash.slice(1));
      const confirmationToken = parameters.get("token") ?? "";
      const rawReportToken = parameters.get("report") ?? parameters.get("reportToken");
      initialLinkRef.current = {
        token: confirmationToken,
        reportToken: rawReportToken && PRIVATE_TOKEN_PATTERN.test(rawReportToken)
          ? rawReportToken
          : null,
        valid: PRIVATE_TOKEN_PATTERN.test(confirmationToken)
          && (rawReportToken === null || PRIVATE_TOKEN_PATTERN.test(rawReportToken)),
      };
      clearConfirmationFragment();
    }

    const confirmationLink = initialLinkRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (!confirmationLink.valid) {
        setState("invalid");
        return;
      }
      setToken(confirmationLink.token);
      setReportToken(confirmationLink.reportToken);
      setState("ready");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  async function confirm() {
    if (!token || state !== "ready") return;
    setState("submitting");
    setError(null);
    try {
      const response = await fetch("/api/study-profile/waitlist/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          ...(reportToken ? { reportToken } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({})) as ConfirmationResponse;
      if (!response.ok || payload.waitlistJoined !== true) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "YOVA could not confirm your place. Try again.",
        );
      }

      const boundReportHref = reportToken
        ? resolveBoundReportHref(payload.reportUrl, reportToken)
        : null;
      if (
        reportToken
        && (
          payload.reportUnlocked !== true
          || typeof payload.responseId !== "string"
          || !RESPONSE_ID_PATTERN.test(payload.responseId)
          || !boundReportHref
        )
      ) {
        throw new Error("Your waitlist place was confirmed, but YOVA could not unlock this report. Try the confirmation button again.");
      }

      setToken(null);
      initialLinkRef.current = null;
      clearConfirmationFragment();

      if (
        boundReportHref
        && typeof payload.responseId === "string"
      ) {
        const visitorId = getStudyProfileVisitorId();
        storeStudyProfileReportTransition({
          responseId: payload.responseId,
          ...(visitorId ? { visitorId } : {}),
        });
        setReportHref(boundReportHref);
        setState("confirmed");
        window.location.replace(boundReportHref);
        return;
      }

      setState("confirmed");
    } catch (confirmationError) {
      setState("ready");
      setError(
        confirmationError instanceof Error
          ? confirmationError.message
          : "YOVA could not confirm your place. Try again.",
      );
    }
  }

  return (
    <main className={styles.confirmationPage}>
      <section className={styles.confirmationCard} aria-labelledby="confirmation-heading">
        <Link href="/" aria-label="YOVA home" className={styles.brandLink}>
          <BrandMark />
        </Link>
        {state === "confirmed" ? (
          <>
            <CheckCircle2 size={34} aria-hidden="true" />
            <span className={styles.sectionEyebrow}>Email confirmed</span>
            <h1 id="confirmation-heading">{reportHref ? "Your report is unlocked." : "You are on the YOVA waitlist."}</h1>
            {reportHref ? (
              <>
                <p>Your waitlist place is confirmed. Your private Study Profile is ready to open.</p>
                <a className={styles.primaryButton} href={reportHref}>Open my Study Profile</a>
              </>
            ) : (
              <>
                <p>We will email you about YOVA&apos;s launch. You can unsubscribe at any time. See our <a href="/privacy">Privacy Notice</a>.</p>
                <Link className={styles.primaryButton} href="/study-profile">Back to Study Profile</Link>
              </>
            )}
          </>
        ) : state === "invalid" ? (
          <>
            <TriangleAlert size={34} aria-hidden="true" />
            <span className={styles.sectionEyebrow}>Confirmation link</span>
            <h1 id="confirmation-heading">This link is incomplete.</h1>
            <p>Return to Study Profile to request a new confirmation email.</p>
            <Link className={styles.primaryButton} href="/study-profile">Go to Study Profile</Link>
          </>
        ) : (
          <>
            <MailCheck size={34} aria-hidden="true" />
            <span className={styles.sectionEyebrow}>One final step</span>
            <h1 id="confirmation-heading">{reportToken ? "Confirm your place and unlock your report." : "Confirm your place on the YOVA waitlist."}</h1>
            <p>Select the button below to confirm that you want to join the YOVA waitlist and receive YOVA launch emails. You can unsubscribe at any time. Opening this page alone does not confirm your place. See our <a href="/privacy">Privacy Notice</a>.</p>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={state !== "ready"}
              aria-busy={state === "submitting"}
              onClick={() => void confirm()}
            >
              {state === "submitting"
                ? "Confirming..."
                : reportToken
                  ? "Confirm and view my results"
                  : "Confirm my waitlist place"}
            </button>
            {error && <p className={styles.formError} role="alert">{error}</p>}
          </>
        )}
      </section>
    </main>
  );
}

function resolveBoundReportHref(value: unknown, reportToken: string) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, window.location.origin);
    const expectedPath = `/study-profile/report/${encodeURIComponent(reportToken)}`;
    if (url.origin !== window.location.origin || url.pathname !== expectedPath) return null;
    return expectedPath;
  } catch {
    return null;
  }
}

function clearConfirmationFragment() {
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}
