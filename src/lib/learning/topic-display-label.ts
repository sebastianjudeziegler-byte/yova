/**
 * Turns free-prose learning goals into short, grammar-safe display labels.
 *
 * COPY CONTRACT (see docs/COPY-CONTRACT.md): learner goals and model output
 * are sentences; UI labels are noun phrases. Any surface that shows a topic,
 * goal, or objective inside or near template copy must pass it through this
 * function first — never interpolate raw goal prose into a sentence.
 */

const LEADING_GOAL_SCAFFOLDING = /^(?:i\s+(?:want|need|would\s+like|am\s+trying|'m\s+trying)\s+to\s+|i'd\s+like\s+to\s+|help\s+me\s+(?:to\s+)?|learn\s+(?:about\s+|to\s+)?|understand\s+(?:the\s+)?|explain\s+(?:the\s+)?|study\s+)/i;

const LEADING_FRAGMENT_CONNECTIVES = /^(?:and|but|so|because|that|which|in|on|of|for|with|from|by|about|into)\s+/i;

const TRAILING_PURPOSE_CLAUSE = /,?\s+so\s+(?:that\s+)?(?:i|you|we)\b[\s\S]*$/i;

const MAXIMUM_LABEL_WORDS = 9;

export function topicDisplayLabel(topic: string | null | undefined, fallback = "your goal"): string {
  let label = (topic ?? "").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  if (!label) return fallback;

  label = label.replace(TRAILING_PURPOSE_CLAUSE, "");
  for (let pass = 0; pass < 2; pass += 1) {
    const stripped = label.replace(LEADING_GOAL_SCAFFOLDING, "");
    if (stripped === label) break;
    label = stripped;
  }
  for (let pass = 0; pass < 3; pass += 1) {
    const stripped = label.replace(LEADING_FRAGMENT_CONNECTIVES, "");
    if (stripped === label) break;
    label = stripped;
  }
  label = label.replace(/[.!…\s]+$/u, "").trim();
  if (!label || label.length < 3) return fallback;

  const words = label.split(/\s+/);
  if (words.length > MAXIMUM_LABEL_WORDS) {
    label = `${words.slice(0, MAXIMUM_LABEL_WORDS).join(" ")}…`;
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}
