import { describe, expect, it } from "vitest";
import {
  canonicalizePlanAvailabilitySlots,
  enumeratePlanAvailabilitySlots,
  type PlanAvailabilityInput,
} from "@/lib/plan-generation/availability-slots";

function availabilityInput(
  overrides: Partial<PlanAvailabilityInput> = {},
): PlanAvailabilityInput {
  return {
    availability: [{ day: "Monday", window: "Evening", minutes: 25 }],
    deadline: null,
    timeZone: "America/Los_Angeles",
    ...overrides,
  };
}

describe("plan availability slot enumeration", () => {
  it("orders variable same-day windows by their fixed local start while retaining source indices", () => {
    const slots = enumeratePlanAvailabilitySlots(
      availabilityInput({
        availability: [
          { day: "Monday", window: "Evening", minutes: 45 },
          { day: "Monday", window: "Morning", minutes: 10 },
          { day: "Monday", window: "Afternoon", minutes: 20 },
          { day: "Monday", window: "Anytime", minutes: 25 },
          { day: "Monday", window: "Now", minutes: 30 },
          { day: "Monday", window: "Custom label", minutes: 35 },
        ],
      }),
      new Date("2026-08-10T07:00:00.000Z"),
      1,
    );

    expect(slots).toEqual([
      { startsAt: "2026-08-10T16:00:00.000Z", endsAt: "2026-08-10T16:10:00.000Z", minutes: 10, dayIndex: 0, windowIndex: 1 },
      { startsAt: "2026-08-10T19:00:00.000Z", endsAt: "2026-08-10T19:30:00.000Z", minutes: 30, dayIndex: 0, windowIndex: 4 },
      { startsAt: "2026-08-10T21:00:00.000Z", endsAt: "2026-08-10T21:20:00.000Z", minutes: 20, dayIndex: 0, windowIndex: 2 },
      { startsAt: "2026-08-11T00:00:00.000Z", endsAt: "2026-08-11T00:25:00.000Z", minutes: 25, dayIndex: 0, windowIndex: 3 },
      { startsAt: "2026-08-11T00:00:00.000Z", endsAt: "2026-08-11T00:35:00.000Z", minutes: 35, dayIndex: 0, windowIndex: 5 },
      { startsAt: "2026-08-11T02:00:00.000Z", endsAt: "2026-08-11T02:45:00.000Z", minutes: 45, dayIndex: 0, windowIndex: 0 },
    ]);
  });

  it("keeps the learner's local wall-clock window stable across daylight-saving time", () => {
    const input = availabilityInput({
      availability: [{ day: "Every day", window: "Morning", minutes: 20 }],
      timeZone: "America/New_York",
    });
    const slots = enumeratePlanAvailabilitySlots(
      input,
      new Date("2026-03-07T12:00:00.000Z"),
      3,
    );

    expect(slots.map(({ startsAt, endsAt, dayIndex }) => ({ startsAt, endsAt, dayIndex }))).toEqual([
      { startsAt: "2026-03-07T14:00:00.000Z", endsAt: "2026-03-07T14:20:00.000Z", dayIndex: 0 },
      { startsAt: "2026-03-08T13:00:00.000Z", endsAt: "2026-03-08T13:20:00.000Z", dayIndex: 1 },
      { startsAt: "2026-03-09T13:00:00.000Z", endsAt: "2026-03-09T13:20:00.000Z", dayIndex: 2 },
    ]);
    const localHours = slots.map((slot) => new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: input.timeZone,
    }).format(new Date(slot.startsAt)));
    expect(localHours).toEqual(["09", "09", "09"]);
  });

  it("clips the final window to the deadline and excludes later occurrences", () => {
    const slots = enumeratePlanAvailabilitySlots(
      availabilityInput({
        availability: [
          { day: "Monday", window: "Evening", minutes: 45 },
          { day: "Tuesday", window: "Morning", minutes: 30 },
        ],
        deadline: "2026-08-10T19:10:00.000-07:00",
      }),
      new Date("2026-08-09T12:00:00.000-07:00"),
      4,
    );

    expect(slots).toEqual([
      {
        startsAt: "2026-08-11T02:00:00.000Z",
        endsAt: "2026-08-11T02:10:00.000Z",
        minutes: 10,
        dayIndex: 1,
        windowIndex: 0,
      },
    ]);
  });

  it("returns the same deeply frozen value without mutating its input", () => {
    const input = availabilityInput({
      availability: [
        { day: "Wednesday", window: "Evening", minutes: 15 },
        { day: "Monday", window: "Morning", minutes: 25 },
      ],
    });
    const inputSnapshot = structuredClone(input);
    const now = new Date("2026-08-09T12:00:00.000-07:00");
    const first = enumeratePlanAvailabilitySlots(input, now, 7);
    const second = enumeratePlanAvailabilitySlots(input, now, 7);

    expect(first).toEqual(second);
    expect(input).toEqual(inputSnapshot);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.every(Object.isFrozen)).toBe(true);
    expect(Reflect.set(first[0]!, "minutes", 99)).toBe(false);
    expect(Reflect.set(first, "0", first[1])).toBe(false);
  });

  it("unions duplicate and overlapping declarations without manufacturing capacity", () => {
    const raw = [
      { startsAt: "2026-08-10T17:00:00.000Z", endsAt: "2026-08-10T17:30:00.000Z", minutes: 30, dayIndex: 0, windowIndex: 0 },
      { startsAt: "2026-08-10T17:00:00.000Z", endsAt: "2026-08-10T17:35:00.000Z", minutes: 35, dayIndex: 0, windowIndex: 1 },
      { startsAt: "2026-08-10T17:20:00.000Z", endsAt: "2026-08-10T17:50:00.000Z", minutes: 30, dayIndex: 0, windowIndex: 2 },
    ] as const;
    const canonical = canonicalizePlanAvailabilitySlots(
      raw,
      new Date("2026-08-10T16:00:00.000Z"),
    );

    expect(canonical).toEqual([{
      startsAt: "2026-08-10T17:00:00.000Z",
      endsAt: "2026-08-10T17:50:00.000Z",
      minutes: 50,
      dayIndex: 0,
      windowIndex: 0,
    }]);
    expect(canonical.reduce((total, slot) => total + slot.minutes, 0)).toBe(50);
    expect(Object.isFrozen(canonical)).toBe(true);
    expect(canonical.every(Object.isFrozen)).toBe(true);
  });

  it("merges a continuous union regardless of input order", () => {
    const shorter = {
      startsAt: "2026-08-10T17:00:00.000Z",
      endsAt: "2026-08-10T17:15:00.000Z",
      minutes: 15,
      dayIndex: 0,
      windowIndex: 1,
    } as const;
    const longer = {
      startsAt: "2026-08-10T17:00:00.000Z",
      endsAt: "2026-08-10T17:30:00.000Z",
      minutes: 30,
      dayIndex: 0,
      windowIndex: 0,
    } as const;
    const earlier = {
      startsAt: "2026-08-10T16:00:00.000Z",
      endsAt: "2026-08-10T16:10:00.000Z",
      minutes: 10,
      dayIndex: 0,
      windowIndex: 2,
    } as const;

    expect(canonicalizePlanAvailabilitySlots(
      [shorter, earlier, longer],
      new Date("2026-08-10T15:00:00.000Z"),
    )).toEqual([
      earlier,
      {
        startsAt: longer.startsAt,
        endsAt: longer.endsAt,
        minutes: 30,
        dayIndex: 0,
        windowIndex: 0,
      },
    ]);
  });

  it("floors once after a current-time clamp so ten usable minutes are retained", () => {
    const slots = enumeratePlanAvailabilitySlots(
      availabilityInput({
        availability: [{ day: "Monday", window: "Evening", minutes: 45 }],
        deadline: "2026-08-10T19:10:59.000-07:00",
        timeZone: "America/Los_Angeles",
      }),
      new Date("2026-08-10T19:00:30.000-07:00"),
      1,
    );
    const canonical = canonicalizePlanAvailabilitySlots(
      slots,
      new Date("2026-08-10T19:00:30.000-07:00"),
    );

    expect(canonical).toEqual([{
      startsAt: "2026-08-11T02:00:30.000Z",
      endsAt: "2026-08-11T02:10:59.000Z",
      minutes: 10,
      dayIndex: 0,
      windowIndex: 0,
    }]);
  });
});
