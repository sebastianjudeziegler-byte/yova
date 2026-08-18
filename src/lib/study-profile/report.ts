import {
  STUDY_PROFILE_CALIBRATION_PRODUCT_ADAPTATIONS,
  STUDY_PROFILE_CALIBRATION_DIRECTION_CONTENT,
  STUDY_PROFILE_CALIBRATION_RECOMMENDATIONS,
  STUDY_PROFILE_DIMENSION_CONTENT,
  STUDY_PROFILE_EARLY_ACCESS_CONTENT,
  STUDY_PROFILE_FALLBACK_PROTOCOLS,
  STUDY_PROFILE_FIRST_IMPRESSION_CONTENT,
  STUDY_PROFILE_METHODOLOGY,
  STUDY_PROFILE_PRODUCT_ADAPTATIONS,
  STUDY_PROFILE_PROTOCOLS_BY_INTERACTION,
  STUDY_PROFILE_RECOMMENDATIONS,
  selectStudyProfileWarnings,
} from "@/lib/study-profile/content";
import { STUDY_PROFILE_REPORT_SECTION_HEADINGS } from "@/lib/study-profile/config";
import { selectStudyProfileInteractions } from "@/lib/study-profile/interactions";
import {
  StudyProfileMetadataSchema,
  StudyProfileSnapshotSchema,
  StudyProfileStoredResponseSchema,
  type StudyProfileStoredResponse,
} from "@/lib/study-profile/schema";
import {
  STUDY_PROFILE_DIMENSIONS,
  type StudyProfileDimension,
  type StudyProfileDimensionReport,
  type StudyProfileMetadata,
  type StudyProfileRecommendation,
  type StudyProfileReport,
  type StudyProfileSnapshot,
} from "@/lib/study-profile/types";

export function buildStudyProfileReport(
  profileInput: StudyProfileSnapshot,
  metadataInput?: Partial<StudyProfileMetadata>,
): StudyProfileReport {
  const profile = StudyProfileSnapshotSchema.parse(profileInput);
  const metadata = parsePartialMetadata(metadataInput);
  const overview = STUDY_PROFILE_DIMENSIONS.map((dimension) => dimensionReport(profile, dimension));
  const byDimension = new Map(overview.map((section) => [section.dimension, section]));
  const interactions = selectStudyProfileInteractions(profile);
  const featuredInteraction = interactions[0] ?? null;
  const recommendations = buildRecommendations(profile, metadata);
  const protocolSteps = featuredInteraction
    ? STUDY_PROFILE_PROTOCOLS_BY_INTERACTION[featuredInteraction.id]
    : STUDY_PROFILE_FALLBACK_PROTOCOLS[profile.primaryPattern.dimension];

  return {
    modelVersion: profile.modelVersion,
    isBalanced: profile.isBalanced,
    profileNarrative: profile.isBalanced
      ? {
          heading: "A relatively balanced initial profile",
          body: `Your answers do not point to one extreme pattern across the board. Your clearest current signal is ${primaryLabel(profile)}.`,
        }
      : {
          heading: `Your clearest pattern: ${primaryLabel(profile)}`,
          body: "This is the strongest current signal in your answers, not a fixed trait or a diagnosis.",
        },
    sectionHeadings: STUDY_PROFILE_REPORT_SECTION_HEADINGS,
    overview,
    primaryPattern: requireDimensionReport(byDimension, profile.primaryPattern.dimension),
    secondaryPattern: requireDimensionReport(byDimension, profile.secondaryPattern.dimension),
    interactions,
    featuredInteraction,
    recommendations,
    warnings: selectStudyProfileWarnings(profile, metadata, 3),
    protocol: {
      title: "Try this today",
      steps: protocolSteps,
    },
    productAdaptations: rankedDimensions(profile).map((dimension) => dimension === "calibration_risk"
      ? STUDY_PROFILE_CALIBRATION_PRODUCT_ADAPTATIONS[profile.calibrationDirection]
      : STUDY_PROFILE_PRODUCT_ADAPTATIONS[dimension][profile.classifications[dimension]]),
    firstImpression: STUDY_PROFILE_FIRST_IMPRESSION_CONTENT,
    methodology: STUDY_PROFILE_METHODOLOGY,
    earlyAccess: STUDY_PROFILE_EARLY_ACCESS_CONTENT,
  };
}

function primaryLabel(profile: StudyProfileSnapshot) {
  const content = STUDY_PROFILE_DIMENSION_CONTENT[profile.primaryPattern.dimension];
  return `${content.name} — ${profile.primaryPattern.userFacingLabel}`;
}

export function buildStudyProfileReportFromStoredResponse(
  storedInput: StudyProfileStoredResponse,
) {
  const stored = StudyProfileStoredResponseSchema.parse(storedInput);
  return buildStudyProfileReport(stored.snapshot, stored.metadata);
}

function dimensionReport(
  profile: StudyProfileSnapshot,
  dimension: StudyProfileDimension,
): StudyProfileDimensionReport {
  const score = profile.scores[dimension];
  const base = STUDY_PROFILE_DIMENSION_CONTENT[dimension].levels[score.classification];
  const content = dimension === "calibration_risk"
    ? STUDY_PROFILE_CALIBRATION_DIRECTION_CONTENT[profile.calibrationDirection]
    : base;

  return {
    dimension,
    name: STUDY_PROFILE_DIMENSION_CONTENT[dimension].name,
    label: content.label,
    classification: score.classification,
    summary: content.summary,
    detail: content.detail,
  };
}

function buildRecommendations(
  profile: StudyProfileSnapshot,
  metadata: Partial<StudyProfileMetadata>,
) {
  const recommendations: StudyProfileRecommendation[] = STUDY_PROFILE_DIMENSIONS.map((dimension) => {
    if (dimension === "calibration_risk") {
      return STUDY_PROFILE_CALIBRATION_RECOMMENDATIONS[profile.calibrationDirection];
    }
    return STUDY_PROFILE_RECOMMENDATIONS[dimension][profile.classifications[dimension]];
  });

  if (!metadata.energyWindow || metadata.energyWindow === "varies") {
    return recommendations;
  }

  const energyLabel = metadata.energyWindow.replace("_", " ");
  return recommendations.map((recommendation) => recommendation.category === "session_length_energy"
    ? {
        ...recommendation,
        actions: [
          ...recommendation.actions,
          `Protect your ${energyLabel} window for demanding work when your schedule allows.`,
        ],
      }
    : recommendation);
}

function rankedDimensions(profile: StudyProfileSnapshot) {
  const preferred = [profile.primaryPattern.dimension, profile.secondaryPattern.dimension];
  return [
    ...preferred,
    ...STUDY_PROFILE_DIMENSIONS.filter((dimension) => !preferred.includes(dimension)),
  ];
}

function parsePartialMetadata(metadata?: Partial<StudyProfileMetadata>) {
  if (!metadata) return {};
  return StudyProfileMetadataSchema.partial().parse(metadata);
}

function requireDimensionReport(
  reports: Map<StudyProfileDimension, StudyProfileDimensionReport>,
  dimension: StudyProfileDimension,
) {
  const report = reports.get(dimension);
  if (!report) throw new Error(`Study Profile report content is missing for ${dimension}.`);
  return report;
}
