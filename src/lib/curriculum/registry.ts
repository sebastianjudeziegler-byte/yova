import {
  CurriculumDefinitionSchema,
  type CurriculumDefinition,
  type CurriculumId,
  type PlanCurriculum,
} from "@/lib/curriculum/schema";

const AP_BIOLOGY_SOURCE = "https://apcentral.collegeboard.org/media/pdf/ap-biology-course-and-exam-description.pdf";
const IB_BIOLOGY_SOURCE = "https://www.ibo.org/programmes/diploma-programme/curriculum/sciences/biology/";
const SAT_SOURCE = "https://satsuite.collegeboard.org/higher-ed-professionals/sat-validity/content-domains";
const ACT_SOURCE = "https://www.act.org/content/act/en/products-and-services/the-act/test-preparation/act-exam-sections-and-structure.html";

function apBiologyUnit(input: {
  id: CurriculumId;
  unitCode: string;
  unitTitle: string;
  examWeight: string;
  topics: Array<{
    code: string;
    title: string;
    objectives: Array<{ code: string; text: string }>;
    prerequisiteTopicCodes?: string[];
  }>;
}) {
  return CurriculumDefinitionSchema.parse({
    id: input.id,
    framework: "ap",
    provider: "college_board",
    program: "Advanced Placement",
    courseCode: "AP Biology",
    courseTitle: "AP Biology",
    version: "Course and Exam Description, effective Fall 2025",
    effectiveFrom: "2025-08-01",
    sourceUrl: AP_BIOLOGY_SOURCE,
    unitCode: input.unitCode,
    unitTitle: input.unitTitle,
    examWeight: input.examWeight,
    topics: input.topics.map((topic) => ({
      ...topic,
      prerequisiteTopicCodes: topic.prerequisiteTopicCodes ?? [],
    })),
  });
}

const AP_BIOLOGY_2025_UNIT_1 = apBiologyUnit({
  id: "college_board_ap_biology_2025_unit_1",
  unitCode: "1",
  unitTitle: "Chemistry of Life",
  examWeight: "8%–11%",
  topics: [
    {
      code: "1.1",
      title: "Structure of Water and Hydrogen Bonding",
      objectives: [{ code: "1.1.A", text: "Explain how the properties of water that result from its polarity and hydrogen bonding affect its biological function." }],
    },
    {
      code: "1.2",
      title: "Elements of Life",
      objectives: [{ code: "1.2.A", text: "Describe the composition of macromolecules required by living organisms." }],
    },
    {
      code: "1.3",
      title: "Introduction to Macromolecules",
      objectives: [{ code: "1.3.A", text: "Describe the chemical reactions that build and break biological macromolecules." }],
      prerequisiteTopicCodes: ["1.1", "1.2"],
    },
    {
      code: "1.4",
      title: "Carbohydrates",
      objectives: [{ code: "1.4.A", text: "Describe the structure and function of carbohydrates." }],
      prerequisiteTopicCodes: ["1.3"],
    },
    {
      code: "1.5",
      title: "Lipids",
      objectives: [{ code: "1.5.A", text: "Describe the structure and function of lipids." }],
      prerequisiteTopicCodes: ["1.3"],
    },
    {
      code: "1.6",
      title: "Nucleic Acids",
      objectives: [{ code: "1.6.A", text: "Describe the structure and function of DNA and RNA." }],
      prerequisiteTopicCodes: ["1.3"],
    },
    {
      code: "1.7",
      title: "Proteins",
      objectives: [{ code: "1.7.A", text: "Describe the structure and function of proteins." }],
      prerequisiteTopicCodes: ["1.3"],
    },
  ],
});

const AP_BIOLOGY_2025_UNIT_2 = apBiologyUnit({
  id: "college_board_ap_biology_2025_unit_2",
  unitCode: "2",
  unitTitle: "Cells",
  examWeight: "10%–13%",
  topics: [
    {
      code: "2.1",
      title: "Cell Structure and Function",
      objectives: [{ code: "2.1.A", text: "Explain how the structure and function of subcellular components and organelles contribute to the function of cells." }],
    },
    {
      code: "2.2",
      title: "Cell Size",
      objectives: [{ code: "2.2.A", text: "Explain the effect of surface area-to-volume ratios on the exchange of materials between cells or organisms and the environment." }],
      prerequisiteTopicCodes: ["2.1"],
    },
    {
      code: "2.3",
      title: "Plasma Membrane",
      objectives: [
        { code: "2.3.A", text: "Describe the roles of each of the components of the cell membrane in maintaining the internal environment of the cell." },
        { code: "2.3.B", text: "Describe the fluid mosaic model of cell membranes." },
      ],
      prerequisiteTopicCodes: ["2.1"],
    },
    {
      code: "2.4",
      title: "Membrane Permeability",
      objectives: [
        { code: "2.4.A", text: "Explain how the structure of biological membranes influences selective permeability." },
        { code: "2.4.B", text: "Describe the role of the cell wall in maintaining cell structure and function." },
      ],
      prerequisiteTopicCodes: ["2.3"],
    },
    {
      code: "2.5",
      title: "Membrane Transport",
      objectives: [
        { code: "2.5.A", text: "Describe the mechanisms that organisms use to maintain solute and water balance." },
        { code: "2.5.B", text: "Describe the mechanisms that organisms use to transport large molecules across the plasma membrane." },
      ],
      prerequisiteTopicCodes: ["2.4"],
    },
    {
      code: "2.6",
      title: "Facilitated Diffusion",
      objectives: [{ code: "2.6.A", text: "Explain how the structure of a molecule affects its ability to pass through the plasma membrane." }],
      prerequisiteTopicCodes: ["2.4"],
    },
    {
      code: "2.7",
      title: "Tonicity and Osmoregulation",
      objectives: [
        { code: "2.7.A", text: "Explain how concentration gradients affect the movement of molecules across membranes." },
        { code: "2.7.B", text: "Explain how osmoregulatory mechanisms contribute to the health and survival of organisms." },
      ],
      prerequisiteTopicCodes: ["2.5", "2.6"],
    },
    {
      code: "2.8",
      title: "Mechanisms of Transport",
      objectives: [{ code: "2.8.A", text: "Describe the processes that allow ions and other molecules to move across membranes." }],
      prerequisiteTopicCodes: ["2.5", "2.6", "2.7"],
    },
    {
      code: "2.9",
      title: "Cell Compartmentalization",
      objectives: [
        { code: "2.9.A", text: "Describe the membrane-bound structures of the eukaryotic cell." },
        { code: "2.9.B", text: "Explain how internal membranes and membrane-bound organelles contribute to compartmentalization of eukaryotic cell functions." },
      ],
      prerequisiteTopicCodes: ["2.1", "2.3"],
    },
    {
      code: "2.10",
      title: "Origins of Cell Compartmentalization",
      objectives: [{ code: "2.10.A", text: "Describe similarities and/or differences in compartmentalization between prokaryotic and eukaryotic cells." }],
      prerequisiteTopicCodes: ["2.9"],
    },
  ],
});

const IB_COURSE_OBJECTIVES = [
  { code: "AO1", text: "Demonstrate knowledge of terminology, facts and concepts, and skills, techniques and methodologies.", scope: "course" as const },
  { code: "AO2", text: "Understand and apply knowledge of terminology and concepts, and skills, techniques and methodologies.", scope: "course" as const },
  { code: "AO3", text: "Analyse, evaluate, and synthesize experimental procedures, primary and secondary data, and trends, patterns and predictions.", scope: "course" as const },
  { code: "AO4", text: "Demonstrate the application of skills necessary to carry out insightful and ethical investigations.", scope: "course" as const },
];

function ibBiologyTheme(input: {
  id: CurriculumId;
  code: string;
  title: string;
  topics: Array<[string, string]>;
}) {
  return CurriculumDefinitionSchema.parse({
    id: input.id,
    framework: "ib",
    provider: "international_baccalaureate",
    program: "International Baccalaureate Diploma Programme",
    courseCode: "DP Biology",
    courseTitle: "IB Diploma Programme Biology",
    version: "Subject brief, first assessment 2025",
    effectiveFrom: "2023-08-01",
    sourceUrl: IB_BIOLOGY_SOURCE,
    unitCode: input.code,
    unitTitle: input.title,
    examWeight: null,
    topics: input.topics.map(([code, title]) => ({
      code,
      title,
      objectives: IB_COURSE_OBJECTIVES,
      prerequisiteTopicCodes: [],
    })),
  });
}

const IB_BIOLOGY_2025_THEME_A = ibBiologyTheme({
  id: "ib_dp_biology_2025_theme_a",
  code: "A",
  title: "Unity and diversity",
  topics: [
    ["A1.1", "Water"], ["A1.2", "Nucleic acids"], ["A2.1", "Origins of cells (HL only)"],
    ["A2.2", "Cell structure"], ["A2.3", "Viruses (HL only)"], ["A3.1", "Diversity of organisms"],
    ["A3.2", "Classification and cladistics (HL only)"], ["A4.1", "Evolution and speciation"],
    ["A4.2", "Conservation of biodiversity"],
  ],
});

const IB_BIOLOGY_2025_THEME_B = ibBiologyTheme({
  id: "ib_dp_biology_2025_theme_b",
  code: "B",
  title: "Form and function",
  topics: [
    ["B1.1", "Carbohydrates and lipids"], ["B1.2", "Proteins"],
    ["B2.1", "Membranes and membrane transport"], ["B2.2", "Organelles and compartmentalization"],
    ["B2.3", "Cell specialization"], ["B3.1", "Gas exchange"], ["B3.2", "Transport"],
    ["B3.3", "Muscle and motility (HL only)"], ["B4.1", "Adaptation to environment"],
    ["B4.2", "Ecological niches"],
  ],
});

const IB_BIOLOGY_2025_THEME_C = ibBiologyTheme({
  id: "ib_dp_biology_2025_theme_c",
  code: "C",
  title: "Interaction and interdependence",
  topics: [
    ["C1.1", "Enzymes and metabolism"], ["C1.2", "Cell respiration"], ["C1.3", "Photosynthesis"],
    ["C2.1", "Chemical signalling (HL only)"], ["C2.2", "Neural signalling"],
    ["C3.1", "Integration of body systems"], ["C3.2", "Defence against disease"],
    ["C4.1", "Populations and communities"], ["C4.2", "Transfers of energy and matter"],
  ],
});

const IB_BIOLOGY_2025_THEME_D = ibBiologyTheme({
  id: "ib_dp_biology_2025_theme_d",
  code: "D",
  title: "Continuity and change",
  topics: [
    ["D1.1", "DNA replication"], ["D1.2", "Protein synthesis"], ["D1.3", "Mutations and gene editing"],
    ["D2.1", "Cell and nuclear division"], ["D2.2", "Gene expression (HL only)"], ["D2.3", "Water potential"],
    ["D3.1", "Reproduction"], ["D3.2", "Inheritance"], ["D3.3", "Homeostasis"],
    ["D4.1", "Natural selection"], ["D4.2", "Sustainability and change"], ["D4.3", "Climate change"],
  ],
});

function assessmentSection(input: {
  id: CurriculumId;
  framework: "sat" | "act";
  provider: "college_board" | "act";
  program: string;
  section: string;
  version: string;
  effectiveFrom: string;
  sourceUrl: string;
  topics: Array<{ code: string; title: string; skills: string[] }>;
}) {
  return CurriculumDefinitionSchema.parse({
    id: input.id,
    framework: input.framework,
    provider: input.provider,
    program: input.program,
    courseCode: `${input.program} ${input.section}`,
    courseTitle: `${input.program} ${input.section}`,
    version: input.version,
    effectiveFrom: input.effectiveFrom,
    sourceUrl: input.sourceUrl,
    unitCode: input.section === "Reading and Writing" ? "RW" : input.section,
    unitTitle: input.section,
    examWeight: null,
    topics: input.topics.map((topic) => ({
      code: topic.code,
      title: topic.title,
      objectives: topic.skills.map((text, index) => ({ code: `${topic.code}.${index + 1}`, text })),
      prerequisiteTopicCodes: [],
    })),
  });
}

const SAT_READING_WRITING = assessmentSection({
  id: "college_board_sat_2025_reading_writing",
  framework: "sat",
  provider: "college_board",
  program: "SAT",
  section: "Reading and Writing",
  version: "Digital SAT Suite content domains, current 2025 structure",
  effectiveFrom: "2024-03-01",
  sourceUrl: SAT_SOURCE,
  topics: [
    { code: "RW-II", title: "Information and Ideas", skills: ["Central Ideas and Details", "Command of Evidence", "Inferences"] },
    { code: "RW-CS", title: "Craft and Structure", skills: ["Words in Context", "Text Structure and Purpose", "Cross-Text Connections"] },
    { code: "RW-EI", title: "Expression of Ideas", skills: ["Rhetorical Synthesis", "Transitions"] },
    { code: "RW-SEC", title: "Standard English Conventions", skills: ["Boundaries", "Form, Structure, and Sense"] },
  ],
});

const SAT_MATH = assessmentSection({
  id: "college_board_sat_2025_math",
  framework: "sat",
  provider: "college_board",
  program: "SAT",
  section: "Math",
  version: "Digital SAT Suite content domains, current 2025 structure",
  effectiveFrom: "2024-03-01",
  sourceUrl: SAT_SOURCE,
  topics: [
    { code: "M-ALG", title: "Algebra", skills: ["Linear equations in one variable", "Linear equations in two variables", "Linear functions", "Systems of two linear equations in two variables", "Linear inequalities in one or two variables"] },
    { code: "M-ADV", title: "Advanced Math", skills: ["Equivalent expressions", "Nonlinear equations in one variable and systems of equations in two variables", "Nonlinear functions"] },
    { code: "M-PSDA", title: "Problem-Solving and Data Analysis", skills: ["Ratios, rates, proportional relationships, and units", "Percentages", "One-variable data: distributions and measures of center and spread", "Two-variable data: models and scatterplots", "Probability and conditional probability", "Inference from sample statistics and margin of error", "Evaluating statistical claims: observational studies and experiments"] },
    { code: "M-GT", title: "Geometry and Trigonometry", skills: ["Area and volume", "Lines, angles, and triangles", "Right triangles and trigonometry", "Circles"] },
  ],
});

const ACT_ENGLISH = assessmentSection({
  id: "act_enhanced_2025_english",
  framework: "act",
  provider: "act",
  program: "ACT",
  section: "English",
  version: "Enhanced ACT reporting categories, effective 2025",
  effectiveFrom: "2025-09-01",
  sourceUrl: ACT_SOURCE,
  topics: [
    { code: "EN-POW", title: "Production of Writing", skills: ["Evaluate a passage's purpose, development, organization, support, and connections between ideas."] },
    { code: "EN-KOL", title: "Knowledge of Language", skills: ["Use precise and concise language and maintain an appropriate, consistent tone."] },
    { code: "EN-CSE", title: "Conventions of Standard English", skills: ["Apply grammar, usage, mechanics, sentence structure, and punctuation conventions."] },
  ],
});

const ACT_MATH = assessmentSection({
  id: "act_enhanced_2025_math",
  framework: "act",
  provider: "act",
  program: "ACT",
  section: "Math",
  version: "Enhanced ACT reporting categories, effective 2025",
  effectiveFrom: "2025-09-01",
  sourceUrl: ACT_SOURCE,
  topics: [
    { code: "MA-PHM", title: "Preparing for Higher Math", skills: ["Number and Quantity", "Algebra", "Functions", "Geometry", "Statistics and Probability"] },
    { code: "MA-IES", title: "Integrating Essential Skills", skills: ["Solve multi-step problems using rates, proportions, averages, and measurement in real-world contexts."] },
    { code: "MA-MOD", title: "Modeling", skills: ["Create, interpret, and refine mathematical models within problems."] },
  ],
});

const ACT_READING = assessmentSection({
  id: "act_enhanced_2025_reading",
  framework: "act",
  provider: "act",
  program: "ACT",
  section: "Reading",
  version: "Enhanced ACT reporting categories, effective 2025",
  effectiveFrom: "2025-09-01",
  sourceUrl: ACT_SOURCE,
  topics: [
    { code: "RE-KID", title: "Key Ideas and Details", skills: ["Identify central ideas and themes, summarize accurately, understand relationships, and draw logical inferences and conclusions."] },
    { code: "RE-CS", title: "Craft and Structure", skills: ["Interpret word meanings, analyze author choices, understand text structure and purpose, and evaluate perspectives."] },
    { code: "RE-IKI", title: "Integration of Knowledge and Ideas", skills: ["Analyze claims, distinguish fact from opinion, evaluate reasoning and evidence, and connect related passages."] },
  ],
});

const ACT_SCIENCE = assessmentSection({
  id: "act_enhanced_2025_science",
  framework: "act",
  provider: "act",
  program: "ACT",
  section: "Science",
  version: "Enhanced ACT reporting categories, effective 2025",
  effectiveFrom: "2025-09-01",
  sourceUrl: ACT_SOURCE,
  topics: [
    { code: "SC-ID", title: "Interpretation of Data", skills: ["Read and analyze tables, graphs, and diagrams, identify trends, translate formats, and reason mathematically."] },
    { code: "SC-SI", title: "Scientific Investigation", skills: ["Understand experimental design, variables, controls, goals, constraints, tradeoffs, and extensions of results."] },
    { code: "SC-EAM", title: "Evaluating Scientific Arguments and Models with Evidence", skills: ["Evaluate scientific claims with evidence and formulate conclusions and predictions using claim, evidence, and reasoning."] },
  ],
});

export const CURRICULUM_REGISTRY: readonly CurriculumDefinition[] = [
  AP_BIOLOGY_2025_UNIT_1,
  AP_BIOLOGY_2025_UNIT_2,
  IB_BIOLOGY_2025_THEME_A,
  IB_BIOLOGY_2025_THEME_B,
  IB_BIOLOGY_2025_THEME_C,
  IB_BIOLOGY_2025_THEME_D,
  SAT_READING_WRITING,
  SAT_MATH,
  ACT_ENGLISH,
  ACT_MATH,
  ACT_READING,
  ACT_SCIENCE,
];

type RegistryEntry = {
  definition: CurriculumDefinition;
  programAliases: string[];
  scopeAliases: string[];
  exactAliases: string[];
};

const REGISTRY_ENTRIES: readonly RegistryEntry[] = [
  curriculumEntry(AP_BIOLOGY_2025_UNIT_1, ["ap biology", "ap bio", "advanced placement biology"], ["unit 1", "unit one", "chemistry of life"], ["ap biology unit 1", "ap bio unit 1", "advanced placement biology unit 1"]),
  curriculumEntry(AP_BIOLOGY_2025_UNIT_2, ["ap biology", "ap bio", "advanced placement biology"], ["unit 2", "unit two", "cells"], ["ap biology unit 2", "ap bio unit 2", "advanced placement biology unit 2"]),
  curriculumEntry(IB_BIOLOGY_2025_THEME_A, ["ib biology", "ib dp biology", "ib diploma programme biology", "international baccalaureate biology", "international baccalaureate diploma programme biology"], ["theme a", "unity and diversity"], ["ib biology theme a", "ib dp biology theme a", "ib diploma programme biology theme a"]),
  curriculumEntry(IB_BIOLOGY_2025_THEME_B, ["ib biology", "ib dp biology", "ib diploma programme biology", "international baccalaureate biology", "international baccalaureate diploma programme biology"], ["theme b", "form and function"], ["ib biology theme b", "ib dp biology theme b", "ib diploma programme biology theme b"]),
  curriculumEntry(IB_BIOLOGY_2025_THEME_C, ["ib biology", "ib dp biology", "ib diploma programme biology", "international baccalaureate biology", "international baccalaureate diploma programme biology"], ["theme c", "interaction and interdependence"], ["ib biology theme c", "ib dp biology theme c", "ib diploma programme biology theme c"]),
  curriculumEntry(IB_BIOLOGY_2025_THEME_D, ["ib biology", "ib dp biology", "ib diploma programme biology", "international baccalaureate biology", "international baccalaureate diploma programme biology"], ["theme d", "continuity and change"], ["ib biology theme d", "ib dp biology theme d", "ib diploma programme biology theme d"]),
  curriculumEntry(SAT_READING_WRITING, ["sat", "digital sat"], ["reading and writing", "reading writing"], ["sat reading and writing", "sat reading writing", "digital sat reading and writing", "digital sat reading writing"]),
  curriculumEntry(SAT_MATH, ["sat", "digital sat"], ["math", "mathematics"], ["sat math", "sat mathematics", "digital sat math"]),
  curriculumEntry(ACT_ENGLISH, ["act", "enhanced act"], ["english"], ["act english", "enhanced act english"]),
  curriculumEntry(ACT_MATH, ["act", "enhanced act"], ["math", "mathematics"], ["act math", "act mathematics", "enhanced act math"]),
  curriculumEntry(ACT_READING, ["act", "enhanced act"], ["reading"], ["act reading", "enhanced act reading"]),
  curriculumEntry(ACT_SCIENCE, ["act", "enhanced act"], ["science"], ["act science", "enhanced act science"]),
];

export type CurriculumRecognitionInput = {
  goal: string;
  materials: Array<{ name: string; topicTitles?: string[] }>;
};

export type CurriculumRecognition = {
  definition: CurriculumDefinition;
  planCurriculum: PlanCurriculum;
};

export function recognizeCurriculum(input: CurriculumRecognitionInput): CurriculumRecognition | null {
  const goal = normalize(input.goal);
  const goalMatches = matchingEntries(goal);
  // Keep material boundaries intact. A course name in one upload and a unit
  // label in another is not an explicit statement of either upload's scope.
  const normalizedMaterials = input.materials.map((item) => (
    normalize([item.name, ...(item.topicTitles ?? [])].join(" "))
  ));
  const materialMatches = normalizedMaterials.flatMap((value) => matchingEntries(value));
  const uniqueMatches = new Map<CurriculumId, RegistryEntry>();
  for (const entry of [...goalMatches, ...materialMatches]) uniqueMatches.set(entry.definition.id, entry);

  // A broad multi-section request or conflicting goal/material names are not a
  // safe basis for selecting one official structure.
  if (uniqueMatches.size !== 1) return null;
  const entry = [...uniqueMatches.values()][0]!;
  const goalMatch = goalMatches.some((candidate) => candidate.definition.id === entry.definition.id);
  const materialMatch = materialMatches.some((candidate) => candidate.definition.id === entry.definition.id);
  const matchSource = goalMatch && materialMatch ? "both" : goalMatch ? "goal" : "material";
  const exact = (goalMatch && includesAnyPhrase(goal, entry.exactAliases))
    || (materialMatch && normalizedMaterials.some((value) => includesAnyPhrase(value, entry.exactAliases)));

  return {
    definition: entry.definition,
    planCurriculum: {
      id: entry.definition.id,
      framework: entry.definition.framework,
      provider: entry.definition.provider,
      program: entry.definition.program,
      courseCode: entry.definition.courseCode,
      courseTitle: entry.definition.courseTitle,
      version: entry.definition.version,
      effectiveFrom: entry.definition.effectiveFrom,
      sourceUrl: entry.definition.sourceUrl,
      unitCode: entry.definition.unitCode,
      unitTitle: entry.definition.unitTitle,
      examWeight: entry.definition.examWeight,
      matchSource,
      matchConfidence: exact ? "exact" : "alias",
    },
  };
}

export function curriculumDefinitionById(id: string) {
  return CURRICULUM_REGISTRY.find((entry) => entry.id === id) ?? null;
}

function curriculumEntry(
  definition: CurriculumDefinition,
  programAliases: string[],
  scopeAliases: string[],
  exactAliases: string[],
): RegistryEntry {
  return { definition, programAliases, scopeAliases, exactAliases };
}

function matchingEntries(value: string) {
  if (!value) return [];
  return REGISTRY_ENTRIES.filter((entry) => (
    includesAnyPhrase(value, entry.programAliases) && includesAnyPhrase(value, entry.scopeAliases)
  ));
}

function includesAnyPhrase(value: string, candidates: string[]) {
  const padded = ` ${value} `;
  return candidates.some((candidate) => padded.includes(` ${candidate} `));
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
