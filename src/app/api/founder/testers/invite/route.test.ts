import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  adminConfigured: true,
  getUser: vi.fn(),
  founderRpc: vi.fn(),
  inviteUserByEmail: vi.fn(),
  signInWithOtp: vi.fn(),
  adminFactory: vi.fn(),
}));

vi.mock("@/lib/site-url", () => ({
  getSiteUrl: () => new URL("https://yova.example"),
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkFounderInviteRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  requestRateLimitKey: () => "route-test",
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.founderRpc,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: () => mocks.adminConfigured,
  createSupabaseAdminClient: () => mocks.adminFactory(),
  createSupabaseNoSessionAuthClient: () => ({
    auth: { signInWithOtp: mocks.signInWithOtp },
  }),
}));

import { POST } from "@/app/api/founder/testers/invite/route";

type Ledger = {
  id: string;
  email: string;
  display_name: string | null;
  auth_user_id: string | null;
  status: "pending" | "joined";
  send_count: number;
  invited_at: string;
  joined_at: string | null;
};

describe("founder tester invite route", () => {
  let database: ReturnType<typeof fakeAdminDatabase>;

  beforeEach(() => {
    database = fakeAdminDatabase();
    mocks.adminConfigured = true;
    mocks.adminFactory.mockReset().mockImplementation(() => database.admin);
    mocks.getUser.mockReset().mockResolvedValue({
      data: { user: { id: "founder-1" } },
      error: null,
    });
    mocks.founderRpc.mockReset().mockResolvedValue({ data: true, error: null });
    mocks.inviteUserByEmail.mockReset().mockResolvedValue({
      data: { user: { id: "tester-user-1" } },
      error: null,
    });
    mocks.signInWithOtp.mockReset().mockResolvedValue({ data: {}, error: null });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects a cross-origin request before checking founder credentials", async () => {
    const response = await POST(inviteRequest({
      headers: { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
    }));

    expect(response.status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("requires an authenticated founder", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const signedOut = await POST(inviteRequest());
    expect(signedOut.status).toBe(401);

    mocks.getUser.mockResolvedValue({ data: { user: { id: "member-1" } }, error: null });
    mocks.founderRpc.mockResolvedValue({ data: false, error: null });
    const ordinaryMember = await POST(inviteRequest());
    expect(ordinaryMember.status).toBe(403);
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("creates the private ledger row before sending the first admin invitation", async () => {
    const response = await POST(inviteRequest({
      body: { email: "  Tester@Example.com ", displayName: " Ada " },
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.tester).toMatchObject({
      email: "tester@example.com",
      displayName: "Ada",
      status: "pending",
    });
    expect(mocks.inviteUserByEmail).toHaveBeenCalledWith(
      "tester@example.com",
      expect.objectContaining({
        redirectTo: "https://yova.example/auth/confirm",
        data: expect.objectContaining({ display_name: "Ada", tester_invite_id: "invite-1" }),
      }),
    );
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
    expect(database.ledger).toMatchObject({
      auth_user_id: "tester-user-1",
      send_count: 1,
    });
  });

  it("resends the real admin invitation when the unconfirmed invited user is still pending", async () => {
    database.ledger = pendingLedger({ auth_user_id: "tester-user-1", send_count: 1 });

    const response = await POST(inviteRequest());

    expect(response.status).toBe(200);
    expect(mocks.inviteUserByEmail).toHaveBeenCalledWith(
      "tester@example.com",
      expect.objectContaining({
        redirectTo: "https://yova.example/auth/confirm",
        data: expect.objectContaining({ tester_invite_id: "invite-1" }),
      }),
    );
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
    expect(database.ledger?.send_count).toBe(2);
  });

  it("keeps founder approval and sends scanner-safe access to a confirmed pre-existing user", async () => {
    mocks.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", message: "User already registered" },
    });

    const response = await POST(inviteRequest({
      body: { email: "Existing@Example.com", displayName: "Riley" },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.tester).toMatchObject({
      email: "existing@example.com",
      displayName: "Riley",
      status: "pending",
    });
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "existing@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://yova.example/auth/confirm",
      },
    });
    expect(database.ledger).toMatchObject({
      email: "existing@example.com",
      auth_user_id: null,
      send_count: 1,
    });
  });

  it("removes a new pre-existing-user ledger when its access email is not sent", async () => {
    mocks.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", message: "User already registered" },
    });
    mocks.signInWithOtp.mockResolvedValue({
      data: {},
      error: { code: "over_email_send_rate_limit", message: "rate limited" },
    });

    const response = await POST(inviteRequest({
      body: { email: "Existing@Example.com" },
    }));

    expect(response.status).toBe(502);
    expect(database.ledger).toBeNull();
  });

  it("falls back to scanner-safe magic-link email if a pending invite now belongs to a confirmed user", async () => {
    database.ledger = pendingLedger({ auth_user_id: "tester-user-1", send_count: 1 });
    mocks.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", message: "User already registered" },
    });

    const response = await POST(inviteRequest());

    expect(response.status).toBe(200);
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "tester@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://yova.example/auth/confirm",
      },
    });
    expect(database.ledger).toMatchObject({
      auth_user_id: "tester-user-1",
      send_count: 2,
    });
  });

  it("does not leave a fake pending row when the first email is not sent", async () => {
    mocks.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: { code: "over_email_send_rate_limit", message: "rate limited" },
    });

    const response = await POST(inviteRequest());

    expect(response.status).toBe(502);
    expect(database.ledger).toBeNull();
  });

  it("does not call admin invite for an already joined tester", async () => {
    database.ledger = {
      ...pendingLedger({ auth_user_id: "tester-user-1" }),
      status: "joined",
      joined_at: "2026-08-14T11:00:00.000Z",
    };

    const response = await POST(inviteRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ alreadyInvited: true, tester: { status: "joined" } });
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled();
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
  });
});

function inviteRequest({
  body = { email: "tester@example.com" },
  headers = {},
}: {
  body?: unknown;
  headers?: Record<string, string>;
} = {}) {
  return new Request("https://yova.example/api/founder/testers/invite", {
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

function pendingLedger(overrides: Partial<Ledger> = {}): Ledger {
  return {
    id: "invite-1",
    email: "tester@example.com",
    display_name: null,
    auth_user_id: null,
    status: "pending",
    send_count: 0,
    invited_at: "2026-08-14T10:00:00.000Z",
    joined_at: null,
    ...overrides,
  };
}

function fakeAdminDatabase() {
  const state: { ledger: Ledger | null } = { ledger: null };

  const admin = {
    auth: { admin: { inviteUserByEmail: mocks.inviteUserByEmail } },
    from: vi.fn(() => query()),
  };

  function query() {
    let operation: "select" | "insert" | "update" | "delete" = "select";
    let values: Record<string, unknown> = {};
    const builder: Record<string, unknown> & PromiseLike<{ data: unknown; error: null }> = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      insert: vi.fn((nextValues: Record<string, unknown>) => {
        operation = "insert";
        values = nextValues;
        return builder;
      }),
      update: vi.fn((nextValues: Record<string, unknown>) => {
        operation = "update";
        values = nextValues;
        return builder;
      }),
      delete: vi.fn(() => {
        operation = "delete";
        return builder;
      }),
      maybeSingle: vi.fn(async () => execute()),
      single: vi.fn(async () => execute()),
      then: (resolve, reject) => Promise.resolve(execute()).then(resolve, reject),
    };

    function execute() {
      if (operation === "insert") {
        state.ledger = pendingLedger({
          email: String(values.email),
          display_name: typeof values.display_name === "string" ? values.display_name : null,
        });
      } else if (operation === "update" && state.ledger) {
        state.ledger = { ...state.ledger, ...values } as Ledger;
      } else if (operation === "delete") {
        state.ledger = null;
      }
      return { data: state.ledger, error: null };
    }

    return builder;
  }

  return {
    admin,
    get ledger() { return state.ledger; },
    set ledger(value: Ledger | null) { state.ledger = value; },
  };
}
