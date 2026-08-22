/**
 * Browser-safe identity for local cache/checkpoint comparisons. This is not a
 * security primitive: server authorization and the SHA-256 cache fingerprint
 * remain authoritative. Stable key ordering keeps the same logical value
 * identical across browser hydration and server generation.
 */
export function stableFingerprint(
  value: unknown,
  namespace: string,
) {
  const serialized = stableSerialize(value);
  return `${namespace}:${hash32(serialized, 0x811c9dc5)}${hash32(serialized, 0x9e3779b9)}`;
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function hash32(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
