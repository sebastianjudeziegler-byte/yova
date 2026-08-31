import "server-only";
import {
  conceptSignalsForSession,
  evidenceSignalsForSession,
} from "@/lib/learning/concept-review-scheduler";
import { isScheduledRetrievalSession } from "@/lib/learning/scheduled-retrieval";
import {
  canGenerateReliableSession,
  generateReliableSessionWithOpenAI,
} from "@/lib/openai/reliable-session-generator";
import {
  generateSessionWithOpenAI,
  generationCauseForStats,
  markSessionGenerationContextPrepared,
  prepareSessionGenerationContext,
  SessionGenerationFailure,
  type SessionGenerationContext,
  type SessionGenerationRuntime,
} from "@/lib/openai/session-generator";
import { generateStreamedTeachingSkeletonWithOpenAI } from "@/lib/openai/streamed-teaching-generator";
import { sessionArchitectureForGeneration, usesStreamedTeaching } from "@/lib/session-generation/architecture";
import { supportsStreamedTeachingRouteMethod } from "@/lib/session-generation/method-runtime-capability";

/**
 * Keeps production and live quality evaluations on the same generation path.
 * The compact generator is faster and more predictable, but only for methods
 * whose complete learning sequence fits its deterministic activity shape.
 */
export function sessionGenerationStrategy(context: SessionGenerationContext) {
  return sessionGenerationStrategyForPreparedContext(
    prepareProductionSessionGenerationContext(context),
  );
}

function sessionGenerationStrategyForPreparedContext(
  scopedContext: SessionGenerationContext,
) {
  const runtimeArchitecture = sessionArchitectureForGeneration({
    storedVersion: scopedContext.sessionArchitectureVersion,
    learningMode: scopedContext.session.learningMode,
    studyMode: scopedContext.learningGoal.studyMode,
    reviewType: scopedContext.session.reviewType ?? null,
    selectedMethodId: scopedContext.studyRoute?.approach.primaryMethodId,
  });
  if (
    usesStreamedTeaching({ sessionArchitectureVersion: runtimeArchitecture })
    && scopedContext.session.learningMode === "learn"
    && scopedContext.learningGoal.studyMode === "inside_yova"
    && !scopedContext.session.reviewType
    && (
      !scopedContext.studyRoute
      || supportsStreamedTeachingRouteMethod(
        scopedContext.studyRoute.approach.primaryMethodId,
      )
    )
  ) return "streamed" as const;
  if (isScheduledRetrievalSession(scopedContext.session)) return "full" as const;
  return canGenerateReliableSession(scopedContext) ? "reliable" as const : "full" as const;
}

export async function generateProductionSessionWithOpenAI(
  context: SessionGenerationContext,
  runtime: SessionGenerationRuntime = {},
) {
  const startedAt = Date.now();
  const scopedContext = prepareProductionSessionGenerationContext(context);
  const generationContext = {
    ...scopedContext,
    sessionArchitectureVersion: sessionArchitectureForGeneration({
      storedVersion: scopedContext.sessionArchitectureVersion,
      learningMode: scopedContext.session.learningMode,
      studyMode: scopedContext.learningGoal.studyMode,
      reviewType: scopedContext.session.reviewType ?? null,
      selectedMethodId: scopedContext.studyRoute?.approach.primaryMethodId,
    }),
  };
  markSessionGenerationContextPrepared(generationContext);
  const strategy = sessionGenerationStrategyForPreparedContext(generationContext);
  try {
    const generated = await (strategy === "streamed"
      ? generateStreamedTeachingSkeletonWithOpenAI(generationContext, runtime)
      : strategy === "reliable"
        ? generateReliableSessionWithOpenAI(generationContext, runtime)
        : generateSessionWithOpenAI(generationContext, runtime));
    return {
      ...generated,
      generationStats: {
        ...generated.generationStats,
        strategy,
        stage: generated.generationStats.stage
          ?? (generated.generationStats.degradedMode ? "fallback" : "complete"),
        ...(generated.generationStats.degradedMode && !generated.generationStats.cause
          ? { cause: generationCauseForStats(generated.generationStats) }
          : {}),
      },
    };
  } catch (error) {
    if (error instanceof SessionGenerationFailure) {
      const stats = error.generationStats;
      throw new SessionGenerationFailure(
        error.message,
        {
          ...stats,
          strategy,
          stage: stats.stage ?? (stats.attempts === 0
            ? "preflight"
            : stats.failedValidator === "session_provider_request"
              ? "provider"
              : "validation"),
          cause: stats.cause ?? generationCauseForStats(stats),
        },
        error.structuralDiagnostic,
      );
    }
    throw new SessionGenerationFailure(
      "YOVA could not complete the selected guided-session generation strategy.",
      {
        elapsedMs: Date.now() - startedAt,
        attempts: 0,
        firstAttemptPassed: false,
        failedValidator: "session_provider_request",
        repairAttempted: false,
        repairSucceeded: null,
        repairReason: "none",
        repairDetail: null,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        strategy,
        stage: "preflight",
        cause: "unexpected",
      },
    );
  }
}

function prepareProductionSessionGenerationContext(
  context: SessionGenerationContext,
) {
  const preparedContext = prepareSessionGenerationContext(context);
  return markSessionGenerationContextPrepared(
    withSessionEvidenceScope(preparedContext),
  );
}

export function withSessionEvidenceScope(
  context: SessionGenerationContext,
): SessionGenerationContext {
  const signalScope = {
    topicIds: context.session.topicIds,
    scopeText: [
      context.session.title,
      context.session.objective,
      ...(context.session.contentTargets ?? []),
    ],
  };
  const conceptSignals = conceptSignalsForSession({
    signals: context.conceptSignals,
    ...signalScope,
  });
  const scaffoldSignals = context.scaffoldSignals
    ? evidenceSignalsForSession({ signals: context.scaffoldSignals, ...signalScope })
    : undefined;
  const topicCalibrationSignals = context.topicCalibrationSignals
    ? evidenceSignalsForSession({ signals: context.topicCalibrationSignals, ...signalScope })
    : undefined;
  const conceptSignalsUnchanged = sameSignals(conceptSignals, context.conceptSignals);
  const scaffoldSignalsUnchanged = context.scaffoldSignals === undefined
    || sameSignals(scaffoldSignals ?? [], context.scaffoldSignals);
  const calibrationSignalsUnchanged = context.topicCalibrationSignals === undefined
    || sameSignals(topicCalibrationSignals ?? [], context.topicCalibrationSignals);
  if (conceptSignalsUnchanged && scaffoldSignalsUnchanged && calibrationSignalsUnchanged) {
    return context;
  }
  return {
    ...context,
    conceptSignals,
    ...(scaffoldSignals ? { scaffoldSignals } : {}),
    ...(topicCalibrationSignals ? { topicCalibrationSignals } : {}),
  };
}

function sameSignals<Signal>(left: readonly Signal[], right: readonly Signal[]) {
  return left.length === right.length
    && left.every((signal, index) => signal === right[index]);
}
