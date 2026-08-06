import { z } from "zod";

export const ErrorSurfaceSchema = z.enum([
  "route_boundary",
  "global_boundary",
  "cloud_sync",
  "plan_generation",
  "session_generation",
  "session_completion",
  "tutor",
  "materials",
  "support",
]);

export const ErrorReportRequestSchema = z.object({
  surface: ErrorSurfaceSchema,
  errorCode: z.string().regex(/^[a-z0-9_]{3,80}$/),
  digest: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable().optional(),
  requestId: z.string().uuid().nullable().optional(),
  routePath: z.string().trim().max(240).regex(/^\/[A-Za-z0-9/_-]*$/).nullable().optional(),
}).strict();

export type ErrorReportRequest = z.infer<typeof ErrorReportRequestSchema>;
export type ErrorSurface = z.infer<typeof ErrorSurfaceSchema>;
