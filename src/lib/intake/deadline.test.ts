import { describe, expect, it } from "vitest";
import {
  deadlineAtEndOfDay,
  deadlineDateInputFromIso,
  futureDeadlineDateInputFromIso,
  inferDeadlineDate,
  inferDeadlineDueAt,
} from "@/lib/intake/deadline";

describe("natural-language deadline contract", () => {
  it.each([
    ["My chemistry practical is due September 4", "2026-09-04"],
    ["I have an economics exam on Sept. 12th", "2026-09-12"],
    ["The literature paper deadline is 10/6/2026", "2026-10-06"],
    ["My design project is due 23/09/2026", "2026-09-23"],
    ["Prepare for the statistics test on 2026-11-08", "2026-11-08"],
  ])("parses %s into one calendar value", (description, expected) => {
    expect(inferDeadlineDate(description, {
      now: new Date("2026-08-21T12:00:00.000Z"),
      timeZone: "Europe/London",
    })).toBe(expected);
  });

  it("rolls a month-and-day deadline into the next year only after it has passed", () => {
    const options = {
      now: new Date("2026-12-30T18:00:00.000Z"),
      timeZone: "America/New_York",
    };

    expect(inferDeadlineDate("My certification exam is on January 3", options))
      .toBe("2027-01-03");
    expect(inferDeadlineDate("My certification exam is on December 30", options))
      .toBe("2026-12-30");
  });

  it("uses the learner's calendar day near a UTC date boundary", () => {
    expect(inferDeadlineDate("The interview exercise is due tomorrow", {
      now: new Date("2026-01-01T00:30:00.000Z"),
      timeZone: "America/Los_Angeles",
    })).toBe("2026-01-01");

    expect(inferDeadlineDueAt("The interview exercise is due tomorrow", {
      now: new Date("2026-01-01T00:30:00.000Z"),
      timeZone: "America/Los_Angeles",
    })).toBe("2026-01-02T07:59:59.999Z");
  });

  it("rejects impossible dates rather than letting Date normalize them", () => {
    const options = {
      now: new Date("2026-01-15T12:00:00.000Z"),
      timeZone: "UTC",
    };

    expect(inferDeadlineDate("The music theory quiz is on February 30", options)).toBeNull();
    expect(inferDeadlineDate("The lab is due 13/40/2026", options)).toBeNull();
    expect(inferDeadlineDate("The report is due 2026-02-29", options)).toBeNull();
  });

  it("does not treat a subject's historical date or elapsed study time as a deadline", () => {
    const options = {
      now: new Date("2026-08-21T12:00:00.000Z"),
      timeZone: "UTC",
    };

    expect(inferDeadlineDate("Understand the events of September 11 and their aftermath", options)).toBeNull();
    expect(inferDeadlineDate("Understand what happened on September 11, 2001", options)).toBeNull();
    expect(inferDeadlineDate("Analyze the public-health response on 2020-03-11", options)).toBeNull();
    expect(inferDeadlineDate("Write a paper about September 11, 2001", options)).toBeNull();
    expect(inferDeadlineDate("I have studied organic chemistry for two weeks", options)).toBeNull();
  });

  it("lets an explicit operational deadline win over a historical topic date", () => {
    const options = {
      now: new Date("2026-08-21T12:00:00.000Z"),
      timeZone: "UTC",
    };

    expect(inferDeadlineDate(
      "Write a paper about September 11, 2001 due in two weeks",
      options,
    )).toBe("2026-09-04");
    expect(inferDeadlineDate(
      "Prepare a report on the 2020-03-11 public-health response, due tomorrow",
      options,
    )).toBe("2026-08-22");
  });

  it("requires due language or narrow assessment shorthand for calendar dates", () => {
    const options = {
      now: new Date("2026-08-21T12:00:00.000Z"),
      timeZone: "UTC",
    };

    expect(inferDeadlineDate("My chemistry quiz on reaction rates is on September 4", options))
      .toBe("2026-09-04");
    expect(inferDeadlineDate("My report is due on September 4", options))
      .toBe("2026-09-04");
    expect(inferDeadlineDate("My report is due 2020-03-11", options)).toBeNull();
  });

  it("keeps end-of-day conversion and ISO-to-input conversion in the same time zone", () => {
    expect(deadlineAtEndOfDay("2026-09-04", "Europe/London"))
      .toBe("2026-09-04T22:59:59.999Z");
    expect(deadlineDateInputFromIso("2026-09-04T22:59:59.999Z", "Europe/London"))
      .toBe("2026-09-04");
    expect(deadlineAtEndOfDay("2026-02-30", "UTC")).toBeNull();
  });

  it("refuses to prefill Plan Creator with a deadline before the learner's local today", () => {
    const now = new Date("2026-08-21T00:30:00.000Z");

    expect(futureDeadlineDateInputFromIso(
      "2026-08-19T23:59:59.999-07:00",
      "America/Los_Angeles",
      now,
    )).toBe("");
    expect(futureDeadlineDateInputFromIso(
      "2026-08-20T23:59:59.999-07:00",
      "America/Los_Angeles",
      now,
    )).toBe("2026-08-20");
  });

  it.each([
    ["2026-04-04", "Australia/Sydney", "2026-04-04T12:59:59.999Z"],
    ["2026-09-26", "Pacific/Auckland", "2026-09-26T11:59:59.999Z"],
  ])("converges to local end-of-day across a DST transition for %s in %s", (
    dateInput,
    timeZone,
    expectedIso,
  ) => {
    const dueAt = deadlineAtEndOfDay(dateInput, timeZone);

    expect(dueAt).toBe(expectedIso);
    expect(deadlineDateInputFromIso(dueAt!, timeZone)).toBe(dateInput);
    expect(new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(dueAt!))).toBe("23:59:59");
  });
});
