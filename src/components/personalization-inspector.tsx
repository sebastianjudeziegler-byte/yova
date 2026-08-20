"use client";

import { useMemo, useState } from "react";
import { CORE_METHOD_CATALOG, LEARNING_TASK_TYPES, type LearningTaskType } from "@/lib/learning/method-catalog";
import { buildLearningScienceRoutingBrief } from "@/lib/learning/method-router";
import { LEARNER_PERSONAS, personaRoutingInput } from "@/lib/learning/persona-fixtures";
import type { SessionLearningMode } from "@/lib/domain";

import styles from "./personalization-inspector.module.css";

/**
 * A development-only view of the routing decision.
 *
 * The recurring question about this system has been whether personalization is
 * actually running or whether the method is a label on an otherwise identical
 * session. This answers it directly: the same goal is routed for every fixture
 * learner, side by side, with the score that produced each result.
 *
 * It calls the real router. Nothing here is a mock or a re-implementation, so a
 * result shown here is the result a learner in that state would receive.
 */

const TASK_LABELS: Record<LearningTaskType, string> = {
  memorization: "Memorization",
  conceptual_learning: "Conceptual learning",
  problem_solving: "Problem solving",
  reading_to_quiz: "Reading to quiz",
  writing_argumentation: "Writing / argumentation",
  programming: "Programming",
  mixed_assessment: "Mixed assessment",
};

const DEFAULT_GOAL = "Recall the products of glycolysis and the Krebs cycle";

export function PersonalizationInspector() {
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [taskType, setTaskType] = useState<LearningTaskType | "auto">("auto");
  const [mode, setMode] = useState<SessionLearningMode>("study");
  const [openPersonaId, setOpenPersonaId] = useState<string | null>(null);

  const routes = useMemo(() => LEARNER_PERSONAS.map((persona) => {
    const routing = buildLearningScienceRoutingBrief(personaRoutingInput(persona, {
      goalTitle: goal,
      goalTopic: goal,
      sessionTitle: goal,
      sessionObjective: goal,
      sessionLearningMode: mode,
      learningIntent: mode === "learn" ? "learn" : "study",
      ...(taskType === "auto" ? {} : { taskTypeOverride: taskType }),
    }));
    return { persona, routing };
  }), [goal, taskType, mode]);

  const distinctMethods = new Set(routes.map((row) => row.routing.suggestedPrimaryMethodId));
  const open = routes.find((row) => row.persona.id === openPersonaId) ?? null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>DEVELOPMENT ONLY</span>
        <h1>Personalization inspector</h1>
        <p>
          One goal, routed for every fixture learner. Everything below comes from the real
          router, so a method shown here is the method that learner would receive.
        </p>
      </header>

      <section className={styles.controls}>
        <label className={styles.goalField}>
          <span>Goal</span>
          <input value={goal} onChange={(event) => setGoal(event.target.value)} />
        </label>
        <label>
          <span>Task type</span>
          <select value={taskType} onChange={(event) => setTaskType(event.target.value as LearningTaskType | "auto")}>
            <option value="auto">Auto-classify from the goal</option>
            {LEARNING_TASK_TYPES.map((type) => (
              <option key={type} value={type}>{TASK_LABELS[type]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Session mode</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as SessionLearningMode)}>
            <option value="learn">Teaching first</option>
            <option value="study">Practice first</option>
          </select>
        </label>
      </section>

      <p className={distinctMethods.size > 1 ? styles.verdictGood : styles.verdictFlat}>
        {distinctMethods.size > 1
          ? `${distinctMethods.size} different methods across ${routes.length} learners for this goal.`
          : "Every learner receives the same method for this goal. That is expected when the task and stage leave only one valid option."}
      </p>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Learner</th>
            <th>Task</th>
            <th>Stage</th>
            <th>Method</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {routes.map(({ persona, routing }) => (
            <tr
              key={persona.id}
              className={persona.id === openPersonaId ? styles.activeRow : undefined}
              onClick={() => setOpenPersonaId(persona.id === openPersonaId ? null : persona.id)}
            >
              <td>
                <strong>{persona.name}</strong>
                <small>{persona.summary}</small>
              </td>
              <td>{TASK_LABELS[routing.taskType]}</td>
              <td>{routing.knowledgeStage.replaceAll("_", " ")}</td>
              <td>
                <span className={styles.method}>
                  {CORE_METHOD_CATALOG[routing.suggestedPrimaryMethodId].name}
                </span>
              </td>
              <td className={styles.reason}>
                {routing.methodFit?.learnerFacingReason
                  ?? <em>No learner signal applied — task fit alone.</em>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {open && (
        <section className={styles.detail}>
          <h2>{open.persona.name}</h2>
          <p className={styles.detailSummary}>{open.persona.summary}</p>

          <h3>Method scores</h3>
          <p className={styles.hint}>
            Only methods valid for this task and knowledge stage are scored. A learner signal
            orders them; it never adds one the task does not allow.
          </p>
          <table className={styles.scoreTable}>
            <thead>
              <tr>
                <th>Method</th>
                <th>Catalog order</th>
                <th>Declared</th>
                <th>Observed</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {(open.routing.methodFit?.scores ?? []).map((score, index) => (
                <tr key={score.methodId} className={index === 0 ? styles.winner : undefined}>
                  <td>{score.methodName}{index === 0 && <span className={styles.chosen}>chosen</span>}</td>
                  <td>{score.baselineScore.toFixed(2)}</td>
                  <td>{score.declaredScore.toFixed(2)}</td>
                  <td>{score.observedScore.toFixed(2)}</td>
                  <td><strong>{score.total.toFixed(2)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Signals behind the chosen method</h3>
          {(open.routing.methodFit?.scores[0]?.signals ?? []).length > 0 ? (
            <ul className={styles.signals}>
              {open.routing.methodFit?.scores[0]?.signals.map((signal) => (
                <li key={`${signal.source}-${signal.reason}`}>
                  <span className={styles.sourceTag}>{signal.source}</span>
                  {signal.reason}
                  <span className={styles.weight}>+{signal.weight.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.hint}>None. This learner has told YOVA nothing relevant to this task.</p>
          )}

          <h3>Router rationale</h3>
          <ul className={styles.basis}>
            {open.routing.decisionBasis.map((line) => <li key={line}>{line}</li>)}
          </ul>

          <h3>Delivery changes</h3>
          {open.routing.deliveryModifiers.length > 0 ? (
            <ul className={styles.basis}>
              {open.routing.deliveryModifiers.map((line) => <li key={line}>{line}</li>)}
            </ul>
          ) : (
            <p className={styles.hint}>No delivery modifiers for this learner.</p>
          )}
        </section>
      )}
    </div>
  );
}
