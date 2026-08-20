import { z } from "zod";

const AvailableAllowanceSchema = z.object({
  status: z.literal("available"),
  remainingToday: z.number().int().min(1).max(1_000),
  retryAfterSeconds: z.literal(0),
  resetAt: z.null(),
}).strict();

const TemporarilyLimitedAllowanceSchema = z.object({
  status: z.literal("temporarily_limited"),
  remainingToday: z.number().int().min(1).max(1_000),
  retryAfterSeconds: z.number().int().min(1).max(86_400),
  resetAt: z.string().datetime(),
}).strict();

const ExhaustedAllowanceSchema = z.object({
  status: z.literal("exhausted"),
  remainingToday: z.literal(0),
  retryAfterSeconds: z.number().int().min(1).max(86_400),
  resetAt: z.string().datetime(),
}).strict();

export const GuidedSessionAllowanceStatusResponseSchema = z.discriminatedUnion("status", [
  AvailableAllowanceSchema,
  TemporarilyLimitedAllowanceSchema,
  ExhaustedAllowanceSchema,
]);

export type GuidedSessionAllowanceStatusResponse = z.infer<
  typeof GuidedSessionAllowanceStatusResponseSchema
>;

export type GuidedSessionAllowanceStatusResponseLike = {
  status: number;
  headers: Pick<Headers, "get">;
};

export type GuidedSessionAllowanceState = GuidedSessionAllowanceStatusResponse extends infer Status
  ? Status extends GuidedSessionAllowanceStatusResponse
    ? Omit<Status, "status"> & { kind: Status["status"] }
    : never
  : never;

export type GuidedSessionAllowanceUnavailableState = {
  kind: "unavailable";
  remainingToday: null;
  retryAfterSeconds: null;
  resetAt: null;
};

/**
 * Parses the private status endpoint into display state. `resetAt` is already
 * calculated by the database from the durable usage window; this helper never
 * recreates the server's quota boundary from the browser clock.
 */
export function guidedSessionAllowanceStateFromResponse(
  response: GuidedSessionAllowanceStatusResponseLike,
  body: unknown,
): GuidedSessionAllowanceState | GuidedSessionAllowanceUnavailableState {
  if (response.status !== 200) return unavailableState();
  const parsed = GuidedSessionAllowanceStatusResponseSchema.safeParse(body);
  if (!parsed.success) return unavailableState();
  const { status, ...statusState } = parsed.data;
  return { kind: status, ...statusState } as GuidedSessionAllowanceState;
}

export function formatGuidedSessionAllowanceReset(resetAt: string | null) {
  if (!resetAt) return null;
  const resetDate = new Date(resetAt);
  if (Number.isNaN(resetDate.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(resetDate);
}

function unavailableState(): GuidedSessionAllowanceUnavailableState {
  return {
    kind: "unavailable",
    remainingToday: null,
    retryAfterSeconds: null,
    resetAt: null,
  };
}
