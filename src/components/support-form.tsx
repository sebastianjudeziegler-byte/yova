"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Send } from "lucide-react";
import type { SupportRequest } from "@/lib/support/schema";

const categories: Array<{ value: SupportRequest["category"]; label: string }> = [
  { value: "account", label: "Account or sign-in" },
  { value: "plan", label: "Plan or recommendation" },
  { value: "session", label: "Guided session" },
  { value: "materials", label: "Uploaded material" },
  { value: "feedback", label: "Product feedback" },
  { value: "other", label: "Something else" },
];

export function SupportForm() {
  const [category, setCategory] = useState<SupportRequest["category"]>("account");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, subject, message }),
      });
      const result = await response.json().catch(() => null) as { requestId?: string; error?: string } | null;
      if (!response.ok || !result?.requestId) {
        throw new Error(result?.error || "YOVA could not send that request.");
      }
      setRequestId(result.requestId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "YOVA could not send that request.");
    } finally {
      setPending(false);
    }
  };

  if (requestId) {
    return <section className="support-success" aria-live="polite"><span><Check size={22} /></span><div><h2>Request received.</h2><p>YOVA saved this privately with your signed-in account. Reference <strong>{requestId.slice(0, 8).toUpperCase()}</strong>.</p><Link className="button secondary" href="/">Return to YOVA</Link></div></section>;
  }

  return (
    <section className="support-form" aria-labelledby="support-form-title">
      <div>
        <span className="step-label">PRIVATE SUPPORT</span>
        <h2 id="support-form-title">Tell us what happened.</h2>
        <p>Send the steps you took, what you expected, and what happened instead. Do not include passwords, API keys, or sensitive school records.</p>
      </div>
      <label><span>Area</span><select value={category} disabled={pending} onChange={(event) => setCategory(event.target.value as SupportRequest["category"])}>{categories.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label><span>Short subject</span><input value={subject} maxLength={120} disabled={pending} placeholder="Example: My study plan would not open" onChange={(event) => setSubject(event.target.value)} /></label>
      <label><span>What happened?</span><textarea value={message} maxLength={4_000} rows={7} disabled={pending} placeholder="Include the screen, button, and any error message you saw." onChange={(event) => setMessage(event.target.value)} /></label>
      <small>{message.length.toLocaleString()} / 4,000 characters</small>
      {error && <div className="support-error" role="alert"><p>{error}</p>{error.toLowerCase().includes("sign in") && <Link href="/">Return to YOVA and sign in</Link>}</div>}
      <button className="button primary large" disabled={pending || subject.trim().length < 3 || message.trim().length < 10} onClick={() => void submit()}>{pending ? <span className="button-spinner" /> : <Send size={17} />} {pending ? "Sending…" : "Send support request"}</button>
    </section>
  );
}
