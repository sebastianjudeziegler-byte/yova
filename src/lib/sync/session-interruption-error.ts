export class UnsupportedBroadRecallInterruptionError extends Error {
  constructor() {
    super("YOVA could not preserve this retired activity marker in the cloud.");
    this.name = "UnsupportedBroadRecallInterruptionError";
  }
}
