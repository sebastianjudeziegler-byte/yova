"use client";

import type { CoreMethodId } from "@/lib/learning/method-catalog";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { calendarDateAtTime, deadlineDateInputFromIso } from "@/lib/intake/deadline";
import { wallClock } from "@/lib/calendar/recurrence";

export type TopicPlanAction = "mark_covered" | "change_method" | "attach_source";
export type GroupedTopicPlanProps = {
  plan: LearningPlan; busy?: boolean; now?: Date; draft?: boolean;
  onStartBlock?: (sessionId: string) => void; onAddMaterial: () => void; onEditPlan: () => void;
  onTopicAction?: (topicId: string, action: TopicPlanAction) => void;
  onChangeMethod?: (sessionId: string, methodId: CoreMethodId) => void;
  onMoveBlock?: (sessionId: string, scheduledFor: string) => void;
};

export function groupedPlanTopics(plan: LearningPlan) {
  return (plan.knowledgeMap?.topics ?? []).filter(topic => !topic.removed).map(topic => {
    const blocks = plan.sessions.filter(session => session.topicIds?.includes(topic.id));
    return { topic, blocks, complete: blocks.length > 0 && blocks.every(block => block.status === "complete"), note: plan.planModel?.topicNotes.find(note => note.topicId === topic.id)?.note };
  });
}

export function planDeadlineLabel(plan: LearningPlan, now: Date): string {
  if (!plan.deadline) return "No fixed deadline";
  const deadline = new Date(plan.deadline);
  if (!Number.isFinite(deadline.getTime())) return "No fixed deadline";
  const date = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: plan.schedulePreferences?.timeZone ?? "UTC" }).format(deadline);
  const days = Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000);
  const purpose = plan.kind === "test" ? "Test" : "Target";
  return `${purpose} ${days < 0 ? "date passed" : days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`} · ${date}`;
}

export function GroupedTopicPlan({ plan, onStartBlock, onAddMaterial, onEditPlan, onTopicAction, onMoveBlock, onChangeMethod, busy = false, now = new Date(), draft = false }: GroupedTopicPlanProps) {
  const groups = groupedPlanTopics(plan);
  const timeZone = plan.schedulePreferences?.timeZone ?? "UTC";
  const next = plan.sessions.find(session => session.status === "ready") ?? plan.sessions.find(session => session.status === "upcoming");
  const completed = plan.sessions.filter(session => session.status === "complete").length;
  const collapsed = plan.planModel?.collapsedQueue === true;
  const prominentTopic = next?.topicIds?.[0];
  const primary = collapsed ? groups.filter(group => group.topic.id === prominentTopic) : groups;
  const remaining = collapsed ? groups.filter(group => group.topic.id !== prominentTopic) : [];
  const renderBlock = (block: LearningPlanSession) => <li key={block.id} data-block-id={block.id}>
    <strong>{block.title}</strong><p>{block.method} · ~{block.estimatedMinutes} min{block.workload?.practicePlaceholder ? ` · ~${block.workload.questionCount} questions` : ""}</p>
    {onChangeMethod && block.status !== "complete" && Boolean(block.studyRoute?.agency.alternatives.length) && <label>Method for {block.title}<select aria-label={`Method for ${block.title}`} disabled={busy} value={block.studyRoute!.approach.primaryMethodId} onChange={event => onChangeMethod(block.id, event.target.value as CoreMethodId)}><option value={block.studyRoute!.approach.primaryMethodId}>{block.method}</option>{block.studyRoute!.agency.alternatives.map(alternative => <option key={alternative.alternativeId} value={alternative.primaryMethodId}>{alternative.visibleMethodName}</option>)}</select></label>}
    <small>{block.status === "complete" ? "Complete" : block.workload?.suggestedDate === false ? "Choose a day" : Number.isFinite(Date.parse(block.scheduledFor)) ? `Suggested: ${new Date(block.scheduledFor).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: plan.schedulePreferences?.timeZone ?? "UTC" })}` : "Choose a day"}</small>
    {onMoveBlock && block.status !== "complete" && plan.planModel?.scheduleMode !== "fixed" && <label>Move {block.title}<input type="date" aria-label={`Move ${block.title}`} disabled={busy} defaultValue={Number.isFinite(Date.parse(block.scheduledFor)) ? deadlineDateInputFromIso(block.scheduledFor, timeZone) : ""} onChange={event => { if (event.target.value) { const clock = Number.isFinite(Date.parse(block.scheduledFor)) ? wallClock(block.scheduledFor, timeZone) : { hour: 9, minute: 0 }; const scheduledFor = calendarDateAtTime(event.target.value, clock.hour, clock.minute, timeZone); if (scheduledFor) onMoveBlock(block.id, scheduledFor); } }} /></label>}
  </li>;
  const renderGroup = (group: ReturnType<typeof groupedPlanTopics>[number]) => <article key={group.topic.id} data-topic-id={group.topic.id} className="generated-topic-map">
    <details><summary><strong>{group.complete ? "✓ " : ""}{group.topic.title}</strong> · {group.blocks.length} {group.blocks.length === 1 ? "block" : "blocks"}{group.complete ? " · Complete" : ""}</summary>
      {group.note && <p>{group.note}</p>}
      {Boolean(group.topic.attachedSources?.length) && <ul aria-label={`Sources for ${group.topic.title}`}>
        {group.topic.attachedSources!.map((source, index) => <li key={index}>{"url" in source
          ? <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
          : plan.materials?.find(material => material.id === source.material_id)?.name ?? "Attached source"}</li>)}
      </ul>}
      <ol>{group.blocks.map(renderBlock)}</ol>
      {onTopicAction && <label>Topic actions for {group.topic.title}<select aria-label={`Topic actions for ${group.topic.title}`} value="" disabled={busy} onChange={event => { if (event.target.value) onTopicAction(group.topic.id, event.target.value as TopicPlanAction); }}><option value="">Choose an action</option><option value="mark_covered">Mark covered</option>{!onChangeMethod && <option value="change_method">Change method</option>}<option value="attach_source">Attach material</option></select></label>}
    </details>
  </article>;
  return <section className="generated-plan" aria-label="Plan grouped by topic">
    <header className="generated-heading"><div><span className="eyebrow">{draft ? "PLAN PREVIEW" : "YOUR PLAN"}</span><h1>{plan.title}</h1><p>{planDeadlineLabel(plan, now)}</p><strong>{plan.sessions.length} blocks · {completed} done</strong></div></header>
    {plan.planModel?.personalizationSentence && plan.planModel.ruleIds.length > 0 && <p className="why-plan" data-rule-ids={plan.planModel.ruleIds.join(" ")}>{plan.planModel.personalizationSentence}</p>}
    {plan.planModel?.constraints?.map((constraint, index) => <p className="material-notice" role="status" key={index}>{constraint}</p>)}
    {next && <div className="plan-activation"><div><strong>Next: {next.title}</strong><p>{next.method} · ~{next.estimatedMinutes} min</p></div>{onStartBlock && <button className="button primary" disabled={busy} onClick={() => onStartBlock(next.id)}>Start next block</button>}</div>}
    {!next && <p role="status">All blocks complete.</p>}
    <div className="plan-revision-actions"><button className="button secondary" disabled={busy} onClick={onAddMaterial}>Add material</button><button className="button ghost" disabled={busy} onClick={onEditPlan}>Edit plan</button></div>
    {primary.map(renderGroup)}
    {remaining.length > 0 && <details><summary>{remaining.length} more {remaining.length === 1 ? "topic" : "topics"}</summary>{remaining.map(renderGroup)}</details>}
  </section>;
}
