import {
  FOUNDER_PEOPLE_EXPORT_MAX_ROWS,
  FOUNDER_PEOPLE_MAX_PAGE_SIZE,
  FounderPeopleExportQuerySchema,
  type FounderPeopleCursor,
  type FounderPeopleDirectoryRow,
} from "@/lib/founder/people";
import {
  createFounderPeopleDataAccess,
  FounderPeopleAccessError,
  FounderPeopleDataError,
} from "@/lib/founder/people-data";
import {
  buildFounderPeopleCsv,
  FOUNDER_PEOPLE_CSV_MAX_BYTES,
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
        ? "The founder export request is too large."
        : "The founder export request was not valid JSON.",
      body.reason === "too_large" ? 413 : 400,
    );
  }

  const parsed = FounderPeopleExportQuerySchema.safeParse(body.value);
  if (!parsed.success) return jsonError("Choose valid export filters and try again.", 422);

  try {
    const access = await createFounderPeopleDataAccess();
    const rows: FounderPeopleDirectoryRow[] = [];
    let cursor: FounderPeopleCursor | null = null;
    const seenCursors = new Set<string>();

    while (true) {
      const page = await access.query({
        ...parsed.data,
        cursor,
        limit: FOUNDER_PEOPLE_MAX_PAGE_SIZE,
      });
      if (page.total > FOUNDER_PEOPLE_EXPORT_MAX_ROWS) {
        return jsonError(
          `This view has more than ${FOUNDER_PEOPLE_EXPORT_MAX_ROWS.toLocaleString("en-US")} rows. Narrow the filters before exporting.`,
          422,
        );
      }

      rows.push(...page.rows);
      if (rows.length > FOUNDER_PEOPLE_EXPORT_MAX_ROWS) {
        return jsonError("This view is too large. Narrow the filters before exporting.", 422);
      }
      if (!page.hasMore || !page.nextCursor) break;
      const cursorKey = `${page.nextCursor.seenAt}\n${page.nextCursor.email}`;
      if (seenCursors.has(cursorKey) || page.rows.length === 0) {
        throw new FounderPeopleDataError("cursor_did_not_advance");
      }
      seenCursors.add(cursorKey);
      cursor = page.nextCursor;
    }

    const csv = buildFounderPeopleCsv(rows);
    if (new TextEncoder().encode(csv).byteLength > FOUNDER_PEOPLE_CSV_MAX_BYTES) {
      return jsonError("This CSV is too large. Narrow the filters before exporting.", 422);
    }

    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      status: 200,
      headers: {
        ...FOUNDER_PRIVATE_HEADERS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="yova-people-${date}.csv"`,
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
  } catch (error) {
    if (error instanceof FounderPeopleAccessError) {
      return jsonError(
        error.status === 401
          ? "Sign in with the YOVA founder account first."
          : "Founder access is required.",
        error.status,
      );
    }
    console.error("YOVA founder people export failed", {
      code: error instanceof FounderPeopleDataError ? error.code : "unknown",
    });
    return jsonError("YOVA could not export people right now. Try again.", 503);
  }
}

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: FOUNDER_PRIVATE_HEADERS },
  );
}
