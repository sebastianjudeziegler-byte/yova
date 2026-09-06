const TEACHING_TITLE_MAX_CHARACTERS = 72;
const TEACHING_TITLE_MAX_WORDS = 10;

const REDUNDANT_TEACHING_ACTION = /^(?:(?:learn|teach|study|read|review|explore|understand|see|explain|trace|build|practice|apply|recognize|identify|describe|compare|connect|map|walk through|work through)\s+)+/i;
const EXPLANATORY_CLAIM_CONNECTOR = /\b(?:because|therefore|thereby|thus|causes?|caused|produces?|produced|results? in|resulted in|leads? to|led to|which means|so that)\b/i;
const DECLARATIVE_CLAIM_VERB = /\b(?:is|are|was|were|has|have|had|makes?|made|forms?|formed|stops?|stopped|creates?|created|increases?|increased|reduces?|reduced|releases?|released|forces?|forced|allows?|allowed|prevents?|prevented|becomes?|became)\b/i;
const QUESTION_HEADING = /^(?:how|why|what|when|where|which|who)\b/i;

export const STREAMED_TEACHING_INSTRUCTION = "Read the explanation, then answer the next question from memory.";

type TeachingTitleOptions = {
  preferredTitle?: string | null;
  alternateTitle?: string | null;
  fallbackTitle?: string;
};

/**
 * Turns model-authored activity copy into a real interface heading. Semantic
 * lesson claims stay in lessonBrief; they are never clipped into a title.
 */
export function conciseTeachingActivityTitle({
  preferredTitle,
  alternateTitle,
  fallbackTitle = "Your lesson model",
}: TeachingTitleOptions) {
  for (const candidate of [preferredTitle, alternateTitle]) {
    const title = normalizeTeachingTitle(candidate);
    if (title) return title;
  }

  return normalizeTeachingTitle(fallbackTitle) ?? "Your lesson model";
}

export type StreamedLessonPresentation = {
  title: string;
  content: string;
  liftedHeading: boolean;
};

/**
 * A streamed lesson often supplies a much better natural heading than the
 * cached skeleton that opened it. Lift that heading into the page's only H1
 * and remove it from the lesson body so learners do not see the same title
 * twice. This also repairs already-persisted sessions at render time.
 */
export function streamedLessonPresentation({
  activityTitle,
  lessonContent,
  streaming = false,
}: {
  activityTitle: string;
  lessonContent?: string | null;
  streaming?: boolean;
}): StreamedLessonPresentation {
  const content = lessonContent ?? "";
  const leadingHeading = extractLeadingMarkdownHeading(content, {
    requireLineBreak: streaming,
  });
  const liftedTitle = normalizeTeachingTitle(leadingHeading?.heading);

  return {
    title: liftedTitle ?? conciseTeachingActivityTitle({ preferredTitle: activityTitle }),
    content: liftedTitle && leadingHeading ? leadingHeading.content : content,
    liftedHeading: Boolean(liftedTitle && leadingHeading),
  };
}

export function extractLeadingMarkdownHeading(
  value: string,
  { requireLineBreak = false }: { requireLineBreak?: boolean } = {},
) {
  const match = /^(?:[\t ]*\r?\n)*[\t ]{0,3}#{1,6}[\t ]+([^\r\n]+?)[\t ]*#*[\t ]*(\r?\n|$)/.exec(value);
  if (!match) return null;
  if (requireLineBreak && !match[2]) return null;

  const heading = match[1]?.trim();
  if (!heading) return null;

  return {
    heading,
    content: value.slice(match[0].length).replace(/^(?:[\t ]*\r?\n)+/, ""),
  };
}

function normalizeTeachingTitle(value: string | null | undefined) {
  if (!value) return null;
  const wasAbbreviated = /(?:\.{3}|…)\s*$/.test(value);
  let normalized = value
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+#+$/, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .trim();
  if (!normalized || wasAbbreviated) return null;

  normalized = normalized
    .replace(REDUNDANT_TEACHING_ACTION, "")
    .replace(/[.:;]\s*$/, "")
    .trim();
  if (!normalized) return null;

  normalized = capitalizeFirstLetter(normalized);
  const words = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? [];
  if (
    normalized.length > TEACHING_TITLE_MAX_CHARACTERS
    || words.length > TEACHING_TITLE_MAX_WORDS
  ) return null;
  if (
    !QUESTION_HEADING.test(normalized)
    && (EXPLANATORY_CLAIM_CONNECTOR.test(normalized) || DECLARATIVE_CLAIM_VERB.test(normalized))
  ) {
    return null;
  }

  return normalized;
}

function capitalizeFirstLetter(value: string) {
  const index = value.search(/\p{L}/u);
  if (index < 0) return value;
  return `${value.slice(0, index)}${value[index]!.toLocaleUpperCase()}${value.slice(index + 1)}`;
}
