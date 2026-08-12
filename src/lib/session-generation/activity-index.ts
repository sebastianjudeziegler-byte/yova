/**
 * Runtime repairs are inserted only in the browser and can shift the visible
 * step number. Server lesson/tutor routes still address the original cached
 * skeleton, so those requests must keep the stable source index.
 */
export function sourceActivityIndex(
  activity: { sourceActivityIndex?: number },
  displayIndex: number,
) {
  return activity.sourceActivityIndex ?? displayIndex;
}
