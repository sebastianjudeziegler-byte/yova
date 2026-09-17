"use client";

import { useState } from "react";
import type { OnboardingAnswers } from "@/lib/onboarding/answers";
import type { LearningMaterial } from "@/lib/domain";
import { makeUuid } from "@/lib/domain";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import { initialSetupCorrections, type SetupCorrections } from "@/lib/plan-generation/setup-corrections";
import { estimateTopicBlockRange } from "@/lib/plan-generation/topic-plan-model";

export function materialReadSummary(material: LearningMaterial): string {
  if (material.processingStatus !== "ready") return "Reading…";
  const chunks = material.understanding?.chunkCount;
  if (chunks) return `${chunks} ${chunks === 1 ? "section" : "sections"} read`;
  const words = material.textContent?.trim().split(/\s+/).length;
  return words ? `${words.toLocaleString()} words read` : "Text read and ready";
}

export function moveSetupTopic(draft: SetupCorrections, from: number, to: number): SetupCorrections {
  if (from < 0 || to < 0 || from >= draft.topics.length || to >= draft.topics.length) return draft;
  const topics = [...draft.topics]; const [topic] = topics.splice(from, 1); topics.splice(to, 0, topic);
  return { ...draft, topics };
}

export function WhatYovaUnderstood({ knowledgeMap, materials, onContinue, onSkip, onBack, busy = false, error = null, onboardingAnswers }: {
  knowledgeMap: PlanKnowledgeMap; materials: LearningMaterial[];
  onContinue: (corrections: SetupCorrections) => void | Promise<void>; onSkip: () => void; onBack: () => void;
  busy?: boolean; error?: string | null; onboardingAnswers?: OnboardingAnswers;
}) {
  const [draft, setDraft] = useState(() => initialSetupCorrections(knowledgeMap, materials));
  const [newTitle, setNewTitle] = useState("");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const topicById = new Map(knowledgeMap.topics.map(topic => [topic.id, topic]));
  const visibleMap = { ...knowledgeMap, topics: draft.topics.map(choice => {
    const original = topicById.get(choice.id) ?? { id: choice.id, title: choice.addedTitle!, description: `Learn and apply ${choice.addedTitle}.`, subtopics: [], prerequisiteTopicIds: [], status: "not_started" as const, initialEvidence: null, sourceReferences: [], origin: "ai_generated" as const, deferred: null };
    return { ...original, initialEvidence: choice.covered ? { source: "learner_report" as const, outcome: "covered_elsewhere" as const, checked: false as const } : original.initialEvidence };
  }) };
  const range = draft.topics.length ? estimateTopicBlockRange(visibleMap, onboardingAnswers) : { min: 0, max: 0 };
  const updateTopic = (id: string, changes: Partial<SetupCorrections["topics"][number]>) => setDraft(current => ({ ...current, topics: current.topics.map(topic => topic.id === id ? { ...topic, ...changes } : topic) }));
  const duplicateTitle = visibleMap.topics.some(topic => topic.title.toLocaleLowerCase() === newTitle.trim().toLocaleLowerCase());
  return <section className="plan-panel wide" aria-labelledby="understood-title">
    <span className="step-label">CHECK THE SCOPE</span><h1 id="understood-title">What YOVA understood</h1>
    <p>Correct the topics and sources below. All your changes apply together when you continue.</p>
    {materials.length > 0 && <section aria-label="Your materials"><h2>Your materials</h2>{materials.map(material => {
      const role = draft.materials.find(choice => choice.materialId === material.id)?.role ?? material.understanding?.role ?? "content_source";
      return <div className="material-files" key={material.id}><strong>{material.name}</strong><span>{materialReadSummary(material)} · Ready</span>
        <div role="group" aria-label={`Classify ${material.name}`}>
          <button type="button" className="button ghost" aria-pressed={role === "scope_outline"} disabled={busy} onClick={() => setDraft(current => ({ ...current, materials: [...current.materials.filter(choice => choice.materialId !== material.id), { materialId: material.id, role: "scope_outline" }] }))}>Study guide</button>
          <button type="button" className="button ghost" aria-pressed={role === "content_source"} disabled={busy} onClick={() => setDraft(current => ({ ...current, materials: [...current.materials.filter(choice => choice.materialId !== material.id), { materialId: material.id, role: "content_source" }] }))}>Notes or slides</button>
        </div><small>{role === "mixed" ? "Contains teaching and a topic outline. Keep this mix, or choose a classification." : role === "scope_outline" ? "Names what to learn, doesn't teach it — YOVA will teach these topics." : "Teaches the content — YOVA will point you here."}</small>
      </div>;
    })}</section>}
    <h2>Topics YOVA found</h2><p>Already covered skips teaching and goes to practice. It does not mark a topic as known.</p>
    <ol className="generated-topic-map">{draft.topics.map((choice, index) => {
      const topic = visibleMap.topics[index];
      return <li key={choice.id} draggable={!busy} onDragStart={() => setDraggedIndex(index)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (draggedIndex !== null) setDraft(current => moveSetupTopic(current, draggedIndex, index)); setDraggedIndex(null); }}>
        <strong>{topic.title}</strong>{topic.subtopics.length > 0 && <ul>{topic.subtopics.map(subtopic => <li key={subtopic}>{subtopic}</li>)}</ul>}
        <label>Source for {topic.title}<select disabled={busy} value={choice.materialId ?? ""} onChange={event => updateTopic(choice.id, { materialId: event.target.value || null })}><option value="">YOVA will teach this</option>{materials.map(material => <option key={material.id} value={material.id}>{material.name}</option>)}</select></label>
        <label><input type="checkbox" checked={choice.covered} disabled={busy} onChange={event => updateTopic(choice.id, { covered: event.target.checked })} /> Already covered: {topic.title}</label>
        <div><button type="button" className="button ghost" aria-label={`Move ${topic.title} up`} disabled={busy || index === 0} onClick={() => setDraft(current => moveSetupTopic(current, index, index - 1))}>↑</button><button type="button" className="button ghost" aria-label={`Move ${topic.title} down`} disabled={busy || index === draft.topics.length - 1} onClick={() => setDraft(current => moveSetupTopic(current, index, index + 1))}>↓</button><button type="button" className="button ghost" aria-label={`Remove ${topic.title}`} disabled={busy} onClick={() => setDraft(current => ({ ...current, topics: current.topics.filter(topic => topic.id !== choice.id) }))}>Remove</button></div>
      </li>;
    })}</ol>
    <div className="starting-context-field"><label htmlFor="add-understood-topic">Add a topic</label><input id="add-understood-topic" maxLength={140} value={newTitle} onChange={event => setNewTitle(event.target.value)} disabled={busy || draft.topics.length >= 40} /><button className="button secondary" disabled={busy || newTitle.trim().length < 2 || duplicateTitle || draft.topics.length >= 40} onClick={() => { setDraft(current => ({ ...current, topics: [...current.topics, { id: makeUuid(), addedTitle: newTitle.trim(), materialId: null, covered: false }] })); setNewTitle(""); }}>Add topic</button></div>
    <p role="status">Roughly {range.min}–{range.max} blocks, including learning and practice. Availability comes next.</p>
    {error && <p role="alert" className="material-error">{error}</p>}
    <footer className="plan-actions"><button className="button ghost" disabled={busy} onClick={onBack}>Back</button><button className="button ghost" disabled={busy} onClick={onSkip}>Skip corrections</button><button className="button primary" disabled={busy || draft.topics.length === 0} onClick={() => void onContinue(draft)}>{busy ? "Applying corrections…" : "Continue"}</button></footer>
  </section>;
}
