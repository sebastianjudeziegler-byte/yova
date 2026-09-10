import { describe, expect, it } from "vitest";
import { enumeratePlanAvailabilitySlots } from "./availability-slots";

describe("clock windows accepted by the revision preview", () => {
  it("keeps a ready-now block at the chosen local time instead of moving it to 17:00", () => {
    const slots = enumeratePlanAvailabilitySlots({ timeZone: "America/Los_Angeles", deadline: null,
      availability: [{ day: "Wednesday", window: "03:00–04:00", minutes: 10 }],
    }, new Date("2026-09-02T10:00:00.000Z"), 1);
    expect(slots.map(slot => ({ at: slot.startsAt, minutes: slot.minutes }))).toEqual([{ at: "2026-09-02T10:00:00.000Z", minutes: 10 }]);
  });
  it("never allocates past an explicit end even when the requested minutes are larger", () => {
    const slots = enumeratePlanAvailabilitySlots({ timeZone: "Europe/London", deadline: null,
      availability: [{ day: "Wednesday", window: "11:15–11:25", minutes: 60 }],
    }, new Date("2026-09-02T10:00:00.000Z"), 1);
    expect(slots.map(slot => ({ at: slot.startsAt, end: slot.endsAt, minutes: slot.minutes }))).toEqual([{ at: "2026-09-02T10:15:00.000Z", end: "2026-09-02T10:25:00.000Z", minutes: 10 }]);
  });
});
