"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Clock3, Mail, Send } from "lucide-react";

export type FounderTester = {
  email: string;
  displayName?: string | null;
  status: "pending" | "joined";
  invitedAt: string;
  joinedAt?: string | null;
};

type FounderTesterAccessProps = {
  initialTesters: FounderTester[];
};

type InviteResponse = {
  tester?: FounderTester;
  alreadyInvited?: boolean;
  error?: string;
};

type RequestKind = "send" | "resend";
type RequestState = { email: string; kind: RequestKind } | null;
type Notice = { tone: "success" | "info" | "error"; message: string } | null;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function FounderTesterAccess({ initialTesters }: FounderTesterAccessProps) {
  const [testers, setTesters] = useState(initialTesters);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [requestState, setRequestState] = useState<RequestState>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  const sortedTesters = useMemo(() => [...testers].sort((left, right) => {
    const rightTime = Date.parse(right.joinedAt || right.invitedAt) || 0;
    const leftTime = Date.parse(left.joinedAt || left.invitedAt) || 0;
    return rightTime - leftTime;
  }), [testers]);
  const joinedCount = testers.filter((tester) => tester.status === "joined").length;
  const pendingCount = testers.length - joinedCount;
  const busy = requestState !== null;

  const announce = (nextNotice: Exclude<Notice, null>) => {
    setNotice(nextNotice);
    window.requestAnimationFrame(() => noticeRef.current?.focus());
  };

  const sendInvitation = async ({
    nextEmail,
    nextDisplayName,
    kind,
  }: {
    nextEmail: string;
    nextDisplayName?: string | null;
    kind: RequestKind;
  }) => {
    const normalizedEmail = nextEmail.trim().toLowerCase();
    const normalizedDisplayName = nextDisplayName?.trim() || undefined;

    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      announce({ tone: "error", message: "Enter a valid email address." });
      return;
    }

    setRequestState({ email: normalizedEmail, kind });
    setNotice(null);

    try {
      const response = await fetch("/api/founder/testers/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          ...(normalizedDisplayName ? { displayName: normalizedDisplayName } : {}),
        }),
      });
      const payload = await readInviteResponse(response);

      if (!response.ok || !payload.tester) {
        throw new Error(payload.error || inviteErrorForStatus(response.status));
      }

      const updatedTester = payload.tester;
      setTesters((current) => [
        updatedTester,
        ...current.filter((tester) => tester.email.toLowerCase() !== updatedTester.email.toLowerCase()),
      ]);

      if (kind === "send") {
        setEmail("");
        setDisplayName("");
      }

      if (payload.alreadyInvited) {
        announce({
          tone: "info",
          message: payload.tester.status === "joined"
            ? "This email already has YOVA access. Ask the tester to use Sign in."
            : `An invitation is already pending for ${normalizedEmail}.`,
        });
      } else {
        announce({
          tone: "success",
          message: kind === "resend"
            ? `Invite sent again to ${normalizedEmail}.`
            : `Invite sent to ${normalizedEmail}.`,
        });
      }
    } catch (error) {
      announce({
        tone: "error",
        message: error instanceof Error && error.message.length <= 220
          ? error.message
          : "YOVA could not send this invitation. Nothing changed. Try again.",
      });
    } finally {
      setRequestState(null);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    void sendInvitation({ nextEmail: email, nextDisplayName: displayName, kind: "send" });
  };

  return (
    <div className="founder-tester-access">
      <section className="founder-tester-invite-card" aria-labelledby="founder-invite-title">
        <div className="founder-tester-card-heading">
          <span className="founder-tester-card-icon" aria-hidden="true"><Mail size={20} /></span>
          <div>
            <h2 id="founder-invite-title">Invite a tester</h2>
            <p>YOVA will email them one secure access link. They will not need a password.</p>
          </div>
        </div>

        <form className="founder-tester-invite-form" onSubmit={submit} noValidate aria-busy={busy}>
          <label>
            <span>Email address</span>
            <input
              type="email"
              name="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (notice?.tone === "error") setNotice(null);
              }}
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              placeholder="tester@example.com"
              required
              disabled={busy}
              aria-invalid={notice?.tone === "error" && notice.message === "Enter a valid email address."
                ? true
                : undefined}
            />
          </label>
          <label>
            <span>First name <small>(optional)</small></span>
            <input
              type="text"
              name="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="given-name"
              maxLength={80}
              placeholder="Ada"
              disabled={busy}
            />
          </label>
          <button className="button primary founder-tester-send" type="submit" disabled={busy}>
            {requestState?.kind === "send" ? "Sending…" : <><Send size={16} /> Send invite</>}
          </button>
        </form>

        {notice && (
          <div
            ref={noticeRef}
            className={`founder-tester-notice ${notice.tone}`}
            role={notice.tone === "error" ? "alert" : "status"}
            aria-live={notice.tone === "error" ? "assertive" : "polite"}
            tabIndex={-1}
          >
            {notice.tone === "success" && <CheckCircle2 size={18} aria-hidden="true" />}
            {notice.tone === "info" && <Clock3 size={18} aria-hidden="true" />}
            {notice.tone === "error" && <span aria-hidden="true">!</span>}
            <p>{notice.message}</p>
          </div>
        )}

        <p className="founder-tester-invite-note">Only invite people who agreed to test YOVA. Their use is covered by the Private Alpha Terms and Privacy Notice.</p>
      </section>

      <section className="founder-tester-list-card" aria-labelledby="founder-testers-title" aria-busy={busy}>
        <header>
          <div>
            <span>PRIVATE ALPHA</span>
            <h2 id="founder-testers-title">Invited testers</h2>
          </div>
          <p aria-label={`${joinedCount} joined and ${pendingCount} awaiting invitation acceptance`}>
            <strong>{joinedCount}</strong> joined <span aria-hidden="true">·</span> <strong>{pendingCount}</strong> awaiting
          </p>
        </header>

        {sortedTesters.length === 0 ? (
          <div className="founder-tester-empty">
            <Mail size={21} aria-hidden="true" />
            <p><strong>No tester invitations yet.</strong><span>Send the first invitation above when someone is ready to try YOVA.</span></p>
          </div>
        ) : (
          <ul className="founder-tester-list">
            {sortedTesters.map((tester) => {
              const isJoined = tester.status === "joined";
              const resending = requestState?.kind === "resend"
                && requestState.email === tester.email.toLowerCase();

              return (
                <li key={tester.email.toLowerCase()}>
                  <span className={`founder-tester-status-icon ${tester.status}`} aria-hidden="true">
                    {isJoined ? <CheckCircle2 size={20} /> : <Clock3 size={20} />}
                  </span>
                  <div className="founder-tester-identity">
                    {tester.displayName && <strong>{tester.displayName}</strong>}
                    <span>{tester.email}</span>
                  </div>
                  <div className="founder-tester-state">
                    <span className={`founder-tester-status ${tester.status}`}>
                      {isJoined ? "Joined" : "Invite sent"}
                    </span>
                    <time dateTime={isJoined && tester.joinedAt ? tester.joinedAt : tester.invitedAt}>
                      {isJoined && tester.joinedAt ? "Joined" : "Sent"} {formatFounderDate(isJoined && tester.joinedAt ? tester.joinedAt : tester.invitedAt)}
                    </time>
                    {!isJoined && (
                      <button
                        className="button secondary founder-tester-resend"
                        type="button"
                        onClick={() => void sendInvitation({
                          nextEmail: tester.email,
                          nextDisplayName: tester.displayName,
                          kind: "resend",
                        })}
                        disabled={busy}
                        aria-label={`Send invitation again to ${tester.email}`}
                      >
                        {resending ? "Sending…" : "Send again"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

async function readInviteResponse(response: Response): Promise<InviteResponse> {
  try {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return {};
    return payload as InviteResponse;
  } catch {
    return {};
  }
}

function inviteErrorForStatus(status: number) {
  if (status === 429) return "Too many invitations were sent at once. Wait a few minutes and try again.";
  if (status === 401 || status === 403) return "Your founder access could not be confirmed. Sign in again and retry.";
  return "YOVA could not send this invitation. Nothing changed. Try again.";
}

function formatFounderDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
