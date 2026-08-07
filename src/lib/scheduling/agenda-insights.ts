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

export type DailyCapacityPlan = {
  status: "empty" | "fits" | "move" | "split" | "blocked";
  capacityMinutes: number;
  todayMinutes: number;
  projectedMinutes: number;
  entry: ScheduledLearningEntry | null;
  scheduledFor: string | null;
  toDateKey: string | null;
  splitMinutes: number | null;
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

export function buildDailyCapacityPlan(
  entries: ScheduledLearningEntry[],
  requestedCapacityMinutes: number,
  now = new Date(),
): DailyCapacityPlan {
  const capacityMinutes = Math.max(10, Math.min(180, Math.round(requestedCapacityMinutes)));
  const todayKey = localDateKey(now);
  const todayEntries = entries
    .filter(({ session }) => localDateKey(new Date(session.scheduledFor)) === todayKey)
    .sort((left, right) => capacityPriority(left, right));
  const todayMinutes = sumMinutes(todayEntries);

  if (!todayEntries.length) {
    return {
      status: "empty",
      capacityMinutes,
      todayMinutes: 0,
      projectedMinutes: 0,
      entry: null,
      scheduledFor: null,
      toDateKey: null,
      splitMinutes: null,
      reason: "Nothing is scheduled today, so YOVA does not need to move or compress any learning content.",
    };
  }

  if (todayMinutes <= capacityMinutes) {
    return {
      status: "fits",
      capacityMinutes,
      todayMinutes,
      projectedMinutes: todayMinutes,
      entry: null,
      scheduledFor: null,
      toDateKey: null,
      splitMinutes: null,
      reason: "The planned content already fits the time available. YOVA will keep the learning sequence unchanged.",
    };
  }

  const groups = buildAgendaDayGroups(entries, now, 10);
  const candidates = [...todayEntries].sort(capacityMovePriority);
  for (const entry of candidates) {
    const target = findCapacityMoveTarget(entry, entries, groups, now);
    if (!target) continue;
    return {
      status: "move",
      capacityMinutes,
      todayMinutes,
      projectedMinutes: todayMinutes - entry.session.estimatedMinutes,
      entry,
      scheduledFor: target.scheduledFor,
      toDateKey: target.toDateKey,
      splitMinutes: null,
      reason: target.reason,
    };
  }

  for (const entry of [...todayEntries].sort((left, right) => right.session.estimatedMinutes - left.session.estimatedMinutes)) {
    const minutesWithoutEntry = todayMinutes - entry.session.estimatedMinutes;
    const splitMinutes = capacityMinutes - minutesWithoutEntry;
    if (splitMinutes < 10 || splitMinutes >= entry.session.estimatedMinutes) continue;
    return {
      status: "split",
      capacityMinutes,
      todayMinutes,
      projectedMinutes: minutesWithoutEntry + splitMinutes,
      entry,
      scheduledFor: null,
      toDateKey: null,
      splitMinutes,
      reason: `The deadline and learning order make a move unsafe. Splitting ${entry.plan.title} keeps only a bounded content block today and carries the unfinished content forward.`,
    };
  }

  return {
    status: "blocked",
    capacityMinutes,
    todayMinutes,
    projectedMinutes: todayMinutes,
    entry: null,
    scheduledFor: null,
    toDateKey: null,
    splitMinutes: null,
    reason: "YOVA could not find a safe automatic change that preserves the current deadlines and learning order. Move a session manually or update a goal deadline.",
  };
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

function capacityPriority(left: ScheduledLearningEntry, right: ScheduledLearningEntry) {
  const leftReady = left.session.status === "ready" ? 0 : 1;
  const rightReady = right.session.status === "ready" ? 0 : 1;
  if (leftReady !== rightReady) return leftReady - rightReady;
  const leftDeadline = deadlineTime(left.plan);
  const rightDeadline = deadlineTime(right.plan);
  if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
  return new Date(left.session.scheduledFor).getTime() - new Date(right.session.scheduledFor).getTime();
}

function capacityMovePriority(left: ScheduledLearningEntry, right: ScheduledLearningEntry) {
  const leftUpcoming = left.session.status === "upcoming" ? 0 : 1;
  const rightUpcoming = right.session.status === "upcoming" ? 0 : 1;
  if (leftUpcoming !== rightUpcoming) return leftUpcoming - rightUpcoming;
  const leftDeadline = deadlineTime(left.plan);
  const rightDeadline = deadlineTime(right.plan);
  if (leftDeadline !== rightDeadline) return rightDeadline - leftDeadline;
  return new Date(right.session.scheduledFor).getTime() - new Date(left.session.scheduledFor).getTime();
}

function deadlineTime(plan: LearningPlan) {
  if (!plan.deadline) return Number.POSITIVE_INFINITY;
  const deadline = new Date(plan.deadline).getTime();
  return Number.isNaN(deadline) ? Number.POSITIVE_INFINITY : deadline;
}

function findCapacityMoveTarget(
  entry: ScheduledLearningEntry,
  entries: ScheduledLearningEntry[],
  groups: AgendaDayGroup[],
  now: Date,
) {
  const planEntries = entries
    .filter(({ plan }) => plan.id === entry.plan.id)
    .sort((left, right) => left.session.sequence - right.session.sequence);
  const sourceIndex = planEntries.findIndex(({ session }) => session.id === entry.session.id);
  const previousTime = sourceIndex > 0
    ? new Date(planEntries[sourceIndex - 1].session.scheduledFor).getTime()
    : Number.NEGATIVE_INFINITY;
  const nextTime = sourceIndex >= 0 && sourceIndex < planEntries.length - 1
    ? new Date(planEntries[sourceIndex + 1].session.scheduledFor).getTime()
    : Number.POSITIVE_INFINITY;
  const source = new Date(entry.session.scheduledFor);

  for (let offset = 1; offset <= 7; offset += 1) {
    const target = addLocalDays(source, offset);
    if (target <= now || target.getTime() <= previousTime || target.getTime() >= nextTime) continue;
    if (entry.plan.deadline && target > new Date(entry.plan.deadline)) continue;
    const toDateKey = localDateKey(target);
    const targetGroup = groups.find((group) => group.dateKey === toDateKey);
    const targetMinutes = targetGroup?.totalMinutes ?? 0;
    const targetSessions = targetGroup?.entries.length ?? 0;
    if (loadFor(targetMinutes + entry.session.estimatedMinutes, targetSessions + 1) === "heavy") continue;
    return {
      scheduledFor: target.toISOString(),
      toDateKey,
      reason: `This protects the more urgent work, keeps ${entry.plan.title} in sequence, and avoids creating another crowded day.`,
    };
  }
  return null;
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addLocalDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}
