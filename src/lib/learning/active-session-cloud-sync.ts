export function cloudCheckpointResponseIsCurrent({
  requestedEpoch,
  currentEpoch,
  runId,
  discardedRunIds,
}: {
  requestedEpoch: number;
  currentEpoch: number;
  runId: string;
  discardedRunIds: ReadonlySet<string>;
}) {
  return requestedEpoch === currentEpoch && !discardedRunIds.has(runId);
}
