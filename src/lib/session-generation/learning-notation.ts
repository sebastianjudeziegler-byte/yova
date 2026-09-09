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

/** A complete algebraic equality is a claim even without five prose words. */
export function isCompleteSymbolicEquation(value: string) {
  const equation = learningContentKey(value).replace(/\s/g, "");
  if (!/^[a-z0-9.'()+*/^=\-]+$/i.test(equation) || /[a-z]{4,}/i.test(equation)) return false;
  const sides = equation.split("=");
  if (sides.length !== 2) return false;
  return sides.every(side => {
    if (!side) return false;
    const tokens = side.match(/\d+(?:\.\d+)?|[a-z]|['()+*/^\-]/gi) ?? [];
    if (tokens.join("") !== side) return false;
    let depth = 0;
    let needsOperand = true;
    for (const token of tokens) {
      if (token === "(") { depth += 1; needsOperand = true; }
      else if (token === ")") {
        if (needsOperand || depth === 0) return false;
        depth -= 1;
      } else if (token === "'") {
        if (needsOperand) return false;
      } else if (/^[+*/^\-]$/.test(token)) {
        if (needsOperand) return false;
        needsOperand = true;
      } else {
        // Adjacent factors and f(x) use ordinary implicit multiplication.
        needsOperand = false;
      }
    }
    return depth === 0 && !needsOperand;
  });
}

/** Symbolic relations are subject content, even when variables are one letter. */
export function mathematicalSubjectTerms(value: string): string[] {
  const notation = learningContentKey(value);
  const terms: string[] = [];
  if (/(?:\b[a-z](?:\([a-z0-9]+\))?|\([a-z]{1,8}\))'/i.test(notation)) terms.push("derivative");
  // Teaching can name the same relation as adding, a sum, or the + operator.
  // Use the same term on both sides of evidence matching; do not lower its
  // subject threshold or borrow the activity's concept label as proof.
  if (/[a-z0-9)'\]]\+[(a-z0-9]/i.test(notation)
    || /\b(?:plus|add|adds|added|adding|addition|sum|sums)\b/i.test(notation)) terms.push("plus");
  return terms;
}

/** A formula-only target requires its complete equation, not shared variables. */
export function preservesTargetEquation(idea: string, target: string, questionContext?: string): boolean | null {
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
  if (preservesRenamedProductEquation(canonical(idea), expected, questionContext)) return true;
  // A question can ask for the derivative and receive just the right-hand
  // expression. Require the complete expression and reject extra terms or a
  // conflicting equation, rather than demanding that the learner repeat LHS.
  const rightHand = expected.split("=")[1]!;
  const index = actual.indexOf(rightHand);
  if (index < 0 || !endsExpression(index + rightHand.length)) return false;
  return !/[a-z0-9'=()+*/^\-]/i.test(actual[index - 1] ?? "");
}

/** Compare the derivative structure, not the arbitrary names of its factors.
 * A result alias is usable only when the question explicitly defines it as
 * that product. Headings and unrelated subject words provide no authority. */
function preservesRenamedProductEquation(actual: string, expected: string, questionContext?: string) {
  const target = expected.match(/^\(([a-z])([a-z])\)'=(.+)$/);
  if (!target || target[1] === target[2]) return false;
  const signature = (right: string, factors: string[]) => {
    const terms = right.replace(/\*/g, "").split("+");
    if (terms.length !== 2 || terms.some(term => !/^[a-z]'?[a-z]'?$/.test(term))) return null;
    const mapped = terms.map(term => (term.match(/[a-z]'?/g) ?? []).map(factor => {
      const index = factors.indexOf(factor[0]!);
      return index < 0 ? "unknown" : `${index}${factor.endsWith("'") ? "'" : ""}`;
    }).sort().join("*"));
    return mapped.sort().join("+");
  };
  const targetFactors = [target[1]!, target[2]!];
  const expectedSignature = signature(`${target[1]}'${target[2]}+${target[1]}${target[2]}'`, targetFactors);
  if (signature(target[3]!, targetFactors) !== expectedSignature) return false;

  const context = learningContentKey(questionContext ?? "");
  // A change of function names cannot hide different independent variables.
  const argumentsUsed = [...`${actual} ${context}`.matchAll(/[a-z]'?\(([a-z])\)/g)].map(match => match[1]);
  if (new Set(argumentsUsed).size > 1) return false;
  const elideArgument = (value: string) => value.replace(/([a-z]'?)\([a-z]\)/g, "$1");
  const expression = elideArgument(actual);
  const question = elideArgument(context);
  const completeBoundary = (value: string, index: number) => !/[a-z0-9'=()+*/^\-]/i.test(value[index] ?? "");
  for (const candidate of expression.matchAll(/(\([a-z]{2}\)'|[a-z]')=([a-z]'?\*?[a-z]'?\+[a-z]'?\*?[a-z]'?)/g)) {
    if (!completeBoundary(expression, candidate.index! - 1)
      || !completeBoundary(expression, candidate.index! + candidate[0].length)) continue;
    const left = candidate[1]!;
    let factors: string[] | undefined;
    if (left.startsWith("(")) factors = [left[1]!, left[2]!];
    else {
      const definition = new RegExp(`\\b${left[0]}=([a-z])\\*?([a-z])`, "g");
      for (const binding of question.matchAll(definition)) {
        if (completeBoundary(question, binding.index! + binding[0].length)) {
          factors = [binding[1]!, binding[2]!];
          break;
        }
      }
    }
    if (factors && factors[0] !== factors[1] && signature(candidate[2]!, factors) === expectedSignature) return true;
  }
  return false;
}
