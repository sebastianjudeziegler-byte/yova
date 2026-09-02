import { expect, test, type Page, type Route } from "@playwright/test";

test.skip(
  process.env.YOVA_E2E_PASSWORD_AUTH !== "1",
  "Runs only with the isolated signed-in Supabase browser harness.",
);

const NOW = "2026-09-02T12:00:00.000Z";
const ACCOUNT_ID = "91000000-0000-4000-8000-000000000001";
const FIRST_ITEM_ID = "91000000-0000-4000-8000-000000000002";
const FIRST_PLAN_ID = "91000000-0000-4000-8000-000000000003";
const COMPLETION_SESSION_ID = "91000000-0000-4000-8000-000000000004";
const COMPLETION_ID = "91000000-0000-4000-8000-000000000005";
const SECOND_ITEM_ID = "91000000-0000-4000-8000-000000000006";
const SECOND_PLAN_ID = "91000000-0000-4000-8000-000000000007";
const INTERRUPTION_SESSION_ID = "91000000-0000-4000-8000-000000000008";
const INTERRUPTION_ID = "91000000-0000-4000-8000-000000000009";
const EXPORT_ID = "91000000-0000-4000-8000-000000000010";
const CLOUD_ROUTE_REVISION_ID = "91000000-0000-4000-8000-000000000011";
const STALE_ROUTE_REVISION_ID = "91000000-0000-4000-8000-000000000012";
const ROUTE_LINEAGE_ID = "91000000-0000-4000-8000-000000000013";
const ROUTE_TARGET_ID = "91000000-0000-4000-8000-000000000014";

type FailureMode = "temporary" | "permanent";

type MockCloudOptions = Readonly<{
  completionSessionRouteRevisionId?: string | null;
}>;

type CapturedDeviceState = Readonly<{
  pendingSessionCompletions: Array<{
    completion: { id: string; planSessionId: string; routeRevisionId?: string };
  }>;
  pendingSessionInterruptions: Array<{
    interruption: { id: string; planSessionId: string };
  }>;
}>;

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW));
});

test("Retry retires two permanently rejected terminal events without losing their recovery export", async ({ page }) => {
  const cloud = await installMockedCloud(page);
  await openSignedInAccount(page);

  await seedTwoTerminalEvents(page);
  expect(await activeTerminalCount(page)).toBe(2);

  cloud.failureMode = "temporary";
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const warning = page.locator(".cloud-sync-warning");
  await expect(warning).toContainText("2 session events are still waiting to sync.");

  cloud.failureMode = "permanent";
  await warning.getByRole("button", { name: "Retry now" }).click();

  await expect(warning).toHaveCount(0);
  await expect.poll(() => activeTerminalCount(page)).toBe(0);
  expect(cloud.permanentRpcCalls).toEqual([
    "record_session_interruption_with_route",
    "complete_plan_session_with_route",
  ]);

  await expectExportToContainBothTerminalEvents(page, cloud, 0);

  // The browser-side mock owns the fake Supabase host. Clear its cookie before
  // the document request so the Next proxy does not attempt an out-of-process
  // auth lookup; the init script restores the same session before hydration.
  await page.context().clearCookies();
  await page.reload();
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
  await expect(page.locator(".cloud-sync-warning")).toHaveCount(0);
  await expect.poll(() => activeTerminalCount(page)).toBe(0);
  await expectExportToContainBothTerminalEvents(page, cloud, 1);
});

test("startup retires a stale routed completion from a ready session using cloud route authority", async ({ page }) => {
  const cloud = await installMockedCloud(page, {
    completionSessionRouteRevisionId: CLOUD_ROUTE_REVISION_ID,
  });
  await seedStaleRoutedCompletionOnNextStartup(page);

  await openSignedInAccount(page);

  await expect(page.locator(".cloud-sync-warning")).toHaveCount(0);
  await expect.poll(() => activeTerminalCount(page)).toBe(0);
  expect(cloud.temporaryRpcCalls).toEqual(["complete_plan_session_with_route"]);
  expect(cloud.permanentRpcCalls).toEqual([]);
  expect(await quarantinedTerminalEvents(page)).toMatchObject([{
    kind: "completion",
    eventId: COMPLETION_ID,
    reason: "authoritative_route_mismatch",
    payload: {
      completion: {
        routeRevisionId: STALE_ROUTE_REVISION_ID,
      },
    },
  }]);

  const exported = await downloadAccountExport(page, cloud, 0);
  expect(exported).toMatchObject({
    pendingSessionCompletions: [{
      completion: {
        id: COMPLETION_ID,
        planSessionId: COMPLETION_SESSION_ID,
        routeRevisionId: STALE_ROUTE_REVISION_ID,
      },
    }],
    pendingSessionInterruptions: [],
  });
});

async function installMockedCloud(page: Page, options: MockCloudOptions = {}) {
  const state: {
    failureMode: FailureMode;
    temporaryRpcCalls: string[];
    permanentRpcCalls: string[];
    exports: CapturedDeviceState[];
  } = {
    failureMode: "temporary",
    temporaryRpcCalls: [],
    permanentRpcCalls: [],
    exports: [],
  };
  const user = {
    id: ACCOUNT_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "sync-learner@example.com",
    email_confirmed_at: NOW,
    confirmed_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    last_sign_in_at: NOW,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { display_name: "Sync Learner" },
    identities: [],
    is_anonymous: false,
  };
  const session = {
    access_token: "mock-access-token",
    token_type: "bearer",
    expires_in: 7_200,
    expires_at: Math.floor(Date.parse(NOW) / 1_000) + 7_200,
    refresh_token: "mock-refresh-token",
    user,
  };

  // Seed the same cookie-backed session shape used by @supabase/ssr. The
  // initial document request remains unauthenticated, so the Next proxy never
  // needs to reach the browser-only Supabase mock; the client then exercises
  // the full signed-in cloud restore and direct RPC paths.
  await page.addInitScript((mockedSession) => {
    const bytes = new TextEncoder().encode(JSON.stringify(mockedSession));
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    const encoded = window.btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    const projectRef = window.location.hostname.split(".")[0];
    document.cookie = `sb-${projectRef}-auth-token=base64-${encoded}; Path=/; SameSite=Lax`;
  }, session);

  await page.route("**/supabase-test/auth/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/token") || url.pathname.endsWith("/user")) {
      await json(route, 200, url.pathname.endsWith("/token") ? session : user);
      return;
    }
    await json(route, 404, { code: "not_found", msg: "Unexpected mocked auth request." });
  });

  await page.route("**/supabase-test/rest/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const rpcName = path.match(/\/rpc\/([^/]+)$/)?.[1];
    if (rpcName) {
      if (
        rpcName === "record_session_interruption_with_route"
        || rpcName === "complete_plan_session_with_route"
      ) {
        if (state.failureMode === "permanent") {
          state.permanentRpcCalls.push(rpcName);
        } else {
          state.temporaryRpcCalls.push(rpcName);
        }
        await terminalFailure(route, rpcName, state.failureMode);
        return;
      }
      if (rpcName === "save_learner_profile") {
        await json(route, 200, null);
        return;
      }
      await json(route, 404, {
        code: "42883",
        message: "unexpected_mocked_rpc",
      });
      return;
    }

    const table = path.match(/\/rest\/v1\/([^/]+)$/)?.[1];
    const body = table ? cloudTableBody(table, options) : undefined;
    if (body === undefined) {
      await json(route, 404, { code: "PGRST205", message: "unexpected_mocked_table" });
      return;
    }
    await json(route, 200, body);
  });

  await page.route("**/api/account/data-export", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      const request = route.request().postDataJSON() as { deviceState: CapturedDeviceState };
      state.exports.push(request.deviceState);
      await json(route, 200, {
        status: "ready_to_finalize",
        exportId: EXPORT_ID,
        finalizeGrant: "mock-finalize-grant-00000000000000000000000000000000",
        prepareExpiresAt: "2026-09-02T12:05:00.000Z",
      });
      return;
    }
    if (method === "PUT") {
      await json(route, 200, {
        downloadUrl: "https://downloads.example.com/yova-data.json",
        filename: "yova-data-2026-09-02T12-00-00Z.json",
        expiresAt: "2026-09-02T12:05:00.000Z",
      });
      return;
    }
    await json(route, 204, null);
  });

  // Keep unrelated server-authenticated background work inside the browser
  // harness. A browser route cannot mock the Next server's outbound Supabase
  // request, and that request is not part of this terminal-retry contract.
  await page.route("**/api/sessions/allowance", async (route) => {
    await json(route, 200, {
      status: "available",
      remainingToday: 10,
      retryAfterSeconds: 0,
      resetAt: null,
    });
  });
  await page.route("**/api/events", async (route) => {
    await json(route, 204, null);
  });
  await page.route("**/api/errors", async (route) => {
    await json(route, 204, null);
  });

  return state;
}

async function openSignedInAccount(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
  await expect(page.locator(".cloud-sync-warning")).toHaveCount(0);
}

async function seedStaleRoutedCompletionOnNextStartup(page: Page) {
  await page.addInitScript((fixture) => {
    const seedMarker = "yova.e2e.seeded-stale-route-completion";
    if (window.sessionStorage.getItem(seedMarker)) return;
    window.sessionStorage.setItem(seedMarker, "1");
    window.localStorage.setItem("yova.cloud-sync-outbox.v1", JSON.stringify([{
      userId: fixture.accountId,
      completion: {
        id: fixture.completionId,
        planId: fixture.planId,
        planSessionId: fixture.planSessionId,
        routeRevisionId: fixture.staleRouteRevisionId,
        startedAt: "2026-09-02T11:30:00.000Z",
        completedAt: "2026-09-02T11:55:00.000Z",
        plannedMinutes: 25,
        actualMinutes: 25,
        correctAnswers: 3,
        totalAnswers: 4,
        feedback: "about_right",
        observedGap: "One relationship still needs review.",
        completionMode: "guided",
        conceptEvidence: [],
        confidenceEvidence: [],
      },
      adaptation: null,
      followUpSession: null,
      continuationSession: null,
      nextSessionStudyRoute: null,
      queuedAt: "2026-09-02T11:55:01.000Z",
    }]));
  }, {
    accountId: ACCOUNT_ID,
    completionId: COMPLETION_ID,
    planId: FIRST_PLAN_ID,
    planSessionId: COMPLETION_SESSION_ID,
    staleRouteRevisionId: STALE_ROUTE_REVISION_ID,
  });
}

async function seedTwoTerminalEvents(page: Page) {
  await page.evaluate((fixture) => {
    window.localStorage.setItem("yova.cloud-sync-outbox.v1", JSON.stringify([{
      userId: fixture.accountId,
      completion: {
        id: fixture.completionId,
        planId: fixture.firstPlanId,
        planSessionId: fixture.completionSessionId,
        startedAt: "2026-09-02T11:30:00.000Z",
        completedAt: "2026-09-02T11:55:00.000Z",
        plannedMinutes: 25,
        actualMinutes: 25,
        correctAnswers: 3,
        totalAnswers: 4,
        feedback: "about_right",
        observedGap: "One relationship still needs review.",
        completionMode: "guided",
        conceptEvidence: [],
        confidenceEvidence: [],
      },
      adaptation: null,
      followUpSession: null,
      continuationSession: null,
      nextSessionStudyRoute: null,
      queuedAt: "2026-09-02T11:55:01.000Z",
    }]));
    window.localStorage.setItem("yova.session-interruption-outbox.v1", JSON.stringify([{
      userId: fixture.accountId,
      interruption: {
        id: fixture.interruptionId,
        planId: fixture.secondPlanId,
        planSessionId: fixture.interruptionSessionId,
        startedAt: "2026-09-02T11:35:00.000Z",
        interruptedAt: "2026-09-02T11:50:00.000Z",
        plannedMinutes: 25,
        actualMinutes: 15,
        completedSteps: 1,
        totalSteps: 3,
        resumeStep: 1,
      },
      queuedAt: "2026-09-02T11:50:01.000Z",
    }]));
  }, {
    accountId: ACCOUNT_ID,
    firstPlanId: FIRST_PLAN_ID,
    completionSessionId: COMPLETION_SESSION_ID,
    completionId: COMPLETION_ID,
    secondPlanId: SECOND_PLAN_ID,
    interruptionSessionId: INTERRUPTION_SESSION_ID,
    interruptionId: INTERRUPTION_ID,
  });
}

async function activeTerminalCount(page: Page) {
  return page.evaluate(() => {
    const completionRaw = window.localStorage.getItem("yova.cloud-sync-outbox.v1");
    const interruptionRaw = window.localStorage.getItem("yova.session-interruption-outbox.v1");
    const completions: unknown = completionRaw ? JSON.parse(completionRaw) : [];
    const interruptions: unknown = interruptionRaw ? JSON.parse(interruptionRaw) : [];
    return (Array.isArray(completions) ? completions.length : 0)
      + (Array.isArray(interruptions) ? interruptions.length : 0);
  });
}

async function quarantinedTerminalEvents(page: Page) {
  return page.evaluate((accountId) => {
    const raw = window.localStorage.getItem(`yova.session-terminal-quarantine.v1:${accountId}`);
    return raw ? JSON.parse(raw) as unknown : [];
  }, ACCOUNT_ID);
}

async function expectExportToContainBothTerminalEvents(
  page: Page,
  cloud: Awaited<ReturnType<typeof installMockedCloud>>,
  exportIndex: number,
) {
  const exported = await downloadAccountExport(page, cloud, exportIndex);
  expect(exported).toMatchObject({
    pendingSessionCompletions: [{
      completion: {
        id: COMPLETION_ID,
        planSessionId: COMPLETION_SESSION_ID,
      },
    }],
    pendingSessionInterruptions: [{
      interruption: {
        id: INTERRUPTION_ID,
        planSessionId: INTERRUPTION_SESSION_ID,
      },
    }],
  });
}

async function downloadAccountExport(
  page: Page,
  cloud: Awaited<ReturnType<typeof installMockedCloud>>,
  exportIndex: number,
) {
  await page.getByRole("button", { name: "You", exact: true }).click();
  await page.getByRole("button", { name: "Download my YOVA data" }).click();
  const dialog = page.getByRole("dialog", { name: "Download a copy of your YOVA data?" });
  await dialog.getByRole("button", { name: "Download JSON" }).click();
  await expect(page.getByRole("heading", { name: "Your private download is ready." })).toBeVisible();
  await expect.poll(() => cloud.exports.length).toBe(exportIndex + 1);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  return cloud.exports[exportIndex];
}

async function terminalFailure(route: Route, rpcName: string, mode: FailureMode) {
  if (mode === "permanent") {
    const message = rpcName === "record_session_interruption_with_route"
      ? "study_route_interruption_conflict"
      : "study_route_completion_retry_conflict";
    await json(route, 409, { code: "40001", message, details: null, hint: null });
    return;
  }
  await json(route, 503, {
    code: "08006",
    message: "temporary_connection_failure",
    details: null,
    hint: null,
  });
}

function cloudTableBody(table: string, options: MockCloudOptions) {
  if (table === "profiles") {
    return { display_name: "Sync Learner", onboarding_completed_at: NOW };
  }
  if (table === "learner_profiles") {
    return {
      common_blocker: null,
      guidance_preference: null,
      preferred_session_min: null,
      preferred_session_max: null,
      explanation_preference: null,
      focus_frequency: null,
      starting_pattern: null,
      energy_window: null,
      primary_improvement_goal: null,
      additional_context: null,
    };
  }
  if (table === "learning_items") {
    return [
      learningItem(FIRST_ITEM_ID, "Cell biology review"),
      learningItem(SECOND_ITEM_ID, "European history review"),
    ];
  }
  if (table === "plans") {
    return [
      planRow(FIRST_PLAN_ID, FIRST_ITEM_ID),
      planRow(SECOND_PLAN_ID, SECOND_ITEM_ID),
    ];
  }
  if (table === "plan_sessions") {
    return [
      sessionRow(
        COMPLETION_SESSION_ID,
        FIRST_PLAN_ID,
        "Cell transport retrieval",
        options.completionSessionRouteRevisionId ?? null,
      ),
      sessionRow(INTERRUPTION_SESSION_ID, SECOND_PLAN_ID, "Alliance systems retrieval"),
    ];
  }
  if (table === "study_routes") {
    return options.completionSessionRouteRevisionId
      ? [studyRouteRow(options.completionSessionRouteRevisionId)]
      : [];
  }
  if (
    table === "session_attempts"
    || table === "materials"
    || table === "learning_events"
    || table === "deadline_milestones"
  ) return [];
  return undefined;
}

function learningItem(id: string, title: string) {
  return {
    id,
    title,
    kind: "test",
    topic: title,
    deadline: "2026-09-20T17:00:00.000Z",
    source_mode: "yova_generated",
    study_mode: "inside_yova",
    created_at: NOW,
  };
}

function planRow(id: string, learningItemId: string) {
  return {
    id,
    learning_item_id: learningItemId,
    status: "active",
    rationale: "Use a short retrieval block to locate one precise knowledge gap.",
    generation_inputs: { learningIntent: "study", intent: "plan" },
    knowledge_map: null,
    created_at: NOW,
  };
}

function sessionRow(
  id: string,
  planId: string,
  title: string,
  committedRouteRevisionId: string | null = null,
) {
  return {
    id,
    plan_id: planId,
    sequence: 1,
    title,
    objective: "Recall the key relationships and identify the next specific review target.",
    method: "Retrieval practice",
    method_rationale: "Closed-note recall reveals which relationship needs another explanation.",
    scheduled_for: "2026-09-03T16:00:00.000Z",
    estimated_minutes: 25,
    status: "ready",
    step_data: {
      amountLabel: "One focused target + evidence check · about 25 min",
      learningMode: "study",
      topicIds: [],
      contentTargets: ["Explain the target relationship"],
      completionEvidence: ["Recall the relationship without notes"],
    },
    committed_route_revision_id: committedRouteRevisionId,
  };
}

function studyRouteRow(routeRevisionId: string) {
  return {
    route_revision_id: routeRevisionId,
    route_lineage_id: ROUTE_LINEAGE_ID,
    revision_number: 1,
    schema_version: 1,
    lifecycle: "committed",
    plan_id: FIRST_PLAN_ID,
    plan_session_id: COMPLETION_SESSION_ID,
    predecessor_revision_id: null,
    route_payload: {
      target: {
        taskFamily: "conceptual_learning",
        desiredOutcome: "Recall the key relationships and identify the next specific review target.",
        targetStates: [{
          targetId: ROUTE_TARGET_ID,
          stage: "retrieval_ready",
          uncertainty: "medium",
          evidenceRefs: [],
        }],
        sourceRequirements: {
          sourceType: "yova_generated",
          requiredSourceIds: [],
          groundingRequired: false,
          instructions: [],
        },
      },
      approach: {
        mode: "practice",
        executionEnvironment: "inside_yova",
        primaryMethodId: "retrieval_practice",
        visibleMethodName: "Retrieval practice",
        confidenceLevel: "medium",
      },
      timing: {
        activeMinutes: 25,
        elapsedMinutes: 25,
        durationSource: "router_default",
      },
      execution: {
        orderedPhases: [{
          phaseId: "retrieve",
          methodPhase: "retrieve",
          activeMinutes: 25,
          targetIds: [ROUTE_TARGET_ID],
        }],
        difficultyTier: "standard",
        initialSupport: "independent_start",
        activityLimit: 1,
        completionEvidence: [{
          evidenceId: "retrieval-check",
          targetIds: [ROUTE_TARGET_ID],
          kind: "retrieval",
          description: "Recall the target relationship without looking at the source.",
          requiresIndependentAttempt: true,
        }],
        deferredTargets: [],
      },
      agency: {
        controlMode: "yova_decides",
        selectedBy: "yova",
        alternatives: [],
      },
      explanation: {
        shortReason: "Closed-note recall exposes the exact relationship that needs repair.",
        taskRequirements: [],
        learnerDeclarations: [],
        observations: [],
        uncertainties: [],
      },
      provenance: {
        routerVersion: "e2e-route-v1",
        profileVersion: "e2e-profile-v1",
        evidenceRefs: [],
        ruleTrace: [{
          ruleId: "e2e.ready-route",
          result: "retrieval_selected",
          reason: "The ready session has an authoritative committed route.",
          evidenceRefs: [],
        }],
      },
    },
    created_at: NOW,
    committed_at: NOW,
  };
}

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
    },
    body: status === 204 ? "" : JSON.stringify(body),
  });
}
