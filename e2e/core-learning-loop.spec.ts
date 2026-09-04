import { expect, test, type Page, type Route } from "@playwright/test";
import type { LearningPlan } from "../src/lib/domain";
import {
  hydratedSessionResourceCacheIssue,
  sessionCacheScopeFingerprint,
} from "../src/lib/session-generation/cache-contract";
import { SessionGenerationResponseSchema } from "../src/lib/session-generation/schema";
import { createCommittedInitialSessionStudyRoute } from "../src/lib/study-route/session-route-creation";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const onboardingAnswers = [
  "Show a short recommendation and alternatives",
  "I delay a little, then get going",
  "20 to 30 minutes",
  "A concrete example before the rule",
  "Recalling it without notes, then checking",
  "I recognize it but cannot recall it",
  "Give me a small hint",
  "Show one step at a time",
  "Clear checkpoints inside the block",
  "No extra support right now",
  "Afternoon",
] as const;

test("Study Now lets the learner review and safely choose an eligible method before activation", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand why the product rule has two derivative terms and apply it once.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: "Review method first" }).click();

  await expect(page.getByRole("heading", { name: "YOVA recommends this method." }))
    .toBeVisible({ timeout: 30_000 });
  const recommended = page.locator(".study-now-field").filter({ hasText: "Recommended session" });
  await expect(recommended.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect(recommended).toContainText(/focused minutes/i);
  const alternative = page.locator(".study-now-field")
    .filter({ hasText: "Other methods that also fit" })
    .getByRole("button")
    .first();
  const alternativeName = (await alternative.locator("strong").innerText()).trim();
  await alternative.click();

  await expect(page.getByRole("heading", { name: "Your method is ready." })).toBeVisible();
  await expect(page.locator(".study-now-field").filter({ hasText: "Recommended session" }))
    .toContainText(alternativeName);
  await expect(page.getByLabel(`Study recipe: ${alternativeName}`)).toContainText(
    new RegExp(`You chose ${escapeRegExp(alternativeName)}`, "i"),
  );
  await page.getByRole("button", { name: /Start this session/ }).click();

  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  const methodDecision = page.getByLabel("Why YOVA chose this approach");
  await expect(methodDecision).toContainText(alternativeName);
  await expect(methodDecision).toContainText("HOW YOVA CHANGED IT FOR YOU");
  await expect(methodDecision).toContainText(new RegExp(`You chose ${escapeRegExp(alternativeName)}`, "i"));
});

test("durable allowance exhaustion loads the committed method workpad and names the reset", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: {
        "Retry-After": "3600",
        "X-Yova-Fallback-Reason": "guided_session_allowance_exhausted",
        "X-Yova-Request-Id": "86948113-b4be-423a-b0bc-d86aaae1ba7b",
      },
      body: JSON.stringify({
        error: "This account has used all of its guided-session allowance.",
        code: "guided_session_allowance_exhausted",
        retryable: false,
        retryAfterSeconds: 3600,
      }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await createOneOffLearningSession(
    page,
    "Review the photosynthetic electron transport chain for my test.",
    "study",
  );

  const allowanceNotice = page.locator(".session-issue").filter({
    hasText: "Your guided-session allowance is used up until",
  });
  await expect(allowanceNotice).toContainText("A safe study-method workpad was loaded instead");
  await expect(allowanceNotice).toContainText("Reference: 86948113-b4be-423a-b0bc-d86aaae1ba7b");
  const methodWorkpad = page.getByLabel("Study-method workpad");
  await expect(methodWorkpad).toBeVisible();
  await expect(methodWorkpad.getByLabel("How to study this")).toContainText("WHY THIS METHOD");
  await expect(methodWorkpad).toContainText("This completes practice, not a knowledge check.");
  await expect(page.getByRole("heading", { name: "Use the session target as your comparison frame" })).toHaveCount(0);
  await expect(page.getByText("LESSON SERVICE INTERRUPTED", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prepare this lesson again" })).toHaveCount(0);
});

test("durable allowance exhaustion without a safe fallback has its own non-retryable state", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: {
        "Retry-After": "1800",
        "X-Yova-Fallback-Reason": "guided_session_allowance_exhausted",
      },
      body: JSON.stringify({
        error: "This account has used all of its guided-session allowance.",
        code: "guided_session_allowance_exhausted",
        retryable: false,
        retryAfterSeconds: 1800,
      }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand the photosynthetic electron transport chain from scratch.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Anything YOVA should account for?").fill(
    "Use my instructor's private rubric for every comparison.",
  );
  await page.getByRole("button", { name: "Prepare this session" }).click();

  const quotaState = page.locator(".session-quota-state");
  await expect(quotaState).toContainText("GUIDED SESSION ALLOWANCE USED");
  await expect(quotaState).toContainText("You can request another generated lesson after");
  await expect(quotaState.locator("time")).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}T/);
  await expect(quotaState).toContainText("subject-specific offline lesson is not available for this session configuration");
  await expect(quotaState).not.toContainText("topic-scoped study-method guide is available below");
  await expect(quotaState).toContainText("This teaching-first session still needs an initial subject explanation");
  await expect(page.getByText("LESSON SERVICE INTERRUPTED", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prepare this lesson again" })).toHaveCount(0);
  await expect(quotaState.getByRole("button", { name: /^Open / })).toBeVisible();
});

test("streamed lesson quota uses its built-in explanation and surfaces the reset", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(streamedResumeSessionResponse(requestedRouteRevisionId(route))),
    });
  });
  await page.route("**/api/sessions/lesson", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: {
        "Retry-After": "900",
        "X-Yova-Fallback-Reason": "guided_session_allowance_exhausted",
      },
      body: [
        'data: {"type":"lesson.meta","requestId":"86948113-b4be-423a-b0bc-d86aaae1ba7b","model":"built-in"}',
        "",
        'data: {"type":"lesson.replace","content":"# Allowance-safe explanation\\n\\nThis bounded explanation came from the validated lesson brief without another AI call."}',
        "",
        'data: {"type":"lesson.complete","deliveryMode":"bounded_fallback","elapsedMs":0,"latencyToFirstTokenMs":null,"inputTokens":0,"cachedInputTokens":0,"outputTokens":0,"wordCount":15,"model":"built-in"}',
        "",
        "",
      ].join("\n"),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await createOneOffLearningSession(page, "Help me understand retrieval practice and test the idea.");

  await expect(page.getByText("Allowance-safe explanation")).toBeVisible();
  await expect(page.getByText("Safe built-in lesson", { exact: true })).toBeVisible();
  const allowanceNotice = page.locator(".session-issue").filter({
    hasText: "Your guided-session allowance is used up until",
  });
  await expect(allowanceNotice).toContainText("A safe built-in explanation was loaded instead");
  await expect(page.getByText("LESSON SERVICE INTERRUPTED", { exact: true })).toHaveCount(0);
});

test("a confident misconception is repaired now without a duplicate follow-up", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary guided-session generation failure." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Learner$/ })).toBeVisible();
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();

  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me review cellular respiration and test what I remember.",
  );
  await page.getByRole("button", { name: "I know it and want to test my recall" }).click();
  await expect(page.getByText("Starting approach: Practice first.")).toBeVisible();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible({ timeout: 15_000 });
  const setupDecision = page.getByLabel("Why YOVA chose this approach");
  await expect(setupDecision).toContainText("Concept Mapping");
  await expect(setupDecision).toContainText(
    /stable evidence-constrained baseline for conceptual learning at the novice stage in Practice mode/i,
  );
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByRole("heading", { name: "Closed-note retrieval" })).toBeVisible();
  await openMobileSessionGuide(page);
  await expect(page.getByText("How YOVA adapted this").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/asked for concrete examples before rules/i).filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator(".session-method-playbook:visible")).toContainText("WHY THIS METHOD");
  await expect(page.locator(".session-method-playbook:visible")).toContainText("Use it like this");
  await expect(page.getByLabel("Support progression").first()).toContainText("Start without support");
  const retrievalRoadmap = page.getByLabel("Session method sequence").first();
  await expect(retrievalRoadmap).toContainText("Attempt from memory");
  await expect(retrievalRoadmap).toContainText("Compare and repair");
  await expect(page.getByLabel("Method phase 1 of 3")).toContainText("Orient to the target");
  await expect(page.getByText(/Try to produce each answer before looking/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Very sure" }).click();
  await page.getByRole("button", { name: "Krebs cycle" }).click();
  await expect(page.getByText(/possible misconception/i)).toBeVisible();
  await page.getByRole("button", { name: "Repair this idea" }).click();

  await expect(page.getByText("Repair now, verify later")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("YOVA CHANGED THE SUPPORT")).toBeVisible();
  const adaptiveRepair = page.getByRole("region", { name: "Adaptive repair: One clue first" });
  await expect(adaptiveRepair).toBeVisible();
  await expect(adaptiveRepair).toContainText(/asked for a small hint when stuck/i);
  await leaveSession(page, "2 of 6 required steps finished");
  await expectSavedSessionRecommendation(page, 2);
  await page.getByRole("button", { name: "Continue session" }).click();
  await expect(page.getByText("Repair now, verify later")).toBeVisible();
  await expect(page.locator(".session-activity-header").getByRole("heading", { name: /Use one clue, then retry Cellular respiration sequence/i })).toBeVisible();
  await expect(page.getByText(/not saved as proof of mastery/i)).not.toBeVisible();
  await page.getByLabel("Corrected idea in your own words").fill(
    "Glycolysis happens first, followed by the Krebs cycle and electron transport chain.",
  );
  await page.getByRole("button", { name: "Check my answer" }).dispatchEvent("click");
  await expect(page.getByText("YOVA'S FORMATIVE CHECK")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("The key idea is present.")).toBeVisible();
  await page.getByRole("button", { name: "I got the key idea" }).click();
  await expect(page.getByText(/required recheck records whether the repaired concept now holds/i)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Somewhat sure" }).click();
  await page.getByRole("button", { name: "Cytoplasm" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Attempt from memory").fill(
    "Glycolysis occurs in the cytoplasm and does not directly require oxygen.",
  );
  await page.getByRole("button", { name: "Check my answer" }).dispatchEvent("click");
  await page.getByRole("button", { name: "I got the key idea" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish this content" }).click();

  await expect(page.getByRole("heading", { name: "Today’s checks held up." })).toBeInViewport();
  await expect(page.getByRole("heading", { name: "The work is done. One part needs another check." })).not.toBeVisible();
  await expect(page.getByText("2 of 3", { exact: true })).toBeVisible();
  await expect(page.getByText("Initial evidence checks")).toBeVisible();
  await expect(page.getByText("Correct before in-session repair")).toBeVisible();
  await expect(page.getByText("Recorded, not graded")).toBeVisible();
  await expect(page.getByText("No gap remains after today’s required repairs.")).toBeVisible();
  await expect(page.getByText(/the successful repair means no duplicate follow-up is needed/i)).toBeVisible();
  await expect(page.getByText("Cellular respiration sequence", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("NO CHANGE NEEDED")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Complete this learning item" })).toBeVisible();
  await expect(page.getByText(/today’s evidence does not require another scheduled check/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add a short delayed check" })).not.toBeVisible();
  await page.getByRole("button", { name: "Finish and continue" }).click();
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Learner$/ })).toBeVisible();
});

test("Practice Problems starts with an unsupported written attempt, repairs a miss, then changes context", async ({ page }) => {
  type ProblemPracticeGenerationRequest = {
    planSessionId: string;
    routeRevisionId?: string;
    previewContext?: {
      studyRoute?: { approach?: { primaryMethodId?: string } };
      session?: { topicIds?: string[] };
    };
  };
  const generationRequests: ProblemPracticeGenerationRequest[] = [];

  await page.route("**/api/sessions/generate", async (route) => {
    const generationRequest = route.request().postDataJSON() as ProblemPracticeGenerationRequest;
    generationRequests.push(generationRequest);
    const topicId = generationRequest.previewContext?.session?.topicIds?.[0];
    if (!generationRequest.planSessionId || !topicId) {
      throw new Error("Expected the committed problem-practice session and its topic in the generation request.");
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(practiceProblemsSessionResponse({
        planSessionId: generationRequest.planSessionId,
        routeRevisionId: generationRequest.routeRevisionId,
        topicId,
      })),
    });
  });
  await page.route("**/api/sessions/evaluate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        verdict: "secure",
        feedback: "The corrected setup keeps the low-function derivative first and squares the original denominator.",
        matchedIdeas: ["The quotient-rule numerator order and denominator square are both present."],
        missingIdeas: [],
        mode: "preview",
      }),
    });
  });

  await createPreviewAccount(page);
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Give me quotient-rule practice problems so I can test whether I can solve them independently.",
  );
  await page.getByRole("button", { name: "I understand the basics but need practice" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  expect(generationRequests[0]?.previewContext?.studyRoute?.approach?.primaryMethodId).toBe("practice_problems");
  await expect(page.getByRole("heading", { name: "Set up the quotient rule without support" })).toBeVisible();
  await expect(page.getByLabel("Method phase 1 of 3")).toContainText("Perform independently");
  await expect(page.getByLabel("Show your reasoning")).toBeVisible();
  await expect(page.locator(".answer-grid")).toHaveCount(0);
  await expect(page.locator(".teaching-lesson")).toHaveCount(0);

  await page.getByRole("button", { name: "Somewhat sure" }).click();
  await page.getByRole("button", { name: "I don't know yet" }).click();
  await expect(page.getByText("MODEL ANSWER")).toBeVisible();
  await page.getByRole("button", { name: "Repair this idea" }).click();

  await expect(page.getByText("Repair now, verify later")).toBeVisible();
  const targetedRepair = page.getByRole("region", { name: "Adaptive repair: One clue first" });
  await expect(targetedRepair).toBeVisible();
  await expect(targetedRepair).toContainText("Quotient-rule numerator order");
  await expect(targetedRepair).toContainText(/target has not changed/i);
  await page.getByLabel("Corrected idea in your own words").fill(
    "Differentiate the numerator first, keep the denominator, then subtract the numerator times the denominator derivative.",
  );
  await page.getByRole("button", { name: "Check my answer" }).click();
  await expect(page.getByText("The key idea is present.")).toBeVisible();
  await page.getByRole("button", { name: "I got the key idea" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Transfer the quotient rule to a trigonometric numerator" })).toBeVisible();
  await expect(page.getByLabel("Method phase 3 of 4")).toContainText("Apply it in a new context");
  await expect(page.locator(".session-activity-instruction")).toContainText(
    "Differentiate a different function with the same rule",
  );
  await expect(page.getByLabel("Show your reasoning")).toBeVisible();
});

test("a support request keeps the committed practice recipe when fallback generation fails", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary guided-session generation failure." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me review the product rule and test what I remember.",
  );
  await page.getByRole("button", { name: "I know it and want to test my recall" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "I need more support first" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/add more guidance inside the planned method/i)).toBeVisible();
  await expect(page.getByText("Time in this recipe", { exact: true })).toBeVisible();
  await expect(page.getByText("25 minutes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByText(/safe study-method workpad was loaded instead/i)).toBeVisible();
  const methodWorkpad = page.getByLabel("Study-method workpad");
  await expect(methodWorkpad).toBeVisible();
  await expect(methodWorkpad.getByLabel("How to study this")).toContainText("Practice Problems");
  await expect(methodWorkpad.getByLabel("How to study this")).toContainText("Practice first");
  await expect(methodWorkpad).toContainText("This completes practice, not a knowledge check.");
  await expect(page.getByRole("heading", { name: "See the product rule before using it" })).not.toBeVisible();
  await expect(page.getByText(/safe built-in session was loaded instead/i)).not.toBeVisible();
});

test("an inactive-plan generation response cannot open a stale built-in lesson", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "That learning plan is no longer active." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand the product rule and practice using it.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByRole("heading", { name: "YOVA could not prepare a guided lesson for this session setup." })).toBeVisible();
  await expect(page.getByText("That learning plan is no longer active.")).toBeVisible();
  await expect(page.getByRole("button", { name: /guided lesson again/i })).toHaveCount(0);
  await expect(page.getByText(/safe built-in session was loaded instead/i)).not.toBeVisible();
});

test("a visibly shortened inside recipe keeps its method in the fallback workpad", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary guided-session generation failure." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Review the product rule and test what I remember.",
  );
  await page.getByRole("button", { name: "15 minutes", exact: true }).click();
  await page.getByRole("button", { name: "I understand the basics but need practice" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await rebuildLatestStudyNowPlanForMinutes(page, 10);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Time in this recipe", { exact: true })).toBeVisible();
  await expect(page.getByText("10 minutes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByText(/safe study-method workpad was loaded instead/i)).toBeVisible();
  const methodWorkpad = page.getByLabel("Study-method workpad");
  await expect(methodWorkpad).toBeVisible();
  await expect(methodWorkpad.getByLabel("How to study this")).toContainText("Practice Problems");
  await expect(methodWorkpad).toContainText("This completes practice, not a knowledge check.");
  await expect(page.getByText("STEP 1 OF 3", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Use the session target as your comparison frame" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).not.toBeVisible();
});

test("a built-in fallback never ignores a learner's custom session requirement", async ({ page }) => {
  const generationBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/sessions/generate", async (route) => {
    generationBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary guided-session generation failure." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand the product rule and practice using it.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Time in this recipe", { exact: true })).toBeVisible();
  await expect(page.getByText("25 minutes", { exact: true })).toBeVisible();
  await page.getByLabel("Anything YOVA should account for?").fill("This session must also cover the quotient rule.");
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByRole("heading", { name: "YOVA could not reach the guided-lesson service." })).toBeVisible();
  await expect(page.getByText(/subject-specific offline lesson is not available for this session configuration/i)).toBeVisible();
  await expect(page.getByText(/safe built-in session was loaded instead/i)).not.toBeVisible();

  await page.getByRole("button", { name: "Try preparing the guided lesson again" }).click();
  await expect.poll(() => generationBodies.length).toBe(2);
  expect(generationBodies[1]?.sessionAdjustment).toEqual(generationBodies[0]?.sessionAdjustment);
  expect(generationBodies[1]?.sessionAdjustment).toMatchObject({
    familiarity: "as_planned",
    availableMinutes: null,
    note: "This session must also cover the quotient rule.",
  });
  await expect(page.getByRole("heading", { name: "YOVA could not reach the guided-lesson service." })).toBeVisible();
});

test("a new topic is taught before YOVA asks for independent performance", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Use the deterministic built-in lesson for this browser journey." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand compound growth and personal finance basics.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await expect(page.getByText("Starting approach: Teaching first.")).toBeVisible();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByLabel(/Method phase 1 of/)).toContainText("See a complete model");
  await expect(page.getByLabel("How YOVA adapted this session")).toContainText("The method comes from the task");
  await expect(page.getByLabel("How YOVA adapted this session")).toContainText(/concrete examples before rules/i);
  await openMobileSessionGuide(page);
  await expect(page.getByText("Teaching first", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("How YOVA adapted this").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/asked for concrete examples before rules/i).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByLabel("Support progression").first()).toContainText("Support fades inside this session");
  const teachingRoadmap = page.getByLabel("Session method sequence").first();
  await expect(teachingRoadmap).toContainText("See a complete model");
  await expect(teachingRoadmap).toContainText("Practice with less help");
  await expect(teachingRoadmap).toContainText("Perform independently");
  await expect(teachingRoadmap).toContainText("Apply it in a new context");
  await expect(page.getByLabel("Method phase 1 of 4")).toContainText("See a complete model");
  await expect(page.getByText(/A budget directs limited income/).first()).toBeVisible();
  await expect(page.getByText("Part 1 of 2", { exact: true })).toBeVisible();
  const interactiveVisualLabel = page.getByText(/^INTERACTIVE (?:MODEL|PROCESS|TIMELINE|COMPARISON|CONCEPT MAP)$/);
  const interactiveVisual = page.getByLabel(/^Interactive (?:model|process|timeline|comparison|concept map):/i);
  await expect(interactiveVisualLabel).not.toBeVisible();
  await expect(page.getByRole("group", { name: /One quick confidence check/ })).not.toBeVisible();
  await page.getByRole("button", { name: "Next: Explore the model" }).click();
  await expect(interactiveVisualLabel).toBeVisible();
  await expect(interactiveVisual).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Model parts" }).getByRole("tab")).toHaveCount(3);
  await page.getByRole("button", { name: "Next part" }).click();
  await expect(interactiveVisual).toContainText("2 of 3");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Trace one financial choice" })).toBeVisible();
  await expect(page.getByText(/If \$100 earns 10%/).first()).toBeVisible();
  await expect(page.getByRole("group", { name: /One quick confidence check/ })).not.toBeVisible();
  await page.getByRole("button", { name: "Next: Explore the model" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "What makes the second year compound growth?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review the lesson" })).toBeVisible();
  await page.getByRole("button", { name: "Review the lesson" }).click();
  await expect(page.getByRole("dialog", { name: /Review the lesson, then return to the same question/i })).toBeVisible();
  await expect(page.getByText("Your answer and session progress stay exactly where they are.")).toBeVisible();
  await page.getByRole("dialog", { name: /Review the lesson, then return to the same question/i })
    .locator("footer")
    .getByRole("button", { name: "Back to the question" })
    .click();
  await expect(page.getByRole("heading", { name: "What makes the second year compound growth?" })).toBeVisible();
  await expect(page.getByRole("group", { name: /One quick confidence check/ })).not.toBeVisible();
  await page.getByRole("button", { name: "The earlier gain remains in the base" }).click();
  await expect(page.getByText("Correct.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Explain compound growth in your own words" })).toBeVisible();
  await expect(page.getByLabel("Method phase 3 of 4")).toContainText("Perform independently");
  await expect(page.getByRole("group", { name: /One quick confidence check/ })).toBeVisible();
  await page.getByRole("button", { name: "Somewhat sure" }).click();
  await expect(page.getByRole("button", { name: "I don't know yet" })).toBeVisible();
  await page.getByRole("button", { name: "I don't know yet" }).dispatchEvent("click");
  await expect(page.getByText("MODEL ANSWER")).toBeVisible();
  await expect(page.getByRole("button", { name: "Needs another pass" })).toHaveClass(/selected/);
  await page.getByRole("button", { name: "Repair this idea" }).click();

  await expect(page.getByText("Repair now, verify later")).toBeVisible();
  await expect(page.getByText("YOVA CHANGED THE SUPPORT")).toBeVisible();
  await expect(page.getByText("One clue first")).toBeVisible();
  await expect(page.getByText(/asked for a small hint when stuck/i)).toBeVisible();
  await page.getByLabel("Corrected idea in your own words").fill(
    "Earlier gains stay in the base, so later percentage gains apply to the original amount and its accumulated growth.",
  );
  await page.getByRole("button", { name: "Check my answer" }).dispatchEvent("click");
  await expect(page.getByText("YOVA'S FORMATIVE CHECK")).toBeVisible();
  await expect(page.getByText("The key idea is present.")).toBeVisible();
});

test("a World War I beginner receives real teaching and a direct model answer", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Use the built-in subject session for this reliability test." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Teach me the causes of World War I and how the conflict spread across Europe.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByRole("heading", { name: "Build the World War I cause map" })).toBeVisible();
  await expect(page.getByText(/On June 28, 1914/)).toBeVisible();
  await page.getByRole("button", { name: "Next: Core idea" }).click();
  await expect(page.getByText(/Militarism increased armies/)).toBeVisible();
  await expect(page.locator(".session-workspace")).not.toContainText("the first concept listed");
  await expect(page.locator(".session-workspace")).not.toContainText("A strong response states the main idea");

  await page.getByRole("button", { name: "Next: Explore the model" }).click();
  await expect(page.getByText(/On June 28, 1914/).first()).toBeVisible();
  await page.getByRole("button", { name: "Next: Common mix-up" }).click();
  await expect(page.getByText("The assassination alone made a world war inevitable.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Which explanation best describes the outbreak of World War I?" })).toBeVisible();
  await page.getByRole("button", { name: "Long-term tensions made Europe unstable, and decisions during the July Crisis widened the assassination crisis into war" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Rebuild the escalation in your own words" })).toBeVisible();
  await expectNoHorizontalOverflow(page, ".session-shell");
  const confidence = page.getByRole("button", { name: "Somewhat sure" });
  if (await confidence.isVisible()) await confidence.click();
  const unknownAnswer = page.getByRole("button", { name: "I don't know yet" });
  await expect(unknownAnswer).toBeInViewport();
  await unknownAnswer.dispatchEvent("click");
  await expect(page.getByText("MODEL ANSWER")).toBeVisible();
  await expect(page.locator(".model-answer-card")).toContainText("Austria-Hungary responded to the assassination with an ultimatum");
  await expect(page.locator(".model-answer-card")).not.toContainText("A strong response");
});

test("an opaque class label is stopped until the learner names the actual calculus concept", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  const goalInput = page.getByPlaceholder("Example: Help me understand the product rule and practice using it.");
  await goalInput.fill("Start Calc Unit 3");
  await expect(page.getByText(/class label such as “Unit 3” does not tell YOVA/i)).toBeVisible();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();

  await expect(page.getByRole("heading", { name: "What topics or skills does this actually cover?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Build and start session/ })).toBeDisabled();
  await page.getByRole("button", { name: "Product rule", exact: true }).click();
  await page.getByRole("button", { name: /Use this topic/ }).click();
  await expect(page.getByText("Start Calc Unit 3: Product rule", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Build and start session/ })).toBeEnabled();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByRole("heading", { name: "See the product rule before using it" })).toBeVisible();
  await expect(page.getByText(/teaching first/i).filter({ visible: true }).first()).toBeVisible();
  const renderedFormula = page.locator(".teaching-core .katex").first();
  await expect(renderedFormula).toBeVisible();
  await expect(renderedFormula.locator("annotation[encoding='application/x-tex']")).toContainText("frac");
  const formulaLayout = await renderedFormula.evaluate((element) => ({
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
    fitsItsLine: element.getBoundingClientRect().width <= (element.parentElement?.getBoundingClientRect().width ?? 0) + 1,
  }));
  expect(formulaLayout.fontSize).toBeGreaterThanOrEqual(15);
  expect(formulaLayout.fitsItsLine).toBe(true);
  const workspaceWidth = await page.locator(".session-workspace").evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(workspaceWidth.scroll).toBeLessThanOrEqual(workspaceWidth.client + 1);
});

test("a teaching-first inside outage does not start with unsupported recall", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Live generation did not produce a guided session that passed YOVA's learning checks.",
        code: "guided_session_quality_checks_failed",
        retryable: false,
      }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand eigenvalues and eigenvectors from scratch",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByText("LESSON QUALITY CHECK", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The generated lesson did not pass YOVA's quality checks." })).toBeVisible();
  await expect(page.getByText(/teaching-first session still needs an initial subject explanation/i)).toBeVisible();
  await expect(page.getByLabel("Study-method workpad")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Use the study method" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try preparing the guided lesson again" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review session setup" })).toBeVisible();
});

test("a temporary AI failure loads a subject-specific startup funding lesson", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary guided-session generation failure." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Teach me startup funding stages, instruments, investors, dilution, and term sheets from the beginning",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByRole("heading", { name: "Build the startup funding map" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Follow one founder from an idea to an early company." })).toBeVisible();
  await page.getByRole("button", { name: /Core idea/ }).click();
  await expect(page.getByText(/bootstrapping uses founder money or company revenue/i)).toBeVisible();
  await expect(page.getByText(/safe built-in session was loaded instead/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).not.toBeVisible();
});

test("home lets the learner browse prioritized recommendations without opening every plan", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Temporary test failure." }) });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await createOneOffLearningSession(page, "Help me understand compound growth and personal finance basics.");
  await expect(page.locator(".method-phase-coach:visible")).toContainText("See a complete model");
  await exitSessionWithoutProgress(page);

  await createOneOffLearningSession(page, "Teach me startup funding stages, instruments, investors, and dilution from the beginning.");
  await expect(page.getByRole("heading", { name: "Build the startup funding map" })).toBeVisible();
  await exitSessionWithoutProgress(page);

  const recommendation = recommendedLearningPlan(page);
  await expect(recommendation).toBeVisible();
  const secondRecommendation = page.getByRole("button", { name: "Show recommendation 2 of 2" });
  await expect(secondRecommendation).toBeVisible();
  await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
  const firstTitle = await recommendation.getByRole("heading", { level: 2 }).textContent();
  await secondRecommendation.click();
  await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
  await expect(recommendation.getByRole("heading", { level: 2 })).not.toHaveText(firstTitle ?? "");
});

test("outside study gives a concrete source-based session instead of pretending YOVA owns the content", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Draft a comparative history thesis using my textbook evidence",
  );
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Guide me outside YOVA/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  const methodWorkpad = page.getByLabel("Study-method workpad");
  const methodBriefing = methodWorkpad.getByLabel("How to study this");
  await expect(methodWorkpad).toBeVisible();
  await expect(methodBriefing).toContainText("HOW TO STUDY THIS");
  await expect(methodBriefing).toContainText("TODAY'S TARGET");
  await expect(methodBriefing).toContainText("What this covers");
  await expect(methodBriefing).toContainText("Finished means");
  await expect(methodBriefing).toContainText("WHY THIS METHOD");
  await expect(methodBriefing).toContainText("Use it like this");
  await expect(methodBriefing).toContainText("Why this fits today");
  await expect(methodBriefing).toContainText(/outside source remains the source of truth/i);
  await expect(methodWorkpad).toContainText("This completes practice, not a knowledge check.");
  await expect(page.locator(".session-activity-header").getByRole("heading", { name: /How to use/i })).toBeVisible();
  await expect(page.getByText(/move to your own source/i)).toBeVisible();
  await expect(page.locator("strong:visible").filter({ hasText: /^Outline from Memory$/ })).toBeVisible();
});

test("an arbitrary outside method workpad completes as practice without changing topic evidence", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Review how thermohaline circulation moves heat using my oceanography textbook",
  );
  await page.getByRole("button", { name: "I understand the basics but need practice" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Guide me outside YOVA/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  const workpad = page.getByLabel("Study-method workpad");
  await expect(workpad).toBeVisible();
  await expect(workpad.getByLabel("How to study this")).toContainText(/thermohaline circulation/i);
  await expect(workpad).toContainText("This completes practice, not a knowledge check.");

  await expect.poll(async () => Boolean(await readPreviewPracticeState(page))).toBe(true);
  const before = await readPreviewPracticeState(page);
  if (!before) throw new Error("Expected the outside session in the preview snapshot.");
  expect(before.topicStatuses.length).toBeGreaterThan(0);
  expect(before.sessionStatus).toBe("ready");

  await workpad.getByLabel("Your workpad").fill(
    "Warm, salty surface water moves heat toward higher latitudes, cools, becomes denser, sinks, and joins deep circulation.",
  );
  const topicChecks = workpad.getByRole("group", { name: "Check each covered topic" }).getByRole("checkbox");
  const topicCount = await topicChecks.count();
  expect(topicCount).toBeGreaterThan(0);
  for (let index = 0; index < topicCount; index += 1) {
    await topicChecks.nth(index).check();
  }

  const finishPractice = workpad.getByRole("button", { name: "Finish as ungraded practice" });
  await expect(finishPractice).toBeEnabled();
  await finishPractice.click();

  await expect(page.getByText("UNGRADED PRACTICE COMPLETE", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The session moves forward. Your knowledge map does not." })).toBeVisible();
  await expect(page.getByText("KNOWLEDGE MAP UPDATED", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Topic evidence", { exact: true })).toBeVisible();
  await expect(page.getByText("None added", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finish and continue" }).click();

  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Learner$/ })).toBeVisible();
  await expect.poll(async () => {
    const after = await readPreviewPracticeState(page, before.planId, before.sessionId);
    return after?.completion?.completionMode ?? null;
  }).toBe("unguided_practice");

  const after = await readPreviewPracticeState(page, before.planId, before.sessionId);
  if (!after?.completion) throw new Error("Expected the unguided completion in the preview snapshot.");
  expect(after.sessionStatus).toBe("complete");
  expect(after.topicStatuses).toEqual(before.topicStatuses);
  expect(after.topicStatusesSerialized).toBe(before.topicStatusesSerialized);
  expect(after.completion).toMatchObject({
    completionMode: "unguided_practice",
    correctAnswers: 0,
    totalAnswers: 0,
    observedGap: "Unguided practice completed; no topic evidence was recorded.",
    conceptEvidence: [],
    confidenceEvidence: [],
  });
  expect(after.verificationSession).toMatchObject({
    id: after.completion.id,
    sequence: before.sessionSequence + 1,
    status: "ready",
    learningMode: "study",
    reviewType: "verify",
    topicIds: before.sessionTopicIds,
    contentTargets: before.sessionContentTargets,
    completionEvidence: before.sessionCompletionEvidence,
  });
});

test("a fallback method workpad resumes its timer and checked targets after reload", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary guided-session generation failure." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Review how thermohaline circulation moves heat using my oceanography textbook",
  );
  await page.getByRole("button", { name: "I understand the basics but need practice" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Guide me outside YOVA/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await page.getByRole("button", { name: "Not now", exact: true }).dispatchEvent("click");
  await expect(recommendedLearningPlan(page)).toBeVisible();

  // Material-grounded sessions deliberately do not receive a generic built-in
  // lesson. This drives the real standalone method-recovery path without
  // weakening or mocking the fallback eligibility decision itself.
  await expect.poll(() => page.evaluate(() => Boolean(
    window.localStorage.getItem("yova.preview.v1"),
  ))).toBe(true);
  await page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) throw new Error("Expected the Study Now preview snapshot.");
    const snapshot = JSON.parse(raw) as {
      plans?: Array<{
        sourceMode?: string;
        sessions?: Array<{ resource?: unknown }>;
      }>;
      updatedAt?: string;
    };
    const plan = snapshot.plans?.at(-1);
    if (!plan) throw new Error("Expected a saved Study Now plan.");
    plan.sourceMode = "user_materials";
    const session = plan.sessions?.find((candidate) => !candidate.resource);
    if (!session) throw new Error("Expected a ready Study Now session without a resource.");
    // A generated resource can become unusable after session requirements
    // change. The standalone method checkpoint must remain authoritative over
    // that stale cache when the replacement generation also fails.
    session.resource = {
      rationale: "Stale generated lesson retained only to exercise recovery precedence.",
      activities: [{
        type: "instruction",
        concept: "Ocean circulation",
        label: "Review",
        title: "Old generated lesson",
        body: "This stale resource must not replace the active method workpad.",
        choices: [],
        correctAnswer: null,
        feedback: null,
      }],
      generatedAt: "2026-08-18T12:00:00.000Z",
      origin: "generated",
    };
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });
  await page.reload();

  await recommendedLearningPlan(page).getByRole("button", { name: "Start session" }).click();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Has anything changed?" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Set the pace for today." })).toBeVisible();
  await page.getByLabel("Anything YOVA should account for?").fill(
    "Use the current textbook section, so the cached lesson needs replacement.",
  );
  await page.getByRole("button", { name: "Prepare this session" }).click();
  await expect(page.getByText(/safe study-method workpad was loaded instead/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Use the study method" })).toHaveCount(0);

  const workpad = page.getByLabel("Study-method workpad");
  await expect(workpad).toBeVisible();
  const privateNote = "PRIVATE METHOD NOTE must not survive reload";
  await workpad.getByLabel("Your workpad").fill(privateNote);
  const topicChecks = workpad.getByRole("group", { name: "Check each covered topic" }).getByRole("checkbox");
  await expect(topicChecks.first()).toBeVisible();
  await topicChecks.first().check();
  await page.waitForTimeout(1_100);
  await expect(page.locator(".method-session-shell > header > span")).not.toHaveText("0:00 elapsed");

  await expect.poll(() => page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.active-session-checkpoints.v1");
    const checkpoints = raw ? JSON.parse(raw) as Array<{
      activeSeconds?: number;
      methodWork?: { checkedTopics?: string[] };
      resourceGeneratedAt?: string;
    }> : [];
    const checkpoint = checkpoints.at(-1);
    return {
      activeSeconds: checkpoint?.activeSeconds ?? 0,
      checkedTopics: checkpoint?.methodWork?.checkedTopics?.length ?? 0,
      resourceGeneratedAt: checkpoint?.resourceGeneratedAt ?? null,
      serialized: raw ?? "",
    };
  })).toMatchObject({
    activeSeconds: expect.any(Number),
    checkedTopics: 1,
    resourceGeneratedAt: null,
  });
  // `expect.poll` does not expose the matched value, so read once after the
  // checkpoint has reached the asserted state.
  const serializedCheckpoint = await page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.active-session-checkpoints.v1") ?? "[]";
    return raw;
  });
  expect(serializedCheckpoint).not.toContain(privateNote);

  await page.reload();
  await expectSavedSessionRecommendation(page);
  await page.getByRole("button", { name: "Continue session" }).click();

  const resumedWorkpad = page.getByLabel("Study-method workpad");
  await expect(resumedWorkpad).toBeVisible();
  await expect(
    resumedWorkpad.getByRole("group", { name: "Check each covered topic" }).getByRole("checkbox").first(),
  ).toBeChecked();
  await expect(resumedWorkpad.getByLabel("Your workpad")).toHaveValue("");
  await expect(page.getByText(/Your session was recovered/)).toBeVisible();
  await expect(page.locator(".method-session-shell > header > span")).not.toHaveText("0:00 elapsed");
});

test("a 10-minute outside teaching-first session loads its built-in method lesson", async ({ page }) => {
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Live generation did not produce a guided session that passed YOVA's learning checks.",
        retryable: false,
      }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "I want to understand how the Krebs cycle actually produces NADH and FADH2",
  );
  await page.getByRole("button", { name: "15 minutes", exact: true }).click();
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Guide me outside YOVA/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await rebuildLatestStudyNowPlanForMinutes(page, 10);

  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "I need more support first" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/add more guidance inside the planned method/i)).toBeVisible();
  await expect(page.getByText("Time in this recipe", { exact: true })).toBeVisible();
  await expect(page.getByText("10 minutes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByText(/safe built-in session was loaded instead/i)).toBeVisible();
  await expect(page.getByText("STEP 1 OF 3", { exact: true })).toBeVisible();
  await expect(page.locator(".session-activity-header").getByRole("heading", { name: /How to use/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).not.toBeVisible();
});

test("an overdue outside teaching-first session splits into runnable 10-minute parts", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "I want to understand how the Krebs cycle actually produces NADH and FADH2",
  );
  await page.getByRole("button", { name: "15 minutes", exact: true }).click();
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Guide me outside YOVA/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();

  const setupSummary = page.locator(".session-current-assumption");
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await expect(setupSummary).toContainText("about 15 minutes");
  await page.getByRole("button", { name: "Not now", exact: true }).click();

  await expect.poll(() => page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) return null;
    const snapshot = JSON.parse(stored) as {
      plans?: Array<{ sessions?: Array<{ estimatedMinutes?: number; status?: string }> }>;
    };
    const ready = snapshot.plans?.at(-1)?.sessions?.find((session) => session.status === "ready");
    return ready?.estimatedMinutes ?? null;
  })).toBe(15);

  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected the Study Now plan in the preview snapshot.");
    const snapshot = JSON.parse(stored) as {
      plans?: Array<{ sessions?: Array<{ scheduledFor?: string; status?: string }> }>;
      updatedAt?: string;
    };
    const ready = snapshot.plans?.at(-1)?.sessions?.find((session) => session.status === "ready");
    if (!ready) throw new Error("Expected a ready session to make overdue.");
    ready.scheduledFor = new Date(Date.now() - 6 * 60 * 60 * 1_000).toISOString();
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });
  await page.reload();

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByText("A SESSION IS STILL WAITING", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ran out of time", exact: true }).click();
  const splitButton = page.getByRole("button", {
    name: "Recommended: Split into 10-min sessions",
    exact: true,
  });
  await expect(splitButton).toBeVisible();
  await splitButton.click();

  await expect(page.locator(".agenda-recovery-result")).toContainText(
    "Split applied. Part 1 and each remaining part now have a 10-minute window.",
  );
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Start Part 1 (10 min)", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) return [];
    const snapshot = JSON.parse(stored) as {
      plans?: Array<{
        sessions?: Array<{
          title?: string;
          estimatedMinutes?: number;
          status?: string;
        }>;
      }>;
    };
    return (snapshot.plans?.at(-1)?.sessions ?? []).map((session) => ({
      title: session.title,
      minutes: session.estimatedMinutes,
      status: session.status,
    }));
  })).toEqual([
    expect.objectContaining({ title: expect.stringContaining("Part 1 of 2"), minutes: 10, status: "ready" }),
    expect.objectContaining({ title: expect.stringContaining("Part 2 of 2"), minutes: 10, status: "upcoming" }),
  ]);

  await page.getByRole("button", { name: "Start Part 1 (10 min)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await expect(setupSummary).toContainText("about 10 minutes");
  await expect(setupSummary).not.toContainText("about 15 minutes");

  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Live generation did not produce a guided session that passed YOVA's learning checks.",
        retryable: false,
      }),
    });
  });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByText(/safe built-in session was loaded instead/i)).toBeVisible();
  await expect(page.getByText("STEP 1 OF 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).not.toBeVisible();
});

test("an overdue arbitrary inside session splits and loads a route-faithful 10-minute workpad", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Review eigenvalues and eigenvectors for practice",
  );
  await page.getByRole("button", { name: "15 minutes", exact: true }).click();
  await page.getByRole("button", { name: "I understand the basics but need practice" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();

  const setupSummary = page.locator(".session-current-assumption");
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await expect(setupSummary).toContainText("about 15 minutes");
  await page.getByRole("button", { name: "Not now", exact: true }).click();

  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected the inside-YOVA Study Now plan in the preview snapshot.");
    const snapshot = JSON.parse(stored) as {
      plans?: Array<{ sessions?: Array<{
        scheduledFor?: string;
        status?: string;
        contentTargets?: string[];
        completionEvidence?: string[];
      }> }>;
      updatedAt?: string;
    };
    const ready = snapshot.plans?.at(-1)?.sessions?.find((session) => session.status === "ready");
    if (!ready) throw new Error("Expected a ready inside-YOVA session to make overdue.");
    ready.scheduledFor = new Date(Date.now() - 6 * 60 * 60 * 1_000).toISOString();
    // Acronym-only targets have no tokens in the curated-template heuristic.
    // The generic fallback must use its exact saved-target contract instead.
    ready.contentTargets = ["DNA and RNA"];
    ready.completionEvidence = ["Explain the saved relationship in your own words"];
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });
  await page.reload();

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByText("A SESSION IS STILL WAITING", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ran out of time", exact: true }).click();
  const splitButton = page.getByRole("button", {
    name: "Recommended: Split into 10-min sessions",
    exact: true,
  });
  await expect(splitButton).toBeVisible();
  await splitButton.click();

  await expect(page.locator(".agenda-recovery-result")).toContainText(
    "Split applied. Part 1 and each remaining part now have a 10-minute window.",
  );
  await expect(page.getByRole("button", { name: "Start Part 1 (10 min)", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) return [];
    const snapshot = JSON.parse(stored) as {
      plans?: Array<{ sessions?: Array<{ estimatedMinutes?: number; status?: string }> }>;
    };
    return (snapshot.plans?.at(-1)?.sessions ?? []).map((session) => ({
      minutes: session.estimatedMinutes,
      status: session.status,
    }));
  })).toEqual([
    expect.objectContaining({ minutes: 10, status: "ready" }),
    expect.objectContaining({ minutes: 10, status: "upcoming" }),
  ]);

  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await page.getByRole("button", { name: /^Recent \d+$/ }).click();
  const unfinishedStudyNowPlan = page.locator(".learning-goal-card").filter({
    hasText: /eigenvalues and eigenvectors/i,
  });
  await expect(unfinishedStudyNowPlan).toContainText("NEXT SESSION");
  await expect(unfinishedStudyNowPlan.getByRole("button", { name: "Start next", exact: true })).toBeVisible();
  await unfinishedStudyNowPlan.getByRole("button", { name: "Open goal", exact: true }).click();
  const learningDetailStart = page.getByRole("button", { name: "Start next session", exact: true });
  await expect(page.getByText("Unfinished work", { exact: true })).toBeVisible();
  await expect(learningDetailStart).toBeVisible();
  await learningDetailStart.click();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await expect(setupSummary).toContainText("about 10 minutes");
  await expect(setupSummary).not.toContainText("about 15 minutes");

  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Live generation did not produce a guided session that passed YOVA's learning checks.",
        retryable: false,
      }),
    });
  });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Prepare this session" }).click();

  await expect(page.getByText(/safe study-method workpad was loaded instead/i)).toBeVisible();
  const methodWorkpad = page.getByLabel("Study-method workpad");
  await expect(methodWorkpad).toBeVisible();
  await expect(methodWorkpad.getByLabel("How to study this")).toContainText("Concept Mapping");
  await expect(methodWorkpad).toContainText("DNA and RNA");
  await expect(methodWorkpad).toContainText("This completes practice, not a knowledge check.");
  await expect(page.getByText("STEP 1 OF 3", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Use the session target as your comparison frame" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).not.toBeVisible();
  await expect(page.getByText("COMPARISON CHECK", { exact: true })).toHaveCount(0);
});

test("the backend rejects an opaque goal even when the browser guard is bypassed", async ({ request }) => {
  const response = await request.post("/api/plans/generate", {
    headers: { "X-Yova-Development-Preview": "plan-creator" },
    data: {
      intent: "study_now",
      learningIntent: "learn",
      goal: "Start Calc Unit 3",
      materialMode: "none",
      materials: [],
      studyMode: "inside",
      deadline: null,
      timeZone: "America/Los_Angeles",
      diagnosticResponses: [{
        question: "Where are you starting?",
        answer: "I have not learned this yet",
        evaluation: "self_report",
      }],
      availability: [{ day: "Today", window: "Now", minutes: 15 }],
      profileSummary: "The learner wants a short, clearly structured session.",
    },
  });
  const body = await response.json();

  expect(response.status()).toBe(422);
  expect(body.code).toBe("goal_needs_detail");
});

test("plan generation remains a draft until the learner activates it", async ({ request }) => {
  const deadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000);
  const generationRequest = {
    intent: "plan",
    learningIntent: "learn",
    goal: "Understand photosynthesis and cellular respiration for my biology test",
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: deadline.toISOString(),
    timeZone: "America/Los_Angeles",
    diagnosticResponses: [{
      question: "Where are you starting?",
      answer: "I have not learned this yet",
      evaluation: "self_report",
    }],
    availability: [{ day: "Every day", window: "Evening", minutes: 45 }],
    profileSummary: "The learner prefers direct explanations, examples, and short structured sessions.",
  };
  const previewHeaders = { "X-Yova-Development-Preview": "plan-creator" };
  const generationResponse = await request.post("/api/plans/generate", {
    headers: previewHeaders,
    data: generationRequest,
  });
  const generated = await generationResponse.json();

  expect(generationResponse.status()).toBe(200);
  expect(generated.plan.status).toBe("draft");
  expect(generated.generation.persistence).toBe("draft");

  const activationResponse = await request.post("/api/plans/activate", {
    headers: previewHeaders,
    data: { plan: generated.plan, generationRequest },
  });
  const activated = await activationResponse.json();

  expect(activationResponse.status()).toBe(200);
  expect(activated.plan.status).toBe("active");
  expect(activated.activation.persistence).toBe("browser");

  const repeatedActivation = await request.post("/api/plans/activate", {
    headers: previewHeaders,
    data: { plan: generated.plan, generationRequest },
  });
  const repeated = await repeatedActivation.json();

  expect(repeatedActivation.status()).toBe(200);
  expect(repeated.plan.id).toBe(activated.plan.id);
  expect(repeated.plan.learningItemId).toBe(activated.plan.learningItemId);
});

test("a learner can stop twice without losing progress or earlier evidence", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand compound growth and personal finance basics.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByRole("heading", { name: "Use money concepts as decision tools" })).toBeVisible();
  await page.getByRole("button", { name: "Next: Explore the model" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await leaveSession(page, "1 of 5 required steps finished");

  await expectSavedSessionRecommendation(page, 1);
  await page.getByRole("button", { name: "Continue session" }).click();
  await expect(page.getByRole("heading", { name: "Trace one financial choice" })).toBeVisible();
  await page.getByRole("button", { name: "Next: Explore the model" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "The earlier gain remains in the base" }).click();
  await expect(page.getByText("Correct.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await leaveSession(page, "3 of 5 required steps finished");

  await expectSavedSessionRecommendation(page, 3);
  await page.getByRole("button", { name: "Continue session" }).click();
  await expect(page.getByRole("heading", { name: "Explain compound growth in your own words" })).toBeVisible();
  await page.getByRole("button", { name: "Somewhat sure" }).click();
  await page.getByLabel("Perform independently").fill(
    "Earlier gains remain in the base, so the same percentage can produce larger gains later.",
  );
  await page.getByRole("button", { name: "Check my answer" }).dispatchEvent("click");
  await expect(page.getByText("YOVA'S FORMATIVE CHECK")).toBeVisible();
  await expect(page.getByText("The key idea is present.")).toBeVisible();
  await expect(page.getByText(/one-time AI check and is not saved/i)).toBeVisible();
  await page.getByRole("button", { name: "I got the key idea" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish this content" }).click();

  await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Evidence checks", { exact: true })).toBeVisible();
});

test("a resumed streamed question can reopen its prior lesson by persisted activity index", async ({ page }) => {
  const lessonActivityIndexes: number[] = [];
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(streamedResumeSessionResponse(requestedRouteRevisionId(route))),
    });
  });
  await page.route("**/api/sessions/lesson", async (route) => {
    const body = route.request().postDataJSON() as { activityIndex?: number };
    if (typeof body.activityIndex === "number") lessonActivityIndexes.push(body.activityIndex);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        'data: {"type":"lesson.meta","requestId":"30000000-0000-4000-8000-000000000001","model":"test-model"}',
        "",
        'data: {"type":"lesson.delta","delta":"# Restored streamed explanation\\n\\nRetrieval shows what you can produce before reviewing the answer."}',
        "",
        'data: {"type":"lesson.complete","deliveryMode":"generated","elapsedMs":20,"latencyToFirstTokenMs":5,"inputTokens":20,"cachedInputTokens":0,"outputTokens":18,"wordCount":13,"model":"test-model"}',
        "",
        "",
      ].join("\n"),
    });
  });

  await createPreviewAccount(page);
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand retrieval practice and test the idea.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByText("Restored streamed explanation")).toBeVisible();
  await page.getByRole("button", { name: "Answer the question" }).click();
  await expect(page.getByRole("heading", { name: "Choose the retrieval sequence" })).toBeVisible();
  await leaveSession(page, "1 of 5 required steps finished");

  const storedResumePlan = await page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as { plans?: LearningPlan[] };
    return snapshot.plans?.at(-1) ?? null;
  });
  const storedResumeSession = storedResumePlan?.sessions.find((candidate) => candidate.status === "ready");
  const storedResumeIssue = storedResumePlan && storedResumeSession
    ? hydratedSessionResourceCacheIssue({
        plan: storedResumePlan,
        session: storedResumeSession,
        adjustment: null,
      })
    : "The preview plan or ready session was not stored.";
  expect(storedResumeIssue, JSON.stringify({
    routeMethodId: storedResumeSession?.studyRoute?.approach.primaryMethodId,
    routeMethodName: storedResumeSession?.studyRoute?.approach.visibleMethodName,
    resourceMethodId: storedResumeSession?.resource?.methodBriefing?.methodId,
    resourceMethodName: storedResumeSession?.resource?.methodBriefing?.name,
  })).toBeNull();

  await page.getByRole("button", { name: "Continue session" }).click();
  await expect(page.getByRole("heading", { name: "Choose the retrieval sequence" })).toBeVisible();
  expect(lessonActivityIndexes).toEqual([0]);
  await page.getByRole("button", { name: "Review the lesson" }).click();

  await expect.poll(() => lessonActivityIndexes.length).toBe(2);
  expect(lessonActivityIndexes).toEqual([0, 0]);
  await expect(page.getByRole("dialog", { name: /Review the lesson, then return to the same question/i }))
    .toContainText("Restored streamed explanation");
});

test("a refresh recovers semantic progress without saving draft answers or inventing an interruption", async ({ page }) => {
  test.setTimeout(90_000);
  let generationRequests = 0;

  await page.route("**/api/sessions/generate", async (route) => {
    generationRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(streamedResumeSessionResponse(requestedRouteRevisionId(route))),
    });
  });
  await page.route("**/api/sessions/lesson", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        'data: {"type":"lesson.meta","requestId":"30000000-0000-4000-8000-000000000021","model":"test-model"}',
        "",
        'data: {"type":"lesson.delta","delta":"# Refresh-safe explanation\\n\\nRetrieval shows what you can produce before reviewing the answer."}',
        "",
        'data: {"type":"lesson.complete","deliveryMode":"generated","elapsedMs":20,"latencyToFirstTokenMs":5,"inputTokens":20,"cachedInputTokens":0,"outputTokens":18,"wordCount":13,"model":"test-model"}',
        "",
        "",
      ].join("\n"),
    });
  });
  await page.route("**/api/sessions/evaluate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        verdict: "secure",
        feedback: "Your explanation connects the unsupported attempt to finding the knowledge that still needs repair.",
        matchedIdeas: ["The attempt happens before review."],
        missingIdeas: [],
        mode: "preview",
      }),
    });
  });

  await createPreviewAccount(page);
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand retrieval practice and test the idea.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByText("Refresh-safe explanation")).toBeVisible();
  await page.getByRole("button", { name: "Answer the question" }).click();
  await expect(page.getByRole("heading", { name: "Choose the retrieval sequence" })).toBeVisible();
  await expect.poll(() => readRecoveryState(page)).toMatchObject({
    checkpointStatus: "working",
    completedSteps: 1,
    sessionInterruptions: 0,
    hasSessionResource: true,
  });

  await page.reload();
  await expectSavedSessionRecommendation(page, 1);
  expect(generationRequests).toBe(1);
  await expect.poll(() => readRecoveryState(page)).toMatchObject({ sessionInterruptions: 0 });
  await page.getByRole("button", { name: "Continue session" }).click();
  await expect(page.getByRole("heading", { name: "Choose the retrieval sequence" })).toBeVisible();
  await expect(page.getByText(/completed sections are saved; an unfinished answer was not stored/i)).toBeVisible();
  expect(generationRequests).toBe(1);

  const confidenceCheck = page.getByRole("group", { name: /One quick confidence check/ });
  if (await confidenceCheck.isVisible()) {
    await page.getByRole("button", { name: "Somewhat sure" }).click();
  }
  await page.getByRole("button", { name: "Attempt, then review" }).click();
  await expect(page.getByText("Correct.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Explain why retrieval comes first" })).toBeVisible();

  const freeResponseConfidence = page.getByRole("group", { name: /One quick confidence check/ });
  if (await freeResponseConfidence.isVisible()) {
    await page.getByRole("button", { name: "Somewhat sure" }).click();
  }
  const draftMarker = "PRIVATE-DRAFT-7c2d9e should never be persisted";
  const freeResponse = page.locator(".recall-response textarea");
  await freeResponse.fill(draftMarker);
  await expect.poll(async () => {
    const state = await readRecoveryState(page);
    return state.completedSteps;
  }).toBe(2);
  const localStorageBeforeReload = await page.evaluate(() => JSON.stringify(
    Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, index) => {
      const key = window.localStorage.key(index) ?? "";
      return [key, window.localStorage.getItem(key)];
    })),
  ));
  expect(localStorageBeforeReload).not.toContain(draftMarker);

  await page.reload();
  await expectSavedSessionRecommendation(page, 2);
  await page.getByRole("button", { name: "Continue session" }).click();
  await expect(page.getByRole("heading", { name: "Explain why retrieval comes first" })).toBeVisible();
  await expect(page.locator(".recall-response textarea")).toHaveValue("");
  expect(generationRequests).toBe(1);
  await expect.poll(() => readRecoveryState(page)).toMatchObject({ sessionInterruptions: 0 });

  const restoredConfidence = page.getByRole("group", { name: /One quick confidence check/ });
  if (await restoredConfidence.isVisible()) {
    await page.getByRole("button", { name: "Somewhat sure" }).click();
  }
  await page.locator(".recall-response textarea").fill(
    "Trying first reveals which knowledge is available without visible support and what still needs repair.",
  );
  await page.getByRole("button", { name: "Check my answer" }).click();
  await expect(page.getByText("YOVA'S FORMATIVE CHECK")).toBeVisible();
  await page.getByRole("button", { name: "I got the key idea" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Repair the retrieval explanation" })).toBeVisible();
  await page.getByLabel("Compare and repair").fill(
    "Retrieval comes before review so the unsupported attempt reveals the exact gap that needs correction.",
  );
  await page.getByRole("button", { name: "Check my answer" }).click();
  await expect(page.getByText("YOVA'S FORMATIVE CHECK")).toBeVisible();
  await page.getByRole("button", { name: "I got the key idea" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Explain why retrieval comes first again" })).toBeVisible();
  await page.getByLabel("Explain it again").fill(
    "Trying first shows what is available from memory, and checking afterward lets me repair only what was missing.",
  );
  await page.getByRole("button", { name: "Check my answer" }).click();
  await expect(page.getByText("YOVA'S FORMATIVE CHECK")).toBeVisible();
  await page.getByRole("button", { name: "I got the key idea" }).click();
  await page.getByRole("button", { name: "Finish this content" }).click();
  await expect(page.getByRole("heading", { name: "Complete this learning item" })).toBeVisible();
  await expect.poll(() => readRecoveryState(page)).toMatchObject({
    checkpointStatus: "awaiting_finish",
    completedSteps: 5,
    sessionCompletions: 0,
    sessionInterruptions: 0,
  });

  await page.reload();
  const finishingRecommendation = recommendedLearningPlan(page);
  await expect(finishingRecommendation.getByText("CONTINUE · READY TO FINISH", { exact: true })).toBeVisible();
  await expect(finishingRecommendation.getByRole("button", { name: "Review and finish" })).toBeVisible();
  await page.getByRole("button", { name: "Review and finish" }).click();
  await expect(page.getByRole("heading", { name: "Complete this learning item" })).toBeVisible();
  await expect(page.getByText(/completed session was recovered/i)).toBeVisible();
  expect(generationRequests).toBe(1);
  const finishingRunId = (await readRecoveryState(page)).lastCheckpointRunId;
  expect(finishingRunId).not.toBeNull();
  await page.getByRole("button", { name: "Finish and continue" }).click();
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Learner$/ })).toBeVisible();
  await expect.poll(() => readRecoveryState(page)).toMatchObject({
    checkpointStatus: null,
    sessionCompletions: 1,
    sessionInterruptions: 0,
  });
  const finishedRecoveryState = await readRecoveryState(page);
  expect(finishedRecoveryState.completionId).toBe(finishingRunId);

  await page.reload();
  await expect(page.getByText("CONTINUE · PROGRESS SAVED", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue session" })).toHaveCount(0);
  await expect.poll(() => readRecoveryState(page)).toMatchObject({
    checkpointStatus: null,
    sessionCompletions: 1,
    sessionInterruptions: 0,
  });
  expect(generationRequests).toBe(1);
});

test("a saved first-step recall round resumes at the next prompt without persisting draft text", async ({ page }) => {
  test.setTimeout(90_000);
  let generationRequests = 0;

  await page.route("**/api/sessions/generate", async (route) => {
    generationRequests += 1;
    const plannedMinutes = await page.evaluate(() => {
      const raw = window.localStorage.getItem("yova.preview.v1");
      if (!raw) return 25;
      const snapshot = JSON.parse(raw) as {
        plans?: Array<{ sessions?: Array<{ status?: string; estimatedMinutes?: number }> }>;
      };
      return snapshot.plans?.at(-1)?.sessions?.find((session) => session.status === "ready")
        ?.estimatedMinutes ?? 25;
    });
    const fixture = retrievalRoundResumeSessionResponse(
      plannedMinutes,
      requestedRouteRevisionId(route),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Practice recalling how osmosis moves water across a membrane.",
  );
  await page.getByRole("button", { name: "I understand the basics but need practice" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible({
    timeout: 15_000,
  });
  const studyPlan = await page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) throw new Error("Expected the Study Now plan before starting its recall round.");
    const snapshot = JSON.parse(raw) as { plans?: LearningPlan[] };
    const plan = snapshot.plans?.at(-1);
    const session = plan?.sessions?.find((candidate) => candidate.status === "ready");
    if (!plan || !session) throw new Error("Expected one ready Study Now session.");
    return plan;
  });
  const studySession = studyPlan.sessions.find((candidate) => candidate.status === "ready");
  if (!studySession) throw new Error("Expected one ready Study Now session.");
  const routeCreatedAt = studySession.studyRoute?.identity.createdAt ?? studyPlan.createdAt;
  studyPlan.learningIntent = "study";
  studySession.learningMode = "study";
  studySession.method = "Retrieval practice";
  studySession.methodReason = "An unsupported attempt reveals which osmosis relationships still need repair.";
  studySession.studyRoute = undefined;
  studySession.studyRoute = createCommittedInitialSessionStudyRoute({
    plan: studyPlan,
    session: studySession,
    now: routeCreatedAt,
    origin: {
      source: "e2e_retrieval_fixture",
      reason: "This recovery fixture starts from a coherent retrieval route.",
    },
  });
  await page.evaluate((updatedPlan) => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) throw new Error("Expected the Study Now plan before storing its retrieval route.");
    const snapshot = JSON.parse(raw) as { plans?: LearningPlan[] };
    const planIndex = snapshot.plans?.findIndex((candidate) => candidate.id === updatedPlan.id) ?? -1;
    if (!snapshot.plans || planIndex < 0) throw new Error("Expected the Study Now plan to remain stored.");
    snapshot.plans[planIndex] = updatedPlan;
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  }, studyPlan);
  await page.reload();
  await page.getByRole("button", { name: "Start session" }).click();
  await confirmSessionSetup(page);
  await expect(page.getByText("Close your osmosis notes before answering.", { exact: true })).toBeVisible();
  await expect(page.getByText("0 of 3 answered", { exact: true })).toBeVisible();
  const continueButton = page.locator(".session-action-bar").getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeDisabled();
  const draftMarker = "PRIVATE-OSMOSIS-DRAFT should not survive recovery";
  await page.getByPlaceholder("Write what you can recall. An incomplete answer is still useful.").fill(draftMarker);
  await page.getByRole("button", { name: "Check what I recalled" }).click();
  await page.getByRole("button", { name: /Partly Some of it came back/ }).click();

  await expect(page.getByText("1 of 3 answered", { exact: true })).toBeVisible();
  await expect(page.getByText("What determines the net direction of water movement?", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window.localStorage.getItem("yova.active-session-checkpoints.v1") ?? ""
  ))).toContain('"ratings":["partly"]');
  expect(await page.evaluate(() => JSON.stringify(
    Array.from({ length: window.localStorage.length }, (_, index) => {
      const key = window.localStorage.key(index) ?? "";
      return [key, window.localStorage.getItem(key)];
    }),
  ))).not.toContain(draftMarker);

  await page.getByRole("button", { name: "Exit" }).click();
  await page.getByRole("button", { name: "Save progress and leave" }).click();
  await expect.poll(() => page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as {
      sessionInterruptions?: Array<{
        completedSteps?: number;
        evidence?: { totalAnswers?: number };
        activityProgress?: { ratings?: string[] };
      }>;
    };
    return snapshot.sessionInterruptions?.at(-1) ?? null;
  })).toMatchObject({
    completedSteps: 0,
    evidence: { totalAnswers: 0 },
    activityProgress: { ratings: ["partly"] },
  });
  await expect.poll(() => page.evaluate(() => {
    const snapshotRaw = window.localStorage.getItem("yova.preview.v1");
    const checkpointsRaw = window.localStorage.getItem("yova.active-session-checkpoints.v1");
    if (!snapshotRaw || !checkpointsRaw) return null;
    const snapshot = JSON.parse(snapshotRaw) as {
      sessionInterruptions?: Array<{
        id?: string;
        planSessionId?: string;
        startedAt?: string;
        interruptedAt?: string;
      }>;
    };
    const interruption = snapshot.sessionInterruptions?.at(-1);
    const checkpoints = JSON.parse(checkpointsRaw) as Array<{
      runId?: string;
      planSessionId?: string;
      startedAt?: string;
      savedAt?: string;
      resourceFingerprint?: string;
    }>;
    const checkpoint = checkpoints.find((candidate) => (
      candidate.planSessionId === interruption?.planSessionId
    ));
    return {
      freshRun: Boolean(checkpoint?.runId && interruption?.id && checkpoint.runId !== interruption.id),
      sameSessionStart: checkpoint?.startedAt === interruption?.startedAt,
      savedAfterExit: Boolean(
        checkpoint?.savedAt
        && interruption?.interruptedAt
        && Date.parse(checkpoint.savedAt) > Date.parse(interruption.interruptedAt),
      ),
      fingerprinted: /^sr1:[0-9a-f]{16}$/.test(checkpoint?.resourceFingerprint ?? ""),
    };
  })).toEqual({
    freshRun: true,
    sameSessionStart: true,
    savedAfterExit: true,
    fingerprinted: true,
  });

  const hydratedPlan = await page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as { plans?: LearningPlan[] };
    return snapshot.plans?.at(-1) ?? null;
  });
  expect(hydratedPlan).not.toBeNull();
  const hydratedSession = hydratedPlan?.sessions.find((session) => session.status === "ready");
  expect(hydratedSession).toBeDefined();
  const cacheIssue = hydratedSessionResourceCacheIssue({
    plan: hydratedPlan!,
    session: hydratedSession!,
    adjustment: null,
  });
  expect(cacheIssue, JSON.stringify({
    planLearningIntent: hydratedPlan?.learningIntent,
    planArchitecture: hydratedPlan?.sessionArchitectureVersion,
    studyMode: hydratedPlan?.studyMode,
    plannedMode: hydratedSession?.learningMode,
    resourceSchema: hydratedSession?.resource?.schemaVersion,
    resourceMode: hydratedSession?.resource?.methodBriefing?.learningMode,
  })).toBeNull();

  await page.reload();
  await page.getByRole("button", { name: "Continue session" }).click();
  await expect(page.getByText("1 of 3 answered", { exact: true })).toBeVisible();
  await expect(page.getByText("What determines the net direction of water movement?", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Write what you can recall. An incomplete answer is still useful."))
    .toHaveValue("");
  expect(generationRequests).toBe(1);

  await page.getByPlaceholder("Write what you can recall. An incomplete answer is still useful.").fill(
    "Water moves toward the side with lower water potential.",
  );
  await page.getByRole("button", { name: "Check what I recalled" }).click();
  await page.getByRole("button", { name: /I had it Retrieved without help/ }).click();
  await page.getByPlaceholder("Write what you can recall. An incomplete answer is still useful.").fill(
    "The membrane lets water cross while restricting the dissolved solute.",
  );
  await page.getByRole("button", { name: "Check what I recalled" }).click();
  await page.getByRole("button", { name: /I had it Retrieved without help/ }).click();

  await expect(page.getByText("Why can water cross while the solute remains separated?", { exact: true })).toBeVisible();
  await expect(page.getByText("second pass", { exact: true })).toBeVisible();
  await expect(page.getByText(/3 of 3 answered/)).toBeVisible();
  await page.getByPlaceholder("Write what you can recall. An incomplete answer is still useful.").fill(
    "A selectively permeable membrane lets water cross while restricting the solute.",
  );
  await page.getByRole("button", { name: "Check what I recalled" }).click();
  await page.getByRole("button", { name: /I had it Retrieved without help/ }).click();

  await expect(page.getByText("RECALL ROUND COMPLETE", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.active-session-checkpoints.v1");
    if (!raw) return null;
    const checkpoint = (JSON.parse(raw) as Array<{
      completedSteps?: number;
      evidence?: { totalAnswers?: number };
      activityProgress?: { ratings?: string[] };
    }>).at(-1);
    return checkpoint ?? null;
  })).toMatchObject({
    completedSteps: 0,
    evidence: { totalAnswers: 0 },
    activityProgress: { ratings: ["partly", "got_it", "got_it", "got_it"] },
  });

  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page.getByRole("heading", { name: "Explain why retrieval comes first" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.active-session-checkpoints.v1");
    if (!raw) return null;
    const checkpoint = (JSON.parse(raw) as Array<{
      completedSteps?: number;
      evidence?: { totalAnswers?: number };
      activityProgress?: unknown;
    }>).at(-1);
    return checkpoint ? {
      completedSteps: checkpoint.completedSteps,
      totalAnswers: checkpoint.evidence?.totalAnswers,
      hasActivityProgress: "activityProgress" in checkpoint,
    } : null;
  })).toEqual({ completedSteps: 1, totalAnswers: 0, hasActivityProgress: false });
});

test("learner text fields keep long pastes visible and block submission until trimmed", async ({ page }) => {
  test.setTimeout(90_000);
  const longPaste = "x".repeat(800);

  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(streamedResumeSessionResponse(requestedRouteRevisionId(route))),
    });
  });
  await page.route("**/api/sessions/lesson", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        'data: {"type":"lesson.meta","requestId":"30000000-0000-4000-8000-000000000031","model":"test-model"}',
        "",
        'data: {"type":"lesson.delta","delta":"# Retrieval practice\\n\\nAttempt the answer before reviewing the explanation."}',
        "",
        'data: {"type":"lesson.complete","deliveryMode":"generated","elapsedMs":20,"latencyToFirstTokenMs":5,"inputTokens":20,"cachedInputTokens":0,"outputTokens":12,"wordCount":9,"model":"test-model"}',
        "",
        "",
      ].join("\n"),
    });
  });

  await createPreviewAccount(page);
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand retrieval practice and test the idea.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const sessionNote = page.getByLabel("Anything YOVA should account for?");
  await sessionNote.fill(longPaste);
  await expect(sessionNote).toHaveValue(longPaste);
  await expect(sessionNote).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#session-context-note-limit")).toContainText(
    "800/500 · 300 characters over the limit.",
  );
  await expect(page.getByRole("button", { name: "Prepare this session" })).toBeDisabled();

  await sessionNote.fill("");
  await page.getByRole("button", { name: "Prepare this session" }).click();
  await expect(page.getByRole("button", { name: "Change direction" })).toBeVisible();
  await page.getByRole("button", { name: "Change direction" }).click();

  const courseDirection = page.getByRole("dialog", { name: "Tell YOVA what is off track." })
    .getByLabel("What should be different?");
  await courseDirection.fill(longPaste);
  await expect(courseDirection).toHaveValue(longPaste);
  await expect(courseDirection).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#course-direction-limit")).toContainText(
    "800/500 · 300 characters over the limit.",
  );
  await expect(page.getByRole("button", { name: "Approve and rebuild" })).toBeDisabled();
  await page.getByRole("button", { name: "Keep this plan" }).click();

  await page.getByRole("button", { name: "Exit" }).click();
  await page.getByRole("button", { name: "Save progress and leave" }).click();
  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot after leaving the session.");
    const snapshot = JSON.parse(stored) as {
      plans: unknown[];
      updatedAt?: string;
    };
    const planId = "63000000-0000-4000-8000-000000000001";
    const sessionId = "63000000-0000-4000-8000-000000000002";
    const topicId = "63000000-0000-4000-8000-000000000003";
    const scheduledFor = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
    snapshot.plans.push({
      id: planId,
      learningItemId: "63000000-0000-4000-8000-000000000004",
      title: "Active plan adjustment fixture",
      topic: "Retrieval practice",
      kind: "topic",
      deadline: null,
      status: "active",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "study",
      creationIntent: "plan",
      sessionArchitectureVersion: "filled_teaching_v1",
      rationale: "Keep one active plan available for the adjustment control.",
      createdAt: new Date().toISOString(),
      materials: [],
      sessions: [{
        id: sessionId,
        sequence: 1,
        title: "Practice retrieval deliberately",
        objective: "Explain how retrieval practice exposes a learning gap.",
        method: "Retrieval practice",
        methodReason: "An unsupported attempt makes the current model visible.",
        scheduledFor,
        estimatedMinutes: 25,
        amountLabel: "25 minutes",
        learningMode: "study",
        topicIds: [topicId],
        contentTargets: ["Retrieval practice and answer review"],
        completionEvidence: ["Explain why the attempt comes before review"],
        status: "ready",
      }],
    });
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });
  await page.reload();
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await page.getByRole("button", { name: "Open goal" }).click();
  await page.getByRole("button", { name: "Adjust", exact: true }).click();

  const adjustmentPanel = page.locator(".plan-adjustment-panel");
  const planDirection = adjustmentPanel.getByLabel("What should be different?");
  await planDirection.fill(longPaste);
  await expect(planDirection).toHaveValue(longPaste);
  await expect(planDirection).toHaveAttribute("aria-invalid", "true");
  await expect(adjustmentPanel.locator("#plan-adjustment-direction-limit")).toContainText(
    "800/500 · 300 characters over the limit.",
  );
  await expect(adjustmentPanel.getByRole("button", { name: "Approve and rebuild plan" })).toBeDisabled();
});

test("Calendar rail and dense Week grid remain contained at a 375px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await createPreviewAccount(page);
  await completeOnboarding(page);
  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
    const snapshot = JSON.parse(stored) as {
      plans: unknown[];
      sessionCompletions: unknown[];
      updatedAt?: string;
    };
    const completedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1_000).toISOString();
    const startedAt = new Date(Date.parse(completedAt) - 20 * 60 * 1_000).toISOString();
    const planId = "61000000-0000-4000-8000-000000000001";
    const sessionId = "61000000-0000-4000-8000-000000000002";
    const topicId = "61000000-0000-4000-8000-000000000003";
    snapshot.plans.push({
      id: planId,
      learningItemId: "61000000-0000-4000-8000-000000000004",
      title: "Ocean circulation systems and climate interactions",
      topic: "Physical oceanography",
      kind: "topic",
      deadline: null,
      status: "completed",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "study",
      creationIntent: "plan",
      sessionArchitectureVersion: "filled_teaching_v1",
      rationale: "Use retrieval and application to check the model.",
      createdAt: startedAt,
      materials: [],
      sessions: [{
        id: sessionId,
        sequence: 1,
        title: "Retrieve the ocean-circulation model",
        objective: "Explain the relationship without support.",
        method: "Retrieval practice",
        methodReason: "Independent recall makes the current model visible.",
        scheduledFor: startedAt,
        estimatedMinutes: 20,
        amountLabel: "20 minutes",
        learningMode: "study",
        topicIds: [topicId],
        contentTargets: ["Photosynthetic electron transport chain redox carrier relationships"],
        completionEvidence: ["Explain the full relationship independently"],
        status: "complete",
      }],
    });
    snapshot.sessionCompletions.push({
      id: "61000000-0000-4000-8000-000000000005",
      planId,
      planSessionId: sessionId,
      startedAt,
      completedAt,
      plannedMinutes: 20,
      actualMinutes: 20,
      correctAnswers: 0,
      totalAnswers: 1,
      feedback: "about_right",
      observedGap: "Photosynthetic electron transport chain redox carrier relationships",
      completionMode: "guided",
      conceptEvidence: [{
        topicId,
        concept: "Photosynthetic electron transport chain redox carrier relationships",
        outcome: "needs_review",
        activityType: "free_response",
      }],
      confidenceEvidence: [],
    });
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });
  await page.reload();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();

  const geometry = await page.locator(".calendar-workspace").evaluate((workspace) => {
    const rail = workspace.querySelector<HTMLElement>(".calendar-rail");
    const main = workspace.querySelector<HTMLElement>(".calendar-main");
    if (!rail || !main) return null;
    const railRect = rail.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    return {
      bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      workspaceFits: workspace.scrollWidth <= workspace.clientWidth + 1,
      railFits: rail.scrollWidth <= rail.clientWidth + 1,
      railBeforeMain: railRect.top <= mainRect.top && railRect.bottom <= mainRect.top + 2,
    };
  });

  expect(geometry).toEqual({
    bodyFits: true,
    workspaceFits: true,
    railFits: true,
    railBeforeMain: true,
  });
  await expect(page.locator(".calendar-week")).toHaveCSS("overflow-x", "auto");
});

test("spent guided-session allowance is visible before Home or Calendar opens setup", async ({ page }) => {
  const resetAt = "2026-08-20T00:00:00.000Z";
  let allowanceExhausted = false;
  await page.route("**/api/sessions/allowance", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: allowanceExhausted ? { "Retry-After": "7200" } : {},
      body: JSON.stringify(allowanceExhausted
        ? {
          status: "exhausted",
          remainingToday: 0,
          retryAfterSeconds: 7_200,
          resetAt,
        }
        : {
          status: "available",
          remainingToday: 3,
          retryAfterSeconds: 0,
          resetAt: null,
        }),
    });
  });

  await createPreviewAccount(page);
  const initialAllowanceResponse = page.waitForResponse((response) => (
    response.url().includes("/api/sessions/allowance")
  ));
  await completeOnboarding(page);
  await initialAllowanceResponse;
  await expect(page.getByRole("button", { name: "Study now Quick, off-plan" })).toBeEnabled();
  await expect(page.getByLabel("Guided-session allowance")).toHaveCount(0);

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByLabel("Guided-session allowance")).toHaveCount(0);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Review how plate boundaries shape ocean basins.",
  );
  await page.getByRole("button", { name: "I understand the basics but need practice" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await page.getByRole("button", { name: "Not now", exact: true }).click();

  allowanceExhausted = true;
  await page.reload();

  const homeAllowance = page.locator(".guided-session-allowance-notice.home");
  await expect(homeAllowance).toContainText("Daily guided-session allowance used");
  await expect(homeAllowance.locator("time")).toHaveAttribute("datetime", resetAt);
  await expect(homeAllowance).toContainText("continue a session that was already saved");
  await expect(page.getByRole("button", { name: "Allowance used today" }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "Study now Quick, off-plan" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).not.toBeVisible();

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const agendaAllowance = page.locator(".guided-session-allowance-notice.agenda");
  await expect(agendaAllowance).toContainText("Daily guided-session allowance used");
  await expect(agendaAllowance.locator("time")).toHaveAttribute("datetime", resetAt);
  const blockedAgendaStarts = page.getByRole("button", { name: "Allowance used today" });
  await expect(blockedAgendaStarts.first()).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).not.toBeVisible();
});

test("spent allowance still permits a saved session to continue", async ({ page }) => {
  const resetAt = "2026-08-20T00:00:00.000Z";
  let allowanceExhausted = false;
  let generationRequests = 0;
  await page.route("**/api/sessions/allowance", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: allowanceExhausted ? { "Retry-After": "7200" } : {},
      body: JSON.stringify(allowanceExhausted
        ? {
          status: "exhausted",
          remainingToday: 0,
          retryAfterSeconds: 7_200,
          resetAt,
        }
        : {
          status: "available",
          remainingToday: 2,
          retryAfterSeconds: 0,
          resetAt: null,
        }),
    });
  });
  await page.route("**/api/sessions/generate", async (route) => {
    generationRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(streamedResumeSessionResponse(requestedRouteRevisionId(route))),
    });
  });

  await createPreviewAccount(page);
  await completeOnboarding(page);
  await createOneOffLearningSession(
    page,
    "Practice explaining how thermohaline circulation moves water through the oceans.",
    "study",
  );
  await expect(page.getByRole("button", { name: "Exit" })).toBeVisible();
  await exitSessionWithoutProgress(page);

  allowanceExhausted = true;
  await page.reload();

  await expect(page.locator(".guided-session-allowance-notice.home")).toContainText(
    "Daily guided-session allowance used",
  );
  await expect(recommendedLearningPlan(page).getByRole("button", { name: "Continue session" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Study now Quick, off-plan" })).toBeDisabled();

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.locator(".guided-session-allowance-notice.agenda")).toContainText(
    "Daily guided-session allowance used",
  );
  await expect(page.locator(".calendar-your-day").getByRole("button", { name: "Continue" })).toBeEnabled();

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await recommendedLearningPlan(page).getByRole("button", { name: "Continue session" }).click();
  await expect(page.getByRole("button", { name: "Change direction" })).toBeVisible();
  await expect(page.getByText("Your session was recovered.")).toBeVisible();
  expect(generationRequests).toBe(1);
});

test("the product shell keeps every core destination and creation path usable", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Learner$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Turn any goal into a clear next step." })).toBeVisible();
  await expectNoHorizontalOverflow(page, ".home-page");

  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What you’re working toward" })).toBeVisible();
  await expectNoHorizontalOverflow(page, ".page");

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();
  await expectNoHorizontalOverflow(page, ".page");

  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Get help in context" })).toBeVisible();
  await expectNoHorizontalOverflow(page, ".page");
  await expect(page.getByRole("combobox", { name: "Ask YOVA context" })).toHaveValue("general");
  await expect(page.getByText("No learning goal attached")).toBeVisible();
  await page.getByRole("button", { name: /^History/ }).click();
  await expect(page.getByRole("dialog", { name: "Previous chats" })).toBeVisible();
  await page.getByRole("button", { name: "Close conversation history" }).last().click();
  await page.getByRole("textbox", { name: "Ask YOVA" }).fill("An unsent draft");

  await page.getByRole("button", { name: "You", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your learning, in one place" })).toBeVisible();
  await expectNoHorizontalOverflow(page, ".page");
  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Ask YOVA context" })).toHaveValue("general");
  await expect(page.getByRole("textbox", { name: "Ask YOVA" })).toHaveValue("");
  await page.getByRole("button", { name: "You", exact: true }).click();

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Build my first plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What do you need to learn or prepare for?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.locator(".calendar-page-header").getByRole("button", { name: "Add to YOVA", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What do you need to learn, prepare for, or complete?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "What do you want help with?" })).toBeVisible();
});

test("Ask YOVA turns structured explanations and math into readable interface content", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.route("**/api/tutor", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const threadId = "10000000-0000-4000-8000-000000000001";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        threadId,
        messages: [
          {
            id: "10000000-0000-4000-8000-000000000002",
            threadId,
            role: "user",
            content: "Explain the derivative at x equals 2.",
            createdAt: "2026-08-06T20:00:00.000Z",
          },
          {
            id: "10000000-0000-4000-8000-000000000003",
            threadId,
            role: "assistant",
            content: "**Core idea:** the derivative is the instantaneous rate of change.\n\nUse $f'(2)=4$.\n\n1. Compare nearby points.\n2. Shrink the interval.",
            createdAt: "2026-08-06T20:00:01.000Z",
          },
        ],
        model: "test-model",
        persistence: "browser",
        proposedAction: null,
      }),
    });
  });

  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  await page.getByRole("textbox", { name: "Ask YOVA" }).fill("Explain the derivative at x equals 2.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.locator(".tutor-rich-text strong")).toHaveText("Core idea:");
  await expect(page.locator(".tutor-rich-text .katex")).toBeVisible();
  await expect(page.locator(".tutor-rich-text li")).toHaveCount(2);
  await expect(page.locator(".tutor-rich-text")).not.toContainText("**");
});

test("the session tutor stays anchored to the exact learning activity", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  let capturedRequest: { sessionContext?: Record<string, unknown> } = {};
  await page.route("**/api/tutor", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    capturedRequest = route.request().postDataJSON() as { sessionContext?: Record<string, unknown> };
    const threadId = "20000000-0000-4000-8000-000000000001";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        threadId,
        messages: [
          {
            id: "20000000-0000-4000-8000-000000000002",
            threadId,
            role: "user",
            content: "Show me one concrete example of the idea in this step.",
            createdAt: "2026-08-06T21:00:00.000Z",
          },
          {
            id: "20000000-0000-4000-8000-000000000003",
            threadId,
            role: "assistant",
            content: "**Example:** if $100$ grows by $10$, the new base is $110$. The next percentage gain uses that larger base.",
            createdAt: "2026-08-06T21:00:01.000Z",
          },
        ],
        model: "test-model",
        persistence: "browser",
        proposedAction: null,
      }),
    });
  });

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand compound growth and personal finance basics.",
  );
  await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);

  await expect(page.getByRole("heading", { name: "Use money concepts as decision tools" })).toBeVisible();
  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explain it differently" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show an example" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check my understanding" })).toBeVisible();
  await page.getByRole("button", { name: "Show an example" }).click();

  await expect(page.locator(".session-tutor-assistant .tutor-rich-text strong")).toHaveText("Example:");
  await expect(page.locator(".session-tutor-assistant .katex").first()).toBeVisible();
  await expect(page.locator(".session-tutor-response")).not.toContainText("**");
  await expect(page.getByText("YOVA sees the step and result, but not your typed free response.")).toBeVisible();

  const sessionContext = capturedRequest.sessionContext ?? {};
  expect(sessionContext.activityTitle).toBe("Use money concepts as decision tools");
  expect(sessionContext.activityType).toBe("instruction");
  expect(sessionContext.helpIntent).toBe("show_example");
  expect(sessionContext.answerState).toBe("not_attempted");
  expect(sessionContext.selectedChoice).toBeNull();
  expect(String(sessionContext.teachingSummary)).toContain("budget");
});

test("a planning request outage still produces a reviewable plan from YOVA's saved inputs", async ({ page }) => {
  await page.route("**/api/plans/generate", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary planning service failure." }),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await beginPlanFromAdd(page, "I have a biology test in two weeks on cellular respiration.");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Generate my plan" }).click();

  await expect(page.getByText("Plan ready")).toBeVisible({ timeout: 30_000 });
  const livePlanningIssue = page.locator(".generation-notice[role='alert']");
  await expect(livePlanningIssue).toContainText("Live AI planning failed");
  await expect(livePlanningIssue.getByRole("button", { name: "Retry live planning" })).toBeVisible();
  await expect(livePlanningIssue).not.toContainText("reliable planning engine");
  await expect(page.getByRole("heading", { name: "Your information is safe." })).not.toBeVisible();
});

test("legacy split work reopens as an active plan with runnable ten-minute sessions", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
    const snapshot = JSON.parse(stored) as Record<string, unknown> & { plans: unknown[] };
    const topicId = "65000000-0000-4000-8000-000000000003";
    snapshot.plans = [{
      id: "65000000-0000-4000-8000-000000000001",
      learningItemId: "65000000-0000-4000-8000-000000000002",
      title: "Plate Tectonics and Mantle Convection",
      topic: "How mantle convection contributes to plate motion",
      kind: "topic",
      deadline: null,
      // Old split/start races could leave this lifecycle value behind even
      // though both generated parts were still runnable.
      status: "completed",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "study",
      creationIntent: "plan",
      sessionArchitectureVersion: "filled_teaching_v1",
      rationale: "Recover the unfinished explanation and application work without losing either part.",
      createdAt: "2026-08-20T12:00:00.000Z",
      materials: [],
      sessions: [{
        id: "65000000-0000-4000-8000-000000000011",
        sequence: 1,
        title: "Explain mantle convection · Part 1 of 2",
        objective: "Explain how temperature and density differences drive mantle convection.",
        method: "Self-explanation",
        methodReason: "A causal explanation makes the plate-motion model visible.",
        scheduledFor: "2030-06-01T15:00:00.000Z",
        estimatedMinutes: 8,
        amountLabel: "One focused target · about 8 min",
        learningMode: "study",
        topicIds: [topicId],
        contentTargets: ["Temperature, density, and mantle circulation"],
        completionEvidence: ["Explain the convection relationship in your own words"],
        originSessionId: "65000000-0000-4000-8000-000000000010",
        originalContentMinutes: 15,
        segmentIndex: 1,
        segmentCount: 2,
        status: "ready",
      }, {
        id: "65000000-0000-4000-8000-000000000012",
        sequence: 2,
        title: "Explain mantle convection · Part 2 of 2",
        objective: "Apply the convection model to divergent and convergent plate boundaries.",
        method: "Scenario application",
        methodReason: "A new boundary scenario checks whether the causal model transfers.",
        scheduledFor: "2030-06-02T15:00:00.000Z",
        estimatedMinutes: 7,
        amountLabel: "One focused target · about 7 min",
        learningMode: "study",
        topicIds: [topicId],
        contentTargets: ["Mantle convection and plate-boundary motion"],
        completionEvidence: ["Apply the model to one unfamiliar plate-boundary scenario"],
        originSessionId: "65000000-0000-4000-8000-000000000010",
        originalContentMinutes: 15,
        segmentIndex: 2,
        segmentCount: 2,
        status: "upcoming",
      }],
    }];
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });

  await page.reload();
  await page.getByRole("button", { name: "Learning", exact: true }).click();

  const recoveredPlan = page.locator(".learning-goal-card").filter({
    hasText: "Plate Tectonics and Mantle Convection",
  });
  await expect(recoveredPlan).toBeVisible();
  await expect(recoveredPlan).toContainText("0 of 2 sessions complete");
  await expect(recoveredPlan).toContainText("10 min");
  await expect(recoveredPlan.getByRole("button", { name: "Start next" })).toBeVisible();
  await expect(page.locator(".tabs").getByRole("button", { name: /Active/ })).toContainText("1");
  await expect(page.locator(".tabs").getByRole("button", { name: /Recent/ })).toContainText("0");

  await expect.poll(() => page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) return null;
    const snapshot = JSON.parse(stored) as {
      plans?: Array<{
        title?: string;
        status?: string;
        sessions?: Array<{ estimatedMinutes?: number; amountLabel?: string }>;
      }>;
    };
    const plan = snapshot.plans?.find((candidate) => candidate.title === "Plate Tectonics and Mantle Convection");
    return plan ? {
      status: plan.status,
      minutes: plan.sessions?.map((session) => session.estimatedMinutes),
      labels: plan.sessions?.map((session) => session.amountLabel),
    } : null;
  })).toEqual({
    status: "active",
    minutes: [10, 10],
    labels: [
      "One focused target · about 10 min",
      "One focused target · about 10 min",
    ],
  });

  await recoveredPlan.getByRole("button", { name: "Start next" }).click();
  const earlyStartDialog = page.getByRole("dialog", {
    name: "Start Explain mantle convection · Part 1 of 2 now?",
  });
  if (await earlyStartDialog.isVisible()) {
    await earlyStartDialog.getByRole("button", { name: "Start now, keep dates" }).click();
  }
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await expect(page.locator(".session-current-assumption")).toContainText("about 10 minutes");
  await expect(page.locator(".session-current-assumption")).not.toContainText("about 8 minutes");
});

test("finishing a shortened guided lesson keeps every deferred target as exact next work", async ({ page }) => {
  test.setTimeout(60_000);
  const planId = "67000000-0000-4000-8000-000000000001";
  const planSessionId = "67000000-0000-4000-8000-000000000011";
  const topicIds = [
    "67000000-0000-4000-8000-000000000021",
    "67000000-0000-4000-8000-000000000022",
  ];
  const targets = [
    "Glycolysis inputs and outputs",
    "Electron transport chain mechanism",
  ];
  const evidence = [
    "Explain glycolysis inputs and outputs independently",
    "Explain the electron transport chain mechanism independently",
  ];
  await page.route("**/api/sessions/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(deferredGuidedSessionResponse(planSessionId, topicIds[0]!, targets, evidence)),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.evaluate(({ planId: seededPlanId, planSessionId: seededSessionId, seededTopicIds, seededTargets, seededEvidence }) => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
    const snapshot = JSON.parse(stored) as Record<string, unknown> & { plans: unknown[] };
    snapshot.plans = [{
      id: seededPlanId,
      learningItemId: "67000000-0000-4000-8000-000000000002",
      title: "Cellular Respiration Continuation",
      topic: "Stages, locations, and outputs of cellular respiration",
      kind: "topic",
      deadline: "2030-06-02T18:00:00.000Z",
      status: "active",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "study",
      creationIntent: "plan",
      sessionArchitectureVersion: "filled_teaching_v1",
      rationale: "Use a bounded retrieval attempt while preserving every later target.",
      createdAt: "2026-08-21T12:00:00.000Z",
      materials: [],
      sessions: [{
        id: seededSessionId,
        sequence: 1,
        title: "Retrieve cellular respiration stages",
        objective: "Retrieve the stages, locations, and outputs of cellular respiration.",
        method: "Retrieval practice",
        methodReason: "Attempt the current relationship before reviewing and repairing it.",
        scheduledFor: "2030-06-01T15:00:00.000Z",
        estimatedMinutes: 20,
        amountLabel: "Two focused targets · about 20 min",
        learningMode: "study",
        topicIds: seededTopicIds,
        contentTargets: seededTargets,
        completionEvidence: seededEvidence,
        status: "ready",
      }],
    }];
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  }, { planId, planSessionId, seededTopicIds: topicIds, seededTargets: targets, seededEvidence: evidence });

  await page.reload();
  await expect(page.getByRole("button", { name: "Start session", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  const planCard = page.locator(".learning-goal-card").filter({
    hasText: "Cellular Respiration Continuation",
  });
  await planCard.getByRole("button", { name: "Start next" }).click();
  const earlyStartDialog = page.getByRole("dialog", {
    name: "Start Retrieve cellular respiration stages now?",
  });
  if (await earlyStartDialog.isVisible()) {
    await earlyStartDialog.getByRole("button", { name: "Start now, keep dates" }).click();
  }
  await confirmSessionSetup(page);

  await expect(page.getByRole("heading", { name: "Recall glycolysis" })).toBeVisible();
  await page.getByRole("button", { name: "Somewhat sure" }).click();
  await page.getByRole("button", { name: "Glucose becomes pyruvate in the cytosol" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Repair the glycolysis model" })).toBeVisible();
  await page.getByRole("button", { name: "Connect glucose conversion to pyruvate and ATP production" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Name what should return" })).toBeVisible();
  await page.getByRole("button", { name: "Finish this content" }).click();
  await expect(page.getByText("SESSION COMPLETE", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finish and continue" }).click();

  await expect.poll(() => page.evaluate((seededPlanId) => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) return null;
    const snapshot = JSON.parse(stored) as {
      plans?: Array<{
        id?: string;
        status?: string;
        sessions?: Array<{
          id?: string;
          sequence?: number;
          status?: string;
          scheduledFor?: string;
          topicIds?: string[];
          contentTargets?: string[];
          completionEvidence?: string[];
        }>;
      }>;
    };
    const plan = snapshot.plans?.find((candidate) => candidate.id === seededPlanId);
    return plan ? {
      status: plan.status,
      sessions: plan.sessions?.map((session) => ({
        id: session.id,
        sequence: session.sequence,
        status: session.status,
        scheduledFor: session.scheduledFor,
        topicIds: session.topicIds,
        contentTargets: session.contentTargets,
        completionEvidence: session.completionEvidence,
      })),
    } : null;
  }, planId)).toMatchObject({
    status: "active",
    sessions: [{
      id: planSessionId,
      sequence: 1,
      status: "complete",
      scheduledFor: "2030-06-01T15:00:00.000Z",
    }, {
      sequence: 2,
      status: "ready",
      topicIds,
      contentTargets: [targets[1]],
      completionEvidence: [
        `Explain or apply this remaining saved target independently: ${targets[1]}`,
      ],
    }],
  });
});

test("adjusting ordinary future work preserves the exact scheduled review contract", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
    const snapshot = JSON.parse(stored) as Record<string, unknown> & { plans: unknown[] };
    const topicId = "66000000-0000-4000-8000-000000000003";
    snapshot.plans = [{
      id: "66000000-0000-4000-8000-000000000001",
      learningItemId: "66000000-0000-4000-8000-000000000002",
      title: "Plate Boundary Evidence Plan",
      topic: "Use geological evidence to explain plate-boundary motion",
      kind: "topic",
      deadline: null,
      status: "active",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "study",
      creationIntent: "plan",
      sessionArchitectureVersion: "filled_teaching_v1",
      rationale: "Keep the delayed evidence check exact while resizing later content practice.",
      createdAt: "2026-08-20T12:00:00.000Z",
      materials: [],
      sessions: [{
        id: "66000000-0000-4000-8000-000000000011",
        sequence: 1,
        title: "Verify the mantle-convection relationship",
        objective: "Verify the relationship after a delay without reopening the earlier lesson.",
        method: "Three-item closed-note review",
        methodReason: "A delayed closed-note check tests whether the repaired relationship now holds.",
        scheduledFor: "2030-06-03T15:00:00.000Z",
        estimatedMinutes: 5,
        amountLabel: "3 quick questions · about 5 min",
        learningMode: "study",
        topicIds: [topicId],
        contentTargets: ["Mantle convection and plate motion"],
        completionEvidence: ["Answer exactly 3 closed-note questions about the relationship"],
        status: "ready",
        reviewConcept: "Mantle convection and plate motion",
        reviewType: "verify",
      }, {
        id: "66000000-0000-4000-8000-000000000012",
        sequence: 2,
        title: "Apply evidence at contrasting plate boundaries",
        objective: "Compare geological evidence from two contrasting plate-boundary settings.",
        method: "Case comparison",
        methodReason: "Contrasting cases make the transferable evidence rules explicit.",
        scheduledFor: "2030-06-04T15:00:00.000Z",
        estimatedMinutes: 25,
        amountLabel: "Two boundary cases + evidence check · about 25 min",
        learningMode: "study",
        topicIds: [topicId],
        contentTargets: ["Evidence at convergent boundaries", "Evidence at divergent boundaries"],
        completionEvidence: ["Compare the evidence and explain what each case supports"],
        status: "upcoming",
      }],
    }];
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });

  await page.reload();
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  const planCard = page.locator(".learning-goal-card").filter({ hasText: "Plate Boundary Evidence Plan" });
  await planCard.getByRole("button", { name: "Open goal" }).click();
  await page.getByRole("button", { name: "Adjust", exact: true }).click();

  const adjustmentPanel = page.locator(".plan-adjustment-panel");
  const futureWindow = adjustmentPanel.getByRole("combobox", { name: "Future session window" });
  // The first runnable row is a five-minute scheduled review. The adjustment
  // control must take its default from ordinary content, not that review.
  await expect(futureWindow).toHaveValue("25");
  await expect(adjustmentPanel).toContainText(
    "1 scheduled review keeps the original duration, concept, and return time.",
  );
  await futureWindow.selectOption("15");
  await adjustmentPanel.getByRole("button", { name: "Approve and rebuild plan" }).click();

  await expect(adjustmentPanel).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) return null;
    const snapshot = JSON.parse(stored) as {
      plans?: Array<{
        title?: string;
        sessions?: Array<Record<string, unknown>>;
      }>;
    };
    const sessions = snapshot.plans?.find((plan) => plan.title === "Plate Boundary Evidence Plan")?.sessions ?? [];
    const review = sessions.find((session) => session.id === "66000000-0000-4000-8000-000000000011");
    const ordinary = sessions.filter((session) => session.id !== "66000000-0000-4000-8000-000000000011");
    return review ? {
      review: {
        id: review.id,
        sequence: review.sequence,
        title: review.title,
        objective: review.objective,
        method: review.method,
        methodReason: review.methodReason,
        scheduledFor: review.scheduledFor,
        estimatedMinutes: review.estimatedMinutes,
        amountLabel: review.amountLabel,
        learningMode: review.learningMode,
        topicIds: review.topicIds,
        contentTargets: review.contentTargets,
        completionEvidence: review.completionEvidence,
        status: review.status,
        reviewConcept: review.reviewConcept,
        reviewType: review.reviewType,
      },
      ordinary: ordinary.map((session) => ({
        sequence: session.sequence,
        estimatedMinutes: session.estimatedMinutes,
        status: session.status,
        originSessionId: session.originSessionId,
      })),
    } : null;
  })).toEqual({
    review: {
      id: "66000000-0000-4000-8000-000000000011",
      sequence: 1,
      title: "Verify the mantle-convection relationship",
      objective: "Verify the relationship after a delay without reopening the earlier lesson.",
      method: "Three-item closed-note review",
      methodReason: "A delayed closed-note check tests whether the repaired relationship now holds.",
      scheduledFor: "2030-06-03T15:00:00.000Z",
      estimatedMinutes: 5,
      amountLabel: "3 quick questions · about 5 min",
      learningMode: "study",
      topicIds: ["66000000-0000-4000-8000-000000000003"],
      contentTargets: ["Mantle convection and plate motion"],
      completionEvidence: ["Answer exactly 3 closed-note questions about the relationship"],
      status: "ready",
      reviewConcept: "Mantle convection and plate motion",
      reviewType: "verify",
    },
    ordinary: [{
      sequence: 2,
      estimatedMinutes: 15,
      status: "upcoming",
      originSessionId: "66000000-0000-4000-8000-000000000012",
    }, {
      sequence: 3,
      estimatedMinutes: 15,
      status: "upcoming",
      originSessionId: "66000000-0000-4000-8000-000000000012",
    }],
  });

  const timeline = page.locator(".plan-timeline");
  await expect(timeline).toContainText("Verify the mantle-convection relationship");
  await expect(timeline.locator(".timeline-row").filter({ hasText: "Verify the mantle-convection relationship" }))
    .toContainText("5 min");
  await expect(timeline.locator(".timeline-row").filter({ hasText: "Apply evidence at contrasting plate boundaries" }))
    .toHaveCount(2);
});

test("scheduled-review setup stays fixed and opens the exact active or Study Now goal", async ({ page }) => {
  const generationRequests: Array<Record<string, unknown>> = [];
  await page.route("**/api/sessions/allowance", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "available",
        remainingToday: 3,
        retryAfterSeconds: 0,
        resetAt: null,
      }),
    });
  });
  await page.route("**/api/sessions/generate", async (route) => {
    generationRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(scheduledReviewSessionResponse()),
    });
  });
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
    const snapshot = JSON.parse(stored) as Record<string, unknown> & { plans: unknown[] };
    const scheduledReview = ({
      id,
      title,
      concept,
      includeExactArrays,
    }: {
      id: string;
      title: string;
      concept: string;
      includeExactArrays: boolean;
    }) => ({
      id,
      sequence: 1,
      title,
      objective: `Retrieve ${concept} after a delay without reopening the earlier lesson.`,
      method: "Independent retrieval verification",
      methodReason: "A delayed check tests whether the relationship remains available.",
      scheduledFor: "2026-08-20T12:00:00.000Z",
      estimatedMinutes: 10,
      amountLabel: "Required guided verification · about 10 min",
      learningMode: "study",
      topicIds: includeExactArrays ? [`${id.slice(0, -1)}9`] : [],
      contentTargets: includeExactArrays ? [concept] : [],
      completionEvidence: includeExactArrays ? [`Answer exactly three questions about ${concept}`] : [],
      status: "ready",
      reviewConcept: concept,
      reviewType: "verify",
    });
    snapshot.plans = [{
      id: "67000000-0000-4000-8000-000000000001",
      learningItemId: "67000000-0000-4000-8000-000000000002",
      title: "Active Plate Motion Goal",
      topic: "Mantle convection and plate motion",
      kind: "topic",
      deadline: null,
      status: "active",
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "study",
      creationIntent: "plan",
      sessionArchitectureVersion: "filled_teaching_v1",
      rationale: "Use a delayed return to check the relationship without reteaching first.",
      createdAt: "2026-08-20T10:00:00.000Z",
      materials: [],
      sessions: [scheduledReview({
        id: "67000000-0000-4000-8000-000000000011",
        title: "Verify mantle convection",
        concept: "Mantle convection and plate motion",
        includeExactArrays: true,
      })],
    }, {
      id: "68000000-0000-4000-8000-000000000001",
      learningItemId: "68000000-0000-4000-8000-000000000002",
      title: "Study Now Osmosis Practice",
      topic: "Osmosis and water potential",
      kind: "topic",
      deadline: null,
      status: "active",
      sourceMode: "user_materials",
      studyMode: "outside_yova",
      learningIntent: "study",
      creationIntent: "study_now",
      sessionArchitectureVersion: "filled_teaching_v1",
      rationale: "Use a delayed return to check the relationship without reteaching first.",
      createdAt: "2026-08-20T11:00:00.000Z",
      materials: [{
        id: "68000000-0000-4000-8000-000000000003",
        name: "osmosis-notes.txt",
        mimeType: "text/plain",
        sizeBytes: 148,
        textContent: "Water crosses a selectively permeable membrane toward the side with lower water potential.",
        processingStatus: "ready",
      }],
      sessions: [scheduledReview({
        id: "68000000-0000-4000-8000-000000000011",
        title: "Verify osmosis and water potential",
        concept: "Osmosis and water potential",
        // Production still contains a legacy reviewConcept-only row. Setup and
        // preview generation must keep that row usable without inventing an
        // adjustment or requiring newly persisted arrays.
        includeExactArrays: false,
      }), {
        id: "68000000-0000-4000-8000-000000000012",
        sequence: 2,
        title: "Reconnect the idea with a trusted source",
        objective: "Review the trusted source, then explain the relationship independently.",
        method: "Read, recall, review",
        methodReason: "Ordinary unfinished work can provide teaching without changing the scheduled check.",
        scheduledFor: "2026-08-21T12:00:00.000Z",
        estimatedMinutes: 15,
        amountLabel: "One source review and one independent explanation",
        learningMode: "learn",
        topicIds: ["68000000-0000-4000-8000-000000000019"],
        contentTargets: ["Osmosis and water potential"],
        completionEvidence: ["Explain the relationship without reopening the source"],
        status: "upcoming",
      }],
    }];
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });

  const allowanceResponse = page.waitForResponse((response) => (
    response.url().includes("/api/sessions/allowance")
  ));
  await page.reload();
  await allowanceResponse;
  await expect(page.getByRole("button", { name: "Study now Quick, off-plan" })).toBeEnabled();
  await expect(page.getByLabel("Guided-session allowance")).toHaveCount(0);
  await page.getByRole("button", { name: "Learning", exact: true }).click();

  const activeCard = page.locator(".learning-goal-card").filter({ hasText: "Active Plate Motion Goal" });
  await activeCard.getByRole("button", { name: "Start next" }).click();
  await expect(page.getByRole("heading", { name: "Confirm this quick verification." })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Open the goal instead" }).click();
  await expect(page.locator(".tabs").getByRole("button", { name: /^Active/ })).toHaveClass(/active/);
  await expect(page.getByRole("heading", { name: "Active Plate Motion Goal" })).toBeVisible();

  await page.locator(".tabs").getByRole("button", { name: /^Recent/ }).click();
  const studyNowCard = page.locator(".learning-goal-card").filter({ hasText: "Study Now Osmosis Practice" });
  await studyNowCard.getByRole("button", { name: "Open goal" }).click();
  await page.getByRole("button", { name: "Start next session" }).click();
  await expect(page.getByText("Exactly 3 multiple-choice questions", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "This return check has a fixed starting point." })).toBeVisible();
  await expect(page.getByRole("button", { name: "I need this taught first" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Support for this session" })).toHaveCount(0);
  await expect(page.getByLabel("Time available right now")).toHaveCount(0);
  await expect(page.getByLabel("Anything YOVA should account for?")).toHaveCount(0);
  await page.getByRole("button", { name: "Open the goal instead" }).click();
  await expect(page.locator(".tabs").getByRole("button", { name: /^Recent/ })).toHaveClass(/active/);
  await expect(page.getByRole("heading", { name: "Study Now Osmosis Practice" })).toBeVisible();
  await expect(page.getByLabel("Add source materials")).toBeVisible();
  await expect(page.getByText("osmosis-notes.txt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Change the plan without losing progress" })).toBeVisible();
  await expect(page.getByText("1 scheduled review keeps the original duration, concept, and return time.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Start next session" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Prepare scheduled review" }).click();
  await expect.poll(() => generationRequests.length).toBe(1);
  await expect(page.locator(".session-activity-header").getByRole("heading", { name: "What drives net water movement?" })).toBeVisible();
  await expect(page.locator(".session-step-meta")).toContainText("STEP 1 OF 3");
  await expect(page.getByLabel("Study-method workpad")).toHaveCount(0);
  await expect(page.getByLabel("Guided teaching sequence")).toHaveCount(0);
  await expect(page.getByLabel("Live YOVA lesson")).toHaveCount(0);
  await openMobileSessionGuide(page);
  await expect(page.getByLabel("Scheduled review learning support locked").filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask YOVA is locked during this scheduled review" })).toBeDisabled();
  await expect(page.getByLabel("Quick help options")).toHaveCount(0);
  await expect(page.getByText("Water moves from higher water potential toward lower water potential.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Water crosses a selectively permeable membrane toward the side with lower water potential.", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "The water-potential difference", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Water", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Movement continues both ways with no net change", exact: true }).click();

  await expect(page.getByRole("button", { name: "Ask YOVA", exact: true })).toBeVisible();
  await openMobileSessionGuide(page);
  await page.getByText("Content and sources", { exact: true }).filter({ visible: true }).click();
  await expect(page.getByLabel("Session source coverage").filter({ visible: true })).toContainText("osmosis-notes.txt");
  await page.getByText("See what YOVA used", { exact: true }).filter({ visible: true }).click();
  await expect(page.getByLabel("Session source coverage").filter({ visible: true })).toContainText("Water crosses a selectively permeable membrane toward the side with lower water potential.");
  expect(generationRequests[0]).not.toHaveProperty("sessionAdjustment");
  expect(generationRequests[0]).toMatchObject({
    planId: "68000000-0000-4000-8000-000000000001",
    planSessionId: "68000000-0000-4000-8000-000000000011",
    previewContext: {
      session: {
        learningMode: "study",
        reviewConcept: "Osmosis and water potential",
        reviewType: "verify",
      },
    },
  });
});

test("a normal conceptual plan visibly moves from Learn to later Practice and commits both route modes", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await beginPlanFromAdd(page, "Build me a plan to understand cellular respiration from scratch.");
  await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  await page.getByRole("button", { name: "45 minutes", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await expect(page.getByText("Plan ready")).toBeVisible({ timeout: 30_000 });

  const visibleDraftRoutes = await page.locator(".generated-timeline article").evaluateAll((articles) => (
    articles.map((article) => ({
      title: article.querySelector("h3")?.textContent?.trim() ?? "",
      modeLabel: article.querySelector("small")?.textContent?.trim() ?? "",
    }))
  ));
  const visibleLearnIndex = visibleDraftRoutes.findIndex((session) => (
    session.modeLabel.startsWith("TEACHING FIRST")
  ));
  const visiblePracticeIndex = visibleDraftRoutes.findIndex((session, index) => (
    index > visibleLearnIndex && session.modeLabel.startsWith("PRACTICE FIRST")
  ));
  expect(visibleLearnIndex, JSON.stringify(visibleDraftRoutes)).toBeGreaterThanOrEqual(0);
  expect(visiblePracticeIndex, JSON.stringify(visibleDraftRoutes)).toBeGreaterThan(visibleLearnIndex);

  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();

  const activatedRoutes = await page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) throw new Error("Expected the activated conceptual plan in preview storage.");
    const snapshot = JSON.parse(raw) as { plans?: LearningPlan[] };
    const plan = snapshot.plans?.at(-1);
    if (!plan) throw new Error("Expected the latest activated conceptual plan.");
    return plan.sessions.map((session) => ({
      title: session.title,
      learningMode: session.learningMode,
      routeMode: session.studyRoute?.approach.mode ?? null,
      lifecycle: session.studyRoute?.identity.lifecycleStatus ?? null,
    }));
  });
  expect(activatedRoutes.map((session) => session.title)).toEqual(
    visibleDraftRoutes.map((session) => session.title),
  );
  const committedLearnIndex = activatedRoutes.findIndex((session) => (
    session.learningMode === "learn" && session.routeMode === "learn"
  ));
  const committedPracticeIndex = activatedRoutes.findIndex((session, index) => (
    index > committedLearnIndex
    && session.learningMode === "study"
    && session.routeMode === "practice"
  ));
  expect(committedLearnIndex, JSON.stringify(activatedRoutes)).toBe(visibleLearnIndex);
  expect(committedPracticeIndex, JSON.stringify(activatedRoutes)).toBe(visiblePracticeIndex);
  expect(activatedRoutes.every((session) => session.lifecycle === "committed")).toBe(true);
});

test("normal-plan review changes one offered method without regenerating or rewriting other routes", async ({ page }) => {
  let planGenerationRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/plans/generate") {
      planGenerationRequests += 1;
    }
  });

  await createPreviewAccount(page);
  await completeOnboarding(page);

  await beginPlanFromAdd(page, "I have a biology test next Friday on cellular respiration.");
  await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  await page.getByRole("button", { name: "45 minutes", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await expect(page.getByText("Plan ready")).toBeVisible({ timeout: 30_000 });

  const generationCountBeforeChoice = planGenerationRequests;
  const targetSession = page.getByRole("article", { name: /^Session 1:/ });
  const methodDecision = targetSession.locator("details.generated-method-reason");
  const methodName = targetSession.locator(":scope > div > p").first();
  const methodReason = methodDecision.locator(":scope > p");
  const originalMethod = (await methodName.innerText()).trim();
  const originalReason = (await methodReason.innerText()).trim();

  await methodDecision.locator("summary").click();
  await methodDecision.getByRole("button", { name: "Change method" }).click();
  const alternatives = methodDecision.getByRole("group", {
    name: /^Other methods that also fit for /,
  });
  const alternative = alternatives.getByRole("button").first();
  const alternativeName = (await alternative.locator("strong").innerText()).trim();
  expect(alternativeName).not.toBe(originalMethod);

  const methodChoiceResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/plans/method-choice"
    && response.request().method() === "POST"
  ));
  await alternative.click();
  const methodChoiceResponse = await methodChoiceResponsePromise;
  expect(methodChoiceResponse.ok()).toBe(true);

  const requestPayload = methodChoiceResponse.request().postDataJSON() as {
    plan: LearningPlan;
    selection: { sessionId: string; methodId: string };
  };
  const responsePayload = await methodChoiceResponse.json() as {
    plan: LearningPlan;
    revision: { status: string };
  };
  expect(responsePayload.revision.status).toBe("updated");
  expect(requestPayload.selection.methodId).toBe(
    responsePayload.plan.sessions.find((session) => session.id === requestPayload.selection.sessionId)
      ?.studyRoute?.approach.primaryMethodId,
  );

  const beforeRouteIds = new Map(requestPayload.plan.sessions.map((session) => [
    session.id,
    session.studyRoute?.identity.routeRevisionId ?? null,
  ]));
  const afterRouteIds = new Map(responsePayload.plan.sessions.map((session) => [
    session.id,
    session.studyRoute?.identity.routeRevisionId ?? null,
  ]));
  for (const [sessionId, routeRevisionId] of beforeRouteIds) {
    if (sessionId === requestPayload.selection.sessionId) {
      expect(afterRouteIds.get(sessionId)).not.toBe(routeRevisionId);
    } else {
      expect(afterRouteIds.get(sessionId)).toBe(routeRevisionId);
    }
  }

  await expect(methodName).toHaveText(alternativeName);
  await expect(methodReason).toContainText(`You chose ${alternativeName}`);
  expect((await methodReason.innerText()).trim()).not.toBe(originalReason);
  await expect(targetSession.getByRole("status")).toContainText(`${alternativeName} is now part of this draft.`);
  expect(planGenerationRequests).toBe(generationCountBeforeChoice);

  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();

  const storedPlan = await page.evaluate((planId) => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) throw new Error("Expected the activated plan in preview storage.");
    const snapshot = JSON.parse(raw) as { plans?: LearningPlan[] };
    const plan = snapshot.plans?.find((candidate) => candidate.id === planId);
    if (!plan) throw new Error("Expected the revised plan to be activated.");
    return plan;
  }, responsePayload.plan.id);
  const storedTarget = storedPlan.sessions.find((session) => (
    session.id === requestPayload.selection.sessionId
  ));
  expect(storedTarget).toBeDefined();
  expect(storedTarget?.method).toBe(alternativeName);
  expect(storedTarget?.studyRoute?.approach.visibleMethodName).toBe(alternativeName);
  expect(storedTarget?.studyRoute?.identity.lifecycleStatus).toBe("committed");
  expect(storedTarget?.studyRoute?.identity.routeRevisionId).toBe(
    afterRouteIds.get(requestPayload.selection.sessionId),
  );
  expect(storedTarget?.studyRoute?.agency).toMatchObject({
    selectedBy: "learner",
    controlMode: "learner_customizes",
    override: { changedFields: ["primary_method"] },
  });
  for (const storedSession of storedPlan.sessions) {
    if (storedSession.id === requestPayload.selection.sessionId) continue;
    expect(storedSession.studyRoute?.identity.routeRevisionId).toBe(beforeRouteIds.get(storedSession.id));
    expect(storedSession.studyRoute?.agency.selectedBy).toBe("yova");
  }
});

test("session setup changes one committed method and generates from its exact successor route", async ({ page }) => {
  let planGenerationRequests = 0;
  const sessionGenerationRequests: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/plans/generate") {
      planGenerationRequests += 1;
    }
  });
  await page.route("**/api/sessions/generate", async (route) => {
    sessionGenerationRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Stop after capturing the routed generation request." }),
    });
  });

  await createPreviewAccount(page);
  await completeOnboarding(page);

  await beginPlanFromAdd(page, "I have a biology test next Friday on cellular respiration.");
  await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  await page.getByRole("button", { name: "45 minutes", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await expect(page.getByText("Plan ready")).toBeVisible();
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();

  const beforeChoice = await page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) throw new Error("Expected the activated plan in preview storage.");
    const snapshot = JSON.parse(raw) as { plans?: LearningPlan[] };
    const plan = snapshot.plans?.at(-1);
    const session = plan?.sessions.find((candidate) => candidate.status === "ready");
    const route = session?.studyRoute;
    if (!plan || !session || !route || route.identity.lifecycleStatus !== "committed") {
      throw new Error("Expected a ready session with a committed StudyRoute.");
    }
    const alternative = route.agency.alternatives.find((candidate) => (
      candidate.primaryMethodId !== route.approach.primaryMethodId
      && candidate.mode === route.approach.mode
      && candidate.executionEnvironment === route.approach.executionEnvironment
      && candidate.activeMinutes === route.timing.activeMinutes
    ));
    if (!alternative) throw new Error("Expected an offered method alternative for the ready session.");
    return {
      planId: plan.id,
      sessionId: session.id,
      sessionTitle: session.title,
      methodName: route.approach.visibleMethodName,
      methodReason: route.explanation.shortReason,
      alternative: {
        methodId: alternative.primaryMethodId,
        methodName: alternative.visibleMethodName,
      },
      routeId: route.identity.routeRevisionId,
      routeLineageId: route.identity.routeLineageId,
      revisionNumber: route.identity.revisionNumber,
      target: route.target,
      mode: route.approach.mode,
      executionEnvironment: route.approach.executionEnvironment,
      timing: route.timing,
      routeIds: Object.fromEntries(plan.sessions.map((candidate) => [
        candidate.id,
        candidate.studyRoute?.identity.routeRevisionId ?? null,
      ])),
    };
  });

  await page.getByRole("button", { name: "Start next session", exact: true }).click();
  const earlyStartDialog = page.getByRole("dialog", { name: /^Start .+ now\?$/ });
  if (await earlyStartDialog.isVisible()) {
    await earlyStartDialog.getByRole("button", { name: "Start now, keep dates" }).click();
  }
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  const methodDecision = page.getByLabel("Why YOVA chose this approach");
  await expect(methodDecision.getByRole("heading", { name: beforeChoice.methodName })).toBeVisible();
  await expect(methodDecision).toContainText(beforeChoice.methodReason);

  const planGenerationCountBeforeChoice = planGenerationRequests;
  const sessionGenerationCountBeforeChoice = sessionGenerationRequests.length;
  await methodDecision.getByRole("button", {
    name: `Change method for ${beforeChoice.sessionTitle}`,
  }).click();
  const alternatives = methodDecision.getByRole("group", {
    name: `Other methods that also fit for ${beforeChoice.sessionTitle}`,
  });
  await expect(methodDecision.getByRole("region", {
    name: "Other eligible methods",
  })).toHaveCount(0);
  await alternatives.getByRole("button", {
    name: new RegExp(`^Use ${escapeRegExp(beforeChoice.alternative.methodName)}\\.`),
  }).click();

  await expect(methodDecision.getByRole("status")).toContainText(
    `${beforeChoice.alternative.methodName} is now the method for this session.`,
  );
  await expect(methodDecision.getByRole("heading", {
    name: beforeChoice.alternative.methodName,
  })).toBeVisible();
  expect(planGenerationRequests).toBe(planGenerationCountBeforeChoice);
  expect(sessionGenerationRequests).toHaveLength(sessionGenerationCountBeforeChoice);

  await expect.poll(async () => page.evaluate(({ planId, sessionId }) => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as { plans?: LearningPlan[] };
    return snapshot.plans
      ?.find((candidate) => candidate.id === planId)
      ?.sessions.find((candidate) => candidate.id === sessionId)
      ?.studyRoute?.identity.routeRevisionId ?? null;
  }, {
    planId: beforeChoice.planId,
    sessionId: beforeChoice.sessionId,
  })).not.toBe(beforeChoice.routeId);

  await methodDecision.getByRole("button", {
    name: `Change method for ${beforeChoice.sessionTitle}`,
  }).click();
  const otherMethods = methodDecision.getByRole("region", {
    name: "Other eligible methods",
  });
  await expect(otherMethods).toBeVisible();
  const hiddenMethodButtons = otherMethods.locator(
    ".session-other-method-list > button[data-method-id]",
  );
  const visibleHiddenMethodIds = await hiddenMethodButtons.evaluateAll((buttons) => (
    buttons.map((button) => button.getAttribute("data-method-id"))
  ));
  const otherMethodAuthority = await page.evaluate(({ planId, sessionId }) => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) throw new Error("Expected the updated plan in preview storage.");
    const snapshot = JSON.parse(raw) as { plans?: LearningPlan[] };
    const route = snapshot.plans
      ?.find((candidate) => candidate.id === planId)
      ?.sessions.find((candidate) => candidate.id === sessionId)
      ?.studyRoute;
    if (!route) throw new Error("Expected the exact committed route for Other methods.");
    const eligibility = route.provenance.ruleTrace.findLast((entry) => (
      entry.ruleId === "method_eligibility_v3"
    ));
    if (!eligibility) throw new Error("Expected immutable method eligibility provenance.");
    return {
      routeId: route.identity.routeRevisionId,
      eligibleMethodIds: eligibility.result.split(","),
      storedMethodIds: [
        route.approach.primaryMethodId,
        ...route.agency.alternatives.map((alternative) => alternative.primaryMethodId),
      ],
    };
  }, { planId: beforeChoice.planId, sessionId: beforeChoice.sessionId });
  expect(visibleHiddenMethodIds.every((methodId) => (
    methodId
    && otherMethodAuthority.eligibleMethodIds.includes(methodId)
    && !otherMethodAuthority.storedMethodIds.some((storedMethodId) => (
      storedMethodId === methodId
    ))
  ))).toBe(true);

  await otherMethods.getByPlaceholder("For example, Pomodoro or interleaving").fill("Pomodoro");
  await otherMethods.getByRole("button", { name: "Check and use" }).click();
  const safeMapping = otherMethods.locator(".session-other-method-mapping");
  await expect(safeMapping).toContainText("timing option");
  await expect(safeMapping.getByRole("button", { name: /^Use .+ instead$/ })).toBeVisible();
  const routeIdAfterMappingPreview = await page.evaluate(({ planId, sessionId }) => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as { plans?: LearningPlan[] };
    return snapshot.plans
      ?.find((candidate) => candidate.id === planId)
      ?.sessions.find((candidate) => candidate.id === sessionId)
      ?.studyRoute?.identity.routeRevisionId ?? null;
  }, { planId: beforeChoice.planId, sessionId: beforeChoice.sessionId });
  expect(routeIdAfterMappingPreview).toBe(otherMethodAuthority.routeId);
  await methodDecision.getByRole("button", {
    name: `Close method choices for ${beforeChoice.sessionTitle}`,
  }).click();

  const afterChoice = await page.evaluate(({ planId, sessionId }) => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) throw new Error("Expected the updated plan in preview storage.");
    const snapshot = JSON.parse(raw) as { plans?: LearningPlan[] };
    const plan = snapshot.plans?.find((candidate) => candidate.id === planId);
    const session = plan?.sessions.find((candidate) => candidate.id === sessionId);
    if (!plan || !session?.studyRoute) throw new Error("Expected the successor route in preview storage.");
    return {
      sessionId: session.id,
      sessionMethod: session.method,
      sessionMinutes: session.estimatedMinutes,
      routeId: session.studyRoute.identity.routeRevisionId,
      supersedesRevisionId: session.studyRoute.identity.supersedesRevisionId ?? null,
      routeLineageId: session.studyRoute.identity.routeLineageId,
      revisionNumber: session.studyRoute.identity.revisionNumber,
      lifecycleStatus: session.studyRoute.identity.lifecycleStatus,
      methodId: session.studyRoute.approach.primaryMethodId,
      methodName: session.studyRoute.approach.visibleMethodName,
      target: session.studyRoute.target,
      mode: session.studyRoute.approach.mode,
      executionEnvironment: session.studyRoute.approach.executionEnvironment,
      timing: session.studyRoute.timing,
      agency: session.studyRoute.agency,
      routeIds: Object.fromEntries(plan.sessions.map((candidate) => [
        candidate.id,
        candidate.studyRoute?.identity.routeRevisionId ?? null,
      ])),
    };
  }, { planId: beforeChoice.planId, sessionId: beforeChoice.sessionId });

  expect(afterChoice).toMatchObject({
    sessionId: beforeChoice.sessionId,
    sessionMethod: beforeChoice.alternative.methodName,
    sessionMinutes: beforeChoice.timing.activeMinutes,
    supersedesRevisionId: beforeChoice.routeId,
    routeLineageId: beforeChoice.routeLineageId,
    revisionNumber: beforeChoice.revisionNumber + 1,
    lifecycleStatus: "committed",
    methodId: beforeChoice.alternative.methodId,
    methodName: beforeChoice.alternative.methodName,
    target: beforeChoice.target,
    mode: beforeChoice.mode,
    executionEnvironment: beforeChoice.executionEnvironment,
    timing: beforeChoice.timing,
    agency: {
      selectedBy: "learner",
      controlMode: "learner_customizes",
      override: { changedFields: ["primary_method"] },
    },
  });
  expect(afterChoice.routeId).not.toBe(beforeChoice.routeId);
  for (const [sessionId, routeId] of Object.entries(beforeChoice.routeIds)) {
    expect(afterChoice.routeIds[sessionId]).toBe(
      sessionId === beforeChoice.sessionId ? afterChoice.routeId : routeId,
    );
  }

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Has anything changed?" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Set the pace for today." })).toBeVisible();
  await page.getByRole("button", { name: "Prepare this session" }).click();
  await expect.poll(() => sessionGenerationRequests.length).toBe(1);
  expect(sessionGenerationRequests[0]).toMatchObject({
    planId: beforeChoice.planId,
    planSessionId: beforeChoice.sessionId,
    routeRevisionId: afterChoice.routeId,
  });
});

test("a multi-session plan carries one clear source decision from Add to Learning", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await beginPlanFromAdd(page, "I have a biology test next Friday on cellular respiration.");

  await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  await page.getByRole("button", { name: "45 minutes", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();

  await expect(page.getByRole("heading", { name: "Everything YOVA will use" })).toBeVisible();
  await expect(page.getByText("Guided inside YOVA with YOVA-created teaching and practice")).toBeVisible();
  await page.getByRole("button", { name: "Generate my plan" }).click();

  await expect(page.getByText("Plan ready")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Does this plan match what you need?" })).toBeVisible();
  await expect(page.getByText("Nothing is active until you confirm it below.")).toBeVisible();
  const planContract = page.getByRole("region", { name: "How YOVA mapped this plan" });
  await expect(planContract).toBeVisible();
  await expect(planContract).toContainText("KNOWLEDGE MAP");
  await expect(planContract).toContainText("SESSION LOAD");
  await expect(planContract).toContainText("YOUR DELIVERY");
  await expect(planContract).toContainText("YOUR SCHEDULE");
  await expect(page.locator(".generated-session-focus").first()).toContainText("Focus:");
  await page.getByRole("button", { name: "Change schedule" }).click();
  await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await expect(page.getByText("Plan ready")).toBeVisible();
  const reviewedMethods = (await page.locator(
    ".generated-timeline article > div > p:not(.generated-session-focus)",
  ).allTextContents()).map((method) => method.trim());
  expect(reviewedMethods.length).toBeGreaterThan(0);
  expect(reviewedMethods.every((method) => method.length > 0)).toBe(true);
  const reviewedMethodReasons = (await page.locator(
    ".generated-method-reason > p",
  ).allTextContents()).map((reason) => reason.trim());
  expect(reviewedMethodReasons).toHaveLength(reviewedMethods.length);
  expect(reviewedMethodReasons.every((reason) => reason.length > 0)).toBe(true);
  const firstMethodReason = page.locator(".generated-method-reason").first();
  await firstMethodReason.locator("summary").click();
  await expect(firstMethodReason.locator("p")).toBeVisible();
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
  await expect(page.getByText("Created by YOVA", { exact: true })).toBeVisible();
  const persistedMethodContract = await page.evaluate(() => {
    const raw = window.localStorage.getItem("yova.preview.v1");
    if (!raw) throw new Error("Expected the activated multi-session plan in preview storage.");
    const snapshot = JSON.parse(raw) as { plans?: LearningPlan[] };
    const plan = snapshot.plans?.at(-1);
    if (!plan) throw new Error("Expected the latest activated multi-session plan.");
    return plan.sessions.map((session) => ({
      method: session.method,
      methodReason: session.methodReason,
      routeMethod: session.studyRoute?.approach.visibleMethodName ?? null,
      lifecycle: session.studyRoute?.identity.lifecycleStatus ?? null,
      selectedBy: session.studyRoute?.agency.selectedBy ?? null,
      ruleIds: session.studyRoute?.provenance.ruleTrace.map((entry) => entry.ruleId) ?? [],
    }));
  });
  expect(persistedMethodContract.map((session) => session.method)).toEqual(reviewedMethods);
  expect(persistedMethodContract.map((session) => session.methodReason)).toEqual(reviewedMethodReasons);
  expect(persistedMethodContract.every((session) => (
    session.routeMethod === session.method
    && session.lifecycle === "committed"
    && session.selectedBy === "yova"
    && session.ruleIds.includes("initial_plan_method_routing_v1")
    && session.ruleIds.includes("canonical_method_selection_v1")
  ))).toBe(true);

  const initialSessionCount = await page.locator(".timeline-row").count();
  expect(initialSessionCount).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await expect(page.getByText(/Time controls the size of each content slice/)).toBeVisible();
  await page.getByRole("combobox", { name: /Future session window/ }).selectOption("15");
  await page.getByRole("button", { name: "Approve and rebuild plan" }).click();

  await expect.poll(async () => page.locator(".timeline-row").count()).toBeGreaterThan(initialSessionCount);
  const adjustedDurations = await page.locator(".timeline-row > span:last-child").allTextContents();
  expect(adjustedDurations.length).toBeGreaterThan(initialSessionCount);
  expect(adjustedDurations.every((duration) => Number.parseInt(duration, 10) <= 15)).toBe(true);
  await expect(page.getByText(/sessions complete/).first()).toBeVisible();

  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  const tutorContext = page.getByRole("combobox", { name: "Ask YOVA context" });
  await expect(tutorContext).toHaveValue("general");
  await expect(tutorContext.locator("option").nth(1)).toContainText("Biology Test on Cellular Respiration");
  await tutorContext.selectOption({ index: 1 });
  await expect(page.getByText("Using learning context")).toBeVisible();
  await expect(page.getByText("YOVA can use this goal's materials, next session, and learner evidence.")).toBeVisible();
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Ask YOVA context" })).toHaveValue("general");

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const moveOverdue = page.getByRole("button", { name: "Move to tomorrow" });
  if (await moveOverdue.isVisible()) await moveOverdue.click();
  await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();
  const adjustmentTools = page.locator("details.agenda-adjustment-tools");
  if (!(await adjustmentTools.getAttribute("open"))) await adjustmentTools.locator("summary").click();
  await expect(adjustmentTools).toContainText("You stay in control");
  await adjustmentTools.getByLabel("Minutes available today").fill("15");
  await adjustmentTools.getByLabel("What changed? Optional").fill("Only a short window is available today");
  await expectNoHorizontalOverflow(page, ".agenda-capacity-planner");
  await adjustmentTools.getByRole("button", { name: "Review options" }).click();
  const proposal = adjustmentTools.locator(".agenda-capacity-options");
  await expect(proposal).toContainText("PROPOSED ADJUSTMENT");
  await expect(proposal).toContainText(
    /Nothing needs to move|Today already fits|Move one unfinished block|Shorten one safe content block|No safe automatic change/,
  );
});

test("archived, draft, and deleted-plan projections stay out of current-work surfaces", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.evaluate(() => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
    const snapshot = JSON.parse(stored) as Record<string, unknown>;
    const now = new Date();
    // Keep the fixture on the currently selected Calendar day even when the
    // suite runs late at night. Adding an hour can cross midnight and hide the
    // otherwise-valid active session on tomorrow's card.
    const scheduledFor = now.toISOString();
    const dueAt = new Date(now.getTime() + 2 * 60 * 60 * 1_000).toISOString();
    const createdAt = new Date(now.getTime() - 60 * 60 * 1_000).toISOString();
    const session = (id: string, title: string) => ({
      id,
      sequence: 1,
      title,
      objective: `Finish ${title}`,
      method: "Guided learning",
      methodReason: "Visibility regression fixture",
      scheduledFor,
      estimatedMinutes: 25,
      amountLabel: "One focused section",
      learningMode: "learn",
      status: "ready",
    });
    const plan = (id: string, learningItemId: string, title: string, status: "draft" | "active" | "archived") => ({
      id,
      learningItemId,
      title,
      topic: title,
      kind: "topic",
      deadline: dueAt,
      status,
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "learn",
      rationale: "Visibility regression fixture",
      createdAt,
      sessions: [session(`${id}-session`, `${title} session`)],
    });

    snapshot.plans = [
      plan("active-plan", "active-item", "Visible active biology plan", "active"),
      plan("archived-plan", "archived-item", "Hidden archived calculus plan", "archived"),
      plan("draft-plan", "draft-item", "Hidden draft chemistry plan", "draft"),
    ];
    snapshot.deadlineMilestones = [
      { id: "active-deadline", title: "Visible biology deadline", description: "Active linked work", dueAt, status: "open", linkedLearningItemId: "active-item", createdAt },
      { id: "archived-deadline", title: "Hidden archived deadline", description: "Archived linked work", dueAt, status: "open", linkedLearningItemId: "archived-item", createdAt },
      { id: "draft-deadline", title: "Hidden draft deadline", description: "Draft linked work", dueAt, status: "open", linkedLearningItemId: "draft-item", createdAt },
      { id: "deleted-deadline", title: "Hidden deleted-plan deadline", description: "Orphaned linked work", dueAt, status: "open", linkedLearningItemId: "deleted-item", createdAt },
    ];
    snapshot.updatedAt = new Date().toISOString();
    window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  });
  await page.reload();

  await expect(page.getByText("Visible active biology plan").first()).toBeVisible();
  await expect(page.getByText("Hidden archived calculus plan")).toHaveCount(0);
  await expect(page.getByText("Hidden draft chemistry plan")).toHaveCount(0);

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByText("Visible active biology plan").first()).toBeVisible();
  await expect(page.getByText("Visible biology deadline").first()).toBeVisible();
  await expect(page.getByText("Hidden archived calculus plan")).toHaveCount(0);
  await expect(page.getByText("Hidden archived deadline")).toHaveCount(0);
  await expect(page.getByText("Hidden draft deadline")).toHaveCount(0);
  await expect(page.getByText("Hidden deleted-plan deadline")).toHaveCount(0);

  await page.getByRole("button", { name: "Ask YOVA", exact: true }).click();
  const contextOptions = page.getByRole("combobox", { name: "Ask YOVA context" }).locator("option");
  await expect(contextOptions.filter({ hasText: "Visible active biology plan" })).toHaveCount(1);
  await expect(contextOptions.filter({ hasText: "Hidden archived calculus plan" })).toHaveCount(0);
  await expect(contextOptions.filter({ hasText: "Hidden draft chemistry plan" })).toHaveCount(0);

  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await page.getByRole("button", { name: /Archive/ }).click();
  await expect(page.getByText("Hidden archived calculus plan").first()).toBeVisible();

  await page.getByRole("button", { name: "Open goal" }).click();
  await expect(page.getByRole("heading", { name: "Hidden archived calculus plan" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Archived goal history" })).toContainText("0 of 1 sessions");
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("button", { name: /Active/ })).toHaveClass(/active/);
  await expect(page.getByText("Hidden archived calculus plan").first()).toBeVisible();

  await page.locator(".learning-goal-card").filter({ hasText: "Hidden archived calculus plan" }).getByRole("button", { name: "Open goal" }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator(".tabs").getByRole("button", { name: /Archive/ })).toHaveClass(/active/);
  await page.getByRole("button", { name: "Open goal" }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  const deletionDialog = page.getByRole("dialog", { name: "Delete this archived goal?" });
  await expect(deletionDialog).toContainText("sessions, results, tutor conversation, linked deadlines, and attached materials");
  await deletionDialog.getByLabel("Type DELETE to confirm").fill("DELETE");
  await deletionDialog.getByRole("button", { name: "Permanently delete goal" }).click();
  await expect(page.getByText("Hidden archived calculus plan")).toHaveCount(0);
});

test("material setup clearly supports files, articles, and YouTube transcripts", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me understand how ecosystems respond to invasive species.",
  );
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Use my materials/ }).click();
  const dropzone = page.getByLabel("Upload learning materials. Choose files or drag and drop them here.");
  await expect(dropzone).toContainText("Choose files or drag them here");
  await expect(dropzone).toContainText("PDF, TXT, or Markdown");
  await expect(page.getByRole("button", { name: /Add an article or YouTube video/ })).toBeVisible();
  await page.getByRole("button", { name: /Add an article or YouTube video/ }).click();
  await expect(page.getByRole("region", { name: "Add material from a link" })).toContainText("Public article");
  await expect(page.getByRole("region", { name: "Add material from a link" })).toContainText("YouTube transcript");
  await expect(page.getByText(/does not bypass paywalls or sign-ins/i)).toBeVisible();
});

test("material drop zone accepts drag gestures and explains rejected files", async ({ page }) => {
  await createPreviewAccount(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
    "Help me prepare for a World War I history test.",
  );
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Use my materials/ }).click();

  const dropzone = page.getByLabel("Upload learning materials. Choose files or drag and drop them here.");
  const transfer = await page.evaluateHandle(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(["history notes"], "history-notes.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }));
    return dataTransfer;
  });

  await dropzone.dispatchEvent("dragenter", { dataTransfer: transfer });
  await expect(dropzone).toHaveClass(/drag-active/);
  await expect(dropzone).toContainText("Drop files to add them");
  await dropzone.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(dropzone).not.toHaveClass(/drag-active/);
  await expect(page.getByText("history-notes.docx is not supported. Use PDF, TXT, or Markdown.")).toBeVisible();
  await transfer.dispose();

  await page.getByLabel("Choose learning materials").setInputFiles({
    name: "teacher-guide.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from("not a supported upload"),
  });
  await expect(page.getByText("teacher-guide.pptx is not supported. Use PDF, TXT, or Markdown.")).toBeVisible();
});

async function openMobileSessionGuide(page: Page) {
  const mobileGuide = page.locator(".session-guide-mobile");
  if (await mobileGuide.isVisible()) await mobileGuide.locator(":scope > summary").click();
}

async function rebuildLatestStudyNowPlanForMinutes(page: Page, minutes: number) {
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await page.locator(".tabs").getByRole("button", { name: /^Recent/ }).click();

  const latestPlan = page.locator(".learning-goal-card").last();
  await latestPlan.getByRole("button", { name: "Open goal" }).click();
  await page.getByRole("button", { name: "Adjust", exact: true }).click();

  const adjustmentPanel = page.locator(".plan-adjustment-panel");
  await adjustmentPanel.getByRole("combobox", { name: "Future session window" }).selectOption(String(minutes));
  await adjustmentPanel.getByRole("button", { name: "Approve and rebuild plan" }).click();
  await expect(adjustmentPanel).toHaveCount(0);
  await page.getByRole("button", { name: "Start next session", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
}

async function beginPlanFromAdd(page: Page, description: string) {
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.locator(".calendar-page-header").getByRole("button", { name: "Add to YOVA", exact: true }).click();
  await page.getByPlaceholder("Example: I have a World War I test in two weeks. I am starting from the beginning and I have a study guide.").fill(description);
  await page.getByRole("button", { name: "Organize this" }).click();
  await expect(page.getByRole("heading", { name: "Here is what YOVA understood." })).toBeVisible();
  await page.getByRole("button", { name: "Choose what YOVA should do" }).click();
  await page.getByRole("button", { name: /Create a plan/ }).click();
}

async function expectNoHorizontalOverflow(page: Page, selector: string) {
  const overflow = await page.locator(selector).first().evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
    offenders: Array.from(element.querySelectorAll<HTMLElement>("*")).map((child) => {
      const rect = child.getBoundingClientRect();
      return {
        tag: child.tagName.toLowerCase(),
        className: child.className,
        client: child.clientWidth,
        scroll: child.scrollWidth,
        width: Math.round(rect.width),
        right: Math.round(rect.right),
      };
    }).filter((item) => item.scroll > item.client + 1 || item.width > window.innerWidth + 1 || item.right > window.innerWidth + 1).slice(0, 12),
  }));
  expect(
    overflow.scroll,
    `Horizontal overflow in ${selector}: ${JSON.stringify(overflow.offenders)}`,
  ).toBeLessThanOrEqual(overflow.client + 1);
}

async function createPreviewAccount(page: Page) {
  await page.goto("/?qa=preview");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill("learning-loop@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Make YOVA fit how you actually study." })).toBeVisible();
}

async function readPreviewPracticeState(
  page: Page,
  planId?: string,
  sessionId?: string,
) {
  return page.evaluate(({ requestedPlanId, requestedSessionId }) => {
    const stored = window.localStorage.getItem("yova.preview.v1");
    if (!stored) return null;

    const snapshot = JSON.parse(stored) as {
      plans?: Array<{
        id?: string;
        sessions?: Array<{
          id?: string;
          sequence?: number;
          status?: string;
          learningMode?: string;
          topicIds?: string[];
          contentTargets?: string[];
          completionEvidence?: string[];
          reviewType?: string;
        }>;
        knowledgeMap?: { topics?: Array<{ id?: string; status?: string }> };
      }>;
      sessionCompletions?: Array<{
        id?: string;
        planId?: string;
        planSessionId?: string;
        completionMode?: string;
        correctAnswers?: number;
        totalAnswers?: number;
        observedGap?: string;
        conceptEvidence?: unknown[];
        confidenceEvidence?: unknown[];
      }>;
    };
    const plan = requestedPlanId
      ? snapshot.plans?.find((candidate) => candidate.id === requestedPlanId)
      : snapshot.plans?.at(-1);
    const session = requestedSessionId
      ? plan?.sessions?.find((candidate) => candidate.id === requestedSessionId)
      : plan?.sessions?.find((candidate) => candidate.status === "ready") ?? plan?.sessions?.at(0);
    if (!plan?.id || !session?.id) return null;
    const completion = snapshot.sessionCompletions?.find((candidate) => (
      candidate.planId === plan.id
      && candidate.planSessionId === session.id
    )) ?? null;
    const verificationSession = plan.sessions?.find((candidate) => (
      candidate.sequence === (session.sequence ?? 0) + 1
      && candidate.reviewType === "verify"
    )) ?? null;
    const topicStatuses = (plan.knowledgeMap?.topics ?? []).map((topic) => ({
      id: topic.id ?? null,
      status: topic.status ?? null,
    }));

    return {
      planId: plan.id,
      sessionId: session.id,
      sessionSequence: session.sequence ?? 0,
      sessionStatus: session.status ?? null,
      sessionTopicIds: session.topicIds ?? [],
      sessionContentTargets: session.contentTargets ?? [],
      sessionCompletionEvidence: session.completionEvidence ?? [],
      topicStatuses,
      topicStatusesSerialized: JSON.stringify(topicStatuses),
      verificationSession,
      completion,
    };
  }, {
    requestedPlanId: planId,
    requestedSessionId: sessionId,
  });
}

async function readRecoveryState(page: Page) {
  return page.evaluate(() => {
    let checkpoints: Array<{ runId?: string; status?: string; completedSteps?: number }> = [];
    let snapshot: {
      plans?: Array<{ sessions?: Array<{ resource?: unknown }> }>;
      sessionCompletions?: Array<{ id?: string }>;
      sessionInterruptions?: unknown[];
    } = {};

    try {
      const rawCheckpoints = window.localStorage.getItem("yova.active-session-checkpoints.v1");
      const parsedCheckpoints: unknown = rawCheckpoints ? JSON.parse(rawCheckpoints) : [];
      checkpoints = Array.isArray(parsedCheckpoints)
        ? parsedCheckpoints as Array<{ runId?: string; status?: string; completedSteps?: number }>
        : [];
    } catch {
      checkpoints = [];
    }

    try {
      const rawSnapshot = window.localStorage.getItem("yova.preview.v1");
      const parsedSnapshot: unknown = rawSnapshot ? JSON.parse(rawSnapshot) : {};
      snapshot = parsedSnapshot && typeof parsedSnapshot === "object"
        ? parsedSnapshot as typeof snapshot
        : {};
    } catch {
      snapshot = {};
    }

    const checkpoint = checkpoints.at(-1);
    return {
      checkpointStatus: checkpoint?.status ?? null,
      completedSteps: checkpoint?.completedSteps ?? null,
      lastCheckpointRunId: checkpoint?.runId ?? null,
      sessionCompletions: snapshot.sessionCompletions?.length ?? 0,
      completionId: snapshot.sessionCompletions?.at(-1)?.id ?? null,
      sessionInterruptions: snapshot.sessionInterruptions?.length ?? 0,
      hasSessionResource: Boolean(snapshot.plans?.[0]?.sessions?.[0]?.resource),
    };
  });
}

async function completeOnboarding(page: Page) {
  await page.getByRole("button", { name: /Personalize YOVA/ }).click();

  for (const [index, answer] of onboardingAnswers.entries()) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    const nextLabel = index === onboardingAnswers.length - 1 ? "Build my setup" : "Continue";
    await page.getByRole("button", { name: nextLabel }).click();
  }

  await expect(page.getByRole("heading", { name: "YOVA will begin like this." })).toBeVisible();
  await page.getByRole("button", { name: "Open YOVA" }).click();
}

async function leaveSession(page: Page, progressText: string) {
  await page.getByRole("button", { name: "Exit" }).dispatchEvent("click");
  await expect(page.getByRole("dialog", { name: "Your plan will stay open." })).toContainText(progressText);
  await page.getByRole("button", { name: "Save progress and leave" }).dispatchEvent("click");
}

function recommendedLearningPlan(page: Page) {
  return page.getByRole("region", { name: "Recommended learning plan" });
}

async function expectSavedSessionRecommendation(page: Page, completedSteps?: number) {
  const recommendation = recommendedLearningPlan(page);
  await expect(recommendation.getByText("CONTINUE · PROGRESS SAVED", { exact: true })).toBeVisible();
  await expect(recommendation.getByRole("button", { name: "Continue session" })).toBeVisible();

  if (completedSteps !== undefined) {
    await expect(page.getByText(new RegExp(`^${completedSteps} of \\d+ sections? saved$`))).toBeVisible();
  }
}

async function confirmSessionSetup(page: Page) {
  await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByLabel("Why YOVA chose this approach")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Has anything changed?" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Set the pace for today." })).toBeVisible();
  await page.getByRole("button", { name: "Prepare this session" }).click();
}

async function createOneOffLearningSession(
  page: Page,
  request: string,
  learningMode: "learn" | "study" = "learn",
) {
  await page.getByRole("button", {
    name: /^(?:Study something now|Study now Quick, off-plan)$/,
  }).first().click();
  await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(request);
  await page.getByRole("button", {
    name: learningMode === "learn"
      ? "I haven't learned this yet"
      : "I understand the basics but need practice",
  }).click();
  await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  await page.getByRole("button", { name: /Create it for me/ }).click();
  await page.getByRole("button", { name: /Build and start session/ }).click();
  await confirmSessionSetup(page);
}

async function exitSessionWithoutProgress(page: Page) {
  await page.getByRole("button", { name: "Exit" }).dispatchEvent("click");
  await expect(page.getByRole("dialog", { name: "Your plan will stay open." })).toBeVisible();
  await page.getByRole("button", { name: "Save progress and leave" }).dispatchEvent("click");
}

function practiceProblemsSessionResponse({
  planSessionId,
  routeRevisionId,
  topicId,
}: {
  planSessionId: string;
  routeRevisionId?: string;
  topicId: string;
}) {
  const response = streamedResumeSessionResponse(routeRevisionId);
  const question = response.session.activities[2]!;
  const reflection = response.session.activities[0]!;

  return SessionGenerationResponseSchema.parse({
    ...response,
    planSessionId,
    session: {
      ...response.session,
      topicIds: [topicId],
      routingContext: {
        taskType: "problem_solving",
        knowledgeStage: "developing",
      },
      rationale: "Begin with a complete unsupported quotient-rule setup, repair only an observed miss, and then require a changed-context transfer problem.",
      coverage: {
        focus: "Apply the quotient rule independently and preserve its numerator order in a different function.",
        essentialIdeas: ["The quotient rule differentiates the numerator and denominator in a fixed subtraction order and squares the original denominator."],
        completionEvidence: ["Set up one representative quotient-rule derivative and one changed-context derivative without a shown solution."],
        evidenceMap: [{
          essentialIdea: "The quotient rule differentiates the numerator and denominator in a fixed subtraction order and squares the original denominator.",
          activityConcept: "Quotient-rule numerator order",
        }],
        deferredContent: [],
      },
      methodBriefing: {
        ...response.session.methodBriefing,
        learningMode: "study",
        taskType: "problem_solving",
        methodId: "practice_problems",
        name: "Practice Problems",
        what: "Attempt one representative quotient-rule problem before feedback, then solve a changed-context problem.",
        why: "An unsupported setup shows whether the learner can choose and apply the rule instead of only recognizing it.",
        how: [
          "Write the complete quotient-rule setup before looking at the comparison.",
          "Repair only the exact gap exposed by the attempt.",
          "Apply the same rule to a different numerator and denominator.",
        ],
        completion: "Complete the representative and changed-context problems without seeing either solution first.",
      },
      activities: [{
        ...question,
        topicId,
        methodPhase: "independent_practice",
        estimatedMinutes: 7,
        type: "free_response",
        concept: "Quotient-rule numerator order",
        label: "Practice problem",
        title: "Set up the quotient rule without support",
        body: "Differentiate f(x) = (x² + 1) / (x - 3). Show the quotient-rule setup before simplifying.",
        teaching: null,
        lessonBrief: null,
        practiceIntent: "baseline",
        misconceptionSummary: "Reverses the quotient-rule numerator order or forgets to square the original denominator.",
        choices: [],
        correctAnswer: "f'(x) = [2x(x - 3) - (x² + 1)] / (x - 3)².",
        feedback: "Differentiate the numerator first, keep the denominator, subtract the numerator times the denominator derivative, and square the original denominator.",
      }, {
        ...question,
        topicId,
        methodPhase: "transfer",
        estimatedMinutes: 7,
        type: "free_response",
        concept: "Quotient-rule transfer",
        label: "Changed context",
        title: "Transfer the quotient rule to a trigonometric numerator",
        body: "Differentiate a different function with the same rule: g(x) = sin(x) / (x² + 1). Show your work and the complete derivative setup.",
        teaching: null,
        lessonBrief: null,
        practiceIntent: "independent_transfer",
        misconceptionSummary: null,
        choices: [],
        correctAnswer: "g'(x) = [cos(x)(x² + 1) - sin(x)(2x)] / (x² + 1)².",
        feedback: "The changed context keeps the same quotient-rule order while both derivative components and the denominator are different.",
      }, {
        ...reflection,
        topicId: null,
        methodPhase: "reflect",
        estimatedMinutes: 2,
        requiredForCompletion: false,
        type: "reflection",
        concept: null,
        label: "Reflect",
        title: "Name the rule that stayed fixed",
        body: "Notice which quotient-rule relationships stayed fixed when the function changed.",
        teaching: null,
        lessonBrief: null,
        practiceIntent: null,
        misconceptionSummary: null,
        choices: [],
        correctAnswer: null,
        feedback: null,
      }],
    },
  });
}

function streamedResumeSessionResponse(routeRevisionId?: string) {
  const topicId = "30000000-0000-4000-8000-000000000010";
  return {
    planSessionId: "30000000-0000-4000-8000-000000000011",
    session: {
      ...(routeRevisionId ? { routeRevisionId } : {}),
      topicIds: [topicId],
      schemaVersion: 17,
      model: "test-model",
      generatedAt: "2026-08-11T18:00:00.000Z",
      cacheContext: {
        effectiveMinutes: 25,
        adjustmentFingerprint: "a".repeat(64),
        scopeFingerprint: sessionCacheScopeFingerprint({
          plannedMinutes: 25,
          adjustment: null,
          contractKey: null,
          routeRevisionId,
        }),
        ...(routeRevisionId ? { routeRevisionId } : {}),
      },
      routingContext: {
        taskType: "conceptual_learning",
        knowledgeStage: "novice",
      },
      rationale: "Teach one bounded retrieval model before checking whether the learner can identify and explain it.",
      coverage: {
        focus: "Understand why retrieval happens before answer review.",
        essentialIdeas: ["Retrieval happens before answer review"],
        completionEvidence: ["Identify and explain why an answer is attempted before review"],
        evidenceMap: [{
          essentialIdea: "Retrieval happens before answer review",
          activityConcept: "Retrieval practice",
        }],
        deferredContent: [],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Feynman Technique",
        what: "Study the bounded model, then explain why retrieval comes before answer review.",
        why: "Explaining the sequence in your own words exposes whether the causal relationship is understood.",
        how: [
          "Read the bounded model before the first check.",
          "Attempt the answer from memory, then repair the exposed gap.",
        ],
        completion: "The learner identifies the sequence and explains why retrieval comes first.",
        personalization: ["The learner asked for a clear example before the independent explanation."],
      },
      sourceGrounding: null,
      deliveryPolicy: {
        schemaVersion: 1,
        evidenceStatus: "starting_hypothesis",
        presentation: {
          mode: "example_first",
          label: "Example first",
          instruction: "Begin with one concrete case before naming the general rule.",
        },
        repair: {
          mode: "hint_first",
          label: "Hint first",
          instruction: "After a miss, reveal one bounded cue before the complete correction.",
        },
        retention: {
          mode: "retrieval",
          label: "Recall without cues",
          instruction: "Require retrieval without visible notes before answer review.",
        },
        workspace: {
          mode: "one_step",
          label: "One step at a time",
          instruction: "Keep only the current action prominent while preserving the path preview.",
        },
        pacing: {
          firstActionMinutes: 4,
          maximumActivities: 5,
          reason: "Use a bounded first explanation and preserve the required checks.",
        },
        learnerFacingReasons: ["The learner asked for a concrete example before the rule."],
        signalsUsed: ["A concrete example before the rule"],
      },
      deliveryInstructions: {
        schemaVersion: 1,
        explanationDensity: "balanced",
        tone: "encouraging",
        analogyUse: "only_when_helpful",
        workedExamples: "lead_with_example",
        structure: "task_aligned",
        pacing: {
          firstActionMinutes: 4,
          maximumActivities: 5,
          instruction: "Keep the first step bounded while preserving every essential idea.",
        },
        learnerContext: ["Use current evidence as a guide rather than a fixed learning style."],
        contentRequirements: {
          coverAllEssentialIdeas: true,
          includeConcreteWorkedExample: true,
          includeCommonMixup: true,
          preservePrerequisiteOrder: true,
        },
      },
      activities: [
        {
          topicId,
          methodPhase: "model",
          estimatedMinutes: 4,
          requiredForCompletion: true,
          type: "instruction",
          concept: null,
          label: "Learn",
          title: "Build the retrieval model",
          body: "Read the streamed explanation before answering the first question.",
          teaching: null,
          lessonBrief: {
            version: 1,
            topicIds: [topicId],
            essentialIdeas: ["Retrieval happens before answer review"],
            sourceChunks: [],
            knowledgeSource: "model_knowledge",
            evidenceContext: {
              confirmedGaps: [],
              secureKnowledge: [],
              priorMisconceptions: [],
            },
            contentRequirements: {
              teachEveryEssentialIdea: true,
              includeConcreteExample: true,
              includeCommonMixup: true,
              preservePrerequisiteOrder: true,
            },
          },
          practiceIntent: null,
          misconceptionSummary: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          topicId,
          methodPhase: "retrieve",
          estimatedMinutes: 3,
          requiredForCompletion: true,
          type: "multiple_choice",
          concept: "Retrieval practice",
          label: "Check",
          title: "Choose the retrieval sequence",
          body: "Which sequence makes unsupported knowledge visible before review?",
          teaching: null,
          lessonBrief: null,
          practiceIntent: "misconception_discrimination",
          misconceptionSummary: "Confuses retrieval with rereading already visible wording.",
          choices: ["Attempt, then review", "Review, then copy", "Only reread"],
          correctAnswer: "Attempt, then review",
          feedback: "Retrieval requires producing an answer before looking at the explanation.",
        },
        {
          topicId,
          methodPhase: "explain",
          estimatedMinutes: 3,
          requiredForCompletion: true,
          type: "free_response",
          concept: "Retrieval practice",
          label: "Explain",
          title: "Explain why retrieval comes first",
          body: "Explain why attempting an answer before review reveals a useful learning gap.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: null,
          misconceptionSummary: null,
          choices: [],
          correctAnswer: "Trying first reveals which knowledge is available without visible support.",
          feedback: "A strong answer connects the unsupported attempt to finding what needs repair.",
        },
        {
          topicId,
          methodPhase: "repair",
          estimatedMinutes: 3,
          requiredForCompletion: true,
          type: "free_response",
          concept: "Retrieval practice",
          label: "Repair",
          title: "Repair the retrieval explanation",
          body: "The first explanation can blur attempting with reviewing. Correct relationship: attempt from memory first so the later comparison exposes the exact gap. Write that corrected relationship in your own words.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: null,
          misconceptionSummary: "Treats reviewing the answer as if it were the retrieval attempt.",
          choices: [],
          correctAnswer: "Retrieval comes before review so the unsupported attempt reveals the exact gap that needs correction.",
          feedback: "The corrected explanation must keep the unsupported attempt before answer review.",
        },
        {
          topicId,
          methodPhase: "reexplain",
          estimatedMinutes: 3,
          requiredForCompletion: true,
          type: "free_response",
          concept: "Retrieval practice",
          label: "Explain again",
          title: "Explain why retrieval comes first again",
          body: "Explain the corrected relationship again in plain language without copying the model or your repair sentence.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: null,
          misconceptionSummary: null,
          choices: [],
          correctAnswer: "Trying first shows what is available from memory, and checking afterward lets you repair only what was missing.",
          feedback: "The new explanation preserves retrieval before review and identifies why the order matters.",
        },
      ],
    },
    generation: {
      mode: "openai",
      persistence: "browser",
    },
  };
}

function scheduledReviewSessionResponse() {
  const response = streamedResumeSessionResponse();
  const topicId = response.session.topicIds[0];
  const baseQuestion = response.session.activities[1];
  const questions = [{
    title: "What drives net water movement?",
    body: "Across a selectively permeable membrane, what determines the net movement of water?",
    choices: ["The water-potential difference", "Only the membrane color", "The container label"],
    correctAnswer: "The water-potential difference",
    feedback: "Net movement follows the water-potential difference across the membrane.",
  }, {
    title: "What can cross the membrane?",
    body: "In this osmosis example, which substance crosses the selectively permeable membrane?",
    choices: ["Water", "Every solute equally", "Neither water nor solute"],
    correctAnswer: "Water",
    feedback: "The membrane permits water while restricting the relevant solute.",
  }, {
    title: "What happens at equilibrium?",
    body: "What best describes water movement at dynamic equilibrium?",
    choices: ["Movement continues both ways with no net change", "All molecular movement stops", "Water moves in only one direction"],
    correctAnswer: "Movement continues both ways with no net change",
    feedback: "At dynamic equilibrium, movement continues but the opposing rates balance.",
  }].map((question) => ({
    ...baseQuestion,
    topicId,
    estimatedMinutes: 1,
    concept: "Osmosis",
    label: "Scheduled check",
    ...question,
  }));

  return SessionGenerationResponseSchema.parse({
    ...response,
    session: {
      ...response.session,
      rationale: "Use exactly three self-contained questions to verify delayed retrieval without teaching first.",
      coverage: {
        focus: "Verify whether the osmosis relationship remains available after a delay.",
        essentialIdeas: ["Water moves from higher water potential toward lower water potential."],
        completionEvidence: ["Answer exactly three multiple-choice questions without teaching first"],
        evidenceMap: [{
          essentialIdea: "Water moves from higher water potential toward lower water potential.",
          activityConcept: "Osmosis",
        }],
        deferredContent: [],
      },
      sourceGrounding: {
        mode: "materials_only",
        summary: "The learner's osmosis notes define the exact relationship checked by this scheduled return.",
        sourceNames: ["osmosis-notes.txt"],
        anchors: [{
          chunkId: "68000000-0000-4000-8000-000000000004",
          sourceName: "osmosis-notes.txt",
          locationLabel: "Opening sentence",
          excerpt: "Water crosses a selectively permeable membrane toward the side with lower water potential.",
          usedFor: "This source statement anchors the delayed check about net water movement.",
        }],
        supplements: [],
      },
      methodBriefing: {
        ...response.session.methodBriefing,
        learningMode: "study",
        methodId: "retrieval_practice",
        name: "Scheduled retrieval",
        what: "Answer three self-contained multiple-choice questions without reopening the lesson.",
        why: "A delayed unsupported attempt reveals whether the relationship remains available.",
        how: [
          "Answer each question before reviewing its feedback.",
          "Continue until all three delayed checks are complete.",
        ],
        completion: "The learner answers all three scheduled questions.",
      },
      activities: questions,
    },
  });
}

function retrievalRoundResumeSessionResponse(
  plannedMinutes = 25,
  routeRevisionId?: string,
) {
  const response = streamedResumeSessionResponse(routeRevisionId);
  const retrievalActivity = response.session.activities[1]!;
  const repairActivity = response.session.activities[2]!;
  const modelActivity = response.session.activities[0]!;
  return SessionGenerationResponseSchema.parse({
    ...response,
    session: {
      ...response.session,
      schemaVersion: 15,
      cacheContext: {
        ...response.session.cacheContext,
        effectiveMinutes: plannedMinutes,
        scopeFingerprint: sessionCacheScopeFingerprint({
          plannedMinutes,
          adjustment: null,
          contractKey: null,
          routeRevisionId,
        }),
      },
      methodBriefing: {
        ...response.session.methodBriefing,
        learningMode: "study",
        methodId: "retrieval_practice",
        name: "Retrieval practice",
      },
      activities: [
        {
          ...retrievalActivity,
          methodPhase: "retrieve",
          methodRuntime: {
            kind: "retrieval_round",
            sourceClosedReminder: "Close your osmosis notes before answering.",
            prompts: [
              {
                prompt: "Why can water cross while the solute remains separated?",
                expectedAnswer: "A selectively permeable membrane allows water through while restricting that solute.",
                hint: "Focus on the membrane.",
              },
              {
                prompt: "What determines the net direction of water movement?",
                expectedAnswer: "Water moves from higher water potential toward lower water potential.",
                hint: "Compare water potential on the two sides.",
              },
              {
                prompt: "What happens at dynamic equilibrium?",
                expectedAnswer: "Water still crosses both ways, but there is no net movement.",
                hint: "Movement continues even when the net change is zero.",
              },
            ],
          },
        },
        {
          ...repairActivity,
          methodPhase: "repair",
        },
        {
          ...modelActivity,
          topicId: null,
          methodPhase: "reflect",
          requiredForCompletion: false,
          type: "reflection",
          concept: null,
          label: "Reflect",
          title: "Name what still needs another retrieval check",
          body: "Identify one osmosis detail that should return in a later closed-note check.",
          teaching: null,
          lessonBrief: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
      ],
    },
  });
}

function requestedRouteRevisionId(route: Route) {
  const payload: unknown = route.request().postDataJSON();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const routeRevisionId = (payload as Record<string, unknown>).routeRevisionId;
  return typeof routeRevisionId === "string" ? routeRevisionId : undefined;
}

function deferredGuidedSessionResponse(
  planSessionId: string,
  activeTopicId: string,
  targets: string[],
  evidence: string[],
) {
  const base = retrievalRoundResumeSessionResponse();
  const activityBase = {
    topicId: activeTopicId,
    estimatedMinutes: 4,
    requiredForCompletion: true,
    teaching: null,
    practiceIntent: null,
    misconceptionSummary: null,
    methodRuntime: null,
  } as const;
  return SessionGenerationResponseSchema.parse({
    ...base,
    planSessionId,
    session: {
      ...base.session,
      topicIds: [activeTopicId],
      rationale: "Use the current ten-minute window for glycolysis and preserve the electron transport target as exact next work.",
      coverage: {
        focus: "Retrieve the glycolysis relationship without notes.",
        essentialIdeas: ["Glycolysis converts glucose into pyruvate in the cytosol."],
        completionEvidence: [evidence[0]],
        evidenceMap: [{
          essentialIdea: "Glycolysis converts glucose into pyruvate in the cytosol.",
          activityConcept: "Glycolysis",
        }],
        deferredContent: [targets[1]],
      },
      methodBriefing: {
        ...base.session.methodBriefing,
        learningMode: "study",
        methodId: "retrieval_practice",
        name: "Retrieval practice",
        completion: "The learner retrieves and repairs the bounded glycolysis relationship independently.",
      },
      activities: [{
        ...activityBase,
        methodPhase: "retrieve",
        type: "multiple_choice",
        concept: "Glycolysis",
        label: "Recall",
        title: "Recall glycolysis",
        body: "Which statement accurately describes the central glycolysis relationship?",
        choices: [
          "Glucose becomes pyruvate in the cytosol",
          "Pyruvate becomes glucose in the nucleus",
          "Oxygen becomes glucose in the mitochondrion",
        ],
        correctAnswer: "Glucose becomes pyruvate in the cytosol",
        feedback: "Glycolysis converts glucose into pyruvate in the cytosol before later respiration stages.",
      }, {
        ...activityBase,
        methodPhase: "repair",
        type: "multiple_choice",
        concept: "Glycolysis repair",
        label: "Repair",
        title: "Repair the glycolysis model",
        body: "Which relationship completes the bounded model most accurately?",
        choices: [
          "Connect glucose conversion to pyruvate and ATP production",
          "Treat glycolysis as electron transport in the nucleus",
          "Treat oxygen as the only glycolysis input",
        ],
        correctAnswer: "Connect glucose conversion to pyruvate and ATP production",
        feedback: "The repaired model connects glucose conversion with pyruvate and a bounded ATP output.",
      }, {
        ...activityBase,
        topicId: null,
        methodPhase: "reflect",
        estimatedMinutes: 2,
        requiredForCompletion: false,
        type: "reflection",
        concept: null,
        label: "Reflect",
        title: "Name what should return",
        body: "Notice that the electron transport target remains saved as a separate next session.",
        choices: [],
        correctAnswer: null,
        feedback: null,
      }],
      cacheContext: {
        effectiveMinutes: 10,
        adjustmentFingerprint: "b".repeat(64),
        scopeFingerprint: `sc1:${"b".repeat(16)}`,
      },
    },
    generation: { mode: "openai", persistence: "browser" },
  });
}
