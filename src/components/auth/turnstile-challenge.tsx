"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type TurnstileWidgetOptions = {
  sitekey: string;
  theme: "light";
  size: "flexible";
  callback: (token: string) => void;
  "error-callback": () => boolean;
  "expired-callback": () => void;
  "timeout-callback": () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileWidgetOptions) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function TurnstileChallenge({
  siteKey,
  resetNonce,
  onTokenChange,
}: {
  siteKey: string;
  resetNonce: number;
  onTokenChange: (token: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenChangeRef = useRef(onTokenChange);
  const lastResetNonceRef = useRef(resetNonce);
  const [scriptReady, setScriptReady] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);

  useEffect(() => {
    tokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    const container = containerRef.current;
    const turnstile = window.turnstile;
    if (!scriptReady || !container || !turnstile || widgetIdRef.current) return;

    setIssue(null);
    try {
      widgetIdRef.current = turnstile.render(container, {
        sitekey: siteKey,
        theme: "light",
        size: "flexible",
        callback: (token) => {
          setIssue(null);
          tokenChangeRef.current(token);
        },
        "error-callback": () => {
          tokenChangeRef.current(null);
          setIssue("The security check could not load. Check your connection and try again.");
          return true;
        },
        "expired-callback": () => {
          tokenChangeRef.current(null);
          setIssue("The security check expired. Complete it again to continue.");
          if (widgetIdRef.current && window.turnstile) {
            window.turnstile.reset(widgetIdRef.current);
          }
        },
        "timeout-callback": () => {
          tokenChangeRef.current(null);
          setIssue("The security check timed out. Complete it again to continue.");
        },
      });
    } catch {
      window.queueMicrotask(() => {
        setIssue("The security check could not start. Refresh the page and try again.");
        tokenChangeRef.current(null);
      });
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
      tokenChangeRef.current(null);
    };
  }, [scriptReady, siteKey]);

  useEffect(() => {
    if (lastResetNonceRef.current === resetNonce) return;
    lastResetNonceRef.current = resetNonce;
    tokenChangeRef.current(null);
    setIssue(null);
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [resetNonce]);

  return (
    <div className="turnstile-challenge">
      <Script
        id="cloudflare-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onError={() => setIssue("The security check could not load. Check your connection and try again.")}
      />
      <div ref={containerRef} className="turnstile-widget" aria-label="Security check" />
      {!scriptReady && !issue && <p className="turnstile-status" role="status">Loading security check…</p>}
      {issue && <p className="form-error turnstile-error" role="alert">{issue}</p>}
    </div>
  );
}
