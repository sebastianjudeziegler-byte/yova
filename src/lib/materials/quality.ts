export type MaterialQuality = {
  status: "ready" | "limited" | "unusable";
  wordCount: number;
  notice: string | null;
};

export function assessMaterialQuality(text: string, truncated: boolean): MaterialQuality {
  const visibleCharacters = text.replace(/\s/g, "").length;
  const alphanumericCharacters = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const tokens = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? [];
  const readableRatio = visibleCharacters > 0 ? alphanumericCharacters / visibleCharacters : 0;

  if (visibleCharacters < 60 || tokens.length < 8 || readableRatio < 0.4) {
    return {
      status: "unusable",
      wordCount: tokens.length,
      notice: "YOVA found too little readable learning content in this file. Try a clearer export, pasted notes, or YOVA-created content.",
    };
  }

  if (truncated) {
    return {
      status: "limited",
      wordCount: tokens.length,
      notice: "YOVA read the first 50,000 characters. This material is usable, but later sections were not included.",
    };
  }

  if (visibleCharacters < 500 || tokens.length < 60) {
    return {
      status: "limited",
      wordCount: tokens.length,
      notice: "YOVA found a short source. It will use this file to set the scope and may add clearly labeled explanations where the source only lists a topic.",
    };
  }

  return { status: "ready", wordCount: tokens.length, notice: null };
}
