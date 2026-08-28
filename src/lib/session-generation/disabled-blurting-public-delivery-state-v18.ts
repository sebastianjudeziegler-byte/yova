import {
  readDisabledBlurtingPublicDeliveryV18,
  type DisabledBlurtingPublicDeliveryV18,
} from "@/lib/session-generation/disabled-blurting-public-delivery-v18";

export const DISABLED_BLURTING_PUBLIC_DELIVERY_STAGES_V18 = Object.freeze([
  "recall",
  "compare",
  "repair",
  "transfer",
  "complete",
] as const);

export type DisabledBlurtingDeliveryControllerReadyV18 = Readonly<{
  kind: "ready";
  delivery: DisabledBlurtingPublicDeliveryV18;
}>;

export type DisabledBlurtingDeliveryControllerInvalidV18 = Readonly<{
  kind: "invalid_initial_delivery";
  reason: "invalid_delivery";
}>;

export type DisabledBlurtingDeliveryControllerStateV18 =
  | DisabledBlurtingDeliveryControllerReadyV18
  | DisabledBlurtingDeliveryControllerInvalidV18;

export type DisabledBlurtingDeliveryControllerCommandV18 = Readonly<{
  type: "server_delivery_received";
  delivery: unknown;
}>;

export type DisabledBlurtingDeliveryRejectionV18 =
  | "invalid_delivery"
  | "identity_mismatch"
  | "envelope_mismatch"
  | "same_stage_content_mismatch"
  | "stage_backtrack"
  | "stage_skip";

export type DisabledBlurtingDeliveryTransitionV18 =
  | Readonly<{
      kind: "accepted";
      mode: "idempotent_replay" | "advanced_one_stage";
      state: DisabledBlurtingDeliveryControllerReadyV18;
    }>
  | Readonly<{
      kind: "rejected";
      reason: DisabledBlurtingDeliveryRejectionV18;
      state: DisabledBlurtingDeliveryControllerReadyV18;
    }>;

/**
 * Parses an answer-free public stage without establishing where it came from.
 * Any of the five stages is valid because a future authenticated recovery
 * boundary may resume from the stage already committed by the server.
 *
 * A caller must authenticate the delivery before passing it here. Parsing alone
 * grants no disclosure, route, evaluation, completion, or evidence authority.
 * The module is deliberately unwired from live renderer and generation paths.
 */
export function createDisabledBlurtingDeliveryControllerV18(
  initialDelivery: unknown,
): DisabledBlurtingDeliveryControllerStateV18 {
  const delivery = readDisabledBlurtingPublicDeliveryV18(initialDelivery);
  return delivery
    ? Object.freeze({ kind: "ready", delivery })
    : INVALID_INITIAL_STATE;
}

/**
 * Reconciles only an exact semantic replay or the immediately following stage.
 * This is an untrusted local projector, not proof that a delivery was authored
 * by the server. A future caller must establish opaque repository provenance
 * before invoking it. Rejected input preserves the last accepted state object.
 */
export function transitionDisabledBlurtingDeliveryControllerV18(
  state: DisabledBlurtingDeliveryControllerReadyV18,
  command: DisabledBlurtingDeliveryControllerCommandV18,
): DisabledBlurtingDeliveryTransitionV18 {
  if (command.type !== "server_delivery_received") {
    return rejected(state, "invalid_delivery");
  }
  const next = readDisabledBlurtingPublicDeliveryV18(command.delivery);
  if (!next) return rejected(state, "invalid_delivery");

  const current = state.delivery;
  if (!sameJson(current.identity, next.identity)) {
    return rejected(state, "identity_mismatch");
  }
  if (!sameImmutableEnvelope(current, next)) {
    return rejected(state, "envelope_mismatch");
  }

  if (current.stage === next.stage) {
    return sameJson(current, next)
      ? Object.freeze({ kind: "accepted", mode: "idempotent_replay", state })
      : rejected(state, "same_stage_content_mismatch");
  }

  const currentIndex = stageIndex(current.stage);
  const nextIndex = stageIndex(next.stage);
  if (nextIndex < currentIndex) return rejected(state, "stage_backtrack");
  if (nextIndex > currentIndex + 1) return rejected(state, "stage_skip");

  return Object.freeze({
    kind: "accepted",
    mode: "advanced_one_stage",
    state: Object.freeze({ kind: "ready", delivery: next }),
  });
}

const INVALID_INITIAL_STATE: DisabledBlurtingDeliveryControllerInvalidV18 =
  Object.freeze({
    kind: "invalid_initial_delivery",
    reason: "invalid_delivery",
  });

function sameImmutableEnvelope(
  current: DisabledBlurtingPublicDeliveryV18,
  next: DisabledBlurtingPublicDeliveryV18,
) {
  return current.schemaVersion === next.schemaVersion
    && current.boundaryStatus === next.boundaryStatus
    && current.gapCount === next.gapCount
    && sameJson(current.orderedTargets, next.orderedTargets)
    && sameJson(current.phaseMetadata, next.phaseMetadata);
}

function stageIndex(
  stage: typeof DISABLED_BLURTING_PUBLIC_DELIVERY_STAGES_V18[number],
) {
  return DISABLED_BLURTING_PUBLIC_DELIVERY_STAGES_V18.indexOf(stage);
}

function rejected(
  state: DisabledBlurtingDeliveryControllerReadyV18,
  reason: DisabledBlurtingDeliveryRejectionV18,
): DisabledBlurtingDeliveryTransitionV18 {
  return Object.freeze({ kind: "rejected", reason, state });
}

function sameJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJson(value, right[index]));
  }
  if (typeof left !== "object" || typeof right !== "object") return false;

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => (
      Object.prototype.hasOwnProperty.call(rightRecord, key)
      && sameJson(leftRecord[key], rightRecord[key])
    ));
}
