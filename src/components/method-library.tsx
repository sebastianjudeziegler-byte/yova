"use client";

import { useRef, useState } from "react";
import { Check, Clock3, Sparkles, Star } from "lucide-react";
import {
  CORE_METHOD_IDS,
  type CoreMethodId,
} from "@/lib/learning/method-catalog";
import {
  FUTURE_BLURTING_LIBRARY_ENTRY,
  METHOD_LIBRARY_ENTRIES,
  type MethodLibraryEntry,
} from "@/lib/learning/method-library-content";

export const METHOD_LIBRARY_MAX_PREFERENCES = 3;

export type MethodLibrarySaveStatus = "idle" | "saving" | "saved" | "pending";

export function visibleMethodLibrarySaveStatus(
  saveStatus: MethodLibrarySaveStatus,
  pendingPreferenceKey: string | null,
  syncedPreferenceKey: string | null,
): MethodLibrarySaveStatus {
  return saveStatus === "pending"
    && pendingPreferenceKey !== null
    && syncedPreferenceKey === pendingPreferenceKey
    ? "saved"
    : saveStatus;
}

export type MethodLibraryProps = {
  preferredMethodIds: readonly CoreMethodId[];
  onPreferredMethodIdsChange: (methodIds: CoreMethodId[]) => void | Promise<void>;
  syncedPreferenceKey?: string | null;
  statedPreferencesEnabled?: boolean;
};

export function toggleMethodLibraryPreference(
  current: readonly CoreMethodId[],
  methodId: CoreMethodId,
) {
  const normalized = CORE_METHOD_IDS.filter((candidate) => current.includes(candidate))
    .slice(0, METHOD_LIBRARY_MAX_PREFERENCES);
  if (normalized.includes(methodId)) {
    return normalized.filter((candidate) => candidate !== methodId);
  }
  if (normalized.length >= METHOD_LIBRARY_MAX_PREFERENCES) return normalized;
  return CORE_METHOD_IDS.filter((candidate) => (
    normalized.includes(candidate) || candidate === methodId
  )).slice(0, METHOD_LIBRARY_MAX_PREFERENCES);
}

export function MethodLibrary({
  preferredMethodIds,
  onPreferredMethodIdsChange,
  syncedPreferenceKey = null,
  statedPreferencesEnabled = true,
}: MethodLibraryProps) {
  const controlledPreferred = normalizeMethodLibraryPreferences(preferredMethodIds);
  const controlledPreferenceKey = controlledPreferred.join("|");
  const [optimisticPreference, setOptimisticPreference] = useState<{
    baseKey: string;
    methodIds: CoreMethodId[];
  } | null>(null);
  const [saveStatus, setSaveStatus] = useState<MethodLibrarySaveStatus>("idle");
  const [pendingPreferenceKey, setPendingPreferenceKey] = useState<string | null>(null);
  const saveRequestId = useRef(0);
  const preferred = optimisticPreference?.baseKey === controlledPreferenceKey
    ? optimisticPreference.methodIds
    : controlledPreferred;

  const preferenceLimitReached = preferred.length >= METHOD_LIBRARY_MAX_PREFERENCES;
  const saving = saveStatus === "saving";
  const visibleSaveStatus = visibleMethodLibrarySaveStatus(
    saveStatus,
    pendingPreferenceKey,
    syncedPreferenceKey,
  );

  const togglePreference = async (methodId: CoreMethodId) => {
    if (saving) return;
    const nextPreferred = toggleMethodLibraryPreference(preferred, methodId);
    const requestId = saveRequestId.current + 1;
    saveRequestId.current = requestId;
    setOptimisticPreference({
      baseKey: controlledPreferenceKey,
      methodIds: nextPreferred,
    });
    setSaveStatus("saving");
    try {
      await onPreferredMethodIdsChange(nextPreferred);
      if (saveRequestId.current === requestId) {
        setPendingPreferenceKey(null);
        setSaveStatus("saved");
      }
    } catch {
      // Keep the optimistic local choice. The parent saves it to local state
      // before attempting cloud sync, so a temporary network issue is honest.
      if (saveRequestId.current === requestId) {
        setPendingPreferenceKey(nextPreferred.join("|"));
        setSaveStatus("pending");
      }
    }
  };

  return (
    <section className="method-library" aria-labelledby="method-library-heading">
      <section className="method-library-intro">
        <div className="method-library-intro-icon" aria-hidden="true"><Sparkles size={20} /></div>
        <div>
          <span className="step-label">YOUR OPTIONS</span>
          <h2 id="method-library-heading">Nine ways YOVA can help you study</h2>
          <p>Explore what each method is useful for and what you would actually do in a session.</p>
        </div>
        <div className="method-library-rule">
          <strong>A preference is a nudge, not a rule.</strong>
          <p>The task, what you currently know, and repeated results still come first. Preferences affect future choices and never rewrite sessions already saved.</p>
        </div>
      </section>

      <section className="method-library-preferences" aria-labelledby="method-library-preference-heading" aria-busy={saving}>
        <div>
          <span className="method-library-preference-icon" aria-hidden="true"><Star size={18} /></span>
          <div>
            <h2 id="method-library-preference-heading">Methods you enjoy</h2>
            <p id="method-library-preference-help">Choose up to three. YOVA will consider them only when they already fit the task.</p>
          </div>
        </div>
        <p className="method-library-preference-count" role="status" aria-live="polite" aria-atomic="true">
          <strong>{preferred.length}</strong> of {METHOD_LIBRARY_MAX_PREFERENCES} preferred
        </p>
        <p
          className={`method-library-save-status ${visibleSaveStatus}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {visibleSaveStatus === "saving" && "Saving…"}
          {visibleSaveStatus === "saved" && <><Check size={14} aria-hidden="true" /> Preferences saved</>}
          {visibleSaveStatus === "pending" && "Cloud save failed. Your choice is still visible here—use Retry now before closing or reloading."}
          {visibleSaveStatus === "idle" && "Changes save automatically."}
        </p>
        {!statedPreferencesEnabled && (
          <p className="method-library-preferences-paused" role="note">
            Your choices are saved, but YOVA is not using stated preferences while “Use what I tell YOVA” is turned off in You.
          </p>
        )}
        {preferenceLimitReached && (
          <p className="method-library-limit-note">Remove one preference before adding another.</p>
        )}
      </section>

      <div className="method-library-grid" role="list" aria-label="Available study methods">
        {METHOD_LIBRARY_ENTRIES.map((method, index) => (
          <LiveMethodCard
            key={method.id}
            method={method}
            index={index + 1}
            preferred={preferred.includes(method.id)}
            preferenceLimitReached={preferenceLimitReached}
            saving={saving}
            onTogglePreference={() => void togglePreference(method.id)}
          />
        ))}
      </div>

      <section className="method-library-future" aria-labelledby="method-library-future-heading">
        <header>
          <div><Clock3 size={18} aria-hidden="true" /></div>
          <span>
            <span className="step-label">COMING LATER</span>
            <h2 id="method-library-future-heading">A method YOVA is still finishing safely</h2>
          </span>
        </header>
        <article className="method-library-future-card" data-method-status="coming-later">
          <div>
            <span className="method-library-status future">Not available yet</span>
            <h3>{FUTURE_BLURTING_LIBRARY_ENTRY.name}</h3>
            <p>{FUTURE_BLURTING_LIBRARY_ENTRY.what}</p>
            <small><strong>Best for:</strong> {FUTURE_BLURTING_LIBRARY_ENTRY.bestFor}</small>
          </div>
          <details>
            <summary>See the planned steps</summary>
            <ol>{FUTURE_BLURTING_LIBRARY_ENTRY.how.map((step) => <li key={step}>{step}</li>)}</ol>
            <p>{FUTURE_BLURTING_LIBRARY_ENTRY.availability}</p>
          </details>
        </article>
      </section>
    </section>
  );
}

function LiveMethodCard({
  method,
  index,
  preferred,
  preferenceLimitReached,
  saving,
  onTogglePreference,
}: {
  method: MethodLibraryEntry;
  index: number;
  preferred: boolean;
  preferenceLimitReached: boolean;
  saving: boolean;
  onTogglePreference: () => void;
}) {
  const titleId = `method-library-title-${method.id}`;
  const preferenceUnavailable = preferenceLimitReached && !preferred;

  return (
    <article
      className={`method-library-card ${preferred ? "preferred" : ""}`}
      role="listitem"
      aria-labelledby={titleId}
      data-method-id={method.id}
    >
      <header>
        <span className="method-library-number" aria-hidden="true">{index}</span>
        <div>
          <span className="method-library-status">Available now</span>
          <h2 id={titleId}>{method.name}</h2>
        </div>
      </header>

      <p className="method-library-summary">{method.what}</p>
      <p className="method-library-best-for"><strong>Best for</strong>{method.bestFor}</p>
      <ul className="method-library-tags" aria-label={`${method.name} task types`}>
        {method.taskLabels.map((label) => <li key={label}>{label}</li>)}
      </ul>

      <button
        type="button"
        className="method-library-preference-button"
        aria-pressed={preferred}
        aria-describedby="method-library-preference-help"
        disabled={saving || preferenceUnavailable}
        onClick={onTogglePreference}
      >
        <Star size={16} fill={preferred ? "currentColor" : "none"} aria-hidden="true" />
        <span>Prefer when it fits</span>
        {preferred && <Check size={15} aria-hidden="true" />}
      </button>

      <details className="method-library-details">
        <summary>How it works</summary>
        <div>
          <section>
            <h3>Why it helps</h3>
            <p>{method.why}</p>
          </section>
          <section>
            <h3>What you do</h3>
            <ol>{method.how.map((step) => <li key={step}>{step}</li>)}</ol>
          </section>
          <section className="method-library-finished">
            <h3>Finished means</h3>
            <p>{method.completion}</p>
          </section>
          <section className="method-library-guardrail">
            <h3>Use something else when</h3>
            <p>{method.avoidWhen}</p>
          </section>
        </div>
      </details>
    </article>
  );
}

function normalizeMethodLibraryPreferences(methodIds: readonly CoreMethodId[]) {
  return CORE_METHOD_IDS.filter((candidate) => methodIds.includes(candidate))
    .slice(0, METHOD_LIBRARY_MAX_PREFERENCES);
}
