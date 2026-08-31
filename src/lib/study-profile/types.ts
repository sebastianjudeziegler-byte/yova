export const STUDY_PROFILE_MODEL_VERSION = "profile_model_v1" as const;
export const STUDY_PROFILE_LEGACY_SCORING_REVISION = "study_profile_scoring_v1" as const;
export const STUDY_PROFILE_SCORING_REVISION = "study_profile_scoring_v2" as const;
export const STUDY_PROFILE_SCORING_REVISIONS = [
  STUDY_PROFILE_LEGACY_SCORING_REVISION,
  STUDY_PROFILE_SCORING_REVISION,
] as const;
export type StudyProfileScoringRevision = (typeof STUDY_PROFILE_SCORING_REVISIONS)[number];
export const STUDY_PROFILE_REPORT_CONTENT_VERSION = "study_profile_report_v3" as const;

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

export const STUDY_PROFILE_STUDY_GOALS = [
  "upcoming_exams",
  "keeping_up",
  "catching_up",
  "specific_qualification",
  "better_habits",
] as const;
export type StudyProfileStudyGoal = (typeof STUDY_PROFILE_STUDY_GOALS)[number];

export const STUDY_PROFILE_NAMED_PATTERN_IDS = [
  "stalled_starter",
  "scattershot",
  "drifter",
  "familiarity_trap",
  "evidence_doubter",
  "polisher",
  "sprinter",
  "all_rounder",
] as const;
export type StudyProfileNamedPatternId = (typeof STUDY_PROFILE_NAMED_PATTERN_IDS)[number];

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
  /** Mean answer severity on the 0 through 3 response scale. */
  meanSeverity?: number;
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
  /** Absent only on pre-revamp snapshots using the original ranking rules. */
  scoringRevision?: typeof STUDY_PROFILE_SCORING_REVISION;
  scores: Record<StudyProfileDimension, StudyProfileDimensionScore>;
  rawScores: Record<StudyProfileDimension, number>;
  normalizedScores: Record<StudyProfileDimension, number>;
  classifications: Record<StudyProfileDimension, StudyProfileClassification>;
  calibrationDirection: StudyProfileCalibrationDirection;
  primaryPattern: StudyProfilePattern;
  secondaryPattern: StudyProfilePattern;
  isBalanced: boolean;
  /** Internal signal for the all-A speed-run/social-desirability case. */
  lowSignal?: boolean;
};

export type StudyProfileMetadata = {
  energyWindow: StudyProfileEnergyWindow;
  schoolLevel: StudyProfileSchoolLevel;
  studyGoal?: StudyProfileStudyGoal | null;
  hardestPart?: string | null;
};

export type StudyProfileNamedPattern = {
  id: StudyProfileNamedPatternId;
  name: string;
  dimension: StudyProfileDimension | null;
  tell: string;
  twist: string;
  modifier: string | null;
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

export type StudyProfileMethodRecommendation = {
  id: string;
  name: string;
  useWhen: string;
  whyItFits: string;
  steps: readonly string[];
  example: string;
  caution: string;
  basedOn: readonly StudyProfileDimension[];
  timeCost?: string;
  tonightVersion?: string;
  fit?: StudyProfileMethodFit;
};

export const STUDY_PROFILE_METHOD_FITS = [
  "strong_fit",
  "situational",
  "skip_for_now",
] as const;
export type StudyProfileMethodFit = (typeof STUDY_PROFILE_METHOD_FITS)[number];

export const STUDY_PROFILE_METHOD_CATALOG_IDS = [
  "active_recall",
  "spaced_practice",
  "exam_condition_practice",
  "error_log",
  "teach_back",
  "five_minute_start",
  "implementation_intentions",
  "timeboxing",
  "interleaving",
  "brain_dump",
  "pretesting",
  "worked_example_fading",
  "elaborative_interrogation",
  "weekly_review",
  "session_shutdown",
] as const;
export type StudyProfileMethodCatalogId = (typeof STUDY_PROFILE_METHOD_CATALOG_IDS)[number];

export type StudyProfileMethodCatalogDefinition = {
  id: StudyProfileMethodCatalogId;
  name: string;
  whatItIs: string;
  whyItWorks: string;
  steps: readonly string[];
  timeCost: string;
  tonightVersion: string;
  fitByPattern: Record<StudyProfileNamedPatternId, StudyProfileMethodFit>;
};

export type StudyProfileMethodCatalogEntry = Omit<
  StudyProfileMethodCatalogDefinition,
  "fitByPattern"
> & {
  fit: StudyProfileMethodFit;
  fitLabel: string;
};

export type StudyProfileSessionPlan = {
  title: string;
  workMinutes: number;
  breakMinutes: number;
  rounds: number;
  bestTime: string;
  setupSteps: readonly string[];
  focusRule: string;
  checkingRule: string;
  stopRule: string;
};

export type StudyProfilePlaybook = {
  heading: string;
  intro: string;
  nextSession: StudyProfileSessionPlan;
  methods: readonly StudyProfileMethodRecommendation[];
};

export type StudyProfileReport = {
  modelVersion: typeof STUDY_PROFILE_MODEL_VERSION;
  scoringRevision: StudyProfileScoringRevision;
  contentVersion: typeof STUDY_PROFILE_REPORT_CONTENT_VERSION;
  isBalanced: boolean;
  pattern: StudyProfileNamedPattern;
  freeInsight: {
    heading: string;
    body: string;
  };
  whyThisIsHappening: {
    heading: string;
    body: string;
  };
  profileNarrative: {
    heading: string;
    body: string;
  };
  sectionHeadings: {
    overview: string;
    methods: string;
    primaryPattern: string;
    secondaryPattern: string;
    interactions: string;
    adaptations: string;
    warnings: string;
    productPreview: string;
  };
  overview: readonly StudyProfileDimensionReport[];
  playbook: StudyProfilePlaybook;
  methodCatalog: readonly StudyProfileMethodCatalogEntry[];
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
};
