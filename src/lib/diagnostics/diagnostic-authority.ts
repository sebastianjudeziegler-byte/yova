import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { PlanKnowledgeMapSchema, type PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import { PlanDiagnosticQuestionSchema, type PlanDiagnosticQuestion } from "@/lib/plan-generation/schema";
import { issuePlanDraftReceipt, verifyPlanDraftReceipt } from "@/lib/server/plan-draft-receipt";

const DOMAIN = "yova.placement-challenge.v1";
const PREVIEW_SECRET = "local-development-only-yova-placement-authority-v1";
const ChallengeSchema = z.object({
  userId: z.string().min(1), planId: z.string().uuid().nullable(),
  expiresAt: z.number().int(), map: PlanKnowledgeMapSchema,
  questions: z.array(PlanDiagnosticQuestionSchema).min(1).max(8),
}).strict();
export const DiagnosticSubmissionSchema = z.object({
  challengeToken: z.string().min(1).max(1_000_000),
  answers: z.array(z.string().trim().min(1).max(180)).min(1).max(8),
}).strict();

function secrets(preview: boolean) {
  // Callers may set preview only after isDevelopmentPreviewRequest succeeds.
  if (preview && process.env.NODE_ENV !== "development") throw new Error("Placement preview is unavailable.");
  const values = preview ? [PREVIEW_SECRET] : [process.env.YOVA_DRAFT_RECEIPT_SECRET, process.env.YOVA_DRAFT_RECEIPT_PREVIOUS_SECRET];
  const current = values[0];
  if (!current || current.length < 32 || current.length > 4096) throw new Error("Placement verification is unavailable.");
  return { current, ...(values[1] ? { previous: values[1] } : {}) };
}

function encryptionKey(secret: string) {
  return createHash("sha256").update(`${DOMAIN}\0${secret}`).digest();
}

export function prepareDiagnosticChallenge(input: {
  userId: string; planId: string | null; map: PlanKnowledgeMap;
  questions: PlanDiagnosticQuestion[]; preview?: boolean;
}) {
  const payload = ChallengeSchema.parse({ userId: input.userId, planId: input.planId, map: input.map, questions: input.questions, expiresAt: Date.now() + 30 * 60_000 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secrets(input.preview ?? false).current), iv);
  cipher.setAAD(Buffer.from(DOMAIN));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const challengeToken = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
  return {
    challengeToken,
    questions: input.questions.map(({ id, topicId, prompt, options }) => ({ id, topicId, prompt, options })),
  };
}

export function readDiagnosticChallenge(token: string, userId: string, planId: string | null, preview = false) {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1" || token.length > 1_000_000) throw new Error("Invalid placement check.");
  const configured = secrets(preview);
  for (const secret of [configured.current, configured.previous].filter((value): value is string => Boolean(value))) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(parts[1]!, "base64url"));
      decipher.setAAD(Buffer.from(DOMAIN));
      decipher.setAuthTag(Buffer.from(parts[2]!, "base64url"));
      const plain = Buffer.concat([decipher.update(Buffer.from(parts[3]!, "base64url")), decipher.final()]);
      const payload = ChallengeSchema.parse(JSON.parse(plain.toString("utf8")));
      if (payload.userId !== userId || payload.planId !== planId || payload.expiresAt < Date.now()) continue;
      return payload;
    } catch { /* A rotated key may still verify this challenge. */ }
  }
  throw new Error("This placement check expired or no longer belongs to this plan. Start a fresh check.");
}

const MAP_CONTRACT = { kind: "verified_placement_map", version: 1 };
export function issueKnowledgeMapReceipt(map: PlanKnowledgeMap, userId: string, preview = false) {
  const issuedAt = Date.now();
  return issuePlanDraftReceipt({
    parsedPlan: map, normalizedGenerationContract: MAP_CONTRACT, authenticatedUserId: userId,
    issuedAt, expiresAt: issuedAt + 24 * 60 * 60_000,
  }, { secrets: secrets(preview) }).receipt;
}

export function verifyKnowledgeMapReceipt(map: PlanKnowledgeMap, receipt: string | undefined, userId: string, preview = false) {
  if (!receipt) return false;
  return verifyPlanDraftReceipt({parsedPlan: map, normalizedGenerationContract: MAP_CONTRACT, authenticatedUserId: userId, receipt}, {secrets: secrets(preview)}).ok;
}

export function mapClaimsEvidence(map: PlanKnowledgeMap) {
  return map.topics.some(topic => topic.status !== "not_started" || topic.initialEvidence !== null)
    || map.placementCheck.status === "completed"
    || map.placementCheck.demonstratedTopicIds.length > 0 || map.placementCheck.gapTopicIds.length > 0;
}
