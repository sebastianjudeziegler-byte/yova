"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Download,
  FileJson,
  KeyRound,
  LogOut,
  Pencil,
  ShieldCheck,
} from "lucide-react";
import { TurnstileChallenge } from "@/components/auth/turnstile-challenge";
import {
  AccountDataExportError,
  requestAccountDataExportVerification,
  verifyAccountDataExportCode,
  type AccountDataExportReady,
} from "@/lib/account-export/client";
import {
  DISPLAY_NAME_MAX_LENGTH,
  normalizeDisplayName,
  validateDisplayName,
} from "@/lib/auth/password";
import {
  isCompleteEmailVerificationCode,
  normalizeEmailVerificationCode,
} from "@/lib/auth/verification-code";
import type { PreviewAccount } from "@/lib/domain";
import styles from "./account-security-card.module.css";

export type AccountDataExportUiState =
  | { status: "closed" }
  | { status: "confirm" }
  | { status: "reauth"; issue: string | null }
  | { status: "sending-code" }
  | { status: "code"; issue: string | null }
  | { status: "verifying" }
  | { status: "preparing" }
  | { status: "ready"; value: AccountDataExportReady }
  | { status: "expired" }
  | {
      status: "failure";
      code: Exclude<AccountDataExportError["code"], "reauth_required">;
      issue: string;
    };

const CLOSED_EXPORT_STATE: AccountDataExportUiState = { status: "closed" };

export function AccountSecurityCard({
  account,
  passwordAccountsEnabled,
  signingOut,
  turnstileSiteKey = null,
  onPrepareDataExport,
  onDisplayNameChange,
  onSignOut,
}: {
  account: PreviewAccount;
  passwordAccountsEnabled: boolean;
  signingOut: boolean;
  turnstileSiteKey?: string | null;
  onPrepareDataExport?: (signal: AbortSignal) => Promise<AccountDataExportReady>;
  onDisplayNameChange: (displayName: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(account.displayName);
  const [savingName, setSavingName] = useState(false);
  const [nameIssue, setNameIssue] = useState<string | null>(null);
  const [nameNotice, setNameNotice] = useState<string | null>(null);
  const [exportState, setExportState] = useState<AccountDataExportUiState>(CLOSED_EXPORT_STATE);
  const [exportAccountId, setExportAccountId] = useState(account.id);
  const [verificationCode, setVerificationCode] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [challengeResetNonce, setChallengeResetNonce] = useState(0);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const exportDialogRef = useRef<HTMLDialogElement>(null);
  const exportControllerRef = useRef<AbortController | null>(null);
  const accountIdRef = useRef(account.id);
  const cloudAccount = account.identityMode === "supabase";
  const renderedExportState = exportAccountId === account.id && !signingOut
    ? exportState
    : CLOSED_EXPORT_STATE;
  const exportPending = renderedExportState.status === "sending-code"
    || renderedExportState.status === "verifying"
    || renderedExportState.status === "preparing";
  const accountBusy = savingName || signingOut || exportPending;
  const siteKey = turnstileSiteKey?.trim() || null;
  const exportAvailable = cloudAccount
    && account.emailVerified === true
    && Boolean(onPrepareDataExport);

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  const resetExportFlow = useCallback((restoreFocus: boolean) => {
    exportControllerRef.current?.abort();
    exportControllerRef.current = null;
    setExportState(CLOSED_EXPORT_STATE);
    setVerificationCode("");
    setCaptchaToken(null);
    setChallengeResetNonce((nonce) => nonce + 1);
    if (restoreFocus && typeof window !== "undefined") {
      window.requestAnimationFrame(() => exportTriggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (accountIdRef.current === account.id) return;
    const previousAccountId = accountIdRef.current;
    accountIdRef.current = account.id;
    exportControllerRef.current?.abort();
    exportControllerRef.current = null;
    let cancelled = false;
    window.queueMicrotask(() => {
      if (cancelled) return;
      setExportAccountId(account.id);
      setExportState((current) => accountDataExportStateAfterAccountChange(
        previousAccountId,
        account.id,
        current,
      ));
      setVerificationCode("");
      setCaptchaToken(null);
      setChallengeResetNonce((nonce) => nonce + 1);
    });
    return () => { cancelled = true; };
  }, [account.id]);

  useEffect(() => {
    if (!signingOut) return;
    exportControllerRef.current?.abort();
    let cancelled = false;
    window.queueMicrotask(() => {
      if (!cancelled) resetExportFlow(false);
    });
    return () => { cancelled = true; };
  }, [resetExportFlow, signingOut]);

  useEffect(() => () => {
    exportControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (exportState.status === "closed") return;
    const dialog = exportDialogRef.current;
    if (!dialog) return;

    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    }

    const frame = window.requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>("[data-export-initial-focus]")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [exportState.status]);

  useEffect(() => {
    if (exportState.status !== "ready") return;
    const expiresAt = Date.parse(exportState.value.expiresAt);
    const remaining = Number.isFinite(expiresAt) ? Math.max(0, expiresAt - Date.now()) : 0;

    const timeout = window.setTimeout(
      () => setExportState({ status: "expired" }),
      Math.min(remaining, 2_147_483_647),
    );
    return () => window.clearTimeout(timeout);
  }, [exportState]);

  const beginNameEdit = () => {
    setDraftName(account.displayName);
    setNameIssue(null);
    setNameNotice(null);
    setEditingName(true);
  };

  const cancelNameEdit = () => {
    setDraftName(account.displayName);
    setNameIssue(null);
    setEditingName(false);
  };

  const saveName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (accountBusy) return;

    const issue = validateDisplayName(draftName);
    if (issue) {
      setNameIssue(issue);
      nameInputRef.current?.focus();
      return;
    }

    const displayName = normalizeDisplayName(draftName);
    setSavingName(true);
    setNameIssue(null);
    setNameNotice(null);
    try {
      await onDisplayNameChange(displayName);
      setDraftName(displayName);
      setEditingName(false);
      setNameNotice("First name saved.");
    } catch (error) {
      setNameIssue(error instanceof Error
        ? error.message
        : "YOVA could not save your first name. Check your connection and try again.");
      nameInputRef.current?.focus();
    } finally {
      setSavingName(false);
    }
  };

  const nextExportController = () => {
    exportControllerRef.current?.abort();
    const controller = new AbortController();
    exportControllerRef.current = controller;
    return controller;
  };

  const exportOperationIsCurrent = (controller: AbortController, expectedAccountId: string) => (
    !controller.signal.aborted
    && exportControllerRef.current === controller
    && accountIdRef.current === expectedAccountId
  );

  const prepareExport = async (verifiedWithCode = false) => {
    if (!onPrepareDataExport || !exportAvailable) return;
    const expectedAccountId = account.id;
    const controller = nextExportController();
    setExportState({ status: "preparing" });

    try {
      const ready = await onPrepareDataExport(controller.signal);
      if (!exportOperationIsCurrent(controller, expectedAccountId)) return;
      setExportState(Date.parse(ready.expiresAt) > Date.now()
        ? { status: "ready", value: ready }
        : { status: "expired" });
    } catch (error) {
      if (!exportOperationIsCurrent(controller, expectedAccountId) || isAbortError(error)) return;
      if (error instanceof AccountDataExportError && error.code === "reauth_required") {
        setExportState({
          status: "reauth",
          issue: verifiedWithCode
            ? "YOVA could not confirm the recent verification yet. Send a new code and try again."
            : null,
        });
        return;
      }

      setExportState(exportFailureState(error));
    } finally {
      if (exportControllerRef.current === controller) exportControllerRef.current = null;
    }
  };

  const requestVerificationCode = async () => {
    if (siteKey && !captchaToken) {
      setExportState({ status: "reauth", issue: "Complete the security check to send a code." });
      return;
    }

    const expectedAccountId = account.id;
    const controller = nextExportController();
    setExportState({ status: "sending-code" });
    try {
      await requestAccountDataExportVerification(
        account.email,
        captchaToken ?? undefined,
        { signal: controller.signal },
      );
      if (!exportOperationIsCurrent(controller, expectedAccountId)) return;
      setVerificationCode("");
      setExportState({ status: "code", issue: null });
    } catch (error) {
      if (!exportOperationIsCurrent(controller, expectedAccountId) || isAbortError(error)) return;
      setExportState({
        status: "reauth",
        issue: "YOVA could not send a verification code right now. Wait a moment and try again.",
      });
    } finally {
      if (exportControllerRef.current === controller) exportControllerRef.current = null;
      setCaptchaToken(null);
      setChallengeResetNonce((nonce) => nonce + 1);
    }
  };

  const verifyCodeAndPrepare = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = normalizeEmailVerificationCode(verificationCode);
    if (!isCompleteEmailVerificationCode(code)) {
      setVerificationCode(code);
      setExportState({
        status: "code",
        issue: "Enter the complete 6-digit code from the newest YOVA email.",
      });
      return;
    }

    const expectedAccountId = account.id;
    const controller = nextExportController();
    setExportState({ status: "verifying" });
    try {
      await verifyAccountDataExportCode(
        expectedAccountId,
        account.email,
        code,
        { signal: controller.signal },
      );
      if (!exportOperationIsCurrent(controller, expectedAccountId)) return;
      await prepareExport(true);
    } catch (error) {
      if (!exportOperationIsCurrent(controller, expectedAccountId) || isAbortError(error)) return;
      setExportState({
        status: "code",
        issue: error instanceof AccountDataExportError && error.code === "failed"
          ? "That verification did not match this account. Request a new code and try again."
          : "That code is incorrect or expired. Check the newest YOVA email and try again.",
      });
    } finally {
      if (exportControllerRef.current === controller) exportControllerRef.current = null;
    }
  };

  const openExportDialog = () => {
    if (!exportAvailable || accountBusy) return;
    setVerificationCode("");
    setCaptchaToken(null);
    setExportState({ status: "confirm" });
  };

  const showNewCodeChallenge = () => {
    setVerificationCode("");
    setCaptchaToken(null);
    setChallengeResetNonce((nonce) => nonce + 1);
    setExportState({ status: "reauth", issue: null });
  };

  const handleReadyDownload = (event: MouseEvent<HTMLAnchorElement>) => {
    if (exportState.status !== "ready") return;
    if (Date.parse(exportState.value.expiresAt) > Date.now()) return;
    event.preventDefault();
    setExportState({ status: "expired" });
  };

  const emailStatus = cloudAccount
    ? account.emailVerified === true
      ? { label: "Email verified", className: styles.verified }
      : account.emailVerified === false
        ? { label: "Email not verified", className: styles.unverified }
        : { label: "Verification unavailable", className: styles.neutral }
    : { label: "Browser preview", className: styles.neutral };

  return (
    <section className={`section-block ${styles.card}`} aria-labelledby="account-security-title">
      <header className={styles.header}>
        <div>
          <span>ACCOUNT &amp; SECURITY</span>
          <h3 id="account-security-title">Your YOVA account</h3>
          <p>Review your identity, security, and data controls.</p>
        </div>
      </header>

      <dl className={styles.details}>
        <div className={styles.row}>
          <dt>Email</dt>
          <dd>
            <strong className={styles.email}>{account.email}</strong>
            <span className={`${styles.status} ${emailStatus.className}`}>
              <BadgeCheck size={15} aria-hidden="true" />
              {emailStatus.label}
            </span>
          </dd>
        </div>

        <div className={styles.row}>
          <dt>First name</dt>
          <dd>
            {editingName ? (
              <form className={styles.nameForm} onSubmit={(event) => void saveName(event)} noValidate>
                <label htmlFor="account-security-first-name">First name</label>
                <input
                  ref={nameInputRef}
                  id="account-security-first-name"
                  name="first-name"
                  value={draftName}
                  onChange={(event) => {
                    setDraftName(event.target.value);
                    setNameIssue(null);
                    setNameNotice(null);
                  }}
                  autoComplete="given-name"
                  maxLength={DISPLAY_NAME_MAX_LENGTH}
                  disabled={accountBusy}
                  required
                  aria-invalid={Boolean(nameIssue)}
                  aria-describedby={nameIssue ? "account-security-name-hint account-security-name-error" : "account-security-name-hint"}
                />
                <small id="account-security-name-hint">This is the name YOVA uses in your account and greetings.</small>
                {nameIssue && <p id="account-security-name-error" className={styles.error} role="alert">{nameIssue}</p>}
                <div className={styles.formActions}>
                  <button className="button ghost" type="button" disabled={accountBusy} onClick={cancelNameEdit}>Cancel</button>
                  <button className="button primary" type="submit" disabled={accountBusy}>
                    {savingName ? "Saving…" : "Save first name"}
                  </button>
                </div>
              </form>
            ) : (
              <div className={styles.valueAction}>
                <strong>{account.displayName}</strong>
                <button type="button" disabled={accountBusy} onClick={beginNameEdit}>
                  <Pencil size={15} aria-hidden="true" /> Edit first name
                </button>
              </div>
            )}
            {nameNotice && <p className={styles.success} role="status">{nameNotice}</p>}
          </dd>
        </div>

        <div className={styles.row}>
          <dt>Password</dt>
          <dd className={styles.passwordRow}>
            <div>
              <KeyRound size={18} aria-hidden="true" />
              <span>{cloudAccount
                ? passwordAccountsEnabled
                  ? account.emailVerified === true
                    ? "Choose a password or replace the one you use now."
                    : "Verify your email before setting or changing a password."
                  : "Password management is not available for this account right now."
                : "Password settings are available with a cloud account."}</span>
            </div>
            {cloudAccount && passwordAccountsEnabled && account.emailVerified === true && (
              <Link className={styles.securityLink} href="/auth/set-password?source=account">
                Set or change password
              </Link>
            )}
          </dd>
        </div>

        {(exportAvailable || !cloudAccount || account.emailVerified !== true) && (
          <div className={styles.row}>
            <dt>Your data</dt>
            <dd className={styles.dataRow}>
              <div className={styles.dataDescription}>
                <span className={styles.dataIcon} aria-hidden="true"><FileJson size={18} /></span>
                <div>
                  <strong>{!cloudAccount ? "Browser preview data" : "Portable YOVA data"}</strong>
                  <p>{!cloudAccount
                    ? "This browser preview does not create a cloud account archive. Its learning data is stored only in this browser; use the reset control below to remove it."
                    : account.emailVerified !== true
                      ? "Verify your email before downloading private account and learning data."
                      : "Download a portable copy of the account, learning, tutor, and material data YOVA has saved for you."}</p>
                  {exportAvailable && <small>JSON · generated when you request it · may contain private study information</small>}
                </div>
              </div>
              {exportAvailable && (
                <button
                  ref={exportTriggerRef}
                  className={styles.dataButton}
                  type="button"
                  disabled={accountBusy}
                  onClick={openExportDialog}
                >
                  <Download size={16} aria-hidden="true" />
                  Download my YOVA data
                </button>
              )}
            </dd>
          </div>
        )}
      </dl>

      <footer className={styles.footer}>
        <div>
          <strong>Using a shared device?</strong>
          <span>Sign out here without signing out your other devices.</span>
        </div>
        <button className="button secondary" type="button" disabled={accountBusy} onClick={() => void onSignOut()}>
          <LogOut size={16} aria-hidden="true" />
          {signingOut ? "Signing out…" : "Sign out on this device"}
        </button>
      </footer>

      {renderedExportState.status !== "closed" && (
        <AccountDataExportDialog
          account={account}
          state={renderedExportState}
          dialogRef={exportDialogRef}
          verificationCode={verificationCode}
          turnstileSiteKey={siteKey}
          captchaToken={captchaToken}
          challengeResetNonce={challengeResetNonce}
          onCaptchaTokenChange={setCaptchaToken}
          onVerificationCodeChange={(value) => {
            setVerificationCode(normalizeEmailVerificationCode(value));
            if (exportState.status === "code" && exportState.issue) {
              setExportState({ status: "code", issue: null });
            }
          }}
          onCancel={() => resetExportFlow(true)}
          onPrepare={() => void prepareExport()}
          onRequestCode={() => void requestVerificationCode()}
          onVerifyCode={(event) => void verifyCodeAndPrepare(event)}
          onRequestNewCode={showNewCodeChallenge}
          onDownload={handleReadyDownload}
        />
      )}
    </section>
  );
}

export function AccountDataExportDialog({
  account,
  state,
  dialogRef,
  verificationCode,
  turnstileSiteKey,
  captchaToken,
  challengeResetNonce,
  onCaptchaTokenChange,
  onVerificationCodeChange,
  onCancel,
  onPrepare,
  onRequestCode,
  onVerifyCode,
  onRequestNewCode,
  onDownload,
}: {
  account: PreviewAccount;
  state: Exclude<AccountDataExportUiState, { status: "closed" }>;
  dialogRef?: RefObject<HTMLDialogElement | null>;
  verificationCode: string;
  turnstileSiteKey: string | null;
  captchaToken: string | null;
  challengeResetNonce: number;
  onCaptchaTokenChange: (token: string | null) => void;
  onVerificationCodeChange: (value: string) => void;
  onCancel: () => void;
  onPrepare: () => void;
  onRequestCode: () => void;
  onVerifyCode: (event: FormEvent<HTMLFormElement>) => void;
  onRequestNewCode: () => void;
  onDownload: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const pending = state.status === "sending-code"
    || state.status === "verifying"
    || state.status === "preparing";
  const closeOnBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget && !pending) onCancel();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.exportDialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-data-export-title"
      aria-describedby="account-data-export-description"
      aria-busy={pending || undefined}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={closeOnBackdrop}
    >
      <div className={styles.dialogContent}>
        {state.status === "confirm" && (
          <>
            <DialogHeading icon={<ShieldCheck size={22} />} eyebrow="PRIVATE DATA" title="Download a copy of your YOVA data?" />
            <div id="account-data-export-description" className={styles.dialogBody}>
              <div className={styles.privateWarning}>
                <AlertTriangle size={18} aria-hidden="true" />
                <p>This file may include private goals, tutor messages, study results, and text extracted from your uploads. Save it only on a device you trust.</p>
              </div>
              <p>It includes file names, extracted text, and sanitized service-usage counters, not the original uploaded files. It does not include your password, sign-in tokens, provider logs, or private security records.</p>
              <p>Work still waiting to sync from another device may not appear. Downloading does not delete or change anything in YOVA.</p>
              <Link href="/support">For a broader privacy request, contact YOVA Support.</Link>
            </div>
            <div className={styles.dialogActions}>
              <button className="button ghost" type="button" data-export-initial-focus onClick={onCancel}>Cancel</button>
              <button className="button primary" type="button" onClick={onPrepare}>
                <Download size={16} aria-hidden="true" /> Download JSON
              </button>
            </div>
          </>
        )}

        {state.status === "reauth" && (
          <>
            <DialogHeading icon={<ShieldCheck size={22} />} eyebrow="VERIFY IT’S YOU" title="Verify before downloading private data." />
            <div id="account-data-export-description" className={styles.dialogBody}>
              <p>YOVA needs a recent sign-in before preparing this file. Send a 6-digit code to <strong>{account.email}</strong>.</p>
              {turnstileSiteKey && (
                <TurnstileChallenge
                  siteKey={turnstileSiteKey}
                  resetNonce={challengeResetNonce}
                  onTokenChange={onCaptchaTokenChange}
                />
              )}
              {state.issue && <p className={styles.dialogError} role="alert">{state.issue}</p>}
            </div>
            <div className={styles.dialogActions}>
              <button className="button ghost" type="button" data-export-initial-focus onClick={onCancel}>Cancel</button>
              <button
                className="button primary"
                type="button"
                disabled={Boolean(turnstileSiteKey) && !captchaToken}
                onClick={onRequestCode}
              >
                Send verification code
              </button>
            </div>
          </>
        )}

        {state.status === "code" && (
          <form onSubmit={onVerifyCode} noValidate>
            <DialogHeading icon={<ShieldCheck size={22} />} eyebrow="CHECK YOUR EMAIL" title="Enter the 6-digit code." />
            <div id="account-data-export-description" className={styles.dialogBody}>
              <p>Use the code from the newest YOVA email sent to <strong>{account.email}</strong>.</p>
              <label className={styles.codeField} htmlFor="account-data-export-code">
                <span>Verification code</span>
                <input
                  id="account-data-export-code"
                  name="verification-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={verificationCode}
                  data-export-initial-focus
                  aria-invalid={Boolean(state.issue)}
                  aria-describedby={state.issue ? "account-data-export-code-hint account-data-export-code-error" : "account-data-export-code-hint"}
                  onChange={(event) => onVerificationCodeChange(event.target.value)}
                />
                <small id="account-data-export-code-hint">Codes use 6 numbers and expire. YOVA will never ask you to share this code.</small>
              </label>
              {state.issue && <p id="account-data-export-code-error" className={styles.dialogError} role="alert">{state.issue}</p>}
            </div>
            <div className={styles.dialogActions}>
              <button className="button ghost" type="button" onClick={onCancel}>Cancel</button>
              <button className="button secondary" type="button" onClick={onRequestNewCode}>Send a new code</button>
              <button className="button primary" type="submit">Verify and download</button>
            </div>
          </form>
        )}

        {state.status === "sending-code" && (
          <PendingExportState
            eyebrow="VERIFY IT’S YOU"
            title="Sending a verification code…"
            description="YOVA is securely requesting a code for your current email."
            onCancel={onCancel}
          />
        )}

        {state.status === "verifying" && (
          <PendingExportState
            eyebrow="VERIFY IT’S YOU"
            title="Verifying your code…"
            description="YOVA is confirming this recent sign-in before preparing private data."
            onCancel={onCancel}
          />
        )}

        {state.status === "preparing" && (
          <PendingExportState
            eyebrow="PREPARING YOUR DATA"
            title="Preparing your download…"
            description="YOVA is creating a private JSON file and a short-lived download link. Keep this window open for a moment."
            onCancel={onCancel}
          />
        )}

        {state.status === "ready" && (
          <>
            <DialogHeading icon={<CheckCircle2 size={22} />} eyebrow="READY" title="Your private download is ready." success />
            <div id="account-data-export-description" className={styles.dialogBody}>
              <p>The link expires <time dateTime={state.value.expiresAt}>{formatExportExpiry(state.value.expiresAt)}</time>. Nothing in YOVA was deleted or changed.</p>
              <div className={styles.fileSummary}>
                <FileJson size={18} aria-hidden="true" />
                <span>{state.value.filename}</span>
              </div>
              <p className={styles.readyWarning}>The downloaded file may contain private study information. Keep it on a device you trust.</p>
            </div>
            <div className={styles.dialogActions}>
              <button className="button ghost" type="button" onClick={onCancel}>Close</button>
              <a
                className={styles.downloadLink}
                href={state.value.downloadUrl}
                download={state.value.filename}
                referrerPolicy="no-referrer"
                data-export-initial-focus
                onClick={onDownload}
              >
                <Download size={16} aria-hidden="true" /> Download JSON
              </a>
            </div>
          </>
        )}

        {state.status === "expired" && (
          <>
            <DialogHeading icon={<FileJson size={22} />} eyebrow="LINK EXPIRED" title="This private download link expired." />
            <div id="account-data-export-description" className={styles.dialogBody}>
              <p>Prepare a new file to get another short-lived link. Nothing in your YOVA account was changed.</p>
            </div>
            <div className={styles.dialogActions}>
              <button className="button ghost" type="button" data-export-initial-focus onClick={onCancel}>Close</button>
              <button className="button primary" type="button" onClick={onPrepare}>Prepare a new download</button>
            </div>
          </>
        )}

        {state.status === "failure" && (
          <>
            <DialogHeading icon={<AlertTriangle size={22} />} eyebrow="DOWNLOAD NOT READY" title="YOVA could not prepare your download." danger />
            <div id="account-data-export-description" className={styles.dialogBody}>
              <p className={styles.dialogError} role="alert">{state.issue}</p>
              <p>Nothing in your YOVA account was changed.</p>
              {state.code === "too_large" && <Link href="/support">Contact YOVA Support for a broader privacy request.</Link>}
            </div>
            <div className={styles.dialogActions}>
              <button className="button ghost" type="button" data-export-initial-focus onClick={onCancel}>Close</button>
              {state.code !== "too_large" && <button className="button primary" type="button" onClick={onPrepare}>Try again</button>}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}

function DialogHeading({
  icon,
  eyebrow,
  title,
  success = false,
  danger = false,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  success?: boolean;
  danger?: boolean;
}) {
  return (
    <header className={styles.dialogHeader}>
      <span className={`${styles.dialogIcon} ${success ? styles.dialogIconSuccess : ""} ${danger ? styles.dialogIconDanger : ""}`} aria-hidden="true">{icon}</span>
      <div>
        <span>{eyebrow}</span>
        <h2 id="account-data-export-title">{title}</h2>
      </div>
    </header>
  );
}

function PendingExportState({
  eyebrow,
  title,
  description,
  onCancel,
}: {
  eyebrow: string;
  title: string;
  description: string;
  onCancel: () => void;
}) {
  return (
    <>
      <DialogHeading icon={<ShieldCheck size={22} />} eyebrow={eyebrow} title={title} />
      <div id="account-data-export-description" className={styles.dialogBody}>
        <p className={styles.pendingStatus} role="status" aria-live="polite">
          <span className="button-spinner dark" aria-hidden="true" />
          {description}
        </p>
      </div>
      <div className={styles.dialogActions}>
        <button className="button ghost" type="button" data-export-initial-focus onClick={onCancel}>Stop waiting</button>
      </div>
    </>
  );
}

function exportFailureState(error: unknown): AccountDataExportUiState {
  const code = error instanceof AccountDataExportError && error.code !== "reauth_required"
    ? error.code
    : "failed";

  const issue = code === "too_large"
    ? "This account is too large for the self-service download."
    : code === "rate_limited"
      ? "YOVA limits how often private exports can be prepared. Wait before trying again."
      : code === "unavailable"
        ? "Account-data downloads are temporarily unavailable. Check your connection and try again."
        : "YOVA could not create the private file or link. Check your connection and try again.";

  return { status: "failure", code, issue };
}

export function accountDataExportStateAfterAccountChange(
  previousAccountId: string,
  nextAccountId: string,
  state: AccountDataExportUiState,
): AccountDataExportUiState {
  return previousAccountId === nextAccountId ? state : CLOSED_EXPORT_STATE;
}

function formatExportExpiry(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "soon";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function isAbortError(error: unknown) {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}
