import type { PlanGenerationResponse } from "@/lib/plan-generation/schema";

export function PlanGenerationNotice({
  generation,
  onRetry,
  retryDisabled = false,
}: {
  generation: PlanGenerationResponse["generation"];
  onRetry: () => void;
  retryDisabled?: boolean;
}) {
  if (!generation.notice) return null;
  const livePlanningFailed = generation.mode === "system";

  return (
    <div
      className={`generation-notice${livePlanningFailed ? " failure" : ""}`}
      role={livePlanningFailed ? "alert" : "status"}
    >
      <span>{livePlanningFailed ? "Live planning issue" : "Alpha note"}</span>
      <p>{generation.notice}</p>
      {livePlanningFailed && (
        <button type="button" className="button secondary" disabled={retryDisabled} onClick={onRetry}>
          Retry live planning
        </button>
      )}
    </div>
  );
}
