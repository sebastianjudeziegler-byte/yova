/** Small, deterministic map data. Layout never depends on a model or a graph service. */
export type ConceptMapDraft = {
  concepts: Array<{ id: string; label: string }>;
  links: Array<{ id: string; from: string; to: string; label: string }>;
};
export type MapItemFeedback = { targetId: string; message: string };
export const MAP_CONCEPT_LIMIT = 12;
export const MAP_LINK_LIMIT = 18;

export function emptyConceptMap(): ConceptMapDraft {
  return { concepts: [1, 2, 3].map((id) => ({ id: `concept-${id}`, label: "" })), links: [] };
}
export function nextMapId(prefix: string, ids: readonly string[]) {
  // New nodes never inherit an old, deleted node's feedback identity.
  let id: string;
  do { id = `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`; } while (ids.includes(id));
  return id;
}
export function removeMapConcept(map: ConceptMapDraft, id: string): ConceptMapDraft {
  return { concepts: map.concepts.filter((concept) => concept.id !== id), links: map.links.filter((link) => link.from !== id && link.to !== id) };
}
export function conceptMapItems(map: ConceptMapDraft) {
  const named = new Map(map.concepts.filter((concept) => concept.label.trim()).map((concept) => [concept.id, concept.label.trim()]));
  return [
    ...[...named].map(([id, label]) => ({ id, kind: "concept" as const, label })),
    ...map.links.filter((link) => named.has(link.from) && named.has(link.to) && link.label.trim()).map((link) => ({ id: link.id, kind: "link" as const, label: `${named.get(link.from)} —${link.label.trim()}→ ${named.get(link.to)}` })),
  ];
}
export function conceptMapCanSubmit(map: ConceptMapDraft) {
  return conceptMapItems(map).some((item) => item.kind === "link") && map.links.every((link) => link.from !== link.to);
}
export function conceptMapAsProduce(map: ConceptMapDraft) {
  const named = new Map(map.concepts.map((concept) => [concept.id, concept.label.trim()]));
  return {
    kind: "concept_map" as const,
    concepts: map.concepts.map((concept) => concept.label.trim()).filter(Boolean),
    links: map.links.filter((link) => named.get(link.from) && named.get(link.to) && link.label.trim()).map((link) => ({ from: named.get(link.from)!, to: named.get(link.to)!, label: link.label.trim() })),
    map,
  };
}
export function validMapFeedback(map: ConceptMapDraft, feedback: readonly MapItemFeedback[]) {
  const ids = new Set(conceptMapItems(map).map((item) => item.id));
  return feedback.filter((item) => ids.has(item.targetId));
}
