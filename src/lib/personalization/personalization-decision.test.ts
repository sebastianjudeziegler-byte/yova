import { describe, expect, it } from "vitest";
import {
  CSS_ONLY_PERSONALIZATION_SETTINGS,
  PERSONALIZATION_DECISION_CHANNELS,
  PERSONALIZATION_DECISION_SETTINGS,
} from "@/lib/personalization/personalization-decision";
import { SessionDeliveryPolicySchema } from "@/lib/personalization/session-delivery-policy";

describe("personalization decision channels", () => {
  it("gives every canonical setting an explicit execution channel", () => {
    expect(Object.keys(PERSONALIZATION_DECISION_CHANNELS).sort()).toEqual(
      [...PERSONALIZATION_DECISION_SETTINGS].sort(),
    );

    const policyFields = new Set(SessionDeliveryPolicySchema.keyof().options);
    for (const setting of PERSONALIZATION_DECISION_SETTINGS) {
      const route = PERSONALIZATION_DECISION_CHANNELS[setting];
      if (route.channel === "delivery_policy") {
        expect(
          policyFields.has(route.deliveryPolicyField),
          `${setting} must name a real session delivery policy field`,
        ).toBe(true);
      }
    }
  });

  it("keeps exactly the four visual settings CSS-only", () => {
    const cssRouted = PERSONALIZATION_DECISION_SETTINGS.filter(
      (setting) => PERSONALIZATION_DECISION_CHANNELS[setting].channel === "css",
    );

    expect([...CSS_ONLY_PERSONALIZATION_SETTINGS].sort()).toEqual([
      "check_ins",
      "motion",
      "text_density",
      "visual_structure",
    ]);
    expect(cssRouted.sort()).toEqual([...CSS_ONLY_PERSONALIZATION_SETTINGS].sort());
  });

  it("routes scheduling and method selection outside the delivery policy", () => {
    const externalSettings = PERSONALIZATION_DECISION_SETTINGS.filter((setting) => {
      const channel = PERSONALIZATION_DECISION_CHANNELS[setting].channel;
      return channel !== "delivery_policy" && channel !== "css";
    });

    expect(externalSettings.sort()).toEqual(["method_id", "recommended_window"]);
    expect(PERSONALIZATION_DECISION_CHANNELS.recommended_window.channel).toBe("schedule_ui");
    expect(PERSONALIZATION_DECISION_CHANNELS.method_id.channel).toBe("method_router");
  });
});
