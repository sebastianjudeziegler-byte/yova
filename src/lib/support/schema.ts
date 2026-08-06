import { z } from "zod";

export const SupportRequestSchema = z.object({
  category: z.enum(["account", "plan", "session", "materials", "billing", "feedback", "other"]),
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(4_000),
}).strict();

export type SupportRequest = z.infer<typeof SupportRequestSchema>;
