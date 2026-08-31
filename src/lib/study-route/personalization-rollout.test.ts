import { describe, expect, it } from "vitest";
import {
  PERSONALIZATION_BASELINE_ROUTE_VERSION,
  PERSONALIZATION_ROLLOUT_POLICY_VERSION,
  PERSONALIZATION_ROUTE_VERSION,
  appendPersonalizationRolloutVersion,
  parsePersonalizationRolloutPercent,
  personalizationInputsForRollout,
  personalizationRouteVersionFromRouterVersion,
  resolvePersonalizationRollout,
} from "@/lib/study-route/personalization-rollout";

describe("personalization StudyRoute rollout", () => {
  it("fails closed to the baseline when the server flag is absent", () => {
    expect(parsePersonalizationRolloutPercent(undefined)).toBe(0);
    expect(parsePersonalizationRolloutPercent(" ")).toBe(0);
    expect(() => parsePersonalizationRolloutPercent("yes"))
      .toThrow(/integer from 0 to 100/i);
    expect(() => parsePersonalizationRolloutPercent("101"))
      .toThrow(/integer from 0 to 100/i);
  });

  it("supports deterministic 0-to-100 staged issuance", () => {
    const baseline = resolvePersonalizationRollout({
      rolloutPercent: 0,
      subjectKey: "account:stable",
    });
    const enabled = resolvePersonalizationRollout({
      rolloutPercent: 100,
      subjectKey: "account:stable",
    });
    const repeated = resolvePersonalizationRollout({
      rolloutPercent: 37,
      subjectKey: "account:stable",
    });
    const repeatedAgain = resolvePersonalizationRollout({
      rolloutPercent: 37,
      subjectKey: "account:stable",
    });

    expect(baseline).toMatchObject({
      routeVersion: PERSONALIZATION_BASELINE_ROUTE_VERSION,
      personalizationEnabled: false,
      assignment: "cohort",
    });
    expect(enabled).toMatchObject({
      routeVersion: PERSONALIZATION_ROUTE_VERSION,
      personalizationEnabled: true,
      assignment: "cohort",
    });
    expect(repeated).toEqual(repeatedAgain);
    expect(repeated.cohortBucket).toBeGreaterThanOrEqual(0);
    expect(repeated.cohortBucket).toBeLessThan(100);
    expect(Object.isFrozen(repeated)).toBe(true);
  });

  it("never treats a missing stable subject as rollout or exploration authority", () => {
    expect(resolvePersonalizationRollout({
      rolloutPercent: 100,
      subjectKey: null,
    })).toMatchObject({
      routeVersion: PERSONALIZATION_BASELINE_ROUTE_VERSION,
      personalizationEnabled: false,
      assignment: "missing_subject_baseline",
      cohortBucket: null,
    });
  });

  it("keeps an existing route version after the flag changes", () => {
    const personalized = resolvePersonalizationRollout({
      rolloutPercent: 0,
      subjectKey: "account:stable",
      currentRouterVersion: `router-v1+${PERSONALIZATION_ROLLOUT_POLICY_VERSION}+${PERSONALIZATION_ROUTE_VERSION}`,
    });
    const baseline = resolvePersonalizationRollout({
      rolloutPercent: 100,
      subjectKey: "account:stable",
      currentRouterVersion: `router-v1+${PERSONALIZATION_ROLLOUT_POLICY_VERSION}+${PERSONALIZATION_BASELINE_ROUTE_VERSION}`,
    });

    expect(personalized).toMatchObject({
      routeVersion: PERSONALIZATION_ROUTE_VERSION,
      personalizationEnabled: true,
      assignment: "existing_route",
    });
    expect(baseline).toMatchObject({
      routeVersion: PERSONALIZATION_BASELINE_ROUTE_VERSION,
      personalizationEnabled: false,
      assignment: "existing_route",
    });
  });

  it("versions the route and cannot rewrite that version in place", () => {
    const decision = resolvePersonalizationRollout({
      rolloutPercent: 100,
      subjectKey: "account:stable",
    });
    const versioned = appendPersonalizationRolloutVersion("router-v1", decision);

    expect(versioned.split("+")).toEqual([
      "router-v1",
      PERSONALIZATION_ROLLOUT_POLICY_VERSION,
      PERSONALIZATION_ROUTE_VERSION,
    ]);
    expect(personalizationRouteVersionFromRouterVersion(versioned))
      .toBe(PERSONALIZATION_ROUTE_VERSION);
    expect(() => appendPersonalizationRolloutVersion(versioned, {
      ...decision,
      routeVersion: PERSONALIZATION_BASELINE_ROUTE_VERSION,
      personalizationEnabled: false,
    })).toThrow(/cannot change personalization cohorts in place/i);
    expect(() => personalizationRouteVersionFromRouterVersion(
      `${PERSONALIZATION_BASELINE_ROUTE_VERSION}+${PERSONALIZATION_ROUTE_VERSION}`,
    )).toThrow(/conflicting personalization rollout versions/i);
  });

  it("removes declarations and outcomes together for the baseline", () => {
    const baseline = resolvePersonalizationRollout({
      rolloutPercent: 0,
      subjectKey: "account:stable",
    });
    const enabled = resolvePersonalizationRollout({
      rolloutPercent: 100,
      subjectKey: "account:stable",
    });
    const context = {
      personalization: { preferredMethod: "active_recall" },
      observedEvidence: [{ method: "active_recall", sessions: 4 }],
    };

    expect(personalizationInputsForRollout({ decision: baseline, ...context }))
      .toEqual({ personalization: null, observedEvidence: [] });
    expect(personalizationInputsForRollout({ decision: enabled, ...context }))
      .toEqual(context);
  });
});
