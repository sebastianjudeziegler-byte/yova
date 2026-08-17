const MAX_ACTIVE_SESSION_SECONDS = 360 * 60;

export type ActiveSessionClockState = {
  accumulatedSeconds: number;
  activeSince: number | null;
};

export function createActiveSessionClock(
  elapsedSeconds: number,
  now: number,
  visible: boolean,
): ActiveSessionClockState {
  return {
    accumulatedSeconds: boundSeconds(elapsedSeconds),
    activeSince: visible ? readTimestamp(now) : null,
  };
}

export function readActiveSessionSeconds(
  state: ActiveSessionClockState,
  now: number,
) {
  const accumulatedSeconds = boundSeconds(state.accumulatedSeconds);
  const activeSince = readTimestamp(state.activeSince);
  const currentTime = readTimestamp(now);
  if (activeSince === null || currentTime === null || currentTime <= activeSince) {
    return accumulatedSeconds;
  }

  const activeSeconds = Math.floor((currentTime - activeSince) / 1_000);
  return boundSeconds(accumulatedSeconds + activeSeconds);
}

export function pauseActiveSessionClock(
  state: ActiveSessionClockState,
  now: number,
): ActiveSessionClockState {
  return {
    accumulatedSeconds: readActiveSessionSeconds(state, now),
    activeSince: null,
  };
}

export function resumeActiveSessionClock(
  state: ActiveSessionClockState,
  now: number,
): ActiveSessionClockState {
  const activeSince = readTimestamp(state.activeSince);
  return {
    accumulatedSeconds: boundSeconds(state.accumulatedSeconds),
    activeSince: activeSince ?? readTimestamp(now),
  };
}

function boundSeconds(value: number) {
  if (Number.isNaN(value) || value <= 0) return 0;
  if (!Number.isFinite(value) || value >= MAX_ACTIVE_SESSION_SECONDS) {
    return MAX_ACTIVE_SESSION_SECONDS;
  }
  return Math.floor(value);
}

function readTimestamp(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}
