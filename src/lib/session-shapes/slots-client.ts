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

async function postSlot<T extends ShapeSlotResponse>(request: ShapeSlotRequest, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/sessions/shape", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Yova-Development-Preview": "guided-session" },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ShapeSlotClientError("YOVA could not reach the server. Check your connection and try again.", "network", 0);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const parsed = ShapeSlotErrorSchema.safeParse(body);
    throw new ShapeSlotClientError(parsed.success ? parsed.data.error : SHAPE_SLOT_HONEST_ERROR, parsed.success ? parsed.data.code : "unknown", response.status);
  }
  const parsed = ShapeSlotResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.action !== request.action) {
    throw new ShapeSlotClientError(SHAPE_SLOT_HONEST_ERROR, "invalid_response", response.status);
  }
  return parsed.data as T;
}

export const requestDirection = (request: DirectionRequest, signal?: AbortSignal) => postSlot<DirectionResponse>(request, signal);
export const requestLearnBlock = (request: LearnBlockRequest, signal?: AbortSignal) => postSlot<LearnBlockResponse>(request, signal);
export const requestComparison = (request: CompareRequest, signal?: AbortSignal) => postSlot<CompareResponse>(request, signal);
export const requestPractice = (request: PracticeRequest, signal?: AbortSignal) => postSlot<PracticeResponse>(request, signal);
