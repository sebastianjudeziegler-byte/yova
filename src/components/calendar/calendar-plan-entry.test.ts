import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarScreen, newCalendarEvent } from "./calendar-screen";
import { ManualEventEditor } from "./manual-event-editor";
const noop=()=>{}; const asyncNoop=async()=>{};
describe("direct calendar event entry",()=>{
 it("opens the native event form from a plan entry request",()=>{
  const html=renderToStaticMarkup(createElement(CalendarScreen,{accountId:"preview",initialOpenEvent:true,plans:[],milestones:[],sessionCompletions:[],sessionInterruptions:[],activeSessionCheckpoints:[],previewMode:true,onOpenAdd:noop,onOpenPlan:noop,onStart:()=>true,onActivateReview:asyncNoop,onReschedule:noop,onAdjustDuration:asyncNoop,onClassifyRecoveryInterruption:noop,onUpdateMilestone:asyncNoop,onDeleteMilestone:asyncNoop,onConvertMilestone:noop,onStartLearningPlan:noop}));
  expect(html).toContain('aria-label="New calendar event"');expect(html).toContain("Start a learning plan instead");expect(html).toContain("Add event");
 });
 it("labels creation accurately and starts with a bounded concrete event",()=>{
  const event=newCalendarEvent(new Date("2026-09-17T10:00:00Z"));
  const html=renderToStaticMarkup(createElement(ManualEventEditor,{event,mode:"create",onSave:asyncNoop,onCancel:noop}));
  expect(html).toContain('aria-label="Add calendar event"');expect(html).toContain("Add event");expect(html).not.toContain("Save changes");
  expect(Date.parse(event.endsAt)-Date.parse(event.startsAt)).toBe(30*60000);expect(event.title).toBe("");
 });
});
