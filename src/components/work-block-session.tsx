"use client";

import { useEffect, useMemo, useState } from "react";
import { ReviewedBlockExplanation } from "./reviewed-block-explanation";
import { LearningContent } from "./learning-content";
import { z } from "zod";
import { ConceptEvidenceListSchema } from "@/lib/learning/concept-evidence";
import { BlockProgressSchema, blockCanComplete, type BlockAction, type BlockProgress } from "@/lib/session-blocks/progress";
import type { WorkBlock } from "@/lib/session-blocks/schema";
import { TutorResponseSchema } from "@/lib/tutor/schema";
import styles from "./work-block-session.module.css";

const SummarySchema = z.object({ correctAnswers: z.number().int().min(0), totalAnswers: z.number().int().min(0),
  conceptEvidence: ConceptEvidenceListSchema, observedGap: z.string() });
export type CheckedBlockSummary = z.infer<typeof SummarySchema>;
const ResponseSchema = z.object({ progress: BlockProgressSchema,
  solutions: z.record(z.string(), z.object({ answer: z.string(), explanation: z.string(), workedSolution: z.array(z.string()) })).default({}),
  summary: SummarySchema.optional(),
});
type Step = { id: string; activityId: string; questionId?: string; sourceId?: string };

export function WorkBlockSession({ block, planId, planSessionId, routeRevisionId, onExit, onFinish, onProgress }: {
  block: WorkBlock; planId: string; planSessionId: string; routeRevisionId: string;
  onProgress: (progress: BlockProgress) => void; onExit: () => void; onFinish: (summary: CheckedBlockSummary) => Promise<boolean>;
}) {
  const [saved, setSaved] = useState<z.infer<typeof ResponseSchema> | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const [help, setHelp] = useState<string | null>(null);
  const [helpPending, setHelpPending] = useState(false);
  const steps = useMemo(() => block.activities.flatMap((activity): Step[] => activity.questionIds.length
    ? activity.questionIds.map(questionId => ({ id: questionId, activityId: activity.id, questionId }))
    : [{ id: activity.id, activityId: activity.id, ...(activity.sourceId ? { sourceId: activity.sourceId } : {}) }]), [block]);
  const done = (step: Step, progress: BlockProgress) => step.sourceId ? progress.sourceCompletedIds.includes(step.sourceId)
    : step.questionId ? progress.attempts.some(attempt => attempt.questionId === step.questionId) : progress.explanationCompletedIds.includes(step.activityId);
  const step = steps.find(item => item.id === cursor);
  const activity = block.activities.find(item => item.id === step?.activityId);
  const question = block.questions.find(item => item.id === step?.questionId);
  const source = block.sources.find(item => item.id === step?.sourceId);
  const attempt = saved?.progress.attempts.find(item => item.questionId === question?.id);
  const solution = question ? saved?.solutions[question.id] : undefined;

  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/sessions/block", { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
      body: JSON.stringify({ planId, planSessionId, routeRevisionId, blockId: block.id, action: "state" }),
    }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "YOVA could not load your saved practice.");
      const parsed = ResponseSchema.parse(body);
      if (parsed.progress.blockId !== block.id) throw new Error("The saved progress belongs to another block.");
      if (!abort.signal.aborted) { setSaved(parsed); onProgress(parsed.progress); setCursor(steps.find(item => !done(item, parsed.progress))?.id ?? null); }
    }).catch(error => { if (!abort.signal.aborted) setIssue(error instanceof Error ? error.message : "Your practice could not be loaded."); });
    return () => abort.abort();
  // The block is immutable; changing its identity remounts the entire workspace.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, planId, planSessionId, routeRevisionId, steps]);

  async function act(action: BlockAction, advance = false) {
    if (busy || !saved) return false;
    setBusy(true); setIssue(null);
    try {
      const response = await fetch("/api/sessions/block", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, planSessionId, routeRevisionId, blockId: block.id, ...action }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Your change could not be saved. Previous practice is saved.");
      const parsed = ResponseSchema.parse(body);
      if (parsed.progress.blockId !== block.id) throw new Error("The saved progress belongs to another block.");
      setSaved(parsed); onProgress(parsed.progress);
      if (advance) { setCursor(steps.find(item => !done(item, parsed.progress))?.id ?? null); setAnswer(""); setHelp(null); }
      return true;
    } catch (error) { setIssue(error instanceof Error ? error.message : "Your previous practice is saved."); return false; }
    finally { setBusy(false); }
  }
  function continueWork() {
    if (!saved) return;
    setCursor(steps.find(item => !done(item, saved.progress))?.id ?? null); setAnswer(""); setHelp(null); setIssue(null);
  }
  async function ask(intent: "explain_differently" | "show_example" | "repair_gap") {
    if (helpPending || !activity) return;
    setHelpPending(true); setIssue(null);
    try {
      if (question && !attempt && !await act({ action: "help_requested", questionId: question.id })) return;
      const response = await fetch("/api/tutor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        planId, threadId: null, persistenceMode: "ephemeral", history: [],
        question: intent === "show_example" ? "Show me one example for this step, then let me continue." : intent === "repair_gap" ? `Why was my answer wrong? ${attempt?.feedback ?? answer}` : "Explain this step briefly, then let me continue.",
        sessionContext: { planSessionId, activityIndex: block.activities.indexOf(activity), activityTitle: activity.title.slice(0, 180),
          activityType: question ? question.format === "multiple_choice" ? "multiple_choice" : "free_response" : "instruction",
          activityInstruction: (question?.prompt ?? activity.instructions).slice(0, 500), concept: question?.prompt.slice(0, 180) ?? null,
          methodPhase: question ? "retrieve" : "model", teachingSummary: ((source?.text ?? block.sources.filter(item => item.topicId === activity.topicId).map(item => item.text).join("\n")) || activity.content).slice(0, 1_200) || null,
          choices: question?.choices.map(value => value.slice(0, 220)) ?? [], referenceAnswer: solution?.answer.slice(0, 800) ?? null,
          feedback: attempt?.feedback.slice(0, 600) ?? null, answerState: attempt ? attempt.outcome === "secure" ? "correct" : "incorrect" : "not_attempted",
          selectedChoice: answer.slice(0, 220) || null, helpIntent: intent },
      }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Help is unavailable. Your practice is saved.");
      setHelp(TutorResponseSchema.parse(body).messages.filter(item => item.role === "assistant").map(item => item.content).join("\n\n"));
    } catch (error) { setIssue(error instanceof Error ? error.message : "Help is unavailable. Your practice is saved."); }
    finally { setHelpPending(false); }
  }
  return <main className={`session-shell ${styles.shell}`}><section className={styles.block} role="region" aria-label="Session work block">
    <header><span className={styles.eyebrow}>Your block · about {block.estimatedMinutes} minutes</span><h1>{block.objective}</h1><p>{block.instructions}</p><p className={styles.reason}>{block.personalization.profileReason}</p></header>
    <div className={styles.progress} aria-label="Block progress">{saved ? steps.filter(item => done(item, saved.progress)).length : 0} of {steps.length} steps finished</div>
    {issue && <p role="alert" className={styles.issue}>{issue}</p>}
    {!saved && !issue && <p role="status">Opening your saved work…</p>}
    {saved?.progress.complete ? <section><h2>Block finished</h2><p role="status" className={styles.receipt}>{saved.progress.receipt}</p>
      <button className="button primary" disabled={busy || !saved.summary} onClick={async () => { if (!saved.summary) return; setBusy(true); if (!await onFinish(saved.summary)) setIssue("Your block is saved, but session completion could not be confirmed. Try finishing again."); setBusy(false); }}>Finish and continue</button>
    </section> : <>
      {activity && <section className={styles.work}><h2>{activity.title}</h2>
        {source && <><h3>{source.title}</h3><p>{source.section}</p><p>{activity.instructions}</p>
          {source.url && <a href={source.url} target="_blank" rel="noreferrer">Open source section</a>}
          <div className={styles.source}>{source.text}</div><button className="button primary" disabled={busy} onClick={() => void act({ action: "source_complete", sourceId: source.id }, true)}>Mark source done</button>
          <p>Finishing the source records that you read or watched it. The practice check shows what you understood.</p></>}
        {activity.kind === "ai_explanation" && <><div className={styles.source}><ReviewedBlockExplanation key={activity.id} planId={planId} planSessionId={planSessionId} routeRevisionId={routeRevisionId} blockId={block.id} activityId={activity.id} content={activity.content} /></div><button className="button primary" disabled={busy} onClick={() => void act({ action: "explanation_complete", activityId: activity.id }, true)}>Continue to practice</button></>}
        {question && <>
          {question.workedExample && <aside className={styles.example}><h3>Example first</h3><LearningContent content={question.workedExample} /></aside>}
          <span className={styles.eyebrow}>{activity.kind === "flashcards" ? "Recall card" : activity.kind === "problems" ? "Worked problem" : "Practice check"}</span>
          <h3><LearningContent content={question.prompt} inline /></h3>{question.reflectBeforeCheck && <p>Explain it in your own words before checking.</p>}
          {question.choices.length ? <div className={styles.choices}>{question.choices.map(choice => <button key={choice} aria-pressed={answer === choice} disabled={busy || Boolean(attempt)} onClick={() => setAnswer(choice)}>{choice}</button>)}</div>
            : <label className={styles.answer}>Your answer<textarea aria-label="Your answer" rows={4} value={answer} disabled={busy || Boolean(attempt)} onChange={event => setAnswer(event.target.value)} /></label>}
          {!attempt && <button className="button primary" disabled={busy || !answer.trim()} onClick={() => void act({ action: "answer", questionId: question.id, answer })}>{busy ? "Checking…" : "Check answer"}</button>}
          {!!saved && question.hints.slice(0, saved.progress.hintCounts[question.id] ?? 0).map((hint, index) => <p className={styles.hint} key={index}>Hint {index + 1}: {hint}</p>)}
          {!attempt && question.hints.length > (saved?.progress.hintCounts[question.id] ?? 0) && <button className="button secondary" disabled={busy} onClick={() => void act({ action: "hint", questionId: question.id })}>Give me a hint</button>}
          {attempt && <section className={styles.feedback}><p>{attempt.feedback}</p>{solution && <><LearningContent content={solution.answer} />{solution.workedSolution.length > 0 && <ol>{solution.workedSolution.map((line, index) => <li key={index}><LearningContent content={line} inline /></li>)}</ol>}</>}
            {attempt.outcome === "needs_review" && <p>You can ask for one targeted example or continue. You do not need to repeat this question.</p>}
            <button className="button primary" disabled={busy} onClick={continueWork}>Continue</button></section>}
          <div className={styles.tools}>{!attempt && <button disabled={busy} onClick={() => void act({ action: "reveal", questionId: question.id })}>Reveal answer</button>}<button disabled={busy || saved?.progress.reportedQuestionIds.includes(question.id)} onClick={() => void act({ action: "report", questionId: question.id })}>Report bad question</button></div>
        </>}
        <div className={styles.tools}><button disabled={helpPending} onClick={() => void ask("explain_differently")}>Explain this</button><button disabled={helpPending} onClick={() => void ask("show_example")}>Show me an example</button>{attempt?.outcome === "needs_review" && <button disabled={helpPending} onClick={() => void ask("repair_gap")}>Why was I wrong?</button>}</div>
        {helpPending && <p role="status">Opening targeted help…</p>}{help && <aside className={styles.example}><h3>Ask YOVA</h3><p>{help}</p>
          {question && !attempt && <p>You can continue without answering; this item will stay unverified.</p>}
          <button disabled={busy} onClick={() => {
            if (question && !attempt) void act({ action: "continue_after_help", questionId: question.id }, true);
            else if (question) continueWork();
            else setHelp(null);
          }}>Continue</button></aside>}
      </section>}
      {!activity && saved && <p>You finished the steps. Finish the block to see what the practice check showed.</p>}
      {block.learningMode === "study" && block.sources.length > 0 && <details><summary>Use the source for a gap</summary>{block.sources.map(item => <article key={item.id}><h3>{item.title} · {item.section}</h3><p className={styles.source}>{item.text}</p>{item.url && <a href={item.url} target="_blank" rel="noreferrer">Open source section</a>}</article>)}</details>}
      <footer><p>{block.stoppingPoint}</p><div className={styles.footerButtons}><button className="button secondary" disabled={busy} onClick={onExit}>Save and leave</button><button className="button primary" disabled={busy || !saved || !blockCanComplete(block, saved.progress)} onClick={() => void act({ action: "complete" })}>Finish block</button></div></footer>
    </>}
  </section></main>;
}
