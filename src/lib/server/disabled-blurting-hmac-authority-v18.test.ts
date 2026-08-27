import {
  createHash,
  createHmac,
} from "node:crypto";
import {
  readFileSync,
  readdirSync,
} from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DISABLED_BLURTING_ANSWER_HMAC_DOMAIN,
  DISABLED_BLURTING_HMAC_SECRET_MAX_BYTES,
  DISABLED_BLURTING_HMAC_SECRET_MIN_BYTES,
  DisabledBlurtingEvaluationRequestDigestClaimV18Schema,
  deriveDisabledBlurtingEvaluationDigestsV18,
  disabledBlurtingTimingSafeSha256HexEqualV18,
} from "@/lib/server/disabled-blurting-hmac-authority-v18";
import { disabledBlurtingCanonicalJsonV18 } from "@/lib/server/disabled-blurting-private-resource-v18";
import {
  DISABLED_BLURTING_EVALUATION_REQUEST_DIGEST_DOMAIN,
} from "@/lib/server/disabled-blurting-verified-completion-v18";
import {
  createDisabledBlurtingEvaluationDigestAuthorityV18,
  createDisabledBlurtingEvaluationRequestDigestClaimV18,
  verifyDisabledBlurtingEvaluationDigestAuthorityV18,
} from "@/lib/server/disabled-blurting-evaluator-contract";
import {
  DisabledBlurtingEvaluatorTransportV18Schema,
} from "@/lib/session-generation/disabled-blurting-public-delivery-v18";

const IDS = Object.freeze({
  evaluationReceipt: "a1000000-0000-4000-8000-000000000001",
  deliveryReceipt: "a1000000-0000-4000-8000-000000000002",
  resource: "a1000000-0000-4000-8000-000000000003",
  user: "a1000000-0000-4000-8000-000000000004",
  plan: "a1000000-0000-4000-8000-000000000005",
  session: "a1000000-0000-4000-8000-000000000006",
  routeRevision: "a1000000-0000-4000-8000-000000000007",
  run: "a1000000-0000-4000-8000-000000000008",
  request: "a1000000-0000-4000-8000-000000000009",
  other: "a1000000-0000-4000-8000-000000000010",
} as const);

const SECRET = "dedicated-blurting-answer-hmac-secret-0123456789-abcdef";
const ANSWER = "Removing the inhibitor increases the downstream response.";
const PRIVATE_SOURCE = "PRIVATE SOURCE TEXT MUST NEVER ENTER A DIGEST OUTPUT";

describe("disabled Blurting V18 server HMAC authority", () => {
  it("pins domain-separated HMAC and canonical request-digest vectors", () => {
    const pair = required(deriveDisabledBlurtingEvaluationDigestsV18(
      identity(),
      ANSWER,
      SECRET,
    ));
    const answerClaim = { ...identity(), learnerAnswer: ANSWER };
    const expectedAnswerHmac = createHmac("sha256", SECRET)
      .update(DISABLED_BLURTING_ANSWER_HMAC_DOMAIN, "utf8")
      .update(disabledBlurtingCanonicalJsonV18(answerClaim), "utf8")
      .digest("hex");
    const requestClaim = {
      ...identity(),
      answerHmac: expectedAnswerHmac,
      evaluatorVersion: "blurting_target_evaluator_v1" as const,
    };
    const expectedRequestDigest = createHash("sha256")
      .update(DISABLED_BLURTING_EVALUATION_REQUEST_DIGEST_DOMAIN, "utf8")
      .update(disabledBlurtingCanonicalJsonV18(requestClaim), "utf8")
      .digest("hex");

    expect(DISABLED_BLURTING_ANSWER_HMAC_DOMAIN)
      .toBe("yova.blurting.answer_hmac.v18|");
    expect(pair.answerHmac.answerHmac).toBe(expectedAnswerHmac);
    expect(pair.requestDigest).toMatchObject({
      requestClaim,
      requestDigest: expectedRequestDigest,
    });
    expect(pair.answerHmac.answerHmac)
      .toBe("65bfa886d435d3306c0ab760fed57000cc6779ab8ac8b5c7c2af59454c84660a");
    expect(pair.requestDigest.requestDigest)
      .toBe("9456e3d38ae9fcf1bdafebd4cb401e51cba38875af3232fce4b6e34ccbfb309a");
    expect(pair.answerHmac.answerHmac)
      .not.toBe(createHash("sha256").update(ANSWER).digest("hex"));
    expect(DisabledBlurtingEvaluationRequestDigestClaimV18Schema.safeParse(
      pair.requestDigest.requestClaim,
    ).success).toBe(true);
  });

  it("canonicalizes object key order but binds every owner, receipt, route, run, request, and answer field", () => {
    const original = required(deriveDisabledBlurtingEvaluationDigestsV18(
      identity(),
      ANSWER,
      SECRET,
    ));
    const reordered = required(deriveDisabledBlurtingEvaluationDigestsV18(
      reorderedIdentity(),
      ANSWER,
      SECRET,
    ));
    expect(reordered.answerHmac.answerHmac).toBe(original.answerHmac.answerHmac);
    expect(reordered.requestDigest.requestDigest)
      .toBe(original.requestDigest.requestDigest);

    const mutations = [
      { ...identity(), evaluationReceiptId: IDS.other },
      { ...identity(), deliveryReceiptId: IDS.other },
      { ...identity(), resourceId: IDS.other },
      { ...identity(), userId: IDS.other },
      { ...identity(), routeIdentity: { ...identity().routeIdentity, planId: IDS.other } },
      { ...identity(), routeIdentity: { ...identity().routeIdentity, sessionId: IDS.other } },
      {
        ...identity(),
        routeIdentity: { ...identity().routeIdentity, routeRevisionId: IDS.other },
      },
      { ...identity(), runId: IDS.other },
      { ...identity(), activityIndex: 3 },
      { ...identity(), requestToken: IDS.other },
    ];
    for (const mutation of mutations) {
      const changed = required(deriveDisabledBlurtingEvaluationDigestsV18(
        mutation,
        ANSWER,
        SECRET,
      ));
      expect(changed.answerHmac.answerHmac)
        .not.toBe(original.answerHmac.answerHmac);
      expect(changed.requestDigest.requestDigest)
        .not.toBe(original.requestDigest.requestDigest);
    }

    const changedAnswer = required(deriveDisabledBlurtingEvaluationDigestsV18(
      identity(),
      `${ANSWER} Changed.`,
      SECRET,
    ));
    expect(changedAnswer.answerHmac.answerHmac)
      .not.toBe(original.answerHmac.answerHmac);
  });

  it("rejects missing, short, oversized, padded, whitespace-only, control, NUL, and malformed secrets", () => {
    expect(DISABLED_BLURTING_HMAC_SECRET_MIN_BYTES).toBe(32);
    expect(DISABLED_BLURTING_HMAC_SECRET_MAX_BYTES).toBe(4_096);
    for (const secret of [
      undefined,
      null,
      42,
      "",
      "x".repeat(DISABLED_BLURTING_HMAC_SECRET_MIN_BYTES - 1),
      " ".repeat(DISABLED_BLURTING_HMAC_SECRET_MIN_BYTES),
      ` ${SECRET}`,
      `${SECRET} `,
      `x\n${SECRET}`,
      `x\u0000${SECRET}`,
      `x\ud800${SECRET}`,
      "x".repeat(DISABLED_BLURTING_HMAC_SECRET_MAX_BYTES + 1),
    ]) {
      expect(deriveDisabledBlurtingEvaluationDigestsV18(
        identity(),
        ANSWER,
        secret,
      )).toBeNull();
    }
    expect(deriveDisabledBlurtingEvaluationDigestsV18(
      identity(),
      ANSWER,
      "é".repeat(DISABLED_BLURTING_HMAC_SECRET_MAX_BYTES / 2 + 1),
    )).toBeNull();
  });

  it("rejects non-canonical or over-limit learner answers without rewriting them", () => {
    for (const answer of [
      undefined,
      null,
      42,
      "",
      "a",
      " ".repeat(32),
      ` ${ANSWER}`,
      `${ANSWER} `,
      "a\u0000b",
      "a\ud800b",
      "a".repeat(3_001),
    ]) {
      expect(deriveDisabledBlurtingEvaluationDigestsV18(
        identity(),
        answer,
        SECRET,
      )).toBeNull();
    }

    const scalarBound = "😀".repeat(3_000);
    expect(deriveDisabledBlurtingEvaluationDigestsV18(
      identity(),
      scalarBound,
      SECRET,
    )).not.toBeNull();
  });

  it("uses the exact reject-only learner-answer edge policy as the public transport", () => {
    for (const answer of [
      "ab",
      ANSWER,
      "a b",
      "😀".repeat(3_000),
      " a",
      "a ",
      "\u00a0a",
      "a\ufeff",
      "a\u0000b",
      "a\ud800b",
      "a".repeat(3_001),
    ]) {
      const publicResult = DisabledBlurtingEvaluatorTransportV18Schema.shape
        .learnerAnswer.safeParse(answer).success;
      const hmacResult = deriveDisabledBlurtingEvaluationDigestsV18(
        identity(),
        answer,
        SECRET,
      ) !== null;
      expect(hmacResult, JSON.stringify(answer.slice(0, 12))).toBe(publicResult);
    }
  });

  it("rejects malformed, non-canonical, and overposted identity claims", () => {
    for (const invalidIdentity of [
      null,
      {},
      { ...identity(), activityIndex: -1 },
      { ...identity(), activityIndex: 24 },
      { ...identity(), requestToken: IDS.request.toUpperCase() },
      { ...identity(), evaluationReceiptId: "not-a-uuid" },
      { ...identity(), learnerAnswer: ANSWER },
      { ...identity(), routeIdentity: { ...identity().routeIdentity, extra: true } },
    ]) {
      expect(deriveDisabledBlurtingEvaluationDigestsV18(
        invalidIdentity,
        ANSWER,
        SECRET,
      )).toBeNull();
    }
    expect(DisabledBlurtingEvaluationRequestDigestClaimV18Schema.safeParse({
      ...identity(),
      answerHmac: "ab".repeat(32),
      evaluatorVersion: "blurting_target_evaluator_v1",
      learnerAnswer: ANSWER,
    }).success).toBe(false);
  });

  it("returns frozen non-authoritative commitments whose JSON contains neither answer nor secret", () => {
    const pair = required(deriveDisabledBlurtingEvaluationDigestsV18(
      identity(),
      ANSWER,
      SECRET,
    ));
    const serialized = JSON.stringify(pair);
    expect(Object.getOwnPropertySymbols(pair.answerHmac)).toEqual([]);
    expect(Object.getOwnPropertySymbols(pair.requestDigest)).toEqual([]);
    expect(serialized).not.toContain(ANSWER);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(PRIVATE_SOURCE);
    expect(collectKeys(pair)).not.toContain("learnerAnswer");
    expect(collectKeys(pair)).not.toContain("secret");
    expectDeepFrozen(pair);
  });

  it("verifies exact replay with fixed-size timing-safe comparisons", () => {
    const pair = required(deriveDisabledBlurtingEvaluationDigestsV18(
      identity(),
      ANSWER,
      SECRET,
    ));
    expect(disabledBlurtingTimingSafeSha256HexEqualV18(
      pair.answerHmac.answerHmac,
      pair.answerHmac.answerHmac,
    )).toBe(true);
    expect(disabledBlurtingTimingSafeSha256HexEqualV18(
      pair.answerHmac.answerHmac,
      pair.requestDigest.requestDigest,
    )).toBe(false);
    expect(disabledBlurtingTimingSafeSha256HexEqualV18(
      pair.answerHmac.answerHmac,
      "not-a-digest",
    )).toBe(false);
  });

  it("keeps the evaluator high-level constructor unreachable from forged JSON", () => {
    const forgedInput = {
      boundary: "disabled_server_bound_evaluator_v18",
      authenticatedUserId: IDS.user,
      observedAt: "2026-08-25T12:00:00.000Z",
      transport: {
        learnerAnswer: ANSWER,
        requestToken: IDS.request,
        identity: {
          planId: IDS.plan,
          sessionId: IDS.session,
          routeRevisionId: IDS.routeRevision,
          runId: IDS.run,
          activityIndex: 2,
        },
      },
      deliveryReceiptId: IDS.deliveryReceipt,
      resourceId: IDS.resource,
      resourceDigest: "ab".repeat(32),
      evaluationTargets: [],
    };
    expect(createDisabledBlurtingEvaluationDigestAuthorityV18(
      forgedInput as never,
      IDS.evaluationReceipt,
      SECRET,
    )).toBeNull();
    const lowLevelPair = required(deriveDisabledBlurtingEvaluationDigestsV18(
      identity(),
      ANSWER,
      SECRET,
    ));
    expect(Object.getOwnPropertySymbols(lowLevelPair.answerHmac)).toEqual([]);
    expect(Object.getOwnPropertySymbols(lowLevelPair.requestDigest)).toEqual([]);
    expect(createDisabledBlurtingEvaluationRequestDigestClaimV18(
      forgedInput as never,
      lowLevelPair.answerHmac as never,
    )).toBeNull();
    expect(verifyDisabledBlurtingEvaluationDigestAuthorityV18(
      forgedInput as never,
      JSON.parse(JSON.stringify({})) as never,
      SECRET,
    )).toBe(false);
  });

  it("remains server-only, unwired, and absent from generation and browser code", () => {
    const authoritySource = sourceFile(
      "src/lib/server/disabled-blurting-hmac-authority-v18.ts",
    );
    const evaluatorSource = sourceFile(
      "src/lib/server/disabled-blurting-evaluator-contract.ts",
    );
    const routeSource = sourceFile("src/app/api/sessions/generate/route.ts");
    expect(authoritySource.startsWith('import "server-only";')).toBe(true);
    expect(authoritySource).not.toContain("process.env");
    expect(authoritySource).not.toMatch(/console\.|logger\.|fetch\(|supabase/iu);
    expect(authoritySource).not.toContain("RuntimeBrand");
    expect(evaluatorSource).toContain("answerHmacRuntimeBrand");
    expect(evaluatorSource).toContain("requestDigestRuntimeBrand");
    expect(evaluatorSource).not.toContain("createHmac");
    expect(routeSource).toContain("blurting_runtime_unavailable");
    expect(routeSource).not.toContain("disabled-blurting-hmac-authority-v18");

    const productionConsumers = listSourceFiles(join(process.cwd(), "src"))
      .filter((path) => !/\.test\.[cm]?[jt]sx?$/u.test(path))
      .filter((path) => path !== join(
        process.cwd(),
        "src/lib/server/disabled-blurting-hmac-authority-v18.ts",
      ))
      .filter((path) => readFileSync(path, "utf8").includes(
        "disabled-blurting-hmac-authority-v18",
      ));
    expect(productionConsumers).toEqual([
      join(
        process.cwd(),
        "src/lib/server/disabled-blurting-evaluator-contract.ts",
      ),
    ]);
  });
});

function identity() {
  return {
    evaluationReceiptId: IDS.evaluationReceipt,
    deliveryReceiptId: IDS.deliveryReceipt,
    resourceId: IDS.resource,
    userId: IDS.user,
    routeIdentity: {
      planId: IDS.plan,
      sessionId: IDS.session,
      routeRevisionId: IDS.routeRevision,
    },
    runId: IDS.run,
    activityIndex: 2,
    requestToken: IDS.request,
  } as const;
}

function reorderedIdentity() {
  return {
    requestToken: IDS.request,
    activityIndex: 2,
    runId: IDS.run,
    routeIdentity: {
      routeRevisionId: IDS.routeRevision,
      sessionId: IDS.session,
      planId: IDS.plan,
    },
    userId: IDS.user,
    resourceId: IDS.resource,
    deliveryReceiptId: IDS.deliveryReceipt,
    evaluationReceiptId: IDS.evaluationReceipt,
  } as const;
}

function required<T>(value: T | null): T {
  expect(value).not.toBeNull();
  return value as T;
}

function collectKeys(value: unknown, result = new Set<string>()): string[] {
  if (!value || typeof value !== "object") return [...result];
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, result);
  } else {
    for (const [key, child] of Object.entries(value)) {
      result.add(key);
      collectKeys(child, result);
    }
  }
  return [...result];
}

function expectDeepFrozen(value: unknown) {
  if (!value || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

function sourceFile(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"])
      .has(extname(entry.name)) ? [path] : [];
  });
}
