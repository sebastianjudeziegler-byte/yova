import {
  DEFAULT_STUDY_PROFILE_SCORING_CONFIG,
  STUDY_PROFILE_SALIENCE_ORDER,
  STUDY_PROFILE_USER_FACING_LABELS,
} from "@/lib/study-profile/config";
import { STUDY_PROFILE_QUESTIONS } from "@/lib/study-profile/questions";
import { StudyProfileAnswersSchema } from "@/lib/study-profile/schema";
import {
  STUDY_PROFILE_DIMENSIONS,
  STUDY_PROFILE_MODEL_VERSION,
  STUDY_PROFILE_SCORING_REVISION,
  type StudyProfileAnswers,
  type StudyProfileCalibrationDirection,
  type StudyProfileClassification,
  type StudyProfileDimension,
  type StudyProfileDimensionScore,
  type StudyProfilePattern,
  type StudyProfileScoringConfig,
  type StudyProfileSnapshot,
  type StudyProfileThreshold,
} from "@/lib/study-profile/types";

export function validateStudyProfileScoringConfig(config: StudyProfileScoringConfig) {
  if (!Number.isFinite(config.calibrationFamiliarityRoutingBonus)
    || config.calibrationFamiliarityRoutingBonus < 0) {
    throw new Error("Calibration routing bonus must be a non-negative number.");
  }

  const coverage = Array.from({ length: 7 }, () => 0);
  const classifications = new Set(config.thresholds.map(({ classification }) => classification));
  if (config.thresholds.length !== 3 || classifications.size !== 3) {
    throw new Error("Study Profile thresholds must define low, moderate, and high exactly once.");
  }
  for (const threshold of config.thresholds) {
    if (!Number.isInteger(threshold.min)
      || !Number.isInteger(threshold.max)
      || threshold.min < 0
      || threshold.max > 6
      || threshold.min > threshold.max) {
      throw new Error("Study Profile thresholds must use valid integer ranges from 0 through 6.");
    }

    for (let score = threshold.min; score <= threshold.max; score += 1) {
      coverage[score] += 1;
    }
  }

  if (coverage.some((count) => count !== 1)) {
    throw new Error("Study Profile thresholds must cover every score from 0 through 6 exactly once.");
  }
}

export function classifyStudyProfileScore(
  rawScore: number,
  thresholds: readonly StudyProfileThreshold[] = DEFAULT_STUDY_PROFILE_SCORING_CONFIG.thresholds,
): StudyProfileClassification {
  if (!Number.isInteger(rawScore) || rawScore < 0 || rawScore > 6) {
    throw new RangeError(`Study Profile raw score must be an integer from 0 through 6; received ${rawScore}.`);
  }

  const match = thresholds.find(({ min, max }) => rawScore >= min && rawScore <= max);
  if (!match) {
    throw new Error(`No Study Profile threshold classifies score ${rawScore}.`);
  }
  return match.classification;
}

export function scoreStudyProfile(
  answersInput: StudyProfileAnswers,
  config: StudyProfileScoringConfig = DEFAULT_STUDY_PROFILE_SCORING_CONFIG,
): StudyProfileSnapshot {
  validateStudyProfileScoringConfig(config);
  const answers = StudyProfileAnswersSchema.parse(answersInput);
  const rawScores = emptyRawScores();
  const worstAnswerScores = emptyRawScores();
  const questionCounts = emptyRawScores();

  for (const question of STUDY_PROFILE_QUESTIONS) {
    const answer = answers[question.id];
    const option = question.options.find((candidate) => candidate.id === answer);
    if (!option) {
      throw new Error(`Answer ${answer} is not valid for Study Profile question ${question.id}.`);
    }
    rawScores[question.dimension] += option.score;
    worstAnswerScores[question.dimension] = Math.max(
      worstAnswerScores[question.dimension],
      option.score,
    );
    questionCounts[question.dimension] += 1;
  }

  const calibrationDirection = resolveCalibrationDirection(answers, config);
  const scores = Object.fromEntries(STUDY_PROFILE_DIMENSIONS.map((dimension) => {
    const rawScore = rawScores[dimension];
    const meanSeverity = rawScore / questionCounts[dimension];
    const classification = classifyStudyProfileScore(rawScore, config.thresholds);
    const score: StudyProfileDimensionScore = {
      dimension,
      rawScore,
      meanSeverity,
      normalizedScore: Math.round((meanSeverity / 3) * 100),
      classification,
      userFacingLabel: resolveUserFacingLabel(dimension, classification, calibrationDirection),
      salienceScore: meanSeverity,
    };
    return [dimension, score];
  })) as Record<StudyProfileDimension, StudyProfileDimensionScore>;

  const [primaryPattern, secondaryPattern] = selectStudyProfilePatterns(
    scores,
    worstAnswerScores,
  );
  const normalizedScores = mapScores(scores, (score) => score.normalizedScore);
  const classifications = mapScores(scores, (score) => score.classification);
  const eligibleDimensions = Object.values(rawScores).filter((value) => value >= 3);

  return {
    modelVersion: STUDY_PROFILE_MODEL_VERSION,
    scoringRevision: STUDY_PROFILE_SCORING_REVISION,
    scores,
    rawScores,
    normalizedScores,
    classifications,
    calibrationDirection,
    primaryPattern,
    secondaryPattern,
    isBalanced: eligibleDimensions.length === 0,
    lowSignal: Object.values(answers).every((answer) => answer === "a"),
  };
}

export function selectStudyProfilePatterns(
  scores: Record<StudyProfileDimension, StudyProfileDimensionScore>,
  worstAnswerScores: Record<StudyProfileDimension, number> = Object.fromEntries(
    STUDY_PROFILE_DIMENSIONS.map((dimension) => [dimension, 0]),
  ) as Record<StudyProfileDimension, number>,
): readonly [StudyProfilePattern, StudyProfilePattern] {
  const priority = new Map(STUDY_PROFILE_SALIENCE_ORDER.map((dimension, index) => [dimension, index]));
  const ranked = STUDY_PROFILE_DIMENSIONS
    .map((dimension) => scores[dimension])
    .sort((left, right) => meanSeverity(right) - meanSeverity(left)
      || worstAnswerScores[right.dimension] - worstAnswerScores[left.dimension]
      || (priority.get(left.dimension) ?? Number.MAX_SAFE_INTEGER)
        - (priority.get(right.dimension) ?? Number.MAX_SAFE_INTEGER));

  return [toPattern(ranked[0]), toPattern(ranked[1])];
}

function meanSeverity(score: StudyProfileDimensionScore) {
  if (score.meanSeverity !== undefined) return score.meanSeverity;
  const questionCount = STUDY_PROFILE_QUESTIONS.filter(
    ({ dimension }) => dimension === score.dimension,
  ).length;
  return questionCount > 0 ? score.rawScore / questionCount : score.rawScore;
}

function resolveCalibrationDirection(
  answers: StudyProfileAnswers,
  config: StudyProfileScoringConfig,
): StudyProfileCalibrationDirection {
  const answer = answers.q8;
  const option = STUDY_PROFILE_QUESTIONS[7].options.find((candidate) => candidate.id === answer);
  if (!option?.calibrationDirection) {
    throw new Error("Question q8 must define a calibration direction for every option.");
  }

  // Explicit underconfidence evidence wins. A strong familiarity illusion on
  // q7 otherwise routes toward overconfidence-aware recommendations.
  if (option.calibrationDirection !== "underconfidence_risk"
    && answers.q7 === config.calibrationFamiliarityAnswer) {
    return "overconfidence_risk";
  }
  return option.calibrationDirection;
}

function resolveUserFacingLabel(
  dimension: StudyProfileDimension,
  classification: StudyProfileClassification,
  calibrationDirection: StudyProfileCalibrationDirection,
) {
  if (dimension !== "calibration_risk") {
    return STUDY_PROFILE_USER_FACING_LABELS[dimension][classification];
  }

  const calibrationLabels: Record<StudyProfileCalibrationDirection, string> = {
    relatively_calibrated: "Confidence usually matches",
    mixed: "Confidence is mixed",
    overconfidence_risk: "Test yourself sooner",
    underconfidence_risk: "Trust correct results more",
  };
  return calibrationLabels[calibrationDirection];
}

function emptyRawScores(): Record<StudyProfileDimension, number> {
  return {
    starting_friction: 0,
    structure_need: 0,
    attention_variability: 0,
    calibration_risk: 0,
    mistake_sensitivity: 0,
    cognitive_stamina: 0,
  };
}

function mapScores<T>(
  scores: Record<StudyProfileDimension, StudyProfileDimensionScore>,
  select: (score: StudyProfileDimensionScore) => T,
) {
  return Object.fromEntries(STUDY_PROFILE_DIMENSIONS.map((dimension) => [
    dimension,
    select(scores[dimension]),
  ])) as Record<StudyProfileDimension, T>;
}

function toPattern(score: StudyProfileDimensionScore): StudyProfilePattern {
  return {
    dimension: score.dimension,
    rawScore: score.rawScore,
    classification: score.classification,
    userFacingLabel: score.userFacingLabel,
    salienceScore: score.salienceScore,
  };
}
