export const STUDY_PROFILE_MODEL_VERSION = "profile_model_v1" as const;

export const STUDY_PROFILE_DIMENSIONS = [
  "starting_friction",
  "structure_need",
  "attention_variability",
  "calibration_risk",
  "mistake_sensitivity",
  "cognitive_stamina",
] as const;

export type StudyProfileDimension = (typeof STUDY_PROFILE_DIMENSIONS)[number];

export const STUDY_PROFILE_QUESTION_IDS = [
  "q1",
  "q2",
  "q3",
  "q4",
  "q5",
  "q6",
  "q7",
  "q8",
  "q9",
  "q10",
  "q11",
  "q12",
] as const;

export type StudyProfileQuestionId = (typeof STUDY_PROFILE_QUESTION_IDS)[number];

export const STUDY_PROFILE_ANSWER_IDS = ["a", "b", "c", "d"] as const;
export type StudyProfileAnswerId = (typeof STUDY_PROFILE_ANSWER_IDS)[number];

export const STUDY_PROFILE_CLASSIFICATIONS = ["low", "moderate", "high"] as const;
export type StudyProfileClassification = (typeof STUDY_PROFILE_CLASSIFICATIONS)[number];

export const STUDY_PROFILE_CALIBRATION_DIRECTIONS = [
  "relatively_calibrated",
  "mixed",
  "overconfidence_risk",
  "underconfidence_risk",
] as const;

export type StudyProfileCalibrationDirection =
  (typeof STUDY_PROFILE_CALIBRATION_DIRECTIONS)[number];

export const STUDY_PROFILE_ENERGY_WINDOWS = [
  "morning",
  "afternoon",
  "evening",
  "late_night",
  "varies",
] as const;

export type StudyProfileEnergyWindow = (typeof STUDY_PROFILE_ENERGY_WINDOWS)[number];

export const STUDY_PROFILE_SCHOOL_LEVELS = ["high_school", "college", "other"] as const;
export type StudyProfileSchoolLevel = (typeof STUDY_PROFILE_SCHOOL_LEVELS)[number];

export type StudyProfileAnswers = Record<StudyProfileQuestionId, StudyProfileAnswerId>;

export type StudyProfileQuestionOption = {
  id: StudyProfileAnswerId;
  label: string;
  score: number;
  calibrationDirection?: StudyProfileCalibrationDirection;
};

export type StudyProfileQuestion = {
  id: StudyProfileQuestionId;
  number: number;
  dimension: StudyProfileDimension;
  prompt: string;
  options: readonly StudyProfileQuestionOption[];
};

export type StudyProfileThreshold = {
  classification: StudyProfileClassification;
  min: number;
  max: number;
};

export type StudyProfileScoringConfig = {
  thresholds: readonly StudyProfileThreshold[];
  calibrationFamiliarityAnswer: StudyProfileAnswerId;
  calibrationFamiliarityRoutingBonus: number;
};

export type StudyProfileDimensionScore = {
  dimension: StudyProfileDimension;
  rawScore: number;
  normalizedScore: number;
  classification: StudyProfileClassification;
  userFacingLabel: string;
  salienceScore: number;
};

export type StudyProfilePattern = Pick<
  StudyProfileDimensionScore,
  "dimension" | "rawScore" | "classification" | "userFacingLabel" | "salienceScore"
>;

export type StudyProfileSnapshot = {
  modelVersion: typeof STUDY_PROFILE_MODEL_VERSION;
  scores: Record<StudyProfileDimension, StudyProfileDimensionScore>;
  rawScores: Record<StudyProfileDimension, number>;
  normalizedScores: Record<StudyProfileDimension, number>;
  classifications: Record<StudyProfileDimension, StudyProfileClassification>;
  calibrationDirection: StudyProfileCalibrationDirection;
  primaryPattern: StudyProfilePattern;
  secondaryPattern: StudyProfilePattern;
  isBalanced: boolean;
};

export type StudyProfileMetadata = {
  energyWindow: StudyProfileEnergyWindow;
  schoolLevel: StudyProfileSchoolLevel;
  hardestPart?: string | null;
};

export type StudyProfileInteractionId =
  | "friction_structure"
  | "friction_mistakes"
  | "friction_attention"
  | "structure_attention"
  | "mistakes_overconfidence"
  | "mistakes_underconfidence"
  | "overconfidence_low_friction"
  | "stamina_attention"
  | "structure_stamina"
  | "autonomy_low_friction_structure";

export type StudyProfileInteraction = {
  id: StudyProfileInteractionId;
  priority: number;
  dimensions: readonly StudyProfileDimension[];
  title: string;
  summary: string;
  actions: readonly string[];
};

export type StudyProfileRecommendationCategory =
  | "starting"
  | "structure"
  | "focus"
  | "checking_what_you_know"
  | "handling_mistakes"
  | "session_length_energy";

export type StudyProfileRecommendation = {
  category: StudyProfileRecommendationCategory;
  heading: string;
  summary: string;
  actions: readonly string[];
  researchTags: readonly string[];
};

export type StudyProfileWarning = {
  id: string;
  title: string;
  detail: string;
};

export type StudyProfileProductAdaptation = {
  id: string;
  title: string;
  detail: string;
};

export type StudyProfileDimensionReport = {
  dimension: StudyProfileDimension;
  name: string;
  label: string;
  classification: StudyProfileClassification;
  summary: string;
  detail: string;
};

export type StudyProfileReport = {
  modelVersion: typeof STUDY_PROFILE_MODEL_VERSION;
  isBalanced: boolean;
  profileNarrative: {
    heading: string;
    body: string;
  };
  sectionHeadings: {
    overview: string;
    primaryPattern: string;
    secondaryPattern: string;
    interactions: string;
    adaptations: string;
    warnings: string;
    productPreview: string;
  };
  overview: readonly StudyProfileDimensionReport[];
  primaryPattern: StudyProfileDimensionReport;
  secondaryPattern: StudyProfileDimensionReport;
  interactions: readonly StudyProfileInteraction[];
  featuredInteraction: StudyProfileInteraction | null;
  recommendations: readonly StudyProfileRecommendation[];
  warnings: readonly StudyProfileWarning[];
  protocol: {
    title: string;
    steps: readonly string[];
  };
  productAdaptations: readonly StudyProfileProductAdaptation[];
  firstImpression: {
    heading: string;
    body: string;
    examplesLabel: string;
    examples: readonly string[];
    closing: string;
  };
  methodology: {
    heading: string;
    body: string;
    researchAreas: readonly string[];
  };
  earlyAccess: {
    heading: string;
    buttonLabel: string;
    betaPrompt: string;
  };
};
