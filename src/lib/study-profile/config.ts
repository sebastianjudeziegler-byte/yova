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
  starting_friction: "Starting Friction",
  structure_need: "Structure Need",
  attention_variability: "Attention Variability",
  calibration_risk: "Confidence Calibration",
  mistake_sensitivity: "Mistake Sensitivity",
  cognitive_stamina: "Cognitive Stamina",
};

export const STUDY_PROFILE_REPORT_SECTION_HEADINGS = {
  overview: "Your initial YOVA Study Profile",
  primaryPattern: "Your strongest pattern",
  secondaryPattern: "Your second strongest pattern",
  interactions: "How your patterns interact",
  adaptations: "How your study system should adapt",
  warnings: "What may work against you",
  productPreview: "What YOVA would do differently for you",
} as const;

export const STUDY_PROFILE_USER_FACING_LABELS = {
  starting_friction: {
    low: "Low",
    moderate: "Moderate",
    high: "High",
  },
  structure_need: {
    low: "Flexible",
    moderate: "Balanced",
    high: "High-structure",
  },
  attention_variability: {
    low: "Steady",
    moderate: "Variable",
    high: "Highly variable",
  },
  calibration_risk: {
    low: "Relatively calibrated",
    moderate: "Mixed",
    high: "Needs more checking",
  },
  mistake_sensitivity: {
    low: "Low",
    moderate: "Moderate",
    high: "High",
  },
  cognitive_stamina: {
    low: "Stable",
    moderate: "Moderate decline",
    high: "Fast decline",
  },
} as const;
