"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { AlertTriangle, ShieldCheck, Trash2 } from "lucide-react";
import { TurnstileChallenge } from "@/components/auth/turnstile-challenge";
import {
  AccountDeletionError,
  deleteAuthenticatedYovaAccount,
  requestAccountDeletionVerification,
  verifyAccountDeletionCode,
} from "@/lib/account-deletion/client";
import { ACCOUNT_DELETION_CONFIRMATION } from "@/lib/account-deletion/schema";
import {
  isCompleteEmailVerificationCode,
  normalizeEmailVerificationCode,
} from "@/lib/auth/verification-code";
import type { PreviewAccount } from "@/lib/domain";
import styles from "./account-security-card.module.css";

type DeletionState =
  | { status: "closed" }
  | { status: "confirm"; issue: string | null }
  | { status: "reauth"; issue: string | null }
  | { status: "sending-code" }
  | { status: "code"; issue: string | null }
  | { status: "verifying" }
  | { status: "deleting" }
  | { status: "failure"; issue: string };

export function AccountDeletionControl({
  account,
  disabled,
  turnstileSiteKey,
  onAccountDeleted,
}: {
  account: PreviewAccount;
  disabled: boolean;
  turnstileSiteKey: string | null;
  onAccountDeleted: () => Promise<void>;
}) {
  const [state, setState] = useState<DeletionState>({ status: "closed" });
  const [confirmation, setConfirmation] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [challengeResetNonce, setChallengeResetNonce] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const pending = state.status === "sending-code"
    || state.status === "verifying"
    || state.status === "deleting";
  const siteKey = turnstileSiteKey?.trim() || null;

  useEffect(() => {
    if (state.status === "closed") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>("[data-deletion-initial-focus]")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state.status]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const close = (restoreFocus = true) => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    dialogRef.current?.close();
    setState({ status: "closed" });
    setConfirmation("");
    setVerificationCode("");
    setCaptchaToken(null);
    setChallengeResetNonce((nonce) => nonce + 1);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const nextController = () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    return controller;
  };

  const deleteAccount = async (recentlyVerified = false) => {
    const controller = nextController();
    setState({ status: "deleting" });
    try {
      await deleteAuthenticatedYovaAccount(account.id, { signal: controller.signal });
      if (controller.signal.aborted) return;
      await onAccountDeleted();
      close(false);
    } catch (error) {
      if (isAbortError(error)) return;
      if (error instanceof AccountDeletionError && error.code === "reauth_required") {
        setState({
          status: "reauth",
          issue: recentlyVerified
            ? "YOVA could not confirm the recent verification yet. Send a new code and try again."
            : null,
        });
        return;
      }
      setState({
        status: "failure",
        issue: error instanceof AccountDeletionError
          ? error.message
          : "YOVA could not delete this account. Nothing was changed. Try again.",
      });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const requestCode = async () => {
    if (siteKey && !captchaToken) {
      setState({ status: "reauth", issue: "Complete the security check to send a code." });
      return;
    }
    const controller = nextController();
    setState({ status: "sending-code" });
    try {
      await requestAccountDeletionVerification(
        account.email,
        captchaToken ?? undefined,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setVerificationCode("");
      setState({ status: "code", issue: null });
    } catch (error) {
      if (isAbortError(error)) return;
      setState({ status: "reauth", issue: "YOVA could not send a verification code right now. Try again." });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setCaptchaToken(null);
      setChallengeResetNonce((nonce) => nonce + 1);
    }
  };

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = normalizeEmailVerificationCode(verificationCode);
    if (!isCompleteEmailVerificationCode(code)) {
      setVerificationCode(code);
      setState({ status: "code", issue: "Enter the complete 6-digit code from the newest YOVA email." });
      return;
    }

    const controller = nextController();
    setState({ status: "verifying" });
    try {
      await verifyAccountDeletionCode(account.id, account.email, code, { signal: controller.signal });
      if (controller.signal.aborted) return;
      await deleteAccount(true);
    } catch (error) {
      if (isAbortError(error)) return;
      setState({
        status: "code",
        issue: error instanceof AccountDeletionError
          ? error.message
          : "That code is incorrect or expired. Check the newest YOVA email and try again.",
      });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  return (
    <>
      <div className={styles.deleteAccountRow}>
        <div>
          <strong>Delete YOVA account</strong>
          <span>Permanently remove this login identity and its private account data.</span>
        </div>
        <button
          ref={triggerRef}
          className="button danger-outline"
          type="button"
          disabled={disabled}
          onClick={() => {
            setConfirmation("");
            setState({ status: "confirm", issue: null });
          }}
        >
          <Trash2 size={16} aria-hidden="true" /> Delete account
        </button>
      </div>

      {state.status !== "closed" && (
        <dialog
          ref={dialogRef}
          className={styles.exportDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-deletion-title"
          aria-describedby="account-deletion-description"
          aria-busy={pending || undefined}
          onCancel={(event) => {
            event.preventDefault();
            if (!pending) close();
          }}
          onClick={(event: MouseEvent<HTMLDialogElement>) => {
            if (event.target === event.currentTarget && !pending) close();
          }}
        >
          <div className={styles.dialogContent}>
            {state.status === "confirm" && (
              <form onSubmit={(event) => {
                event.preventDefault();
                if (confirmation !== ACCOUNT_DELETION_CONFIRMATION) {
                  setState({ status: "confirm", issue: `Type ${ACCOUNT_DELETION_CONFIRMATION} exactly to continue.` });
                  return;
                }
                void deleteAccount();
              }} noValidate>
                <DeletionHeading eyebrow="PERMANENT ACTION" title="Delete your YOVA account?" />
                <div id="account-deletion-description" className={styles.dialogBody}>
                  <div className={styles.privateWarning}>
                    <AlertTriangle size={18} aria-hidden="true" />
                    <p>This permanently removes your login identity, learning profile, plans, session history, tutor conversations, support requests, and private uploaded materials.</p>
                  </div>
                  <p>A separate public Study Profile report or waitlist record is not linked to this account and is not removed here. Contact YOVA Support to delete it.</p>
                  <p>Downloaded export files already saved on your device cannot be removed by YOVA.</p>
                  <label className={styles.codeField} htmlFor="account-deletion-confirmation">
                    <span>Type {ACCOUNT_DELETION_CONFIRMATION} to confirm</span>
                    <input
                      id="account-deletion-confirmation"
                      value={confirmation}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={Boolean(state.issue)}
                      onChange={(event) => {
                        setConfirmation(event.target.value);
                        if (state.issue) setState({ status: "confirm", issue: null });
                      }}
                    />
                  </label>
                  {state.issue && <p className={styles.dialogError} role="alert">{state.issue}</p>}
                </div>
                <div className={styles.dialogActions}>
                  <button className="button ghost" type="button" data-deletion-initial-focus onClick={() => close()}>Cancel</button>
                  <button className="button danger" type="submit" disabled={confirmation !== ACCOUNT_DELETION_CONFIRMATION}>
                    <Trash2 size={16} aria-hidden="true" /> Permanently delete account
                  </button>
                </div>
              </form>
            )}

            {state.status === "reauth" && (
              <>
                <DeletionHeading eyebrow="VERIFY IT’S YOU" title="Verify before deleting this account." />
                <div id="account-deletion-description" className={styles.dialogBody}>
                  <p>YOVA needs a recent sign-in. Send a 6-digit code to <strong>{account.email}</strong>.</p>
                  {siteKey && (
                    <TurnstileChallenge
                      siteKey={siteKey}
                      resetNonce={challengeResetNonce}
                      onTokenChange={setCaptchaToken}
                    />
                  )}
                  {state.issue && <p className={styles.dialogError} role="alert">{state.issue}</p>}
                </div>
                <div className={styles.dialogActions}>
                  <button className="button ghost" type="button" data-deletion-initial-focus onClick={() => close()}>Cancel</button>
                  <button className="button danger" type="button" disabled={Boolean(siteKey) && !captchaToken} onClick={() => void requestCode()}>
                    Send verification code
                  </button>
                </div>
              </>
            )}

            {state.status === "code" && (
              <form onSubmit={(event) => void verifyCode(event)} noValidate>
                <DeletionHeading eyebrow="CHECK YOUR EMAIL" title="Enter the 6-digit code." />
                <div id="account-deletion-description" className={styles.dialogBody}>
                  <p>Use the code from the newest YOVA email sent to <strong>{account.email}</strong>.</p>
                  <label className={styles.codeField} htmlFor="account-deletion-code">
                    <span>Verification code</span>
                    <input
                      id="account-deletion-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={verificationCode}
                      data-deletion-initial-focus
                      aria-invalid={Boolean(state.issue)}
                      onChange={(event) => {
                        setVerificationCode(normalizeEmailVerificationCode(event.target.value));
                        if (state.issue) setState({ status: "code", issue: null });
                      }}
                    />
                  </label>
                  {state.issue && <p className={styles.dialogError} role="alert">{state.issue}</p>}
                </div>
                <div className={styles.dialogActions}>
                  <button className="button ghost" type="button" onClick={() => close()}>Cancel</button>
                  <button className="button danger" type="submit">Verify and delete account</button>
                </div>
              </form>
            )}

            {state.status === "sending-code" && <PendingDeletion title="Sending a verification code…" />}
            {state.status === "verifying" && <PendingDeletion title="Verifying your code…" />}
            {state.status === "deleting" && <PendingDeletion title="Permanently deleting your account…" />}

            {state.status === "failure" && (
              <>
                <DeletionHeading eyebrow="ACCOUNT NOT DELETED" title="YOVA could not delete this account." />
                <div id="account-deletion-description" className={styles.dialogBody}>
                  <p className={styles.dialogError} role="alert">{state.issue}</p>
                  <p>Nothing was changed. You can try again or contact YOVA Support.</p>
                  <Link href="/support">Contact YOVA Support</Link>
                </div>
                <div className={styles.dialogActions}>
                  <button className="button ghost" type="button" data-deletion-initial-focus onClick={() => close()}>Close</button>
                  <button className="button danger" type="button" onClick={() => setState({ status: "confirm", issue: null })}>Try again</button>
                </div>
              </>
            )}
          </div>
        </dialog>
      )}
    </>
  );
}

function DeletionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className={styles.dialogHeader}>
      <span className={`${styles.dialogIcon} ${styles.dialogIconDanger}`} aria-hidden="true"><ShieldCheck size={22} /></span>
      <div>
        <span>{eyebrow}</span>
        <h2 id="account-deletion-title">{title}</h2>
      </div>
    </header>
  );
}

function PendingDeletion({ title }: { title: string }) {
  return (
    <>
      <DeletionHeading eyebrow="PLEASE WAIT" title={title} />
      <div id="account-deletion-description" className={styles.dialogBody} role="status" aria-live="polite">
        <p>Keep this window open. Do not close or refresh YOVA while this permanent action finishes.</p>
      </div>
    </>
  );
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
