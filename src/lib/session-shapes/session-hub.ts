import type { ProduceStep, SessionRoute } from "@/lib/routing/session-route";
import type { TipStep } from "@/lib/session-shapes/session-tips";
import type { ShapeAState, ShapeAStepKind } from "@/lib/session-shapes/shape-a";
import type { ShapeCState } from "@/lib/session-shapes/shape-c";

/**
 * What the session hub's rail shows (Brief 1.5 item 6; handoff
 * session-hub-3a.md), derived from the route and the shape reducers. No new
 * state: the reducers own progression and these rows are display-only.
 */
export type HubRowStatus = "done" | "current" | "future";
export type HubRow = { key: TipStep; label: string; blurb: string; minutes: number | null; status: HubRowStatus };
export type HubRail = { kicker: string; rows: HubRow[]; tipStep: TipStep; stepNumber: number; stepCount: number };

export type HubRailInput = {
  route: SessionRoute;
  aState: ShapeAState;
  cState: ShapeCState;
  atEnd: boolean;
  inQuestions: boolean;
};

/** Splits the timer across steps by weight (largest remainder), so the rows add up to the session's timer. */
export function splitMinutes(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0) || 1;
  const exact = weights.map((weight) => (weight * total) / sum);
  const minutes = exact.map(Math.floor);
  let remaining = total - minutes.reduce((acc, value) => acc + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (remaining <= 0) break;
    minutes[index]! += 1;
    remaining -= 1;
  }
  return minutes;
}

const PRODUCE_BLURB: Record<ProduceStep, string> = {
  typed_explanation: "Source hidden. Explain it back.",
  concept_map: "Source hidden. Map it back.",
  outline: "Source hidden. Outline it back.",
  worked_solution: "Source hidden. Solve a comparable problem.",
  retrieval_questions: "Source hidden. Answer questions.",
};

/** The handoff's per-step minutes for a 25-minute Shape A and Shape C; scaled to the route's timer. */
const WEIGHT: Record<TipStep, number> = { study: 10, produce: 8, compare: 3, repair: 4, brief: 4, questions: 12, round: 5, end: 0 };

const SHAPE_A_KIND_KEY: Record<ShapeAStepKind, TipStep> = {
  direct: "study", away: "study", explanation: "study", worked_structure: "study",
  produce: "produce", compare: "compare", repair: "repair", end: "end",
};

function studyRow(route: SessionRoute): Omit<HubRow, "minutes" | "status"> {
  const brief = route.entry === "brief_review";
  return route.learnPath === "source"
    ? { key: "study", label: brief ? "Brief review" : "Study your material", blurb: "YOVA names what to look at and how." }
    : { key: "study", label: brief ? "Brief review" : "Read the explanation", blurb: "YOVA explains it, then hides it." };
}

const END_ROW = { key: "end", label: "Session complete", blurb: "What's next, and what changed." } as const;

export function hubRail({ route, aState, cState, atEnd, inQuestions }: HubRailInput): HubRail {
  const handoff = route.shape === "A" && route.produceStep === "retrieval_questions";
  let rows: Array<Omit<HubRow, "minutes" | "status">>;
  let current: TipStep;
  let kicker: string;
  if (route.shape === "C" || handoff) {
    const roundNumber = cState.phase === "loading" ? cState.rounds.length + 1 : Math.max(1, cState.rounds.length);
    rows = [
      ...(handoff ? [studyRow(route)] : route.briefStudyStep ? [{ key: "brief" as const, label: "Brief study", blurb: "Read once, then answer without it." }] : []),
      { key: "questions", label: `Closed-book round ${roundNumber}`, blurb: "No source shown." },
      { key: "round", label: "Round review", blurb: "Only what you missed comes back." },
      END_ROW,
    ];
    current = atEnd ? "end"
      : handoff ? (inQuestions ? (cState.phase === "round_complete" ? "round" : "questions") : "study")
        : cState.phase === "brief_study" ? "brief" : cState.phase === "round_complete" ? "round" : "questions";
    kicker = handoff ? "SHAPE A · STUDY → CLOSED-BOOK QUESTIONS" : "SHAPE C · CLOSED-BOOK PRACTICE";
  } else {
    rows = [];
    for (const step of aState.steps) {
      const key = SHAPE_A_KIND_KEY[step.kind];
      if (rows.at(-1)?.key === key) continue;
      rows.push(key === "study" ? studyRow(route)
        : key === "produce" ? { key, label: "Produce", blurb: PRODUCE_BLURB[route.produceStep ?? "typed_explanation"] }
          : key === "compare" ? { key, label: "Compare", blurb: "What is missing or wrong." }
            : key === "repair" ? { key, label: "Repair", blurb: "Optional. Close the named gaps." }
              : END_ROW);
    }
    const step = aState.steps[aState.index];
    current = atEnd ? "end" : step ? SHAPE_A_KIND_KEY[step.kind] : "study";
    kicker = route.produceBeforeStudy ? "SHAPE A · PRODUCE → STUDY → COMPARE → REPAIR" : "SHAPE A · STUDY → PRODUCE → COMPARE → REPAIR";
  }
  const currentIndex = Math.max(0, rows.findIndex((row) => row.key === current));
  const timed = rows.filter((row) => row.key !== "end");
  const minutes = splitMinutes(route.timerMinutes, timed.map((row) => WEIGHT[row.key]));
  return {
    kicker,
    rows: rows.map((row, index) => ({
      ...row,
      minutes: row.key === "end" ? null : minutes[timed.indexOf(row)] ?? null,
      status: index < currentIndex ? "done" : index === currentIndex ? "current" : "future",
    })),
    tipStep: current,
    stepNumber: currentIndex + 1,
    stepCount: rows.length,
  };
}

export type TimerViewInput = {
  elapsedSeconds: number;
  timerMinutes: number;
  /** The accumulated +5s. */
  extraMinutes: number;
  /** The limit (minutes) at which the learner last chose Keep going; a +5 moves the limit, so the banner can return. */
  acknowledgedLimit: number | null;
};

export function timerView({ elapsedSeconds, timerMinutes, extraMinutes, acknowledgedLimit }: TimerViewInput) {
  const limitMinutes = timerMinutes + extraMinutes;
  const over = elapsedSeconds >= limitMinutes * 60;
  return {
    limitMinutes,
    over,
    banner: over && acknowledgedLimit !== limitMinutes,
    progress: Math.min(1, elapsedSeconds / (limitMinutes * 60)),
  };
}
