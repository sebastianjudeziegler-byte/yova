import type { SessionAdjustment } from "@/lib/session-generation/schema";

export const SESSION_SUPPORT_LEVELS = ["more_help", "usual", "more_challenge"] as const;

export type SessionSupportLevel = (typeof SESSION_SUPPORT_LEVELS)[number];

export const SESSION_SUPPORT_OPTIONS: ReadonlyArray<{
  value: SessionSupportLevel;
  title: string;
  description: string;
}> = [
  {
    value: "more_help",
    title: "More help",
    description: "Teach or model the first part before asking you to work independently.",
  },
  {
    value: "usual",
    title: "Usual support",
    description: "Keep the planned balance of teaching, hints, and independent work.",
  },
  {
    value: "more_challenge",
    title: "More challenge",
    description: "Move sooner to independent application without skipping required teaching or checks.",
  },
];

/**
 * The support dial is intentionally a today-only interpretation of the
 * existing session familiarity contract. This keeps retries, caching and
 * interrupted-session resumes exact without turning a temporary choice into
 * a permanent learner label.
 */
export function familiarityForSessionSupport({
  level,
  selectedFamiliarity,
}: {
  level: SessionSupportLevel;
  selectedFamiliarity: SessionAdjustment["familiarity"];
}): SessionAdjustment["familiarity"] {
  if (level === "more_help") return "need_teaching";
  if (level === "more_challenge") return "challenge_me";
  return selectedFamiliarity;
}

export function sessionSupportExplanation(level: SessionSupportLevel) {
  if (level === "more_help") {
    return "For this session only, YOVA will begin with more teaching or a clearer model before independent work.";
  }
  if (level === "more_challenge") {
    return "For this session only, YOVA will move sooner to independent application while keeping every required idea and check.";
  }
  return "YOVA will use your usual support settings for this session.";
}
