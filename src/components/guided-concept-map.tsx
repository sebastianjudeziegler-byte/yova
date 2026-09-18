"use client";

import { useId, useState } from "react";
import { conceptMapItems, MAP_CONCEPT_LIMIT, MAP_LINK_LIMIT, nextMapId, removeMapConcept, validMapFeedback, type ConceptMapDraft, type MapItemFeedback } from "@/lib/session-shapes/concept-map";
import styles from "./guided-concept-map.module.css";

/** Native inputs and a fixed grid: no dragging, graph library, or generated layout. */
export function GuidedConceptMap({ value, onChange, feedback = [], label = "Your concept map" }: {
  value: ConceptMapDraft;
  onChange?: (next: ConceptMapDraft) => void;
  feedback?: MapItemFeedback[];
  label?: string;
}) {
  const marker = useId().replace(/:/g, "");
  const [notice, setNotice] = useState("");
  const named = value.concepts.filter((concept) => concept.label.trim());
  const points = new Map(named.map((concept, index) => [concept.id, { x: 110 + (index % 3) * 210, y: 50 + Math.floor(index / 3) * 115 }]));
  const height = Math.max(110, Math.ceil(named.length / 3) * 115);
  const items = conceptMapItems(value);
  const usableFeedback = validMapFeedback(value, feedback);
  const changeConcept = (id: string, label: string) => onChange?.({ ...value, concepts: value.concepts.map((concept) => concept.id === id ? { ...concept, label } : concept) });
  return <section className={styles.map} aria-label={label}>
    <div className={styles.preview}>
      {named.length ? <svg viewBox={`0 0 640 ${height}`} role="img" aria-label={`${label}: ${named.length} concepts. Relationships and feedback are listed below.`}>
        <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
        {value.links.map((link, index) => {
          const from = points.get(link.from); const to = points.get(link.to);
          if (!from || !to || link.from === link.to || !link.label.trim()) return null;
          const marked = usableFeedback.some((item) => item.targetId === link.id);
          const dx = to.x - from.x; const dy = to.y - from.y;
          const edge = Math.min(90 / Math.max(1, Math.abs(dx)), 27 / Math.max(1, Math.abs(dy)));
          return <g key={link.id} className={marked ? styles.marked : undefined}><line x1={from.x + dx * edge} y1={from.y + dy * edge} x2={to.x - dx * edge} y2={to.y - dy * edge} markerEnd={`url(#${marker})`} /><text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 5} textAnchor="middle" fontSize="12" fill="currentColor">{index + 1}</text><title>{`${items.find((item) => item.id === link.id)?.label ?? ""}${marked ? " — see feedback below" : ""}`}</title></g>;
        })}
        {named.map((concept) => {
          const point = points.get(concept.id)!;
          const marked = usableFeedback.some((item) => item.targetId === concept.id);
          return <g key={concept.id} transform={`translate(${point.x - 85}, ${point.y - 22})`} className={marked ? styles.marked : undefined}>
            <rect width="170" height="44" rx="10" />
            <foreignObject x="7" y="3" width="156" height="38"><div className={styles.nodeLabel}>{concept.label}</div></foreignObject>
            <title>{`${concept.label}${marked ? " — see feedback below" : ""}`}</title>
          </g>;
        })}
      </svg> : <p>Add concepts below. Your map will appear here.</p>}
    </div>
    <ol className={styles.relationships} aria-label="Map relationships and feedback">
      {items.filter((item) => item.kind === "link").map((item) => <li key={item.id} data-map-item-id={item.id} className={usableFeedback.some((entry) => entry.targetId === item.id) ? styles.feedbackItem : undefined}>
        <span>{item.label}</span>{usableFeedback.filter((entry) => entry.targetId === item.id).map((entry, index) => <p key={index}>{entry.message}</p>)}
      </li>)}
      {usableFeedback.filter((entry) => value.concepts.some((concept) => concept.id === entry.targetId)).map((entry, index) => <li className={styles.feedbackItem} key={`feedback-${index}`}>{value.concepts.find((concept) => concept.id === entry.targetId)?.label}: {entry.message}</li>)}
    </ol>
    {onChange && <>
      <fieldset><legend>1. Name the concepts</legend><div className={styles.concepts}>{value.concepts.map((concept, index) => <div key={concept.id}>
        <input aria-label={`Concept ${index + 1}`} maxLength={80} value={concept.label} placeholder={`Concept ${index + 1}`} onChange={(event) => changeConcept(concept.id, event.target.value)} />
        <button type="button" className="button ghost" aria-label={`Remove concept ${index + 1}`} onClick={() => {
          const removedLinks = value.links.filter((link) => link.from === concept.id || link.to === concept.id).length;
          onChange(removeMapConcept(value, concept.id)); setNotice(`Removed ${concept.label || "concept"}${removedLinks ? ` and ${removedLinks} connected ${removedLinks === 1 ? "link" : "links"}` : ""}.`);
        }}>Remove</button>
      </div>)}</div><button type="button" className="button ghost" disabled={value.concepts.length >= MAP_CONCEPT_LIMIT} onClick={() => onChange({ ...value, concepts: [...value.concepts, { id: nextMapId("concept", value.concepts.map((concept) => concept.id)), label: "" }] })}>Add concept</button></fieldset>
      <fieldset><legend>2. Connect them and explain the relationship</legend>
        {value.links.map((link, index) => <div className={styles.link} key={link.id}>
          <select aria-label={`Link ${index + 1} from`} value={link.from} onChange={(event) => onChange({ ...value, links: value.links.map((item) => item.id === link.id ? { ...item, from: event.target.value } : item) })}><option value="">From concept</option>{named.filter((concept) => concept.id !== link.to).map((concept) => <option key={concept.id} value={concept.id}>{concept.label}</option>)}</select>
          <input aria-label={`Link ${index + 1} label`} maxLength={160} placeholder="e.g. provides energy for" value={link.label} onChange={(event) => onChange({ ...value, links: value.links.map((item) => item.id === link.id ? { ...item, label: event.target.value } : item) })} />
          <select aria-label={`Link ${index + 1} to`} value={link.to} onChange={(event) => onChange({ ...value, links: value.links.map((item) => item.id === link.id ? { ...item, to: event.target.value } : item) })}><option value="">To concept</option>{named.filter((concept) => concept.id !== link.from).map((concept) => <option key={concept.id} value={concept.id}>{concept.label}</option>)}</select>
          <button type="button" className="button ghost" aria-label={`Remove link ${index + 1}`} onClick={() => onChange({ ...value, links: value.links.filter((item) => item.id !== link.id) })}>Remove</button>
        </div>)}
        <button type="button" className="button ghost" disabled={named.length < 2 || value.links.length >= MAP_LINK_LIMIT} onClick={() => onChange({ ...value, links: [...value.links, { id: nextMapId("link", value.links.map((link) => link.id)), from: named[0]?.id ?? "", to: named[1]?.id ?? "", label: "" }] })}>Add relationship</button>
        {named.length < 2 && <small>Name two concepts to connect them.</small>}
      </fieldset>
      <p aria-live="polite" className={styles.notice}>{notice}</p>
    </>}
  </section>;
}
