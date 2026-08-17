"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff, KeyRound } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { updateAuthenticatedPassword } from "@/lib/auth/client";
import { PASSWORD_MIN_LENGTH, validatePassword } from "@/lib/auth/password";

export function SetPasswordForm({ source }: { source: "invite" | "recovery" | "account" }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);

  const heading = source === "invite"
    ? "Create a password for YOVA."
    : source === "recovery"
      ? "Choose a new password."
      : "Change your YOVA password.";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const passwordIssue = validatePassword(password);
    if (passwordIssue) {
      setError(passwordIssue);
      passwordRef.current?.focus();
      return;
    }

    if (confirmation !== password) {
      setError("The passwords do not match.");
      return;
    }

    setPending(true);
    try {
      await updateAuthenticatedPassword(password);
      window.location.replace("/");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "YOVA could not update the password. Try again.");
      setPending(false);
    }
  }

  return (
    <main className="account-shell">
      <header>
        <BrandMark />
        <Link className="button ghost" href="/">Return to YOVA</Link>
      </header>
      <section className="account-card" aria-labelledby="set-password-title">
        <div className="mail-check" aria-hidden="true"><KeyRound size={24} /></div>
        <span className="step-label">SECURE YOUR ACCOUNT</span>
        <h1 id="set-password-title">{heading}</h1>
        <p>Use at least {PASSWORD_MIN_LENGTH} characters. A password manager can create and remember one for you.</p>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="new-password">
            <span>New password</span>
            <div className="password-input">
              <input
                ref={passwordRef}
                id="new-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => { setPassword(event.target.value); setError(""); }}
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                aria-invalid={Boolean(error)}
                aria-describedby="password-requirements password-error"
                disabled={pending}
                autoFocus
              />
              <button type="button" aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)} disabled={pending}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                <span>{showPassword ? "Hide" : "Show"}</span>
              </button>
            </div>
          </label>
          <small id="password-requirements" className="password-hint">At least {PASSWORD_MIN_LENGTH} characters. Spaces are allowed.</small>
          <label htmlFor="confirm-password">
            <span>Confirm password</span>
            <input
              id="confirm-password"
              type={showPassword ? "text" : "password"}
              value={confirmation}
              onChange={(event) => { setConfirmation(event.target.value); setError(""); }}
              autoComplete="new-password"
              aria-invalid={Boolean(error)}
              aria-describedby="password-error"
              disabled={pending}
            />
          </label>
          {error && <p id="password-error" className="form-error" role="alert">{error}</p>}
          <button className="button primary large full" type="submit" disabled={pending}>
            {pending ? "Updating password…" : "Save password and open YOVA"}
            {!pending && <ArrowRight size={18} />}
          </button>
        </form>
      </section>
    </main>
  );
}
