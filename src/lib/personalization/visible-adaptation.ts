import type { SessionDeliveryPolicy } from "@/lib/personalization/session-delivery-policy";

const IGNORED_TOKENS = new Set([
  "about", "after", "before", "because", "first", "from", "into", "more", "session", "that", "their",
  "this", "through", "today", "will", "with", "yova", "your",
]);

/**
 * Personalization copy must trace back to a real policy decision. This keeps
 * the UI from displaying plausible-sounding but unsupported learner claims.
 */
export function validateVisibleAdaptation(
  personalization: string[],
  policy: SessionDeliveryPolicy,
) {
  if (!personalization.length) return "The session does not explain any concrete learner-facing delivery adjustment.";

  const evidenceReasons = policy.learnerFacingReasons;
  const unsupported = personalization.find((reason) => !evidenceReasons.some((evidence) => (
    sharedMeaningfulTokens(reason, evidence) >= 2
  )));

  return unsupported
    ? `The personalization claim "${unsupported}" is not traceable to the learner signals used for this session.`
    : null;
}

function sharedMeaningfulTokens(left: string, right: string) {
  const rightTokens = new Set(meaningfulTokens(right));
  return meaningfulTokens(left).filter((token) => rightTokens.has(token)).length;
}

function meaningfulTokens(value: string) {
  return [...new Set(value.toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 3 && !IGNORED_TOKENS.has(token)))];
}
