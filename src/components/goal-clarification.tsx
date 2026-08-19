"use client";

import { useState } from "react";
import { ArrowRight, FileText, HelpCircle } from "lucide-react";
import { goalClarificationSuggestions } from "@/lib/learning/goal-context";

function clarificationParts(detail: string) {
  return detail
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function hasClarificationSuggestion(detail: string, suggestion: string) {
  const normalizedSuggestion = suggestion.trim().toLocaleLowerCase();
  return clarificationParts(detail).some(
    (part) => part.toLocaleLowerCase() === normalizedSuggestion,
  );
}

export function toggleClarificationSuggestion(detail: string, suggestion: string) {
  const normalizedSuggestion = suggestion.trim().toLocaleLowerCase();
  const parts = clarificationParts(detail);

  if (parts.some((part) => part.toLocaleLowerCase() === normalizedSuggestion)) {
    return parts
      .filter((part) => part.toLocaleLowerCase() !== normalizedSuggestion)
      .join(", ");
  }

  return [...parts, suggestion.trim()].join(", ");
}

export function GoalClarification({
  goal,
  onClarify,
  onUseMaterials,
}: {
  goal: string;
  onClarify: (detail: string) => void;
  onUseMaterials: () => void;
}) {
  const [detail, setDetail] = useState("");
  const suggestions = goalClarificationSuggestions(goal);
  const canUseDetail = detail.trim().length >= 3;

  return (
    <section className="goal-clarification" aria-labelledby="goal-clarification-title">
      <span className="step-label"><HelpCircle size={14} /> ONE QUICK QUESTION</span>
      <h2 id="goal-clarification-title">What topics or skills does this actually cover?</h2>
      <p>YOVA cannot see what your class calls “Unit 3.” Choose a likely topic below, type what your teacher listed, or add a source that defines it.</p>
      {suggestions.length > 0 && (
        <div className="clarification-suggestions" aria-label="Possible topics">
          {suggestions.map((suggestion) => (
            <button
              aria-pressed={hasClarificationSuggestion(detail, suggestion)}
              className={hasClarificationSuggestion(detail, suggestion) ? "selected" : ""}
              key={suggestion}
              type="button"
              onClick={() => setDetail((current) => toggleClarificationSuggestion(current, suggestion))}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      <label className="clarification-input">
        <span>Topic, skill, or example problem</span>
        <input
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          placeholder="Example: product rule and chain rule"
        />
      </label>
      <div className="clarification-actions">
        <button className="button ghost" type="button" onClick={onUseMaterials}><FileText size={16} /> Add class materials instead</button>
        <button className="button primary" type="button" disabled={!canUseDetail} onClick={() => onClarify(detail.trim())}>Use this topic <ArrowRight size={16} /></button>
      </div>
    </section>
  );
}
