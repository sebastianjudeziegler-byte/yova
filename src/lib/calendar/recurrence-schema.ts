import { z } from "zod";

export const CalendarDateKeySchema = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).refine((key) => {
  const date = new Date(`${key}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key;
}, "Choose a valid calendar date.");

export const CalendarRecurrenceSchema = z.object({
  frequency: z.enum(["daily", "weekly"]),
  interval: z.number().int().min(1).max(365),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  timeZone: z.string().min(1).max(100).refine((zone) => {
    try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; }
  }, "Choose a valid time zone."),
  until: CalendarDateKeySchema.nullable(),
  count: z.number().int().min(1).max(1000).nullable(),
}).strict().superRefine((rule, ctx) => {
  if (rule.frequency === "weekly" && rule.weekdays.length === 0) ctx.addIssue({ code: "custom", path: ["weekdays"], message: "Choose at least one repeat day." });
  if (new Set(rule.weekdays).size !== rule.weekdays.length) ctx.addIssue({ code: "custom", path: ["weekdays"], message: "Choose each weekday once." });
  if (rule.until && rule.count) ctx.addIssue({ code: "custom", path: ["until"], message: "Choose an end date or an occurrence count." });
});
export type CalendarRecurrence = z.infer<typeof CalendarRecurrenceSchema>;
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
