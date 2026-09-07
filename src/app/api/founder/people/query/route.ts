import { NextResponse } from "next/server";
import { FounderPeopleQuerySchema } from "@/lib/founder/people";
import {
  FounderPeopleAccessError,
  FounderPeopleDataError,
  loadFounderPeopleDirectory,
} from "@/lib/founder/people-data";
import {
  FOUNDER_PRIVATE_HEADERS,
  readBoundedFounderPeopleJson,
  validateFounderPeopleRequest,
} from "@/lib/founder/people-http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const guard = validateFounderPeopleRequest(request);
  if (!guard.ok) return jsonError(guard.message, guard.status);

  const body = await readBoundedFounderPeopleJson(request);
  if (!body.ok) {
    return jsonError(
      body.reason === "too_large"
        ? "The founder directory request is too large."
        : "The founder directory request was not valid JSON.",
      body.reason === "too_large" ? 413 : 400,
    );
  }

  const parsed = FounderPeopleQuerySchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonError("Choose valid founder directory filters and try again.", 422);
  }

  try {
    const data = await loadFounderPeopleDirectory(parsed.data);
    return NextResponse.json(data, { status: 200, headers: FOUNDER_PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof FounderPeopleAccessError) {
      return jsonError(
        error.status === 401
          ? "Sign in with the YOVA founder account first."
          : "Founder access is required.",
        error.status,
      );
    }
    console.error("YOVA founder people query failed", {
      code: error instanceof FounderPeopleDataError ? error.code : "unknown",
    });
    return jsonError("YOVA could not load people right now. Try again.", 503);
  }
}

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: FOUNDER_PRIVATE_HEADERS },
  );
}
