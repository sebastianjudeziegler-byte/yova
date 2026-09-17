"use client";

import { useState } from "react";
import type { LearningPlan } from "@/lib/domain";
import { MapDeltaSchema, type MapDelta, type MapDeltaOperation } from "@/lib/plan-revision/map-delta";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import { calendarDateAtTime, deadlineDateInputFromIso } from "@/lib/intake/deadline";

const ADDED_TOPIC = "pending-added-topic";
const DAYS = ["Every day", "Weekdays", "Weekends", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Replay order through the existing after-topic operation, including moving
 * the first topic. No session content is rewritten by this UI. */
export function topicReorderOperations(original: readonly string[], ordered: readonly string[]): MapDeltaOperation[] {
  if (original.join() === ordered.join()) return [];
  return ordered.slice(1).map((id, index) => ({ op: "reorder", topic_id: id, after_topic_id: ordered[index] }));
}

export function addedTopicOperation(title: string, ordered: readonly string[]): MapDeltaOperation {
  const index = ordered.indexOf(ADDED_TOPIC);
  return { op: "add_topic", title: title.trim(), description: `Learn and apply ${title.trim()}.`,
    ...(index > 0 ? { after_topic_id: ordered[index - 1] } : ordered.length > 1 ? { before_topic_id: ordered[1] } : {}) };
}

export function PlanEditPanel({ plan, busy = false, onPreview, onClose }: {
  plan: LearningPlan; busy?: boolean; onPreview: (delta: MapDelta) => void; onClose: () => void;
}) {
  const topics = (plan.knowledgeMap?.topics ?? []).filter(topic => !topic.removed);
  const zone = plan.schedulePreferences?.timeZone ?? "UTC";
  const originalDeadline = plan.deadline ? deadlineDateInputFromIso(plan.deadline, zone) : "";
  const [order, setOrder] = useState(topics.map(topic => topic.id));
  const [removed, setRemoved] = useState<string[]>([]);
  const [addedTitle, setAddedTitle] = useState("");
  const [deadline, setDeadline] = useState(originalDeadline);
  const [availability, setAvailability] = useState<PlanGenerationRequest["availability"]>(plan.schedulePreferences?.availability ?? []);
  const [dragged, setDragged] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = order.filter(id => !removed.includes(id) && (id !== ADDED_TOPIC || addedTitle.trim().length >= 2));
  const move = (id: string, offset: number) => {
    const next = [...visible]; const index = next.indexOf(id); const target = Math.max(0, Math.min(next.length - 1, index + offset));
    next.splice(index, 1); next.splice(target, 0, id); setOrder([...next, ...order.filter(item => !visible.includes(item))]);
  };
  const submit = () => {
    const operations: MapDeltaOperation[] = [
      ...removed.map(topic_id => ({ op: "remove_topic" as const, topic_id })),
      ...topicReorderOperations(topics.filter(topic => !removed.includes(topic.id)).map(topic => topic.id), visible.filter(id => id !== ADDED_TOPIC)),
    ];
    if (addedTitle.trim().length >= 2) operations.push(addedTopicOperation(addedTitle, visible));
    if (deadline && deadline !== originalDeadline) {
      const iso = calendarDateAtTime(deadline, 23, 59, zone);
      if (!iso) { setError("Choose a valid deadline date."); return; }
      operations.push({ op: "set_deadline", iso });
    }
    if (JSON.stringify(availability) !== JSON.stringify(plan.schedulePreferences?.availability ?? [])) operations.push({ op: "set_availability", availability });
    if (!operations.length) { onClose(); return; }
    const parsed = MapDeltaSchema.safeParse({ operations });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Review these changes before continuing."); return; }
    setError(null); onPreview(parsed.data);
  };
  return <section className="plan-panel wide" aria-labelledby="edit-plan-heading"><h2 id="edit-plan-heading">Edit plan</h2><p>Review the affected blocks before confirming these changes.</p>
    <ol>{visible.map((id, index) => { const title = id === ADDED_TOPIC ? addedTitle.trim() : topics.find(topic => topic.id === id)!.title; return <li key={id} draggable={!busy} onDragStart={() => setDragged(id)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (dragged) move(dragged, visible.indexOf(id) - visible.indexOf(dragged)); setDragged(null); }}><strong>{title}{id === ADDED_TOPIC ? " · New topic" : ""}</strong><button className="button ghost" disabled={busy || index === 0} aria-label={`Move ${title} up`} onClick={() => move(id, -1)}>↑</button><button className="button ghost" disabled={busy || index === visible.length - 1} aria-label={`Move ${title} down`} onClick={() => move(id, 1)}>↓</button><button className="button ghost" disabled={busy} onClick={() => id === ADDED_TOPIC ? setAddedTitle("") : setRemoved(current => [...current, id])}>Remove {title}</button></li>; })}</ol>
    {removed.length > 0 && <p role="status">{removed.length} topics will be removed, including their completed blocks. <button className="button ghost" disabled={busy} onClick={() => setRemoved([])}>Restore removed topics</button></p>}
    <label>Add topic<input value={addedTitle} maxLength={140} disabled={busy} onChange={event => { setAddedTitle(event.target.value); setOrder(current => current.includes(ADDED_TOPIC) ? current : [...current, ADDED_TOPIC]); }} /></label>
    <p>New topics appear above. Drag a topic or use its arrows to choose its position.</p>
    <label>Change deadline<input type="date" value={deadline} disabled={busy} onChange={event => setDeadline(event.target.value)} /></label>
    <p>Changing the deadline re-spaces remaining practice. Changing availability moves dates.</p>
    <fieldset disabled={busy}><legend>Availability</legend>{availability.map((slot, index) => <div key={index}><label>Day for window {index + 1}<select value={slot.day} onChange={event => setAvailability(current => current.map((value, item) => item === index ? { ...value, day: event.target.value } : value))}>{DAYS.map(day => <option key={day}>{day}</option>)}</select></label><label>Time for {slot.day}<select value={slot.window} onChange={event => setAvailability(current => current.map((value, item) => item === index ? { ...value, window: event.target.value } : value))}>{!["Morning", "Afternoon", "Evening", "Anytime"].includes(slot.window) && <option>{slot.window}</option>}<option>Morning</option><option>Afternoon</option><option>Evening</option><option>Anytime</option></select></label><label>Minutes for {slot.day}<input type="number" min={1} max={180} value={slot.minutes} onChange={event => setAvailability(current => current.map((value, item) => item === index ? { ...value, minutes: Math.max(1, Math.min(180, Number(event.target.value))) } : value))} /></label><button className="button ghost" disabled={availability.length === 1} onClick={() => setAvailability(current => current.filter((_, item) => item !== index))}>Remove window {index + 1}</button></div>)}<button className="button ghost" disabled={availability.length >= 14} onClick={() => setAvailability(current => [...current, { day: "Monday", window: "Evening", minutes: 30 }])}>Add study window</button></fieldset>
    {error && <p role="alert">{error}</p>}
    <footer className="plan-actions"><button className="button ghost" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || visible.length === 0} onClick={submit}>Preview changes</button></footer>
  </section>;
}
