import "server-only";

import {
  FounderPeopleDirectoryResponseSchema,
  FounderPeopleQuerySchema,
  type FounderPeopleDirectoryResponse,
  type FounderPeopleQuery,
} from "@/lib/founder/people";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class FounderPeopleAccessError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403) {
    super(status === 401 ? "Founder sign-in required." : "Founder access required.");
    this.name = "FounderPeopleAccessError";
    this.status = status;
  }
}

export class FounderPeopleDataError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("The founder people directory could not be loaded.");
    this.name = "FounderPeopleDataError";
    this.code = code;
  }
}

export async function createFounderPeopleDataAccess() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new FounderPeopleAccessError(401);

  const { data: founderAccess, error: founderError } = await supabase.rpc("is_yova_founder");
  if (founderError || founderAccess !== true) throw new FounderPeopleAccessError(403);

  return {
    async query(input: FounderPeopleQuery): Promise<FounderPeopleDirectoryResponse> {
      const parsedInput = FounderPeopleQuerySchema.parse(input);
      const { data, error } = await supabase.rpc("founder_people_directory", {
        search_text: parsedInput.search,
        kind_filter: parsedInput.kind,
        status_filter: parsedInput.status,
        cursor_seen_at: parsedInput.cursor?.seenAt ?? null,
        cursor_email: parsedInput.cursor?.email ?? null,
        result_limit: parsedInput.limit,
      });

      if (error) throw new FounderPeopleDataError(error.code ?? "rpc_failed");

      const parsed = FounderPeopleDirectoryResponseSchema.safeParse(data);
      if (!parsed.success) throw new FounderPeopleDataError("invalid_response");
      return parsed.data;
    },
  };
}

export async function loadFounderPeopleDirectory(
  input: FounderPeopleQuery,
): Promise<FounderPeopleDirectoryResponse> {
  const access = await createFounderPeopleDataAccess();
  return access.query(input);
}
