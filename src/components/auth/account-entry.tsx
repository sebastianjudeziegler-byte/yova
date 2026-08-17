"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { TurnstileChallenge } from "@/components/auth/turnstile-challenge";
import {
  createPasswordAccount,
  getAuthMode,
  requestEmailAuthentication,
  requestPasswordResetEmail,
  resendPasswordAccountVerification,
  signInWithPasswordAuthentication,
  verifyEmailAuthenticationCode,
} from "@/lib/auth/client";
import { verifyEmailCodeThenRestoreAccount } from "@/lib/auth/post-verification";
import {
  AUTH_EMAIL_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validateAuthEmail,
  validateDisplayName,
  validatePassword,
} from "@/lib/auth/password";
import {
  isCompleteEmailVerificationCode,
  normalizeEmailVerificationCode,
} from "@/lib/auth/verification-code";
import { makeId, type PreviewAccount } from "@/lib/domain";

export type AccountMode = "create" | "sign-in";

type AccountView =
  | "credentials"
  | "email-fallback"
  | "email-sent"
  | "signup-verification"
  | "forgot-password"
  | "reset-email-sent";

type FieldErrors = Partial<Record<"displayName" | "email" | "password", string>>;

const RESEND_COOLDOWN_SECONDS = 30;

export function AccountEntry({
  mode,
  existingAccount,
  emailCodeVerificationEnabled,
  inviteOnly,
  passwordAccountsEnabled,
  turnstileSiteKey,
  browserPreviewMode,
  onBack,
  onContinue,
  onModeChange,
}: {
  mode: AccountMode;
  existingAccount: PreviewAccount | null;
  emailCodeVerificationEnabled: boolean;
  inviteOnly: boolean;
  passwordAccountsEnabled: boolean;
  turnstileSiteKey: string | null;
  browserPreviewMode: boolean;
  onBack: () => void;
  onContinue: (account: PreviewAccount) => void;
  onModeChange: (mode: AccountMode) => void;
}) {
  const [displayName, setDisplayName] = useState(existingAccount?.displayName ?? "");
  const [email, setEmail] = useState(existingAccount?.email ?? "");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [codeError, setCodeError] = useState("");
  const [pending, setPending] = useState(false);
  const [view, setView] = useState<AccountView>("credentials");
  const [verificationCode, setVerificationCode] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [challengeResetNonce, setChallengeResetNonce] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [resendNotice, setResendNotice] = useState("");
  const isCreate = mode === "create";
  const authMode = browserPreviewMode ? "preview" : getAuthMode();
  const publicPasswordMode = passwordAccountsEnabled && authMode === "supabase" && !inviteOnly;
  const siteKey = turnstileSiteKey?.trim() || null;
  const publicAuthReady = !publicPasswordMode || Boolean(siteKey);
  const emailCaptchaRequired = authMode === "supabase" && Boolean(siteKey);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timeout = window.setTimeout(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1_000);
    return () => window.clearTimeout(timeout);
  }, [resendSeconds]);

  const normalizedEmail = () => email.trim().toLowerCase();
  const clearFormIssue = (field?: keyof FieldErrors) => {
    setError("");
    setResendNotice("");
    if (field) {
      setFieldErrors((current) => ({ ...current, [field]: undefined }));
    }
  };
  const resetChallenge = () => {
    setCaptchaToken(null);
    setChallengeResetNonce((nonce) => nonce + 1);
  };
  const validateIdentityFields = ({ needsName, needsPassword }: { needsName: boolean; needsPassword: boolean }) => {
    const nextErrors: FieldErrors = {};
    const displayNameIssue = needsName ? validateDisplayName(displayName) : null;
    const emailIssue = validateAuthEmail(email);
    const passwordIssue = needsPassword
      ? isCreate
        ? validatePassword(password)
        : password
          ? null
          : "Enter your password."
      : null;
    if (displayNameIssue) nextErrors.displayName = displayNameIssue;
    if (emailIssue) nextErrors.email = emailIssue;
    if (passwordIssue) nextErrors.password = passwordIssue;
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!publicAuthReady) return;
    if (!validateIdentityFields({ needsName: isCreate, needsPassword: true })) return;
    if (isCreate && !termsAccepted) {
      setError("Confirm the age and terms statement to create your account.");
      return;
    }
    if (!captchaToken) {
      setError("Complete the security check to continue.");
      return;
    }

    setPending(true);
    setError("");
    try {
      if (isCreate) {
        const result = await createPasswordAccount({
          email: normalizedEmail(),
          password,
          displayName: displayName.trim(),
          captchaToken,
          termsAccepted: true,
        });
        if (result.verificationRequired) {
          setView("signup-verification");
          setResendSeconds(RESEND_COOLDOWN_SECONDS);
          return;
        }
        onContinue(result.account);
        return;
      }

      await signInWithPasswordAuthentication(normalizedEmail(), password, captchaToken);
      window.location.replace("/");
    } catch (authenticationError) {
      setError(authenticationError instanceof Error
        ? authenticationError.message
        : "YOVA could not open your account. Try again.");
    } finally {
      setPending(false);
      resetChallenge();
    }
  };

  const submitEmailAuthentication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const emailValue = normalizedEmail();
    const publicEmailFallback = publicPasswordMode && view === "email-fallback";
    if (!validateIdentityFields({ needsName: isCreate && !publicEmailFallback, needsPassword: false })) return;
    if (publicEmailFallback && !siteKey) return;
    if (emailCaptchaRequired && !captchaToken) {
      setError("Complete the security check to continue.");
      return;
    }
    if (authMode === "preview" && !isCreate
      && (!existingAccount || existingAccount.email.trim().toLowerCase() !== emailValue)) {
      setError("No private-alpha account is saved for this email in this browser yet.");
      return;
    }

    setPending(true);
    setError("");
    try {
      if (authMode === "preview") {
        onContinue(existingAccount && !isCreate ? existingAccount : {
          id: makeId("preview_user"),
          email: emailValue,
          displayName: displayName.trim(),
          createdAt: new Date().toISOString(),
          identityMode: "preview",
        });
        return;
      }

      const result = await requestEmailAuthentication({
        email: emailValue,
        displayName: displayName.trim(),
        shouldCreateUser: isCreate && !inviteOnly && !publicEmailFallback,
        captchaToken: emailCaptchaRequired ? captchaToken ?? undefined : undefined,
      });
      if (result.mode !== "supabase") throw new Error("YOVA could not start secure sign-in.");
      setView("email-sent");
      setResendSeconds(RESEND_COOLDOWN_SECONDS);
    } catch (authenticationError) {
      setError(authenticationError instanceof Error
        ? authenticationError.message
        : "YOVA could not start sign-in. Try again.");
    } finally {
      setPending(false);
      if (emailCaptchaRequired) resetChallenge();
    }
  };

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setCodeError("");
    try {
      await verifyEmailCodeThenRestoreAccount(
        () => verifyEmailAuthenticationCode(email, verificationCode),
      );
    } catch (authenticationError) {
      setCodeError(authenticationError instanceof Error
        ? authenticationError.message
        : "YOVA could not verify that code. Try again.");
    } finally {
      setPending(false);
    }
  };

  const requestPasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!publicAuthReady) return;
    if (!validateIdentityFields({ needsName: false, needsPassword: false })) return;
    if (!captchaToken) {
      setError("Complete the security check to continue.");
      return;
    }

    setPending(true);
    setError("");
    setCodeError("");
    try {
      await requestPasswordResetEmail(normalizedEmail(), captchaToken);
      setView("reset-email-sent");
    } catch (authenticationError) {
      setError(authenticationError instanceof Error
        ? authenticationError.message
        : "YOVA could not start password reset. Check your connection and try again.");
    } finally {
      setPending(false);
      resetChallenge();
    }
  };

  const resendEmail = async (kind: "signup" | "email") => {
    if (resendSeconds > 0 || pending) return;
    const captchaRequired = Boolean(siteKey);
    if (captchaRequired && !captchaToken) {
      setError("Complete the security check before requesting another email.");
      return;
    }

    setPending(true);
    setError("");
    setResendNotice("");
    try {
      if (kind === "signup") {
        await resendPasswordAccountVerification(normalizedEmail(), captchaToken ?? undefined);
      } else {
        await requestEmailAuthentication({
          email: normalizedEmail(),
          displayName: displayName.trim(),
          shouldCreateUser: isCreate && !inviteOnly && !publicPasswordMode,
          captchaToken: captchaRequired ? captchaToken ?? undefined : undefined,
        });
      }
      setResendSeconds(RESEND_COOLDOWN_SECONDS);
      setResendNotice("A new email is on its way. Use the newest message from YOVA.");
    } catch (authenticationError) {
      setError(authenticationError instanceof Error
        ? authenticationError.message
        : "YOVA could not send another email. Try again.");
    } finally {
      setPending(false);
      if (captchaRequired) resetChallenge();
    }
  };

  const switchView = (nextView: AccountView) => {
    setView(nextView);
    setError("");
    setCodeError("");
    setFieldErrors({});
    setVerificationCode("");
    setResendNotice("");
    resetChallenge();
  };

  const renderSecurityCheck = () => siteKey
    ? <TurnstileChallenge siteKey={siteKey} resetNonce={challengeResetNonce} onTokenChange={setCaptchaToken} />
    : null;

  if (view === "signup-verification") {
    return (
      <AccountShell onBack={onBack}>
        <section className="account-card email-sent">
          <div className="mail-check"><Mail size={24} /></div>
          <span className="step-label">VERIFY YOUR EMAIL</span>
          <h1>One quick check, then your YOVA is ready.</h1>
          <p>We sent a verification link to <strong>{normalizedEmail()}</strong>. Open the newest YOVA email to confirm your account.</p>
          <button className="button primary large full" type="button" onClick={() => window.location.reload()}>
            I verified my email <ArrowRight size={18} />
          </button>
          <div className="account-resend">
            <span>Didn&apos;t get it?</span>
            {renderSecurityCheck()}
            {error && <p className="form-error" role="alert">{error}</p>}
            {resendNotice && <p className="form-success" role="status">{resendNotice}</p>}
            <button
              className="button secondary full"
              type="button"
              disabled={pending || resendSeconds > 0 || !captchaToken}
              onClick={() => void resendEmail("signup")}
            >
              {pending ? "Sending…" : resendSeconds > 0 ? `Send again in ${resendSeconds}s` : "Send verification email again"}
            </button>
          </div>
          <button className="button ghost large full" type="button" onClick={() => { setPassword(""); switchView("credentials"); }}>
            Use a different email
          </button>
        </section>
      </AccountShell>
    );
  }

  if (view === "email-sent") {
    return (
      <AccountShell onBack={onBack}>
        <section className="account-card email-sent">
          <div className="mail-check"><Mail size={24} /></div>
          <span className="step-label">CHECK YOUR EMAIL</span>
          <h1>Your secure sign-in email is on its way.</h1>
          <p>We sent it to <strong>{normalizedEmail()}</strong>.</p>
          {emailCodeVerificationEnabled && (
            <form className="email-code-entry" onSubmit={verifyCode}>
              <span className="step-label">EASIEST OPTION</span>
              <p>Enter the 6-digit code from the newest YOVA email.</p>
              <label htmlFor="account-verification-code">
                <span>Verification code</span>
                <input
                  id="account-verification-code"
                  name="verification-code"
                  value={verificationCode}
                  onChange={(event) => { setVerificationCode(normalizeEmailVerificationCode(event.target.value)); setCodeError(""); }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  disabled={pending}
                  required
                  aria-invalid={Boolean(codeError)}
                  aria-describedby={codeError ? "account-code-error" : undefined}
                />
              </label>
              {codeError && <p id="account-code-error" className="form-error" role="alert">{codeError}</p>}
              <button className="button primary large full" type="submit" disabled={pending || !isCompleteEmailVerificationCode(verificationCode)}>
                {pending ? "Verifying…" : "Verify and continue"} {!pending && <ArrowRight size={18} />}
              </button>
            </form>
          )}
          <div className="email-link-option">
            <strong>{emailCodeVerificationEnabled ? "Or use the secure link" : "Open the secure link"}</strong>
            <span>Open the newest email link in the browser where you requested it, then return here.</span>
          </div>
          <button className={emailCodeVerificationEnabled ? "button secondary large full" : "button primary large full"} type="button" onClick={() => window.location.reload()}>
            I opened the link. Check sign-in
          </button>
          <div className="account-resend compact">
            {emailCaptchaRequired && renderSecurityCheck()}
            {error && <p className="form-error" role="alert">{error}</p>}
            {resendNotice && <p className="form-success" role="status">{resendNotice}</p>}
            <button
              className="account-text-action"
              type="button"
              disabled={pending || resendSeconds > 0 || (emailCaptchaRequired && !captchaToken)}
              onClick={() => void resendEmail("email")}
            >
              {pending ? "Sending…" : resendSeconds > 0 ? `Send again in ${resendSeconds}s` : "Send another email"}
            </button>
          </div>
          <button className="button ghost large full" type="button" onClick={() => switchView(publicPasswordMode ? "email-fallback" : "credentials")}>
            Use a different email
          </button>
          <div className="preview-notice">
            <strong>{emailCodeVerificationEnabled ? "The code works across browsers" : "Use the same browser"}</strong>
            <span>{emailCodeVerificationEnabled
              ? "If the link opens somewhere else, enter the email code here instead."
              : "Open the secure link in the browser where you requested it."}</span>
          </div>
        </section>
      </AccountShell>
    );
  }

  if (view === "reset-email-sent") {
    return (
      <AccountShell onBack={onBack}>
        <section className="account-card email-sent">
          <div className="mail-check"><Mail size={24} /></div>
          <span className="step-label">CHECK YOUR EMAIL</span>
          <h1>If that account exists, help is on the way.</h1>
          <p>We sent password reset instructions to <strong>{normalizedEmail()}</strong> if it matches a YOVA account.</p>
          <div className="preview-notice">
            <strong>Why the message is general</strong>
            <span>YOVA does not reveal whether an email address has an account.</span>
          </div>
          <button className="button primary large full" type="button" onClick={() => switchView("credentials")}>
            Back to sign in
          </button>
          <button className="button ghost large full" type="button" onClick={() => { setEmail(""); switchView("forgot-password"); }}>
            Try a different email
          </button>
        </section>
      </AccountShell>
    );
  }

  if (view === "forgot-password") {
    return (
      <AccountShell onBack={() => switchView("credentials")}>
        <section className="account-card">
          <span className="step-label">RESET YOUR PASSWORD</span>
          <h1>Get a secure reset link.</h1>
          <p>Enter your account email. For your privacy, the next screen looks the same whether or not an account exists.</p>
          {!publicAuthReady && <PublicAuthSetupNotice />}
          <form onSubmit={requestPasswordReset} noValidate>
            <EmailField email={email} error={fieldErrors.email} pending={pending} onChange={(value) => { setEmail(value); clearFormIssue("email"); }} />
            {publicAuthReady && renderSecurityCheck()}
            {error && <p className="form-error account-submit-error" role="alert">{error}</p>}
            <button className="button primary large full" type="submit" disabled={pending || !publicAuthReady || !captchaToken}>
              {pending ? "Sending reset link…" : "Send reset link"} {!pending && <ArrowRight size={18} />}
            </button>
          </form>
        </section>
      </AccountShell>
    );
  }

  if (publicPasswordMode && view === "credentials") {
    return (
      <AccountShell onBack={onBack}>
        <section className="account-card">
          <span className="step-label">{isCreate ? "CREATE YOUR ACCOUNT" : "WELCOME BACK"}</span>
          <h1>{isCreate ? "Start building your YOVA." : "Continue your learning."}</h1>
          <p>{isCreate
            ? "Your account keeps your profile, plans, sessions, and progress together."
            : "Sign in with the email and password for your YOVA account."}</p>
          {!publicAuthReady && <PublicAuthSetupNotice />}
          <form onSubmit={submitPassword} noValidate>
            {isCreate && (
              <label htmlFor="account-first-name">
                <span>First name</span>
                <input
                  id="account-first-name"
                  name="first-name"
                  value={displayName}
                  onChange={(event) => { setDisplayName(event.target.value); clearFormIssue("displayName"); }}
                  autoComplete="given-name"
                  maxLength={DISPLAY_NAME_MAX_LENGTH}
                  disabled={pending || !publicAuthReady}
                  required
                  aria-invalid={Boolean(fieldErrors.displayName)}
                  aria-describedby={fieldErrors.displayName ? "account-first-name-error" : undefined}
                />
                {fieldErrors.displayName && <small id="account-first-name-error" className="field-error">{fieldErrors.displayName}</small>}
              </label>
            )}
            <EmailField email={email} error={fieldErrors.email} pending={pending || !publicAuthReady} onChange={(value) => { setEmail(value); clearFormIssue("email"); }} />
            <PasswordField
              password={password}
              visible={passwordVisible}
              error={fieldErrors.password}
              pending={pending || !publicAuthReady}
              mode={mode}
              onChange={(value) => { setPassword(value); clearFormIssue("password"); }}
              onToggle={() => setPasswordVisible((visible) => !visible)}
            />
            {!isCreate && (
              <button className="account-text-action forgot-password-action" type="button" onClick={() => switchView("forgot-password")}>
                Forgot password?
              </button>
            )}
            {isCreate && (
              <div className="account-consent-checkbox">
                <input
                  id="account-age-and-terms"
                  name="age-and-terms"
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                  disabled={pending || !publicAuthReady}
                  required
                  aria-describedby="account-age-and-terms-details"
                />
                <div id="account-age-and-terms-details">
                  <label htmlFor="account-age-and-terms">I’m at least 13, and if I’m under 18 I have parent or guardian permission.</label>{" "}
                  <span>I agree to the <Link href="/terms">Alpha Terms</Link> and acknowledge the <Link href="/privacy">Privacy Notice</Link>.</span>
                </div>
              </div>
            )}
            {publicAuthReady && renderSecurityCheck()}
            {error && <p className="form-error account-submit-error" role="alert">{error}</p>}
            <button className="button primary large full" type="submit" disabled={pending || !publicAuthReady || !captchaToken || (isCreate && !termsAccepted)}>
              {pending ? (isCreate ? "Creating account…" : "Signing in…") : (isCreate ? "Create account" : "Sign in")}
              {!pending && <ArrowRight size={18} />}
            </button>
          </form>
          {!isCreate && (
            <button className="account-alternate-auth" type="button" onClick={() => switchView("email-fallback")}>
              <Mail size={16} /> Use an email code instead
            </button>
          )}
          <AccountModeSwitch mode={mode} inviteOnly={inviteOnly} onModeChange={onModeChange} />
        </section>
      </AccountShell>
    );
  }

  const publicEmailFallback = publicPasswordMode && view === "email-fallback";
  const signInDescription = inviteOnly
    ? emailCodeVerificationEnabled
      ? "Enter the email that received your private-alpha invitation. YOVA will send a secure code and sign-in link."
      : "Enter the email that received your private-alpha invitation. YOVA will send a secure sign-in link."
    : publicEmailFallback
      ? "Use this option if your account was created with an invitation or you normally sign in from an email."
      : emailCodeVerificationEnabled
        ? "Enter your email and YOVA will send you a secure code and sign-in link."
        : "Enter your email and YOVA will send you a secure sign-in link.";
  const submitLabel = isCreate
    ? "Continue"
    : emailCodeVerificationEnabled
      ? "Send sign-in code"
      : "Send secure link";

  return (
    <AccountShell onBack={publicEmailFallback ? () => switchView("credentials") : onBack}>
      <section className="account-card">
        <span className="step-label">{isCreate ? "CREATE YOUR ACCOUNT" : inviteOnly ? "PRIVATE ALPHA ACCESS" : publicEmailFallback ? "EMAIL CODE SIGN-IN" : "WELCOME BACK"}</span>
        <h1>{isCreate ? "Start building your YOVA." : inviteOnly ? "Open your YOVA invitation." : publicEmailFallback ? "Sign in from your email." : "Continue your learning."}</h1>
        <p>{isCreate
          ? "Your account keeps your profile, plans, sessions, and progress together."
          : authMode === "supabase"
            ? signInDescription
            : "Use the email attached to this browser’s private-alpha account."}</p>
        {!publicAuthReady && publicEmailFallback && <PublicAuthSetupNotice />}
        <form onSubmit={submitEmailAuthentication} noValidate>
          {isCreate && !publicEmailFallback && (
            <label htmlFor="account-first-name">
              <span>First name</span>
              <input
                id="account-first-name"
                name="first-name"
                value={displayName}
                onChange={(event) => { setDisplayName(event.target.value); clearFormIssue("displayName"); }}
                autoComplete="given-name"
                maxLength={DISPLAY_NAME_MAX_LENGTH}
                disabled={pending}
                required
                aria-invalid={Boolean(fieldErrors.displayName)}
                aria-describedby={fieldErrors.displayName ? "account-first-name-error" : undefined}
              />
              {fieldErrors.displayName && <small id="account-first-name-error" className="field-error">{fieldErrors.displayName}</small>}
            </label>
          )}
          <EmailField email={email} error={fieldErrors.email} pending={pending || (!publicAuthReady && publicEmailFallback)} onChange={(value) => { setEmail(value); clearFormIssue("email"); }} />
          {emailCaptchaRequired && publicAuthReady && renderSecurityCheck()}
          {error && <p className="form-error account-submit-error" role="alert">{error}</p>}
          <button className="button primary large full" type="submit" disabled={pending || (!publicAuthReady && publicEmailFallback) || (emailCaptchaRequired && !captchaToken)}>
            {pending ? "Sending secure email…" : submitLabel} {!pending && <ArrowRight size={18} />}
          </button>
        </form>
        {isCreate && <AccountConsent />}
        {inviteOnly && <p className="account-consent">YOVA’s private alpha is for testers age 13 or older. Testers under 18 should have a parent or guardian’s permission.</p>}
        {publicEmailFallback && (
          <button className="account-alternate-auth" type="button" onClick={() => switchView("credentials")}>
            <LockKeyhole size={16} /> Use my password instead
          </button>
        )}
        {!publicEmailFallback && <AccountModeSwitch mode={mode} inviteOnly={inviteOnly} onModeChange={onModeChange} />}
        <div className="preview-notice">
          <strong>{authMode === "supabase" ? inviteOnly ? "Invitation-only access" : publicEmailFallback ? "Passwordless fallback" : "Secure cloud account" : "Private-alpha storage"}</strong>
          <span>{authMode === "supabase"
            ? inviteOnly
              ? "Only founder-approved tester emails can open a new YOVA account. No password is required."
              : publicEmailFallback
                ? "Use this for a YOVA account created from an invitation or a previous email sign-in link."
                : emailCodeVerificationEnabled
                  ? "YOVA verifies a temporary email code or link instead of storing a password."
                  : "YOVA uses a temporary email link instead of storing a password."
            : "For now, this browser remembers the prototype. Real email verification activates when the cloud project is connected."}</span>
        </div>
      </section>
    </AccountShell>
  );
}

function AccountShell({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <main className="account-shell">
      <header>
        <BrandMark />
        <button className="button ghost" type="button" onClick={onBack}><ArrowLeft size={17} /> Back</button>
      </header>
      {children}
    </main>
  );
}

function EmailField({
  email,
  error,
  pending,
  onChange,
}: {
  email: string;
  error?: string;
  pending: boolean;
  onChange: (email: string) => void;
}) {
  return (
    <label htmlFor="account-email">
      <span>Email address</span>
      <div className="input-with-icon">
        <Mail size={18} aria-hidden="true" />
        <input
          id="account-email"
          name="email"
          type="email"
          value={email}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={AUTH_EMAIL_MAX_LENGTH}
          disabled={pending}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "account-email-error" : undefined}
        />
      </div>
      {error && <small id="account-email-error" className="field-error">{error}</small>}
    </label>
  );
}

function PasswordField({
  password,
  visible,
  error,
  pending,
  mode,
  onChange,
  onToggle,
}: {
  password: string;
  visible: boolean;
  error?: string;
  pending: boolean;
  mode: AccountMode;
  onChange: (password: string) => void;
  onToggle: () => void;
}) {
  return (
    <div className="account-field">
      <label htmlFor="account-password">Password</label>
      <div className="password-input">
        <LockKeyhole size={18} aria-hidden="true" />
        <input
          id="account-password"
          name="password"
          type={visible ? "text" : "password"}
          value={password}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={mode === "create" ? "new-password" : "current-password"}
          minLength={mode === "create" ? PASSWORD_MIN_LENGTH : 1}
          maxLength={mode === "create" ? 72 : undefined}
          disabled={pending}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "account-password-error" : mode === "create" ? "account-password-hint" : undefined}
        />
        <button type="button" onClick={onToggle} disabled={pending} aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}>
          {visible ? <><EyeOff size={17} aria-hidden="true" /> Hide</> : <><Eye size={17} aria-hidden="true" /> Show</>}
        </button>
      </div>
      {mode === "create" && !error && <small id="account-password-hint" className="field-hint">Use at least {PASSWORD_MIN_LENGTH} characters.</small>}
      {error && <small id="account-password-error" className="field-error">{error}</small>}
    </div>
  );
}

function PublicAuthSetupNotice() {
  return (
    <div className="public-auth-setup-notice" role="alert">
      <LockKeyhole size={19} aria-hidden="true" />
      <div>
        <strong>Public accounts are finishing security setup.</strong>
        <span>Password sign-up, sign-in, and reset are temporarily unavailable. Your information has not been submitted. Try again later.</span>
      </div>
    </div>
  );
}

function AccountModeSwitch({
  mode,
  inviteOnly,
  onModeChange,
}: {
  mode: AccountMode;
  inviteOnly: boolean;
  onModeChange: (mode: AccountMode) => void;
}) {
  if (inviteOnly) return null;
  return (
    <p className="account-mode-switch">
      {mode === "create" ? "Already have an account?" : "New to YOVA?"}{" "}
      <button type="button" onClick={() => onModeChange(mode === "create" ? "sign-in" : "create")}>
        {mode === "create" ? "Sign in" : "Create an account"}
      </button>
    </p>
  );
}

function AccountConsent() {
  return (
    <p className="account-consent">
      By creating an account, you agree to the <Link href="/terms">Terms</Link> and acknowledge the <Link href="/privacy">Privacy Notice</Link>. YOVA is for people age 13 or older; users under 18 should have a parent or guardian’s permission.
    </p>
  );
}
