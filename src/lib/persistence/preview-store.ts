import type { YovaPreviewSnapshot } from "@/lib/domain";

const STORAGE_KEY = "yova.preview.v1";

export function loadPreviewSnapshot(): YovaPreviewSnapshot | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return isPreviewSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function savePreviewSnapshot(snapshot: YovaPreviewSnapshot) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export function clearPreviewSnapshot() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

function isPreviewSnapshot(value: unknown): value is YovaPreviewSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<YovaPreviewSnapshot>;
  return candidate.version === 1
    && Array.isArray(candidate.onboardingAnswers)
    && Array.isArray(candidate.plans)
    && Array.isArray(candidate.sessionCompletions)
    && typeof candidate.signedIn === "boolean"
    && typeof candidate.onboardingCompleted === "boolean"
    && typeof candidate.alphaEntered === "boolean";
}

