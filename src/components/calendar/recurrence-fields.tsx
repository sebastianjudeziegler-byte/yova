"use client";

import { WEEKDAYS, WEEKDAY_ORDER, type CalendarRecurrence } from "@/lib/calendar/recurrence-schema";
import { expandRecurringEvent, recurrenceSummary, shiftCalendarDate } from "@/lib/calendar/recurrence";
import type { CalendarQuickAddDraft } from "@/lib/calendar/quick-add";
import { deadlineDateInputFromIso } from "@/lib/intake/deadline";

export function RecurrenceFields({ value, startsAt, onChange }: {
  value: CalendarRecurrence | null;
  startsAt: string | null;
  onChange: (value: CalendarRecurrence | null) => void;
}) {
  const timeZone = value?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const anchor = deadlineDateInputFromIso(startsAt ?? new Date().toISOString(), timeZone);
  return <fieldset className="calendar-recurrence-fields">
    <legend>Repeat schedule</legend>
    <label><span>Repeats</span><select aria-label="Repeats" value={value?.frequency ?? "none"} onChange={(event) => {
      const frequency = event.target.value;
      if (frequency === "none") return onChange(null);
      onChange({ frequency: frequency as CalendarRecurrence["frequency"], interval: value?.interval ?? 1,
        weekdays: frequency === "weekly" ? value?.weekdays.length ? value.weekdays : [new Date(`${anchor}T12:00:00Z`).getUTCDay()] : [], timeZone, until: value?.until ?? null, count: value?.count ?? null });
    }}><option value="none">Does not repeat</option><option value="daily">Every day or every few days</option><option value="weekly">On selected weekdays</option></select></label>
    {value && <>
      <label><span>Repeat every ({value.frequency === "daily" ? "days" : "weeks"})</span><input type="number" min={1} max={365} step={1} value={value.interval} onChange={(event) => onChange({ ...value, interval: Math.max(1, Math.min(365, Math.round(Number(event.target.value) || 1))) })} /></label>
      {value.frequency === "weekly" && <div className="calendar-repeat-weekdays" role="group" aria-label="Repeat on">{WEEKDAY_ORDER.map((day) => <label key={day}><input type="checkbox" checked={value.weekdays.includes(day)} onChange={(event) => onChange({ ...value, weekdays: event.target.checked ? [...value.weekdays, day] : value.weekdays.filter((item) => item !== day) })} /><span>{WEEKDAYS[day]}</span></label>)}</div>}
      <label><span>Series ends</span><select aria-label="Series ends" value={value.until ? "date" : value.count ? "count" : "never"} onChange={(event) => onChange({ ...value, until: event.target.value === "date" ? shiftCalendarDate(anchor, 90) : null, count: event.target.value === "count" ? 12 : null })}><option value="never">No end date</option><option value="date">On a date</option><option value="count">After a number of occurrences</option></select></label>
      {value.until && <label><span>Last repeat date</span><input type="date" value={value.until} min={anchor} onChange={(event) => onChange({ ...value, until: event.target.value || anchor })} /></label>}
      {value.count && <label><span>Number of occurrences</span><input type="number" min={1} max={1000} value={value.count} onChange={(event) => onChange({ ...value, count: Math.max(1, Math.min(1000, Math.round(Number(event.target.value) || 1))) })} /></label>}
      <small>Times follow {timeZone}, including daylight-saving changes.</small>
    </>}
  </fieldset>;
}

export function RecurrencePreview({ draft }: { draft: CalendarQuickAddDraft }) {
  const rule = draft.recurrence;
  if (!rule) return null;
  const start = draft.startsAt ? new Date(draft.startsAt) : null;
  const previews = start && Number.isFinite(start.getTime()) ? expandRecurringEvent({
    id: "preview", title: draft.title || "Calendar item", eventType: draft.eventType, startsAt: start.toISOString(),
    endsAt: draft.endsAt ?? new Date(start.getTime() + (draft.durationMinutes ?? 30) * 60_000).toISOString(),
    dueAt: null, fixed: draft.fixed, done: false, courseId: null, courseLabel: draft.courseLabel, outcomeId: null,
    createdAt: start.toISOString(), updatedAt: start.toISOString(), recurrence: rule,
  }, start, new Date(start.getTime() + Math.max(15, rule.interval * 42) * 86_400_000)).slice(0, 4) : [];
  return <section className="calendar-recurrence-preview" aria-label="Recurring schedule preview" aria-live="polite">
    <strong>{recurrenceSummary(rule)}</strong>
    {previews.length ? <><small>First {previews.length} occurrences</small><ol>{previews.map((block) => <li key={block.id}>{new Intl.DateTimeFormat("en-GB", { timeZone: rule.timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(block.startsAt))}–{new Intl.DateTimeFormat("en-GB", { timeZone: rule.timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(block.endsAt))}</li>)}</ol></> : <p>Choose a start time, repeat days and an end date after the start to preview the series.</p>}
  </section>;
}
