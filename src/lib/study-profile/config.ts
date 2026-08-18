import type {
  StudyProfileDimension,
  StudyProfileScoringConfig,
} from "@/lib/study-profile/types";

export const STUDY_PROFILE_THRESHOLDS = [
  { classification: "low", min: 0, max: 2 },
  { classification: "moderate", min: 3, max: 4 },
  { classification: "high", min: 5, max: 6 },
] as const;

export const DEFAULT_STUDY_PROFILE_SCORING_CONFIG: StudyProfileScoringConfig = {
  thresholds: STUDY_PROFILE_THRESHOLDS,
  calibrationFamiliarityAnswer: "d",
  calibrationFamiliarityRoutingBonus: 0.75,
};

/**
 * Used only after classification/salience are equal. This keeps true ties
 * stable and makes model changes auditable.
 */
export const STUDY_PROFILE_SALIENCE_ORDER: readonly StudyProfileDimension[] = [
  "starting_friction",
  "structure_need",
  "attention_variability",
  "mistake_sensitivity",
  "calibration_risk",
  "cognitive_stamina",
];

export const STUDY_PROFILE_DIMENSION_NAMES: Record<StudyProfileDimension, string> = {
  starting_friction: "Getting Started",
  structure_need: "Planning and Structure",
  attention_variability: "Staying Focused",
  calibration_risk: "Checking What You Know",
  mistake_sensitivity: "Handling Mistakes",
  cognitive_stamina: "Mental Energy",
};

export const STUDY_PROFILE_REPORT_SECTION_HEADINGS = {
  overview: "What your answers show",
  methods: "Study methods to try",
  primaryPattern: "Your main opportunity",
  secondaryPattern: "Another area to work on",
  interactions: "How these habits affect each other",
  adaptations: "Set up your study sessions this way",
  warnings: "Common traps to avoid",
  productPreview: "How YOVA can help",
} as const;

export const STUDY_PROFILE_USER_FACING_LABELS = {
  starting_friction: {
    low: "Usually easy to begin",
    moderate: "Some trouble beginning",
    high: "Hard to begin",
  },
  structure_need: {
    low: "Flexible",
    moderate: "Balanced",
    high: "Clear steps help most",
  },
  attention_variability: {
    low: "Steady",
    moderate: "Focus changes sometimes",
    high: "Focus changes often",
  },
  calibration_risk: {
    low: "Confidence usually matches",
    moderate: "Confidence is mixed",
    high: "Check knowledge more often",
  },
  mistake_sensitivity: {
    low: "Mistakes feel manageable",
    moderate: "Some concern about mistakes",
    high: "Mistakes can slow you down",
  },
  cognitive_stamina: {
    low: "Longer blocks can work",
    moderate: "Energy fades over time",
    high: "Short blocks work best",
  },
} as const;
