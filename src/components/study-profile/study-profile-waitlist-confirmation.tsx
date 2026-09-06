"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Full page exits unload Meta before non-measurement routes render. */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, MailCheck, TriangleAlert } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import {
  createMetaEventId,
  trackMetaConversionOnce,
} from "@/lib/meta-pixel";
import styles from "./study-profile.module.css";

type ConfirmationState = "loading" | "ready" | "submitting" | "confirmed" | "invalid";

export function StudyProfileWaitlistConfirmation() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<ConfirmationState>("loading");
  const [error, setError] = useState<string | null>(null);
  const initialTokenRef = useRef<string | null>(null);
  const metaEventIdRef = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const fragmentToken = initialTokenRef.current ?? parameters.get("token");
    if (fragmentToken && /^[A-Za-z0-9_-]{43}$/.test(fragmentToken)) {
      initialTokenRef.current = fragmentToken;
      metaEventIdRef.current ??= createMetaEventId(
        "study_profile_waitlist",
        fragmentToken,
      ).catch(() => null);
      clearConfirmationFragment();
    }
    const frame = window.requestAnimationFrame(() => {
      if (!fragmentToken || !/^[A-Za-z0-9_-]{43}$/.test(fragmentToken)) {
        setState("invalid");
        return;
      }
      setToken(fragmentToken);
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
        body: JSON.stringify({ token }),
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: unknown;
        waitlistJoined?: unknown;
        metaConversionEligible?: unknown;
      };
      if (!response.ok || payload.waitlistJoined !== true) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "YOVA could not confirm your place. Try again.",
        );
      }
      if (payload.metaConversionEligible === true && metaEventIdRef.current) {
        const metaEventId = await metaEventIdRef.current;
        if (metaEventId) {
          trackMetaConversionOnce(
            "CompleteRegistration",
            { content_name: "waitlist" },
            metaEventId,
          );
        }
      }
      setToken(null);
      initialTokenRef.current = null;
      metaEventIdRef.current = null;
      clearConfirmationFragment();
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
        <a href="/" aria-label="YOVA home" className={styles.brandLink}>
          <BrandMark />
        </a>
        {state === "confirmed" ? (
          <>
            <CheckCircle2 size={34} aria-hidden="true" />
            <span className={styles.sectionEyebrow}>Email confirmed</span>
            <h1 id="confirmation-heading">You are on the YOVA waitlist.</h1>
            <p>We will email you about YOVA&apos;s launch. You can unsubscribe at any time. See our <a href="/privacy">Privacy Notice</a>.</p>
            <Link className={styles.primaryButton} href="/study-profile">Back to Study Profile</Link>
          </>
        ) : state === "invalid" ? (
          <>
            <TriangleAlert size={34} aria-hidden="true" />
            <span className={styles.sectionEyebrow}>Confirmation link</span>
            <h1 id="confirmation-heading">This link is incomplete.</h1>
            <p>Request a new confirmation email from the Study Profile page.</p>
            <Link className={styles.primaryButton} href="/study-profile">Go to Study Profile</Link>
          </>
        ) : (
          <>
            <MailCheck size={34} aria-hidden="true" />
            <span className={styles.sectionEyebrow}>One final step</span>
            <h1 id="confirmation-heading">Confirm YOVA launch emails.</h1>
            <p>Select the button below to confirm that you want YOVA launch emails at the address you entered. You can unsubscribe at any time. Opening this page alone does not join the waitlist. See our <a href="/privacy">Privacy Notice</a>.</p>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={state !== "ready"}
              aria-busy={state === "submitting"}
              onClick={() => void confirm()}
            >
              {state === "submitting" ? "Confirming..." : "Confirm launch emails"}
            </button>
            {error && <p className={styles.formError} role="alert">{error}</p>}
          </>
        )}
      </section>
    </main>
  );
}

function clearConfirmationFragment() {
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}
