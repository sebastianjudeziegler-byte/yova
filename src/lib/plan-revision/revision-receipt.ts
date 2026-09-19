import type { LearningPlan, LearningPlanSession } from "@/lib/domain";

/**
 * Brief 2.5 root cause 3 (finding 17): receipts said "everything else
 * unchanged" while the change had renamed, re-methoded and re-dated blocks,
 * because the text was fixed. This receipt is computed from the saved
 * before/after plans: every block that differs is named with what changed, so
 * the closing "everything else unchanged" is true by construction.
 */
const SHOWN_BLOCKS = 5;
// These delta lines only say that a schedule or block changed; the computed
// block lines say exactly how, so they are not repeated.
const GENERIC_LINES = new Set(["Change the deadline", "Change available study time", "Change selected study blocks"]);

export function revisionTopicLines(proposal: { lines: readonly { description: string }[] }) {
  return proposal.lines.map(line => line.description).filter(description => !GENERIC_LINES.has(description));
}

export function revisionReceiptMessage({ before, after, topicLines = [], undo = false }: {
  before: LearningPlan; after: LearningPlan; topicLines?: readonly string[]; undo?: boolean;
}) {
  const timeZone = after.schedulePreferences?.timeZone ?? before.schedulePreferences?.timeZone ?? "UTC";
  const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));
  const day = (iso: string | null | undefined) => iso ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone }).format(new Date(iso)) : "none";
  const lines = [...topicLines];
  if (before.deadline !== after.deadline) lines.push(`deadline ${day(before.deadline)} → ${day(after.deadline)}`);
  if (JSON.stringify(before.schedulePreferences?.availability ?? null) !== JSON.stringify(after.schedulePreferences?.availability ?? null)) lines.push("study times changed");
  const beforeById = new Map(before.sessions.map(session => [session.id, session]));
  const live = (session: LearningPlanSession | undefined) => Boolean(session && session.status !== "skipped");
  const blocks: string[] = [];
  for (const next of after.sessions) {
    const previous = beforeById.get(next.id);
    if (!live(previous) && live(next)) { blocks.push(`added ${next.title} (${next.method}, ${when(next.scheduledFor)})`); continue; }
    if (live(previous) && !live(next)) { blocks.push(`removed ${previous!.title}`); continue; }
    if (!previous || !live(next) || JSON.stringify(previous) === JSON.stringify(next)) continue;
    const changes: string[] = [];
    if (previous.title !== next.title) changes.push(`renamed to ${next.title}`);
    if (previous.method !== next.method) changes.push(`method ${previous.method} → ${next.method}`);
    if (previous.learningMode !== next.learningMode) changes.push(next.learningMode === "study" ? "now practice" : "now learning");
    if (Date.parse(previous.scheduledFor) !== Date.parse(next.scheduledFor)) changes.push(`moved ${when(previous.scheduledFor)} → ${when(next.scheduledFor)}`);
    if (previous.estimatedMinutes !== next.estimatedMinutes) changes.push(`${previous.estimatedMinutes} → ${next.estimatedMinutes} min`);
    if (!changes.length) changes.push("its study plan was updated");
    blocks.push(`${previous.title}: ${changes.join(", ")}`);
  }
  for (const previous of before.sessions) if (live(previous) && !after.sessions.some(session => session.id === previous.id)) blocks.push(`removed ${previous.title}`);
  lines.push(...blocks.slice(0, SHOWN_BLOCKS));
  if (blocks.length > SHOWN_BLOCKS) lines.push(`${blocks.length - SHOWN_BLOCKS} more ${blocks.length - SHOWN_BLOCKS === 1 ? "block" : "blocks"} changed`);
  const body = lines.length ? lines.join("; ") : "no block changed";
  return `${undo ? "Previous revision restored: " : ""}${body}; everything else unchanged.`;
}
