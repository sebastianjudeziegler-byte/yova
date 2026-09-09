/** Compare learner content without discarding operators, primes, or accents. */
export function learningContentKey(value: string, preserveCase = false) {
  const normalized = value.normalize("NFC");
  return (preserveCase ? normalized : normalized.toLocaleLowerCase())
    .replace(/[‘’′]/g, "'")
    .replace(/[−–]/g, "-")
    .replace(/[×⋅·]/g, "*")
    .replace(/\s*([=+*/^(),\-])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim();
}

export function hasDistinctLearningChoices(choices: string[]) {
  // Case can distinguish code identifiers and mathematical functions.
  return new Set(choices.map(choice => learningContentKey(choice, true))).size === choices.length;
}

/** Symbolic relations are subject content, even when variables are one letter. */
export function mathematicalSubjectTerms(value: string): string[] {
  const notation = learningContentKey(value);
  const terms: string[] = [];
  if (/(?:\b[a-z](?:\([a-z0-9]+\))?|\([a-z]{1,8}\))'/i.test(notation)) terms.push("derivative");
  if (/[a-z0-9)'\]]\+[(a-z0-9]/i.test(notation)) terms.push("plus");
  return terms;
}

/** A formula-only target requires its complete equation, not shared variables. */
export function preservesTargetEquation(idea: string, target: string): boolean | null {
  const equation = target.replace(/[.!?]+$/, "").match(/\([a-z]{1,8}\)['′’]?\s*=\s*[a-z0-9()'′’+*/^\s-]+$/i)?.[0];
  if (!equation) return null;
  const canonical = (text: string) => learningContentKey(text
    .replace(/\bequals\b/gi, "=").replace(/\bplus\b/gi, "+")
    .replace(/\bminus\b/gi, "-"));
  const expected = canonical(equation);
  let actual = canonical(idea);
  // f(x) and f are the same factor notation in a rule stated for one common
  // argument. Mixed arguments or composite expressions are not elided.
  const argumentsUsed = [...actual.matchAll(/[a-z]'?\(([a-z])\)/g)].map(match => match[1]);
  if (argumentsUsed.length > 0 && new Set(argumentsUsed).size === 1) {
    actual = actual.replace(/([a-z]'?)\([a-z]\)/g, "$1");
  }
  const fullIndex = actual.indexOf(expected);
  const endsExpression = (end: number) => !/[a-z0-9'()+*/^\-]/i.test(actual[end] ?? "");
  if (fullIndex >= 0 && endsExpression(fullIndex + expected.length)) return true;
  // A question can ask for the derivative and receive just the right-hand
  // expression. Require the complete expression and reject extra terms or a
  // conflicting equation, rather than demanding that the learner repeat LHS.
  const rightHand = expected.split("=")[1]!;
  const index = actual.indexOf(rightHand);
  if (index < 0 || !endsExpression(index + rightHand.length)) return false;
  return !/[a-z0-9'=()+*/^\-]/i.test(actual[index - 1] ?? "");
}
