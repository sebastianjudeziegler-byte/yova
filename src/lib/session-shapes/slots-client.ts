import {
  SHAPE_SLOT_HONEST_ERROR,
  ShapeSlotErrorSchema,
  ShapeSlotResponseSchema,
  type CompareRequest,
  type CompareResponse,
  type DirectionRequest,
  type DirectionResponse,
  type LearnBlockRequest,
  type LearnBlockResponse,
  type PracticeRequest,
  type PracticeResponse,
  type ShapeSlotRequest,
  type ShapeSlotResponse,
} from "@/lib/session-shapes/slots-schema";

/** Browser client for the four AI slots. One request, one slot, honest errors. */
export class ShapeSlotClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ShapeSlotClientError";
    this.code = code;
    this.status = status;
  }
}

export function makeSlotIds() {
  return { requestId: crypto.randomUUID(), recoveryKey: crypto.randomUUID() };
}

export const SHAPE_SLOT_CLIENT_TIMEOUT_MS = 65_000;

async function postSlot<T extends ShapeSlotResponse>(request: ShapeSlotRequest, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, SHAPE_SLOT_CLIENT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch("/api/sessions/shape", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Yova-Development-Preview": "guided-session" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) throw new ShapeSlotClientError("This step took too long. Your work remains on screen; retry when you are ready.", "timeout", 408);
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      throw new ShapeSlotClientError("YOVA could not reach the server. Check your connection and try again.", "network", 0);
    }
    let body: unknown = null;
    try { body = await response.json(); }
    catch (error) {
      if (timedOut) throw new ShapeSlotClientError("This step took too long. Your work remains on screen; retry when you are ready.", "timeout", 408);
      if (signal?.aborted) throw error;
    }
    if (!response.ok) {
      const parsed = ShapeSlotErrorSchema.safeParse(body);
      throw new ShapeSlotClientError(parsed.success ? parsed.data.error : SHAPE_SLOT_HONEST_ERROR, parsed.success ? parsed.data.code : "unknown", response.status);
    }
    const parsed = ShapeSlotResponseSchema.safeParse(body);
    if (!parsed.success || parsed.data.action !== request.action) throw new ShapeSlotClientError(SHAPE_SLOT_HONEST_ERROR, "invalid_response", response.status);
    return parsed.data as T;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export const requestDirection = (request: DirectionRequest, signal?: AbortSignal) => postSlot<DirectionResponse>(request, signal);
export const requestLearnBlock = (request: LearnBlockRequest, signal?: AbortSignal) => postSlot<LearnBlockResponse>(request, signal);
export const requestComparison = (request: CompareRequest, signal?: AbortSignal) => postSlot<CompareResponse>(request, signal);
export const requestPractice = (request: PracticeRequest, signal?: AbortSignal) => postSlot<PracticeResponse>(request, signal);
