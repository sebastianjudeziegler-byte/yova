"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BadgeCheck, KeyRound, LogOut, Pencil } from "lucide-react";
import {
  DISPLAY_NAME_MAX_LENGTH,
  normalizeDisplayName,
  validateDisplayName,
} from "@/lib/auth/password";
import type { PreviewAccount } from "@/lib/domain";
import styles from "./account-security-card.module.css";

export function AccountSecurityCard({
  account,
  passwordAccountsEnabled,
  signingOut,
  onDisplayNameChange,
  onSignOut,
}: {
  account: PreviewAccount;
  passwordAccountsEnabled: boolean;
  signingOut: boolean;
  onDisplayNameChange: (displayName: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(account.displayName);
  const [savingName, setSavingName] = useState(false);
  const [nameIssue, setNameIssue] = useState<string | null>(null);
  const [nameNotice, setNameNotice] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const cloudAccount = account.identityMode === "supabase";
  const accountBusy = savingName || signingOut;

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

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

  const saveName = async (event: React.FormEvent<HTMLFormElement>) => {
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
          <p>Review how you sign in and manage this device.</p>
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
    </section>
  );
}
