export const LEARNER_TEXT_CHARACTER_LIMIT = 500;

export type CharacterLimitState = {
  count: number;
  limit: number;
  isOverLimit: boolean;
  charactersOver: number;
};

export function getCharacterLimitState(
  value: string,
  limit = LEARNER_TEXT_CHARACTER_LIMIT,
): CharacterLimitState {
  const count = value.length;

  return {
    count,
    limit,
    isOverLimit: count > limit,
    charactersOver: Math.max(0, count - limit),
  };
}

export function formatCharacterLimit(state: CharacterLimitState) {
  const count = `${state.count}/${state.limit}`;
  if (!state.isOverLimit) return count;

  return `${count} · ${state.charactersOver} ${state.charactersOver === 1 ? "character" : "characters"} over the limit.`;
}
