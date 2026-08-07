import type { LearningPlan, LearningPlanSession } from "@/lib/domain";

export type ScheduledLearningEntry = { plan: LearningPlan; session: LearningPlanSession };

export type AgendaDayGroup = {
  dateKey: string;
  date: Date;
  entries: ScheduledLearningEntry[];
  totalMinutes: number;
  load: "light" | "focused" | "heavy";
};

export type AgendaBalanceSuggestion = {
  entry: ScheduledLearningEntry;
  scheduledFor: string;
  fromDateKey: string;
  toDateKey: string;
  beforeMinutes: number;
  afterMinutes: number;
  targetMinutes: number;
  reason: string;
};

export function buildAgendaDayGroups(entries: ScheduledLearningEntry[], now = new Date(), days = 14) {
  const firstDay = startOfLocalDay(now);
  const finalDay = startOfLocalDay(addLocalDays(now, days));
  const grouped = new Map<string, AgendaDayGroup>();
  for (const entry of entries) {
    const date = new Date(entry.session.scheduledFor);
    if (Number.isNaN(date.getTime()) || date < firstDay || date >= finalDay) continue;
    const dateKey = localDateKey(date);
    const group = grouped.get(dateKey) ?? { dateKey, date: startOfLocalDay(date), entries: [], totalMinutes: 0, load: "light" as const };
    group.entries.push(entry);
    group.totalMinutes += entry.session.estimatedMinutes;
    grouped.set(dateKey, group);
  }
  return [...grouped.values()]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((group) => ({
      ...group,
      entries: group.entries.sort((a, b) => new Date(a.session.scheduledFor).getTime() - new Date(b.session.scheduledFor).getTime()),
      load: loadFor(group.totalMinutes, group.entries.length),
    }));
}

export function summarizeAgenda(entries: ScheduledLearningEntry[], plans: LearningPlan[], now = new Date()) {
  const todayKey = localDateKey(now);
  const weekEnd = addLocalDays(startOfLocalDay(now), 7);
  const todayEntries = entries.filter(({ session }) => localDateKey(new Date(session.scheduledFor)) === todayKey);
  const weekEntries = entries.filter(({ session }) => {
    const scheduled = new Date(session.scheduledFor);
    return scheduled >= startOfLocalDay(now) && scheduled < weekEnd;
  });
  const deadlines = plans
    .filter((plan) => plan.deadline && plan.status === "active")
    .map((plan) => ({ plan, date: new Date(plan.deadline as string) }))
    .filter(({ date }) => !Number.isNaN(date.getTime()) && date >= now)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    todayMinutes: sumMinutes(todayEntries),
    todaySessions: todayEntries.length,
    weekMinutes: sumMinutes(weekEntries),
    weekSessions: weekEntries.length,
    activeGoals: plans.filter((plan) => plan.status === "active").length,
    nextDeadline: deadlines[0] ?? null,
  };
}

export function buildAgendaBalanceSuggestion(entries: ScheduledLearningEntry[], now = new Date()): AgendaBalanceSuggestion | null {
  const groups = buildAgendaDayGroups(entries, now, 8).filter((group) => group.date >= startOfLocalDay(now));
  const heavy = groups.find((group) => group.load === "heavy");
  if (!heavy) return null;

  const candidates = [...heavy.entries]
    .reverse()
    .filter(({ session }) => session.status === "upcoming" && new Date(session.scheduledFor) > now);

  for (const entry of candidates) {
    const sourceDate = new Date(entry.session.scheduledFor);
    const sourceIndex = entries
      .filter(({ plan }) => plan.id === entry.plan.id)
      .sort((a, b) => a.session.sequence - b.session.sequence)
      .findIndex(({ session }) => session.id === entry.session.id);
    const planEntries = entries
      .filter(({ plan }) => plan.id === entry.plan.id)
      .sort((a, b) => a.session.sequence - b.session.sequence);
    const previousTime = sourceIndex > 0 ? new Date(planEntries[sourceIndex - 1].session.scheduledFor).getTime() : Number.NEGATIVE_INFINITY;
    const nextTime = sourceIndex >= 0 && sourceIndex < planEntries.length - 1 ? new Date(planEntries[sourceIndex + 1].session.scheduledFor).getTime() : Number.POSITIVE_INFINITY;

    for (let offset = 1; offset <= 3; offset += 1) {
      const target = addLocalDays(sourceDate, offset);
      const targetKey = localDateKey(target);
      const targetGroup = groups.find((group) => group.dateKey === targetKey);
      const targetMinutes = targetGroup?.totalMinutes ?? 0;
      if (loadFor(targetMinutes + entry.session.estimatedMinutes, (targetGroup?.entries.length ?? 0) + 1) === "heavy") continue;
      if (target.getTime() <= previousTime || target.getTime() >= nextTime) continue;
      if (entry.plan.deadline && target > new Date(entry.plan.deadline)) continue;

      return {
        entry,
        scheduledFor: target.toISOString(),
        fromDateKey: heavy.dateKey,
        toDateKey: targetKey,
        beforeMinutes: heavy.totalMinutes,
        afterMinutes: heavy.totalMinutes - entry.session.estimatedMinutes,
        targetMinutes: targetMinutes + entry.session.estimatedMinutes,
        reason: `This moves one ${entry.session.estimatedMinutes}-minute session from a crowded day while preserving the plan order and deadline.`,
      };
    }
  }
  return null;
}

export function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sumMinutes(entries: ScheduledLearningEntry[]) {
  return entries.reduce((sum, { session }) => sum + session.estimatedMinutes, 0);
}

function loadFor(minutes: number, sessions: number): AgendaDayGroup["load"] {
  if (minutes > 75 || sessions >= 3) return "heavy";
  if (minutes >= 30 || sessions >= 2) return "focused";
  return "light";
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addLocalDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}
