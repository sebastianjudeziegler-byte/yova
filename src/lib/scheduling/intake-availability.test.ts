import { describe, expect, it } from "vitest";
import { scheduleFromIntake } from "./intake-availability";
import { planCreatorScheduleReducer, type PlanCreatorScheduleState } from "./plan-creator-schedule";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import { buildDeadlinePriority } from "@/lib/plan-generation/deadline-priority";
import { auditNow, shortDeadlineRequest } from "@/evals/plan-creation-blocker-cases";

function fallback(): PlanCreatorScheduleState {
  return { deadlineDate: "", studyFrequency: "most_days", preferredWindows: ["Morning"], sessionLength: 25, customScheduleOpen: false, recommendedWindow: "Morning", availabilityChoices: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day, index) => ({ day, dateLabel: "", enabled: index < 5, window: "Morning", minutes: 25 })) };
}
const days = (state: PlanCreatorScheduleState) => state.availabilityChoices.filter(choice => choice.enabled).map(choice => choice.day);

describe("availability from learner intake", () => {
  it.each([1, 3, 5, 9])("keeps an explicit %i-minute window and offers only that much priority work", (minutes) => {
    const selected = scheduleFromIntake(fallback(), `My biology test is tomorrow. I can study Monday evening for ${minutes} minutes.`);
    expect(selected.sessionLength, "The learner's selected time must not become the default 25 minutes").toBe(minutes);
    const request = PlanGenerationRequestSchema.parse({
      ...shortDeadlineRequest(1),
      availability: selected.availabilityChoices.filter(choice => choice.enabled).map(({day,window,minutes}) => ({day,window,minutes})),
    });
    const response = buildDeadlinePriority(request, auditNow);
    expect(response?.priority.minutes).toBe(minutes);
    expect(response?.priority.title).toBe("Focus on ATP and energy transfer");
    expect(response?.priority.progressCredit).toBe(false);
  });
  it("uses each weekday as five explicit evening windows", () => {
    const selected = scheduleFromIntake(fallback(), "A speech is due next Friday. I have 15 minutes each weekday evening.");
    expect(days(selected)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
    expect(selected.availabilityChoices.filter(choice => choice.enabled).every(choice => choice.window === "Evening" && choice.minutes === 15)).toBe(true);
  });
  it("preserves the audited Monday/Wednesday/Friday afternoons and duration", () => {
    const selected = scheduleFromIntake(fallback(), "Biology exam September 21. I can study Monday, Wednesday and Friday afternoons for 25 minutes.");
    expect(days(selected)).toEqual(["Monday", "Wednesday", "Friday"]);
    expect(selected.availabilityChoices.filter(choice => choice.enabled).every(choice => choice.window === "Afternoon" && choice.minutes === 25)).toBe(true);
    const shorter = planCreatorScheduleReducer(selected, { type: "choose_session_length", minutes: 15 });
    expect(days(shorter)).toEqual(days(selected));
    expect(days(planCreatorScheduleReducer(shorter, { type: "toggle_window", window: "Evening" }))).toEqual(days(selected));
  });
  it("handles a range and an explicit exception", () => {
    expect(days(scheduleFromIntake(fallback(), "I am available Monday through Friday except Wednesday, 20 minutes each evening."))).toEqual(["Monday", "Tuesday", "Thursday", "Friday"]);
  });
  it("does not mistake an exam weekday or unavailable days for study availability", () => {
    const initial = fallback();
    expect(scheduleFromIntake(initial, "My exam is Friday afternoon.")).toEqual(initial);
    expect(scheduleFromIntake(initial, "I am not available on Monday or Wednesday.")).toEqual(initial);
  });
});
