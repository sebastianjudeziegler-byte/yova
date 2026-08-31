import { z, type RefinementCtx } from "zod";
import {
  STUDY_PROFILE_CLASSIFICATIONS,
  STUDY_PROFILE_DIMENSIONS,
  STUDY_PROFILE_METHOD_CATALOG_IDS,
  STUDY_PROFILE_METHOD_FITS,
  STUDY_PROFILE_MODEL_VERSION,
  STUDY_PROFILE_NAMED_PATTERN_IDS,
  STUDY_PROFILE_REPORT_CONTENT_VERSION,
  STUDY_PROFILE_SCORING_REVISIONS,
  type StudyProfileReport,
} from "@/lib/study-profile/types";

const STUDY_PROFILE_INTERACTION_IDS = [
  "friction_structure",
  "friction_mistakes",
  "friction_attention",
  "structure_attention",
  "mistakes_overconfidence",
  "mistakes_underconfidence",
  "overconfidence_low_friction",
  "stamina_attention",
  "structure_stamina",
  "autonomy_low_friction_structure",
] as const;

const STUDY_PROFILE_RECOMMENDATION_CATEGORIES = [
  "starting",
  "structure",
  "focus",
  "checking_what_you_know",
  "handling_mistakes",
  "session_length_energy",
] as const;

const ReportTextSchema = z.string().min(1).max(10_000);
const ReportIdSchema = z.string().min(1).max(120);
const ReportTextListSchema = z.array(ReportTextSchema).max(24);

const DimensionSchema = z.enum(STUDY_PROFILE_DIMENSIONS);
const ClassificationSchema = z.enum(STUDY_PROFILE_CLASSIFICATIONS);
const MethodFitSchema = z.enum(STUDY_PROFILE_METHOD_FITS);
const MethodCatalogIdSchema = z.enum(STUDY_PROFILE_METHOD_CATALOG_IDS);

const NamedPatternSchema = z.object({
  id: z.enum(STUDY_PROFILE_NAMED_PATTERN_IDS),
  name: ReportTextSchema,
  dimension: DimensionSchema.nullable(),
  tell: ReportTextSchema,
  twist: ReportTextSchema,
  modifier: ReportTextSchema.nullable(),
}).strict();

const DimensionReportSchema = z.object({
  dimension: DimensionSchema,
  name: ReportTextSchema,
  label: ReportTextSchema,
  classification: ClassificationSchema,
  summary: ReportTextSchema,
  detail: ReportTextSchema,
}).strict();

const MethodRecommendationSchema = z.object({
  id: MethodCatalogIdSchema,
  name: ReportTextSchema,
  useWhen: ReportTextSchema,
  whyItFits: ReportTextSchema,
  steps: z.array(ReportTextSchema).min(3).max(8),
  example: ReportTextSchema,
  caution: ReportTextSchema,
  basedOn: z.array(DimensionSchema).max(STUDY_PROFILE_DIMENSIONS.length),
  timeCost: ReportTextSchema.optional(),
  tonightVersion: ReportTextSchema.optional(),
  fit: MethodFitSchema.optional(),
}).strict();

const SessionPlanSchema = z.object({
  title: ReportTextSchema,
  workMinutes: z.number().int().min(1).max(240),
  breakMinutes: z.number().int().min(0).max(60),
  rounds: z.number().int().min(1).max(12),
  bestTime: ReportTextSchema,
  setupSteps: z.array(ReportTextSchema).min(1).max(12),
  focusRule: ReportTextSchema,
  checkingRule: ReportTextSchema,
  stopRule: ReportTextSchema,
}).strict();

const InteractionSchema = z.object({
  id: z.enum(STUDY_PROFILE_INTERACTION_IDS),
  priority: z.number().int().min(0),
  dimensions: z.array(DimensionSchema).min(1).max(STUDY_PROFILE_DIMENSIONS.length),
  title: ReportTextSchema,
  summary: ReportTextSchema,
  actions: z.array(ReportTextSchema).min(1).max(12),
}).strict();

const RecommendationSchema = z.object({
  category: z.enum(STUDY_PROFILE_RECOMMENDATION_CATEGORIES),
  heading: ReportTextSchema,
  summary: ReportTextSchema,
  actions: z.array(ReportTextSchema).min(1).max(12),
  researchTags: ReportTextListSchema,
}).strict();

const MethodCatalogEntrySchema = z.object({
  id: MethodCatalogIdSchema,
  name: ReportTextSchema,
  whatItIs: ReportTextSchema,
  whyItWorks: ReportTextSchema,
  steps: z.array(ReportTextSchema).min(3).max(8),
  timeCost: ReportTextSchema,
  tonightVersion: ReportTextSchema,
  fit: MethodFitSchema,
  fitLabel: ReportTextSchema,
}).strict();

const OverviewSchema = z.array(DimensionReportSchema)
  .length(STUDY_PROFILE_DIMENSIONS.length)
  .superRefine((overview, context) => {
    ensureCompleteUniqueSet(
      overview.map(({ dimension }) => dimension),
      STUDY_PROFILE_DIMENSIONS,
      context,
      "Overview must contain each Study Profile dimension exactly once.",
    );
  });

const MethodCatalogSchema = z.array(MethodCatalogEntrySchema)
  .length(STUDY_PROFILE_METHOD_CATALOG_IDS.length)
  .superRefine((catalog, context) => {
    ensureCompleteUniqueSet(
      catalog.map(({ id }) => id),
      STUDY_PROFILE_METHOD_CATALOG_IDS,
      context,
      "Method catalog must contain each Study Profile method exactly once.",
    );
  });

const StudyProfileReportSchemaBase = z.object({
  modelVersion: z.literal(STUDY_PROFILE_MODEL_VERSION),
  scoringRevision: z.enum(STUDY_PROFILE_SCORING_REVISIONS),
  contentVersion: z.literal(STUDY_PROFILE_REPORT_CONTENT_VERSION),
  isBalanced: z.boolean(),
  pattern: NamedPatternSchema,
  freeInsight: z.object({
    heading: ReportTextSchema,
    body: ReportTextSchema,
  }).strict(),
  whyThisIsHappening: z.object({
    heading: ReportTextSchema,
    body: ReportTextSchema,
  }).strict(),
  profileNarrative: z.object({
    heading: ReportTextSchema,
    body: ReportTextSchema,
  }).strict(),
  sectionHeadings: z.object({
    overview: ReportTextSchema,
    methods: ReportTextSchema,
    primaryPattern: ReportTextSchema,
    secondaryPattern: ReportTextSchema,
    interactions: ReportTextSchema,
    adaptations: ReportTextSchema,
    warnings: ReportTextSchema,
    productPreview: ReportTextSchema,
  }).strict(),
  overview: OverviewSchema,
  playbook: z.object({
    heading: ReportTextSchema,
    intro: ReportTextSchema,
    nextSession: SessionPlanSchema,
    methods: z.array(MethodRecommendationSchema).length(3),
  }).strict(),
  methodCatalog: MethodCatalogSchema,
  primaryPattern: DimensionReportSchema,
  secondaryPattern: DimensionReportSchema,
  interactions: z.array(InteractionSchema).max(STUDY_PROFILE_INTERACTION_IDS.length),
  featuredInteraction: InteractionSchema.nullable(),
  recommendations: z.array(RecommendationSchema)
    .length(STUDY_PROFILE_RECOMMENDATION_CATEGORIES.length),
  warnings: z.array(z.object({
    id: ReportIdSchema,
    title: ReportTextSchema,
    detail: ReportTextSchema,
  }).strict()).max(12),
  protocol: z.object({
    title: ReportTextSchema,
    steps: z.array(ReportTextSchema).min(1).max(12),
  }).strict(),
  productAdaptations: z.array(z.object({
    id: ReportIdSchema,
    title: ReportTextSchema,
    detail: ReportTextSchema,
  }).strict()).length(STUDY_PROFILE_DIMENSIONS.length),
  firstImpression: z.object({
    heading: ReportTextSchema,
    body: ReportTextSchema,
    examplesLabel: ReportTextSchema,
    examples: z.array(ReportTextSchema).min(1).max(12),
    closing: ReportTextSchema,
  }).strict(),
  methodology: z.object({
    heading: ReportTextSchema,
    body: ReportTextSchema,
    researchAreas: z.array(ReportTextSchema).min(1).max(24),
  }).strict(),
}).strict().superRefine((report, context) => {
  ensureUniqueValues(
    report.playbook.methods.map(({ id }) => id),
    context,
    ["playbook", "methods"],
    "Playbook methods must be unique.",
  );
  ensureUniqueValues(
    report.recommendations.map(({ category }) => category),
    context,
    ["recommendations"],
    "Recommendations must contain each category exactly once.",
  );

  const overviewByDimension = new Map(
    report.overview.map((entry) => [entry.dimension, entry]),
  );
  if (!sameDimensionReport(
    overviewByDimension.get(report.primaryPattern.dimension),
    report.primaryPattern,
  )) {
    context.addIssue({
      code: "custom",
      path: ["primaryPattern"],
      message: "Primary pattern must match its overview entry.",
    });
  }
  if (!sameDimensionReport(
    overviewByDimension.get(report.secondaryPattern.dimension),
    report.secondaryPattern,
  )) {
    context.addIssue({
      code: "custom",
      path: ["secondaryPattern"],
      message: "Secondary pattern must match its overview entry.",
    });
  }

  const catalogIds = new Set(report.methodCatalog.map(({ id }) => id));
  report.playbook.methods.forEach((method, index) => {
    if (!catalogIds.has(method.id)) {
      context.addIssue({
        code: "custom",
        path: ["playbook", "methods", index, "id"],
        message: "Playbook method must exist in the method catalog.",
      });
    }
  });

  if (
    report.featuredInteraction
    && !report.interactions.some(({ id }) => id === report.featuredInteraction?.id)
  ) {
    context.addIssue({
      code: "custom",
      path: ["featuredInteraction"],
      message: "Featured interaction must also appear in interactions.",
    });
  }
});

/**
 * Strict client-safe validator for persisted v3 reports. Every nested object
 * rejects unknown keys, and the refinements protect the complete overview and
 * method catalog from partial or internally inconsistent stored payloads.
 */
export const StudyProfileReportSchema: z.ZodType<StudyProfileReport> =
  StudyProfileReportSchemaBase;

function ensureCompleteUniqueSet<T extends string>(
  values: readonly T[],
  expected: readonly T[],
  context: RefinementCtx<unknown>,
  message: string,
) {
  if (new Set(values).size !== expected.length || expected.some((value) => !values.includes(value))) {
    context.addIssue({ code: "custom", message });
  }
}

function ensureUniqueValues(
  values: readonly string[],
  context: RefinementCtx<unknown>,
  path: PropertyKey[],
  message: string,
) {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path, message });
  }
}

function sameDimensionReport(
  left: z.infer<typeof DimensionReportSchema> | undefined,
  right: z.infer<typeof DimensionReportSchema>,
) {
  return left !== undefined
    && left.dimension === right.dimension
    && left.name === right.name
    && left.label === right.label
    && left.classification === right.classification
    && left.summary === right.summary
    && left.detail === right.detail;
}
