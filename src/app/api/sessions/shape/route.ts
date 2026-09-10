import { openAIShapeSlotProvider } from "@/lib/openai/shape-slot-generator";
import { handleShapeSlotRequest } from "@/lib/server/shape-slot-handler";

export const runtime = "nodejs";
export const maxDuration = 60;

/** The four bounded AI slots of the baseline session shapes (docs/redesign/04-AI-SLOTS.md). */
export async function POST(request: Request) {
  return handleShapeSlotRequest(request, { provider: openAIShapeSlotProvider() });
}
