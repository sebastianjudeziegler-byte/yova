import {
  STUDY_PROFILE_CALIBRATION_PRODUCT_ADAPTATIONS,
  STUDY_PROFILE_CALIBRATION_DIRECTION_CONTENT,
  STUDY_PROFILE_CALIBRATION_RECOMMENDATIONS,
  STUDY_PROFILE_DIMENSION_CONTENT,
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
import { buildStudyProfilePlaybook } from "@/lib/study-profile/playbook";
import {
  StudyProfileAnswersSchema,
  StudyProfileMetadataSchema,
  StudyProfileSnapshotSchema,
  StudyProfileStoredResponseSchema,
  type StudyProfileStoredResponse,
} from "@/lib/study-profile/schema";
import {
  STUDY_PROFILE_REPORT_CONTENT_VERSION,
  STUDY_PROFILE_DIMENSIONS,
  type StudyProfileAnswers,
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
  answersInput?: StudyProfileAnswers,
): StudyProfileReport {
  const profile = StudyProfileSnapshotSchema.parse(profileInput);
  const metadata = parsePartialMetadata(metadataInput);
  const answers = answersInput ? StudyProfileAnswersSchema.parse(answersInput) : undefined;
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
    contentVersion: STUDY_PROFILE_REPORT_CONTENT_VERSION,
    isBalanced: profile.isBalanced,
    profileNarrative: buildProfileNarrative(profile),
    sectionHeadings: STUDY_PROFILE_REPORT_SECTION_HEADINGS,
    overview,
    playbook: buildStudyProfilePlaybook(profile, metadata, answers),
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
  };
}

export function buildStudyProfileReportFromStoredResponse(
  storedInput: StudyProfileStoredResponse,
) {
  const stored = StudyProfileStoredResponseSchema.parse(storedInput);
  return buildStudyProfileReport(stored.snapshot, stored.metadata, stored.rawAnswers);
}

function buildProfileNarrative(profile: StudyProfileSnapshot) {
  if (profile.isBalanced) {
    return {
      heading: "Your study habits are fairly balanced",
      body: "No single issue dominates your answers. The plan below focuses on the two areas most likely to make studying easier and more effective right now.",
    };
  }

  if (profile.primaryPattern.dimension === "starting_friction") {
    return {
      heading: "Make it easier to start",
      body: "Your answers suggest that beginning the work costs more energy than it should. A smaller first step and a short opening timer can help you get into real work sooner.",
    };
  }
  if (profile.primaryPattern.dimension === "structure_need") {
    return {
      heading: "Give yourself a clear next step",
      body: "You are more likely to make progress when the order of the work is already decided. A short visible plan can keep choices from using up the session.",
    };
  }
  if (profile.primaryPattern.dimension === "attention_variability") {
    return {
      heading: "Use shorter, more active study blocks",
      body: "Your focus is easier to keep when progress is visible and the activity changes on purpose. Keep one topic, then switch the way you work with it at planned points.",
    };
  }
  if (profile.primaryPattern.dimension === "calibration_risk") {
    const underconfident = profile.calibrationDirection === "underconfidence_risk";
    return underconfident
      ? {
          heading: "Let your results challenge your doubt",
          body: "Your confidence may sometimes be lower than your performance. Keep a visible record of correct closed-note answers so your next study decision uses the full result.",
        }
      : {
          heading: "Test yourself before you reread",
          body: "Material can feel familiar before it is easy to recall. A short closed-note check will show what is ready and what still needs work.",
        };
  }
  if (profile.primaryPattern.dimension === "mistake_sensitivity") {
    return {
      heading: "Make the first attempt easier to risk",
      body: "Checking, preparing, or polishing can delay the answer that would show you what to improve. Use private, low-stakes attempts and revise after you have something real to check.",
    };
  }
  return {
    heading: "Protect the quality of your study time",
    body: "Long sessions may keep going after the useful work has faded. Shorter blocks, well-timed breaks, and harder work during your best focus window can make the same time more productive.",
  };
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
