export const PERSONALIZATION_DECISION_SETTINGS = [
  "first_action",
  "path_visibility",
  "activity_cadence",
  "knowledge_check",
  "confidence_check",
  "attempt_safety",
  "block_length",
  "presentation",
  "retention",
  "first_repair",
  "layout",
  "recommended_window",
  "text_density",
  "motion",
  "visual_structure",
  "check_ins",
  "method_id",
] as const;

export type PersonalizationDecisionSetting =
  (typeof PERSONALIZATION_DECISION_SETTINGS)[number];

export const CSS_ONLY_PERSONALIZATION_SETTINGS = [
  "text_density",
  "motion",
  "visual_structure",
  "check_ins",
] as const satisfies readonly PersonalizationDecisionSetting[];

export type SessionDeliveryPolicyDecisionField =
  | "presentation"
  | "repair"
  | "retention"
  | "workspace"
  | "pacing"
  | "activityCadence"
  | "attemptSafety"
  | "knowledgeCheck";

type PersonalizationDecisionChannel =
  | {
      channel: "delivery_policy";
      deliveryPolicyField: SessionDeliveryPolicyDecisionField;
    }
  | { channel: "css" }
  | { channel: "schedule_ui" }
  | { channel: "method_router" };

/**
 * The production routing contract for every decision shown in the You tab.
 * Adding a setting requires choosing an execution channel here; teaching
 * decisions must name the concrete delivery-policy field the AI receives.
 */
export const PERSONALIZATION_DECISION_CHANNELS = {
  first_action: { channel: "delivery_policy", deliveryPolicyField: "pacing" },
  path_visibility: { channel: "delivery_policy", deliveryPolicyField: "workspace" },
  activity_cadence: { channel: "delivery_policy", deliveryPolicyField: "activityCadence" },
  knowledge_check: { channel: "delivery_policy", deliveryPolicyField: "knowledgeCheck" },
  confidence_check: { channel: "delivery_policy", deliveryPolicyField: "knowledgeCheck" },
  attempt_safety: { channel: "delivery_policy", deliveryPolicyField: "attemptSafety" },
  block_length: { channel: "delivery_policy", deliveryPolicyField: "pacing" },
  presentation: { channel: "delivery_policy", deliveryPolicyField: "presentation" },
  retention: { channel: "delivery_policy", deliveryPolicyField: "retention" },
  first_repair: { channel: "delivery_policy", deliveryPolicyField: "repair" },
  layout: { channel: "delivery_policy", deliveryPolicyField: "workspace" },
  recommended_window: { channel: "schedule_ui" },
  text_density: { channel: "css" },
  motion: { channel: "css" },
  visual_structure: { channel: "css" },
  check_ins: { channel: "css" },
  method_id: { channel: "method_router" },
} as const satisfies Record<PersonalizationDecisionSetting, PersonalizationDecisionChannel>;

const PERSONALIZATION_DECISION_SETTING_SET = new Set<string>(
  PERSONALIZATION_DECISION_SETTINGS,
);

export function isPersonalizationDecisionSetting(
  value: string,
): value is PersonalizationDecisionSetting {
  return PERSONALIZATION_DECISION_SETTING_SET.has(value);
}
