import { describe, expect, it } from "vitest";
import { CURRICULUM_REGISTRY, recognizeCurriculum } from "@/lib/curriculum/registry";

describe("curriculum registry", () => {
  it("stores each enumerated official spine in source order", () => {
    expect(CURRICULUM_REGISTRY.map((curriculum) => curriculum.id)).toEqual([
      "college_board_ap_biology_2025_unit_1",
      "college_board_ap_biology_2025_unit_2",
      "ib_dp_biology_2025_theme_a",
      "ib_dp_biology_2025_theme_b",
      "ib_dp_biology_2025_theme_c",
      "ib_dp_biology_2025_theme_d",
      "college_board_sat_2025_reading_writing",
      "college_board_sat_2025_math",
      "act_enhanced_2025_english",
      "act_enhanced_2025_math",
      "act_enhanced_2025_reading",
      "act_enhanced_2025_science",
    ]);

    expect(CURRICULUM_REGISTRY.map((curriculum) => [
      curriculum.id,
      curriculum.unitCode,
      curriculum.unitTitle,
      curriculum.sourceUrl,
      curriculum.topics.map((topic) => topic.title),
    ])).toEqual([
      ["college_board_ap_biology_2025_unit_1", "1", "Chemistry of Life", "https://apcentral.collegeboard.org/media/pdf/ap-biology-course-and-exam-description.pdf", ["Structure of Water and Hydrogen Bonding", "Elements of Life", "Introduction to Macromolecules", "Carbohydrates", "Lipids", "Nucleic Acids", "Proteins"]],
      ["college_board_ap_biology_2025_unit_2", "2", "Cells", "https://apcentral.collegeboard.org/media/pdf/ap-biology-course-and-exam-description.pdf", ["Cell Structure and Function", "Cell Size", "Plasma Membrane", "Membrane Permeability", "Membrane Transport", "Facilitated Diffusion", "Tonicity and Osmoregulation", "Mechanisms of Transport", "Cell Compartmentalization", "Origins of Cell Compartmentalization"]],
      ["ib_dp_biology_2025_theme_a", "A", "Unity and diversity", "https://www.ibo.org/programmes/diploma-programme/curriculum/sciences/biology/", ["Water", "Nucleic acids", "Origins of cells (HL only)", "Cell structure", "Viruses (HL only)", "Diversity of organisms", "Classification and cladistics (HL only)", "Evolution and speciation", "Conservation of biodiversity"]],
      ["ib_dp_biology_2025_theme_b", "B", "Form and function", "https://www.ibo.org/programmes/diploma-programme/curriculum/sciences/biology/", ["Carbohydrates and lipids", "Proteins", "Membranes and membrane transport", "Organelles and compartmentalization", "Cell specialization", "Gas exchange", "Transport", "Muscle and motility (HL only)", "Adaptation to environment", "Ecological niches"]],
      ["ib_dp_biology_2025_theme_c", "C", "Interaction and interdependence", "https://www.ibo.org/programmes/diploma-programme/curriculum/sciences/biology/", ["Enzymes and metabolism", "Cell respiration", "Photosynthesis", "Chemical signalling (HL only)", "Neural signalling", "Integration of body systems", "Defence against disease", "Populations and communities", "Transfers of energy and matter"]],
      ["ib_dp_biology_2025_theme_d", "D", "Continuity and change", "https://www.ibo.org/programmes/diploma-programme/curriculum/sciences/biology/", ["DNA replication", "Protein synthesis", "Mutations and gene editing", "Cell and nuclear division", "Gene expression (HL only)", "Water potential", "Reproduction", "Inheritance", "Homeostasis", "Natural selection", "Sustainability and change", "Climate change"]],
      ["college_board_sat_2025_reading_writing", "RW", "Reading and Writing", "https://satsuite.collegeboard.org/higher-ed-professionals/sat-validity/content-domains", ["Information and Ideas", "Craft and Structure", "Expression of Ideas", "Standard English Conventions"]],
      ["college_board_sat_2025_math", "Math", "Math", "https://satsuite.collegeboard.org/higher-ed-professionals/sat-validity/content-domains", ["Algebra", "Advanced Math", "Problem-Solving and Data Analysis", "Geometry and Trigonometry"]],
      ["act_enhanced_2025_english", "English", "English", "https://www.act.org/content/act/en/products-and-services/the-act/test-preparation/act-exam-sections-and-structure.html", ["Production of Writing", "Knowledge of Language", "Conventions of Standard English"]],
      ["act_enhanced_2025_math", "Math", "Math", "https://www.act.org/content/act/en/products-and-services/the-act/test-preparation/act-exam-sections-and-structure.html", ["Preparing for Higher Math", "Integrating Essential Skills", "Modeling"]],
      ["act_enhanced_2025_reading", "Reading", "Reading", "https://www.act.org/content/act/en/products-and-services/the-act/test-preparation/act-exam-sections-and-structure.html", ["Key Ideas and Details", "Craft and Structure", "Integration of Knowledge and Ideas"]],
      ["act_enhanced_2025_science", "Science", "Science", "https://www.act.org/content/act/en/products-and-services/the-act/test-preparation/act-exam-sections-and-structure.html", ["Interpretation of Data", "Scientific Investigation", "Evaluating Scientific Arguments and Models with Evidence"]],
    ]);
  });

  it("stores the current official AP Biology Unit 2 objectives in exact order", () => {
    const curriculum = CURRICULUM_REGISTRY.find(({ id }) => id === "college_board_ap_biology_2025_unit_2");

    expect(curriculum).toMatchObject({
      id: "college_board_ap_biology_2025_unit_2",
      version: "Course and Exam Description, effective Fall 2025",
      unitCode: "2",
      unitTitle: "Cells",
      examWeight: "10%–13%",
    });
    expect(curriculum?.topics.map((topic) => `${topic.code} ${topic.title}`)).toEqual([
      "2.1 Cell Structure and Function",
      "2.2 Cell Size",
      "2.3 Plasma Membrane",
      "2.4 Membrane Permeability",
      "2.5 Membrane Transport",
      "2.6 Facilitated Diffusion",
      "2.7 Tonicity and Osmoregulation",
      "2.8 Mechanisms of Transport",
      "2.9 Cell Compartmentalization",
      "2.10 Origins of Cell Compartmentalization",
    ]);
    expect(curriculum?.topics.flatMap((topic) => topic.objectives).map((objective) => objective.code)).toEqual([
      "2.1.A",
      "2.2.A",
      "2.3.A",
      "2.3.B",
      "2.4.A",
      "2.4.B",
      "2.5.A",
      "2.5.B",
      "2.6.A",
      "2.7.A",
      "2.7.B",
      "2.8.A",
      "2.9.A",
      "2.9.B",
      "2.10.A",
    ]);
  });

  it.each([
    ["AP Biology Unit 1", "college_board_ap_biology_2025_unit_1"],
    ["AP Biology Unit 2", "college_board_ap_biology_2025_unit_2"],
    ["IB DP Biology Theme A", "ib_dp_biology_2025_theme_a"],
    ["IB DP Biology Theme B", "ib_dp_biology_2025_theme_b"],
    ["IB DP Biology Theme C", "ib_dp_biology_2025_theme_c"],
    ["IB DP Biology Theme D", "ib_dp_biology_2025_theme_d"],
    ["Digital SAT Reading & Writing", "college_board_sat_2025_reading_writing"],
    ["Digital SAT Math", "college_board_sat_2025_math"],
    ["Enhanced ACT English", "act_enhanced_2025_english"],
    ["Enhanced ACT Math", "act_enhanced_2025_math"],
    ["Enhanced ACT Reading", "act_enhanced_2025_reading"],
    ["Enhanced ACT Science", "act_enhanced_2025_science"],
  ])("recognizes an explicit supported program and unit or section: %s", (goal, id) => {
    expect(recognizeCurriculum({ goal: `Prepare for ${goal}.`, materials: [] })?.planCurriculum).toMatchObject({
      id,
      matchSource: "goal",
      matchConfidence: "exact",
    });
  });

  it("does not select a spine for an implicit, whole-test, or conflicting request", () => {
    expect(recognizeCurriculum({
      goal: "Learn cell membranes for biology.",
      materials: [],
    })).toBeNull();
    expect(recognizeCurriculum({
      goal: "Prepare for IB Biology Unit 2.",
      materials: [],
    })).toBeNull();
    expect(recognizeCurriculum({
      goal: "Prepare for the whole SAT.",
      materials: [],
    })).toBeNull();
    expect(recognizeCurriculum({
      goal: "Prepare for ACT English and ACT Math.",
      materials: [],
    })).toBeNull();
    expect(recognizeCurriculum({
      goal: "Prepare for AP Biology Unit 1 and Unit 2.",
      materials: [],
    })).toBeNull();
    expect(recognizeCurriculum({
      goal: "Prepare for SAT verbal.",
      materials: [],
    })).toBeNull();
  });

  it("can recognize the official structure from a clearly named material", () => {
    expect(recognizeCurriculum({
      goal: "Prepare for the upcoming test.",
      materials: [{ name: "AP Bio Unit 2 Study Guide.pdf" }],
    })?.planCurriculum).toMatchObject({
      matchSource: "material",
      matchConfidence: "exact",
    });
  });

  it("does not construct a curriculum match across conflicting goal or material scopes", () => {
    expect(recognizeCurriculum({
      goal: "Prepare for AP Biology Unit 2.",
      materials: [{ name: "AP Biology Unit 1 Study Guide.pdf" }],
    })).toBeNull();
    expect(recognizeCurriculum({
      goal: "Prepare for the upcoming test.",
      materials: [
        { name: "AP Biology overview.pdf" },
        { name: "Unit 2 Study Guide.pdf" },
      ],
    })).toBeNull();
  });
});
