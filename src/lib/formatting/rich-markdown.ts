export function normalizeRichMarkdown(value: string) {
  const withNormalizedDelimiters = value
    .replace(/\r\n?/g, "\n")
    .replace(/\s*\\\[\s*/g, () => "\n$$\n")
    .replace(/\s*\\\]/g, () => "\n$$\n")
    .replace(/\\\(\s*/g, "$")
    .replace(/\s*\\\)/g, "$");

  return normalizePlainAsciiMath(withNormalizedDelimiters)
    .replace(
      /\$(\d[\d,]*(?:\.\d{1,2})?)(?=(?:\s+[A-Za-z]|\s*$|[,.](?:\s|$)))/gm,
      (_match, amount: string) => `\\$${amount}`,
    )
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const mathFunctionNames = new Set([
  "abs",
  "cos",
  "exp",
  "lim",
  "ln",
  "log",
  "max",
  "min",
  "sin",
  "sqrt",
  "tan",
]);

type PlainToken = {
  start: number;
  end: number;
  coreStart: number;
  coreEnd: number;
  core: string;
  closesPhrase: boolean;
};

/**
 * Provider responses normally use $...$ for mathematics, but cached and repaired
 * lessons can contain compact ASCII notation such as x^2 or F(1)=2. This bounded
 * adapter recognizes only expression-shaped tokens and leaves ordinary numbers,
 * dates, prose, Markdown code, and already-delimited mathematics untouched.
 */
export function normalizePlainAsciiMath(value: string) {
  let result = "";
  let plainStart = 0;
  let cursor = 0;

  while (cursor < value.length) {
    const delimiter = protectedDelimiterAt(value, cursor);
    if (!delimiter) {
      cursor += 1;
      continue;
    }

    const protectedEnd = findProtectedEnd(value, cursor, delimiter);
    if (protectedEnd === -1) {
      cursor += delimiter.length;
      continue;
    }

    result += wrapPlainMathRuns(value.slice(plainStart, cursor));
    result += value.slice(cursor, protectedEnd);
    cursor = protectedEnd;
    plainStart = protectedEnd;
  }

  return result + wrapPlainMathRuns(value.slice(plainStart));
}

function protectedDelimiterAt(value: string, index: number) {
  if (value[index] === "`" && value[index - 1] !== "\\") {
    return value.startsWith("```", index) ? "```" : "`";
  }
  if (value[index] === "$" && value[index - 1] !== "\\") {
    return value.startsWith("$$", index) ? "$$" : "$";
  }
  return null;
}

function findProtectedEnd(value: string, start: number, delimiter: string) {
  let cursor = start + delimiter.length;
  while (cursor < value.length) {
    const match = value.indexOf(delimiter, cursor);
    if (match === -1) return -1;
    if (value[match - 1] !== "\\") return match + delimiter.length;
    cursor = match + delimiter.length;
  }
  return -1;
}

function wrapPlainMathRuns(value: string) {
  const tokens = Array.from(value.matchAll(/\S+/g), (match) => plainToken(match[0], match.index));
  let result = "";
  let outputCursor = 0;
  let run: PlainToken[] = [];

  const flush = () => {
    if (run.length === 0) return;
    const start = run[0].coreStart;
    const end = run.at(-1)!.coreEnd;
    const expression = value.slice(start, end);
    if (isMathExpression(expression)) {
      result += value.slice(outputCursor, start);
      result += `$${toKatexExpression(expression)}$`;
      outputCursor = end;
    }
    run = [];
  };

  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    const crossesLine = previous ? value.slice(previous.end, token.start).includes("\n") : false;
    if (crossesLine || !isMathToken(token.core)) flush();
    if (isMathToken(token.core)) run.push(token);
    if (token.closesPhrase) flush();
  });
  flush();

  return result + value.slice(outputCursor);
}

function plainToken(raw: string, start: number): PlainToken {
  let coreStart = start;
  let coreEnd = start + raw.length;

  while (coreStart < coreEnd && /^[“”'‘’"]/.test(raw.slice(coreStart - start, coreEnd - start))) coreStart += 1;
  while (coreStart + 1 < coreEnd && (raw.slice(coreStart - start, coreEnd - start).startsWith("**") || raw.slice(coreStart - start, coreEnd - start).startsWith("__"))) coreStart += 2;
  while (coreStart + 1 < coreEnd && (raw.slice(coreStart - start, coreEnd - start).endsWith("**") || raw.slice(coreStart - start, coreEnd - start).endsWith("__"))) coreEnd -= 2;
  while (coreStart < coreEnd && /[.,:;!?“”'‘’"]$/.test(raw.slice(coreStart - start, coreEnd - start))) coreEnd -= 1;

  const core = raw.slice(coreStart - start, coreEnd - start);
  return {
    start,
    end: start + raw.length,
    coreStart,
    coreEnd,
    core,
    closesPhrase: /[.,:;!?]$/.test(raw),
  };
}

function isMathToken(value: string) {
  if (/^(?:\+|-|−|\*|×|\/|÷|=|<|>|<=|>=|!=|±|→|->|\(|\))$/.test(value)) return true;
  if (/^[A-Za-z]$/.test(value) || mathFunctionNames.has(value.toLowerCase())) return true;
  if (!/^[A-Za-z0-9π√().,^_{}+\-*/=<>≤≥±×÷→]+$/.test(value)) return false;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(value)) return false;

  const alphaRuns = value.match(/[A-Za-z]+/g) ?? [];
  if (alphaRuns.some((run) => run.length > 1 && !mathFunctionNames.has(run.toLowerCase()))) return false;

  return /[0-9π√^_=<>≤≥±×÷→]/.test(value)
    || /^[A-Za-z]\([A-Za-z0-9]\)$/.test(value);
}

function isMathExpression(value: string) {
  const compact = value.trim();
  const dense = compact.replace(/\s+/g, "");
  if (!compact || /^\d+(?:[,.]\d+)?$/.test(compact)) return false;
  if (/^\d+(?:\.\d+)?-\d+(?:\.\d+)?$/.test(dense)) return false;
  if (/^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(dense)) return false;
  if (/^[A-Za-z]\d+-[A-Za-z]\d+$/.test(dense)) return false;
  if (/^[A-Z](?:[+*/-][A-Z])+$/.test(dense)) return false;
  if (/\^|_|=|<=|>=|!=|[≤≥±×÷√→]/.test(compact)) return true;
  if (/[A-Za-z0-9)]\s*[+*/-]\s*[A-Za-z0-9(]/.test(compact)) return true;
  if (/\d[a-z](?![a-z])/i.test(compact) && /\d[a-z]/.test(compact)) return true;
  return /(?:sin|cos|tan|log|ln|exp|sqrt|abs|lim|max|min)\s*\(/i.test(compact);
}

function toKatexExpression(value: string) {
  return value
    .replace(/−/g, "-")
    .replace(/×|\*/g, "\\cdot ")
    .replace(/÷/g, "\\div ")
    .replace(/<=|≤/g, "\\le ")
    .replace(/>=|≥/g, "\\ge ")
    .replace(/!=/g, "\\ne ")
    .replace(/->|→/g, "\\to ");
}
