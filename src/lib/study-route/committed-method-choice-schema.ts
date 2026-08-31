import { z } from "zod";
import { CORE_METHOD_IDS } from "@/lib/learning/method-catalog";
import { AgencyMethodRequestResolutionSchema } from "@/lib/study-route/agency-mode-controller";
import { StudyRouteSchema } from "@/lib/study-route/schema";

export const CommittedMethodChoiceRequestSchema = z.object({
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  expectedRouteRevisionId: z.string().uuid(),
  changeRequestId: z.string().uuid(),
  selectionScope: z.enum(["stored_alternative", "other_eligible_method"]).optional(),
  methodId: z.enum(CORE_METHOD_IDS).optional(),
  requestedMethod: z.string().trim().min(1).max(100).optional(),
}).strict().superRefine((request, context) => {
  if (request.changeRequestId === request.expectedRouteRevisionId) {
    context.addIssue({
      code: "custom",
      path: ["changeRequestId"],
      message: "A route-change operation must use a fresh revision identifier.",
    });
  }
  const other = request.selectionScope === "other_eligible_method";
  if (other !== (request.requestedMethod !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["requestedMethod"],
      message: "Other methods requires one bounded requested label.",
    });
  }
  if (other === (request.methodId !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["methodId"],
      message: "A stored alternative and an Other-method label are mutually exclusive.",
    });
  }
});

export const CommittedMethodChoiceSessionSchema = z.object({
  id: z.string().uuid(),
  method: z.string().trim().min(1).max(100),
  methodReason: z.string().trim().min(1).max(300),
  estimatedMinutes: z.number().int().min(5).max(180),
  studyRoute: StudyRouteSchema,
}).strict().superRefine((session, context) => {
  const route = session.studyRoute;
  if (session.method !== route.approach.visibleMethodName) {
    context.addIssue({
      code: "custom",
      path: ["method"],
      message: "The returned method must project the authoritative StudyRoute.",
    });
  }
  if (session.methodReason !== route.explanation.shortReason) {
    context.addIssue({
      code: "custom",
      path: ["methodReason"],
      message: "The returned method reason must project the authoritative StudyRoute.",
    });
  }
  if (session.estimatedMinutes !== route.timing.activeMinutes) {
    context.addIssue({
      code: "custom",
      path: ["estimatedMinutes"],
      message: "The returned duration must project the authoritative StudyRoute.",
    });
  }
});

export const CommittedMethodChoiceResponseSchema = z.object({
  status: z.enum(["updated", "unchanged", "replayed"]),
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  previousRouteRevisionId: z.string().uuid(),
  session: CommittedMethodChoiceSessionSchema,
  requestId: z.string().uuid(),
  methodRequestResolution: AgencyMethodRequestResolutionSchema.nullable().optional(),
}).strict().superRefine((response, context) => {
  const route = response.session.studyRoute;
  if (
    response.session.id !== response.planSessionId
    || route.identity.planId !== response.planId
    || route.identity.sessionId !== response.planSessionId
  ) {
    context.addIssue({
      code: "custom",
      path: ["session"],
      message: "The returned method choice must belong to the requested plan session.",
    });
  }
  if (
    response.status === "unchanged"
    && route.identity.routeRevisionId !== response.previousRouteRevisionId
  ) {
    context.addIssue({
      code: "custom",
      path: ["session", "studyRoute", "identity", "routeRevisionId"],
      message: "An unchanged method choice must retain the current route revision.",
    });
  }
  if (
    response.status !== "unchanged"
    && route.identity.supersedesRevisionId !== response.previousRouteRevisionId
  ) {
    context.addIssue({
      code: "custom",
      path: ["session", "studyRoute", "identity", "supersedesRevisionId"],
      message: "A changed method choice must return the direct committed successor.",
    });
  }
  if (
    response.methodRequestResolution
    && response.methodRequestResolution.selectedMethodId
      !== route.approach.primaryMethodId
  ) {
    context.addIssue({
      code: "custom",
      path: ["methodRequestResolution", "selectedMethodId"],
      message: "The verified method mapping must match the authoritative returned route.",
    });
  }
});

export type CommittedMethodChoiceRequest = z.infer<
  typeof CommittedMethodChoiceRequestSchema
>;
export type CommittedMethodChoiceResponse = z.infer<
  typeof CommittedMethodChoiceResponseSchema
>;
