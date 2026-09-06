"use client";

import { useState } from "react";
import { RecurrenceFields } from "@/components/calendar/recurrence-fields";
import type { CalendarRecurrence } from "@/lib/calendar/recurrence-schema";
import { firstCalendarBlockId } from "@/lib/calendar/recurrence";
import { ManualCalendarEventSchema, type ManualCalendarEvent, type ManualCalendarBlock } from "@/lib/calendar/types";

function localInput(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ManualEventEditor({ event, series, onSave, onCancel }: {
  event: ManualCalendarEvent;
  series?: ManualCalendarBlock["series"];
  onSave: (before: ManualCalendarEvent, after: ManualCalendarEvent, scope: "occurrence" | "series", series?: ManualCalendarBlock["series"]) => Promise<void>;
  onCancel: () => void;
}) {
  // Retain the original revision while editing so a remote update cannot silently overwrite it.
  const [original] = useState(event);
  const [originalSeries] = useState(series);
  const [scope, setScope] = useState<"occurrence" | "series">("occurrence");
  const [recurrence, setRecurrence] = useState<CalendarRecurrence | null>(event.recurrence ?? null);
  const [title, setTitle] = useState(event.title);
  const [type, setType] = useState(event.eventType);
  const [time, setTime] = useState(event.deadlineOnly ? "" : localInput(event.startsAt));
  const [due, setDue] = useState(event.dueAt ? localInput(event.dueAt) : "");
  const [minutes, setMinutes] = useState(event.deadlineOnly ? "30" : String((Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60_000));
  const [fixed, setFixed] = useState(event.fixed);
  const [course, setCourse] = useState(event.courseLabel ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const outcome = type === "deadline" || type === "exam";
  return <form className="calendar-event-editor" aria-label="Edit calendar item" onSubmit={async (e) => {
    e.preventDefault();
    setError("");
    const deadlineOnly = outcome && !time;
    const starts = new Date(time || (outcome ? due : ""));
    const duration = Number(minutes);
    if (!title.trim() || !Number.isFinite(starts.getTime()) || (!deadlineOnly && (!Number.isInteger(duration) || duration < 5 || duration > 360))) {
      setError("Add a title, a valid date and time, and a duration between 5 and 360 minutes.");
      return;
    }
    const dueDate = due ? new Date(due) : null;
    if (outcome && (!dueDate || !Number.isFinite(dueDate.getTime()))) {
      setError("Choose the deadline’s due date and time."); return;
    }
    const parsed = ManualCalendarEventSchema.safeParse({
      ...(scope === "series" ? originalSeries?.master ?? original : original), recurrence: scope === "series" || !originalSeries ? recurrence ?? undefined : undefined, title: title.trim(), eventType: type,
      startsAt: starts.toISOString(), endsAt: new Date(starts.getTime() + (deadlineOnly ? 1 : duration) * 60_000).toISOString(),
      dueAt: outcome ? dueDate!.toISOString() : null, deadlineOnly, fixed,
      courseLabel: course.trim() || null, updatedAt: new Date().toISOString(),
    });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Review this item’s dates and fields before saving."); return; }
    if (parsed.data.recurrence && !firstCalendarBlockId(parsed.data)) { setError("Choose repeat days and an end date that include at least one occurrence."); return; }
    setSaving(true);
    try { await onSave(original, parsed.data, scope, originalSeries); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "This item could not be saved."); }
    finally { setSaving(false); }
  }}>
    {originalSeries && <label>Apply changes to<select aria-label="Apply changes to" value={scope} onChange={(e) => {
      const next = e.target.value as typeof scope; setScope(next);
      const item = next === "series" ? originalSeries.master : original;
      setTitle(item.title); setType(item.eventType); setTime(localInput(item.startsAt));
      setMinutes(String((Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 60_000));
      setFixed(item.fixed); setCourse(item.courseLabel ?? ""); setRecurrence(item.recurrence ?? null);
    }}><option value="occurrence">This occurrence only</option><option value="series">Entire series</option></select></label>}
    <label>Title<input value={title} maxLength={160} required onChange={(e) => setTitle(e.target.value)} /></label>
    <label>Type<select value={type} onChange={(e) => { const next = e.target.value as typeof type; setType(next); setFixed(next === "class" || next === "exam"); }}><option value="class">Class</option><option value="exam">Exam</option><option value="deadline">Deadline</option><option value="personal">Personal</option><option value="free_block">Free block</option></select></label>
    <label>Calendar time{outcome && <small>Optional preparation time</small>}<input type="datetime-local" value={time} required={!outcome} onChange={(e) => setTime(e.target.value)} /></label>
    <label>Duration (minutes)<input type="number" min={5} max={360} step={1} value={minutes} disabled={!time} onChange={(e) => setMinutes(e.target.value)} /></label>
    {outcome && <label>Due time<input type="datetime-local" required value={due} onChange={(e) => setDue(e.target.value)} /></label>}
    <label>Course<input value={course} maxLength={120} onChange={(e) => setCourse(e.target.value)} /></label>
    <label className="calendar-checkbox"><input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)} /><span>Fixed time</span></label>
    {(!originalSeries || scope === "series") && !outcome && <RecurrenceFields value={recurrence} startsAt={time && Number.isFinite(new Date(time).getTime()) ? new Date(time).toISOString() : null} onChange={setRecurrence} />}
    {error && <p className="calendar-inline-error" role="alert">{error}</p>}
    <div className="calendar-inline-actions"><button type="button" className="button ghost" disabled={saving} onClick={onCancel}>Cancel editing</button><button className="button primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div>
  </form>;
}
