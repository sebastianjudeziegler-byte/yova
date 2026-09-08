import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  founder: true,
  directoryError: null as null | { code: string },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  }),
}));

import { POST as exportPeople } from "@/app/api/founder/people/export/route";
import { POST as queryPeople } from "@/app/api/founder/people/query/route";
import { directoryRow } from "@/lib/founder/people.test-support";

describe("founder people routes", () => {
  beforeEach(() => {
    mocks.founder = true;
    mocks.directoryError = null;
    mocks.getUser.mockReset().mockResolvedValue({
      data: { user: { id: "founder-1" } },
      error: null,
    });
    mocks.rpc.mockReset().mockImplementation((name: string) => {
      if (name === "is_yova_founder") {
        return Promise.resolve({ data: mocks.founder, error: null });
      }
      if (name === "founder_people_directory") {
        return Promise.resolve({
          data: directoryResponse(),
          error: mocks.directoryError,
        });
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects cross-origin queries before reading founder credentials", async () => {
    const response = await queryPeople(founderRequest("query", {}, {
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
    }));

    expect(response.status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("requires a signed-in founder for both routes", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await queryPeople(founderRequest("query"))).status).toBe(401);

    mocks.founder = false;
    expect((await exportPeople(founderRequest("export"))).status).toBe(403);
  });

  it("rejects malformed and oversized query input before the directory RPC", async () => {
    const malformed = await queryPeople(founderRequest("query", { kind: "customers" }));
    expect(malformed.status).toBe(422);

    const oversized = await queryPeople(founderRequest("query", { search: "x".repeat(4_200) }));
    expect(oversized.status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns the strict directory DTO with private response headers", async () => {
    const response = await queryPeople(founderRequest("query", {
      search: "learner@example.com",
      kind: "all",
      status: "all",
      cursor: null,
      limit: 25,
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(payload.rows[0]).toMatchObject({
      email: "learner@example.com",
      kind: "linked",
      matchBasis: "exact_normalized_email",
    });
  });

  it("never logs the submitted email when a database query fails", async () => {
    mocks.directoryError = { code: "XX999" };
    const response = await queryPeople(founderRequest("query", {
      search: "private-person@example.com",
    }));

    expect(response.status).toBe(503);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-person@example.com");
  });

  it("downloads a fixed-column, no-store CSV", async () => {
    const response = await exportPeople(founderRequest("export", {
      search: "",
      kind: "all",
      status: "all",
    }));
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="yova-people-/);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(csv).toContain('"learner@example.com"');
    expect(csv).not.toContain("13_17");
  });
});

function directoryResponse() {
  return {
    generatedAt: "2026-09-07T12:00:00.000Z",
    summary: {
      uniquePeople: 1,
      yovaAccounts: 1,
      studyProfileLeads: 1,
      confirmedWaitlist: 1,
      pendingInvites: 0,
    },
    total: 1,
    rows: [directoryRow()],
    hasMore: false,
    nextCursor: null,
  };
}

function founderRequest(
  route: "query" | "export",
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  return new Request(`https://yova.example/api/founder/people/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://yova.example",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
