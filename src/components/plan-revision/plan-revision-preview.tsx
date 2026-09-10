"use client";

import { useEffect, useRef, useState } from "react";
import { savedPlanAvailability } from "./revision-client";
import type { LearningPlan } from "@/lib/domain";
import type { CoreMethodId } from "@/lib/learning/method-catalog";
import type { MapDelta, MapDeltaOperation } from "@/lib/plan-revision/map-delta";
import type { PlanRevisionProposal, RevisionControls } from "@/lib/plan-revision/revision-schema";

export type SignedPreview = { proposal: PlanRevisionProposal; proposalReceipt: string };
type Option = { value: string; label: string };
type Choices = { methods: Array<{ value: CoreMethodId; label: string }>; times: Option[] };
type Props = {
  plan: LearningPlan;
  initialDelta: MapDelta;
  initialControls?: RevisionControls;
  initialTopicId?: string;
  initialType?: MapDeltaOperation["op"];
  onPreview: (delta: MapDelta, controls: RevisionControls) => Promise<SignedPreview>;
  // Parent persists and updates the plan before resolving. Receipt/Undo live
  // outside this editor so closing it cannot discard the durable result.
  onApply: (preview: SignedPreview) => Promise<void>;
  onCancel: () => void;
  choicesForSession: (proposal: PlanRevisionProposal, sessionId: string) => Choices;
  onCapacityChoice: (choice: "move_block" | "shorten_scope" | "add_time", current: MapDelta) => Promise<MapDelta | null>;
  onStageFile: (file: File) => Promise<{ materialId: string; name: string }>;
};
const EMPTY_CONTROLS: RevisionControls = { excludedOperationIndexes: [], sessionEdits: [] };
const CHANGE_NAMES: Record<MapDeltaOperation["op"], string> = {
  mark_covered: "I already learned this", attach_source: "Attach a source",
  add_topic: "Add a topic", remove_topic: "Remove future work", reorder: "Move a topic",
  set_deadline: "Change the deadline", set_availability: "Change available time",
};

function topicsFirst(plan: LearningPlan) { return plan.knowledgeMap?.topics.find(topic => !topic.removed)?.id ?? ""; }

export function PlanRevisionPreview(props: Props) {
  const [delta, setDelta] = useState(props.initialDelta);
  const [controls, setControls] = useState<RevisionControls>(props.initialControls ?? EMPTY_CONTROLS);
  const [preview, setPreview] = useState<SignedPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(props.initialDelta.operations.length === 0);
  const [newType, setNewType] = useState<MapDeltaOperation["op"]>(props.initialType ?? "attach_source");
  const [newTopic, setNewTopic] = useState(props.initialTopicId ?? props.plan.knowledgeMap?.topics.find(topic => !topic.removed)?.id ?? "");
  const [sourceUrl, setSourceUrl] = useState("");
  const [stagedFile, setStagedFile] = useState<{ materialId: string; name: string } | null>(null);
  const [staging, setStaging] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [afterTopic, setAfterTopic] = useState(topicsFirst(props.plan));
  const [deadline, setDeadline] = useState(props.plan.deadline?.slice(0, 16) ?? "");
  const [day, setDay] = useState("Monday");
  const [window, setWindow] = useState("18:00–19:00");
  const [minutes, setMinutes] = useState(60);
  const [shorterMinutes, setShorterMinutes] = useState<10 | 15 | 25 | 45 | 60>(15);
  const [keptWindows, setKeptWindows] = useState(() => (props.plan.schedulePreferences?.availability ?? []).map((_, index) => index));
  const sequence = useRef(0);
  const started = useRef(false);
  const topics = props.plan.knowledgeMap?.topics.filter(topic => !topic.removed) ?? [];

  async function refresh(nextDelta: MapDelta, nextControls = controls) {
    const request = ++sequence.current;
    setDelta(nextDelta); setControls(nextControls); setPending(true); setError(null);
    try {
      const result = await props.onPreview(nextDelta, nextControls);
      if (sequence.current === request) setPreview(result);
    } catch (failure) {
      if (sequence.current === request) {
        setPreview(null);
        setError(failure instanceof Error ? failure.message : "The preview could not be prepared. Your saved plan is unchanged.");
      }
    } finally { if (sequence.current === request) setPending(false); }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (props.initialDelta.operations.length) {
      queueMicrotask(() => { void refresh(props.initialDelta, props.initialControls ?? EMPTY_CONTROLS); });
    }
    // The parent mounts this editor with a key for the plan/revision. Avoid
    // duplicate provider calls from changing callback identities/Strict Mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function retarget(index: number, topicId: string) {
    const operations = delta.operations.map((operation, position) => position === index && "topic_id" in operation
      ? { ...operation, topic_id: topicId } : operation);
    void refresh({ operations });
  }
  function include(index: number, enabled: boolean) {
    const excluded = new Set(controls.excludedOperationIndexes);
    if (enabled) excluded.delete(index); else excluded.add(index);
    void refresh(delta, { ...controls, excludedOperationIndexes: [...excluded] });
  }
  function editSession(sessionId: string, operationIndex: number, patch: { methodId?: CoreMethodId; scheduledFor?: string; durationMinutes?: 10 | 15 | 25 | 45 | 60 }) {
    const existing = props.plan.sessions.some(session => session.id === sessionId);
    const matches = (edit: RevisionControls["sessionEdits"][number]) => existing ? edit.sessionId === sessionId : edit.operationIndex === operationIndex;
    const previous = controls.sessionEdits.find(matches);
    void refresh(delta, { ...controls, sessionEdits: [
      ...controls.sessionEdits.filter(edit => !matches(edit)),
      { ...previous, ...(existing ? { sessionId, operationIndex } : { operationIndex }), ...patch },
    ] });
  }
  async function confirm() {
    if (!preview || pending || saving || !preview.proposal.canApply) return;
    setSaving(true); setError(null);
    try { await props.onApply(preview); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The change has not been confirmed. Try again."); }
    finally { setSaving(false); }
  }
  async function capacity(choice: "move_block" | "shorten_scope" | "add_time") {
    try {
      if (choice === "add_time" || choice === "shorten_scope") {
        setNewType(choice === "add_time" ? "set_availability" : "remove_topic");
        setAdding(true); return;
      }
      const next = await props.onCapacityChoice(choice, delta);
      if (next) await refresh(next);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The capacity choice could not be applied."); }
  }
  async function stage(file: File | undefined) {
    if (!file) return;
    setStaging(true); setError(null);
    try { setStagedFile(await props.onStageFile(file)); setSourceUrl(""); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The file could not be attached."); }
    finally { setStaging(false); }
  }
  function previewShorterSessions() {
    const operationIndex = delta.operations.length;
    const nextDelta: MapDelta = { operations: [...delta.operations, { op: "set_availability", availability: savedPlanAvailability(props.plan) }] };
    const edits = props.plan.sessions.filter(session => ["ready", "upcoming"].includes(session.status) && !session.resource && !session.reviewType && session.estimatedMinutes > shorterMinutes)
      .map(session => ({ sessionId: session.id, operationIndex, durationMinutes: shorterMinutes }));
    setAdding(false);
    void refresh(nextDelta, { ...controls, sessionEdits: [...controls.sessionEdits.filter(edit => !edits.some(next => next.sessionId === edit.sessionId)), ...edits] });
  }
  function addChange() {
    let operation: MapDeltaOperation;
    if (newType === "attach_source") {
      operation = stagedFile ? { op: "attach_source", topic_id: newTopic, material_id: stagedFile.materialId }
        : { op: "attach_source", topic_id: newTopic, url: sourceUrl.trim() };
    } else if (newType === "mark_covered" || newType === "remove_topic") {
      operation = { op: newType, topic_id: newTopic };
    } else if (newType === "add_topic") {
      operation = { op: newType, title: newTitle, description: newDescription, ...(afterTopic ? { after_topic_id: afterTopic } : {}) };
    } else if (newType === "reorder") {
      operation = { op: newType, topic_id: newTopic, after_topic_id: afterTopic };
    } else if (newType === "set_deadline") {
      if (!Number.isFinite(Date.parse(deadline))) { setError("Choose a deadline."); return; }
      operation = { op: newType, iso: new Date(deadline).toISOString() };
    } else {
      operation = { op: "set_availability", availability: [...(props.plan.schedulePreferences?.availability ?? []).filter((_, index) => keptWindows.includes(index)), { day, window, minutes }] };
    }
    setAdding(false); setSourceUrl(""); setStagedFile(null);
    void refresh({ operations: [...delta.operations, operation] });
  }

  return <section className="plan-revision-preview" aria-label="Plan change preview" aria-busy={pending || saving}>
    <header><h3>Review your changes</h3><p>Adjust a line or leave it out, then confirm once.</p></header>
    {error && <p role="alert" className="form-error">{error}</p>}
    {pending && <p role="status">Preparing the preview…</p>}
    <div className="plan-revision-lines">
      {delta.operations.map((operation, index) => {
        const line = preview?.proposal.lines.find(candidate => candidate.operationIndex === index);
        const included = !controls.excludedOperationIndexes.includes(index);
        const title = line?.description ?? CHANGE_NAMES[operation.op];
        return <article key={index} className="plan-revision-line">
          <label><input type="checkbox" checked={included} disabled={saving || pending} onChange={event => include(index, event.target.checked)} /> Include {title}</label>
          {"topic_id" in operation && <label>Target topic
            <select aria-label={`Target topic for change ${index + 1}`} value={operation.topic_id} disabled={saving || pending} onChange={event => retarget(index, event.target.value)}>
              {topics.map(topic => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
            </select>
          </label>}
          <div className="plan-revision-comparison"><div><strong>Before</strong><ul>{(line?.before ?? ["Current plan"]).map((text, i) => <li key={i}>{text}</li>)}</ul></div>
            <div><strong>After</strong><ul>{(included ? line?.after ?? ["Preparing…"] : ["No change"]).map((text, i) => <li key={i}>{text}</li>)}</ul></div></div>
          {line?.blockedReason && <p>{line.blockedReason}</p>}
          {included && preview && line?.sessionIds.map((sessionId, sessionIndex) => {
            const session = preview.proposal.after.sessions.find(item => item.id === sessionId);
            if (!session || (operation.op === "add_topic" && sessionIndex > 0) || (session.originSessionId && session.id !== session.originSessionId)) return null;
            const choices = props.choicesForSession(preview.proposal, sessionId);
            return <div key={sessionId} className="plan-revision-session-controls">
              <label>Method for {session.title}<select value={session.studyRoute?.approach.primaryMethodId ?? ""} disabled={saving || pending} onChange={event => editSession(sessionId, index, { methodId: event.target.value as CoreMethodId })}>
                {choices.methods.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select></label>
              <label>Time for {session.title}<select value={session.scheduledFor} disabled={saving || pending} onChange={event => editSession(sessionId, index, { scheduledFor: event.target.value })}>
                {choices.times.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select></label>
            </div>;
          })}
        </article>;
      })}
    </div>
    {preview && preview.proposal.capacity.status !== "fits" && <aside className="plan-revision-capacity">
      <p>{preview.proposal.capacity.explanation}</p>
      {preview.proposal.capacity.choices.map(choice => <button type="button" className="button secondary" key={choice.action} disabled={saving || pending} onClick={() => void capacity(choice.action)}>{choice.label}</button>)}
    </aside>}
    {!adding && <button className="button secondary" type="button" disabled={saving || pending} onClick={() => setAdding(true)}>Add another change</button>}
    {adding && <fieldset disabled={saving || pending || staging}>
      <legend>Add another change</legend>
      <label>Change type<select value={newType} onChange={event => setNewType(event.target.value as MapDeltaOperation["op"])}>
        {Object.keys(CHANGE_NAMES).map(type => <option key={type} value={type}>{CHANGE_NAMES[type as MapDeltaOperation["op"]]}</option>)}
      </select></label>
      {["attach_source", "mark_covered", "remove_topic", "reorder"].includes(newType) && <label>Change topic<select value={newTopic} onChange={event => setNewTopic(event.target.value)}>{topics.map(topic => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>}
      {newType === "attach_source" && <>
        <label>Source URL<input type="url" value={sourceUrl} onChange={event => { setSourceUrl(event.target.value); setStagedFile(null); }} /></label>
        <label>Choose a source file<input type="file" onChange={event => void stage(event.target.files?.[0])} /></label>
        {stagedFile && <p>{stagedFile.name}</p>}
      </>}
      {newType === "add_topic" && <><label>Topic title<input value={newTitle} onChange={event => setNewTitle(event.target.value)} /></label><label>What should this topic cover?<textarea aria-invalid={newDescription.length > 400 || undefined} aria-describedby="revision-description-limit" value={newDescription} onChange={event => setNewDescription(event.target.value)} /><small id="revision-description-limit" role={newDescription.length > 400 ? "alert" : undefined}>{newDescription.length}/400 characters</small></label></>}
      {["add_topic", "reorder"].includes(newType) && <label>After topic<select value={afterTopic} onChange={event => setAfterTopic(event.target.value)}>{topics.map(topic => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>}
      {newType === "set_deadline" && <label>Deadline<input type="datetime-local" value={deadline} onChange={event => setDeadline(event.target.value)} /></label>}
      {newType === "set_availability" && <><label>Future session length<select value={shorterMinutes} onChange={event => setShorterMinutes(Number(event.target.value) as typeof shorterMinutes)}>{[10, 15, 25, 45, 60].map(value => <option key={value} value={value}>{value} minutes</option>)}</select></label><button type="button" className="button secondary" onClick={previewShorterSessions}>Preview shorter sessions</button><p>Keep all remaining work and your saved weekly windows.</p><label>Day<select aria-label="Day" value={day} onChange={event => setDay(event.target.value)}>{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(value => <option key={value}>{value}</option>)}</select></label><label>Time window<input value={window} onChange={event => setWindow(event.target.value)} /></label><label>Minutes<input type="number" min={10} max={180} value={minutes} onChange={event => setMinutes(Number(event.target.value))} /></label><div>{(props.plan.schedulePreferences?.availability ?? []).map((slot, index) => <label key={index}><input type="checkbox" checked={keptWindows.includes(index)} onChange={event => setKeptWindows(previous => event.target.checked ? [...previous, index] : previous.filter(value => value !== index))} />Keep existing window: {slot.day} {slot.window}</label>)}</div><p>Keep the windows you still want, and add the time above.</p></>}
      <button type="button" className="button secondary" onClick={addChange} disabled={!newTopic || (newType === "add_topic" && (!newTitle.trim() || !newDescription.trim() || newDescription.length > 400)) || (newType === "attach_source" && !stagedFile && !sourceUrl.trim())}>{newType === "attach_source" ? "Preview source attachment" : "Preview change"}</button>
    </fieldset>}
    <footer><button type="button" className="button secondary" disabled={saving} onClick={props.onCancel}>Cancel</button>
      <button type="button" className="button primary" disabled={saving || pending || adding || !preview?.proposal.canApply} onClick={() => void confirm()}>{saving ? "Saving…" : "Confirm changes"}</button></footer>
  </section>;
}
