// SessionMethodBriefingSchema is the narrowest learner-facing consumer.
export const STUDY_ROUTE_METHOD_MAX_LENGTH = 90;
export const STUDY_ROUTE_REASON_MAX_LENGTH = 300;
export const STUDY_ROUTE_OUTCOME_MAX_LENGTH = 500;

export type StudyRouteSessionScalars = {
  method: string;
  methodReason: string;
  objective: string;
};

/**
 * Keeps the learner-visible session row byte-for-byte compatible with the
 * canonical StudyRoute projection. Database transactions compare these
 * values exactly, so post-activation builders must share one boundary.
 */
export function canonicalStudyRouteSessionScalars<T extends StudyRouteSessionScalars>(
  value: T,
): T {
  return {
    ...value,
    method: value.method.trim().slice(0, STUDY_ROUTE_METHOD_MAX_LENGTH),
    methodReason: value.methodReason.trim().slice(0, STUDY_ROUTE_REASON_MAX_LENGTH),
    objective: value.objective.trim().slice(0, STUDY_ROUTE_OUTCOME_MAX_LENGTH),
  };
}
