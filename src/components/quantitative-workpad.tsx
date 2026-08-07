"use client";

import { useState } from "react";
import { Calculator, Plus, Trash2 } from "lucide-react";

type QuantitativeWork = {
  steps: string[];
  finalAnswer: string;
};

export function QuantitativeWorkpad({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const parsed = parseQuantitativeWork(value);
  const [rowCount, setRowCount] = useState(() => Math.max(2, parsed.steps.length));
  const steps = Array.from({ length: rowCount }, (_, index) => parsed.steps[index] ?? "");

  const update = (nextSteps: string[], finalAnswer = parsed.finalAnswer) => {
    onChange(formatQuantitativeWork({ steps: nextSteps, finalAnswer }));
  };

  return <section className="quantitative-workpad" aria-label="Show your reasoning">
    <header>
      <span><Calculator size={18} /></span>
      <div>
        <strong>Show your reasoning, one step at a time</strong>
        <p>YOVA checks the method and the result, so a small arithmetic slip does not hide correct reasoning.</p>
      </div>
    </header>
    <div className="workpad-steps">
      {steps.map((step, index) => <label key={index}>
        <span>{index + 1}</span>
        <textarea
          aria-label={`Reasoning step ${index + 1}`}
          rows={2}
          value={step}
          disabled={disabled}
          placeholder={index === 0 ? "Set up the rule, equation, or known information" : "Continue the calculation or explain this step"}
          onChange={(event) => update(steps.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
        />
      </label>)}
    </div>
    {!disabled && <div className="workpad-row-actions">
      <button type="button" onClick={() => setRowCount((count) => Math.min(6, count + 1))} disabled={rowCount >= 6}>
        <Plus size={15} /> Add a step
      </button>
      {rowCount > 2 && <button type="button" onClick={() => {
        const nextCount = rowCount - 1;
        setRowCount(nextCount);
        update(steps.slice(0, nextCount));
      }}>
        <Trash2 size={14} /> Remove last
      </button>}
    </div>}
    <label className="workpad-final">
      <span>Final answer</span>
      <input
        value={parsed.finalAnswer}
        disabled={disabled}
        placeholder="Enter the final result"
        onChange={(event) => update(steps, event.target.value)}
      />
    </label>
  </section>;
}

export function formatQuantitativeWork({ steps, finalAnswer }: QuantitativeWork) {
  const reasoning = steps
    .map((step) => step.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .map((step, index) => `Step ${index + 1}: ${step}`);
  const normalizedAnswer = finalAnswer.trim().replace(/\s+/g, " ");
  const answer = normalizedAnswer ? [`Final answer: ${normalizedAnswer}`] : [];
  return [...reasoning, ...answer].join("\n");
}

export function parseQuantitativeWork(value: string): QuantitativeWork {
  const steps: string[] = [];
  let finalAnswer = "";

  for (const rawLine of value.split("\n")) {
    const line = rawLine.trim();
    const stepMatch = line.match(/^Step\s+\d+:\s*(.*)$/i);
    const answerMatch = line.match(/^Final answer:\s*(.*)$/i);
    if (stepMatch) steps.push(stepMatch[1]);
    else if (answerMatch) finalAnswer = answerMatch[1];
    else if (line && !finalAnswer) finalAnswer = line;
  }

  return { steps, finalAnswer };
}
