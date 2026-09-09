# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> a confident misconception is repaired now without a duplicate follow-up
- Location: e2e/core-learning-loop.spec.ts:220:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('YOVA\'S FORMATIVE CHECK')
Expected: visible
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByText('YOVA\'S FORMATIVE CHECK')
  - Test timeout of 30000ms exceeded.

```

```yaml
- alert
- main:
  - text: Help Me Review Cellular Respiration and Test What I Remember · Session 1 of 1
  - strong: Retrieve and apply Cellular respiration sequence
  - text: 2 of 6 required steps complete · 0:27 elapsed
  - button "Change direction"
  - button "Exit"
  - complementary:
    - group:
      - strong: Concept Mapping
      - text: Practice first · Step 3 of 6 · 5 learning phases
  - text: Your session was recovered. Completed sections are saved; an unfinished answer was not stored.
  - region "Method phase 3 of 5":
    - text: METHOD PHASE 3 OF 5
    - strong: Compare and repair
    - paragraph: Use feedback after the attempt to correct the exact missing or mistaken part.
    - emphasis: Feedback available
  - strong: Repair now, verify later
  - paragraph: Correct the idea now. YOVA will still check it again later because an immediate retry is not proof that it will stick.
  - 'region "Adaptive repair: One clue first"':
    - text: YOVA CHANGED THE SUPPORT
    - strong: One clue first
    - text: Why this changed
    - paragraph: You asked for a small hint when stuck, so YOVA is preserving another attempt before revealing the complete answer.
    - text: One bounded clue
    - heading "Use one clue, then retry Cellular respiration sequence" [level=2]
    - paragraph: Focus on the relationship involving Cellular respiration sequence in the original prompt. Name what changes, what stays fixed, and how the parts connect.
    - paragraph: "The target has not changed: explain or apply Cellular respiration sequence accurately without visible support."
  - text: STEP 3 OF 6
  - strong: REPAIR CHECK
  - text: About 2 min
  - heading "Use one clue, then retry Cellular respiration sequence" [level=1]
  - paragraph: The previous check exposed this exact gap. Answer the original Cellular respiration sequence prompt again using the clue, without copying the reference answer.
  - text: Corrected idea in your own words
  - textbox "Corrected idea in your own words" [disabled]:
    - /placeholder: Explain the corrected idea without copying the wording...
    - text: Glycolysis happens first, followed by the Krebs cycle and electron transport chain.
  - button "Checking your work..." [disabled]
  - button "I don't know yet" [disabled]
  - text: YOVA will show the model and record a gap without treating it as failure.
  - button "Continue" [disabled]
  - complementary:
    - button "Ask YOVA"
```

# Test source

```ts
  178 | 
  179 | test("streamed lesson quota uses its built-in explanation and surfaces the reset", async ({ page }) => {
  180 |   await page.route("**/api/sessions/generate", async (route) => {
  181 |     await route.fulfill({
  182 |       status: 200,
  183 |       contentType: "application/json",
  184 |       body: JSON.stringify(streamedResumeSessionResponse(requestedRouteRevisionId(route))),
  185 |     });
  186 |   });
  187 |   await page.route("**/api/sessions/lesson", async (route) => {
  188 |     await route.fulfill({
  189 |       status: 200,
  190 |       contentType: "text/event-stream",
  191 |       headers: {
  192 |         "Retry-After": "900",
  193 |         "X-Yova-Fallback-Reason": "guided_session_allowance_exhausted",
  194 |       },
  195 |       body: [
  196 |         'data: {"type":"lesson.meta","requestId":"86948113-b4be-423a-b0bc-d86aaae1ba7b","model":"built-in"}',
  197 |         "",
  198 |         'data: {"type":"lesson.replace","content":"# Allowance-safe explanation\\n\\nThis bounded explanation came from the validated lesson brief without another AI call."}',
  199 |         "",
  200 |         'data: {"type":"lesson.complete","deliveryMode":"bounded_fallback","elapsedMs":0,"latencyToFirstTokenMs":null,"inputTokens":0,"cachedInputTokens":0,"outputTokens":0,"wordCount":15,"model":"built-in"}',
  201 |         "",
  202 |         "",
  203 |       ].join("\n"),
  204 |     });
  205 |   });
  206 |   await createPreviewAccount(page);
  207 |   await completeOnboarding(page);
  208 | 
  209 |   await createOneOffLearningSession(page, "Help me understand retrieval practice and test the idea.");
  210 | 
  211 |   await expect(page.getByText("Allowance-safe explanation")).toBeVisible();
  212 |   await expect(page.getByText("Safe built-in lesson", { exact: true })).toBeVisible();
  213 |   const allowanceNotice = page.locator(".session-issue").filter({
  214 |     hasText: "Your guided-session allowance is used up until",
  215 |   });
  216 |   await expect(allowanceNotice).toContainText("A safe built-in explanation was loaded instead");
  217 |   await expect(page.getByText("LESSON SERVICE INTERRUPTED", { exact: true })).toHaveCount(0);
  218 | });
  219 | 
  220 | test("a confident misconception is repaired now without a duplicate follow-up", async ({ page }) => {
  221 |   await page.route("**/api/sessions/generate", async (route) => {
  222 |     await route.fulfill({
  223 |       status: 503,
  224 |       contentType: "application/json",
  225 |       body: JSON.stringify({ error: "Temporary guided-session generation failure." }),
  226 |     });
  227 |   });
  228 |   await createPreviewAccount(page);
  229 |   await completeOnboarding(page);
  230 | 
  231 |   await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Learner$/ })).toBeVisible();
  232 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  233 | 
  234 |   await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
  235 |     "Help me review cellular respiration and test what I remember.",
  236 |   );
  237 |   await page.getByRole("button", { name: "I know it and want to test my recall" }).click();
  238 |   await expect(page.getByText("Starting approach: Practice first.")).toBeVisible();
  239 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  240 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  241 |   await page.getByRole("button", { name: /Build and start session/ }).click();
  242 | 
  243 | 
  244 |   await expect(page.getByRole("heading", { name: "Closed-note retrieval" })).toBeVisible();
  245 |   await openMobileSessionGuide(page);
  246 |   await expect(page.getByText("How YOVA adapted this").filter({ visible: true }).first()).toBeVisible();
  247 |   await expect(page.getByText(/asked for concrete examples before rules/i).filter({ visible: true }).first()).toBeVisible();
  248 |   await expect(page.locator(".session-method-playbook:visible")).toContainText("WHY THIS METHOD");
  249 |   await expect(page.locator(".session-method-playbook:visible")).toContainText("Use it like this");
  250 |   await expect(page.getByLabel("Support progression").first()).toContainText("Start without support");
  251 |   const retrievalRoadmap = page.getByLabel("Session method sequence").first();
  252 |   await expect(retrievalRoadmap).toContainText("Attempt from memory");
  253 |   await expect(retrievalRoadmap).toContainText("Compare and repair");
  254 |   await expect(page.getByLabel("Method phase 1 of 3")).toContainText("Orient to the target");
  255 |   await expect(page.getByText(/Try to produce each answer before looking/)).toBeVisible();
  256 |   await page.getByRole("button", { name: "Continue" }).click();
  257 | 
  258 |   await page.getByRole("button", { name: "Very sure" }).click();
  259 |   await page.getByRole("button", { name: "Krebs cycle" }).click();
  260 |   await expect(page.getByText(/possible misconception/i)).toBeVisible();
  261 |   await page.getByRole("button", { name: "Repair this idea" }).click();
  262 | 
  263 |   await expect(page.getByText("Repair now, verify later")).toBeVisible({ timeout: 15_000 });
  264 |   await expect(page.getByText("YOVA CHANGED THE SUPPORT")).toBeVisible();
  265 |   const adaptiveRepair = page.getByRole("region", { name: "Adaptive repair: One clue first" });
  266 |   await expect(adaptiveRepair).toBeVisible();
  267 |   await expect(adaptiveRepair).toContainText(/asked for a small hint when stuck/i);
  268 |   await leaveSession(page, "2 of 6 required steps finished");
  269 |   await expectSavedSessionRecommendation(page, 2);
  270 |   await page.getByRole("button", { name: "Continue session" }).click();
  271 |   await expect(page.getByText("Repair now, verify later")).toBeVisible();
  272 |   await expect(page.locator(".session-activity-header").getByRole("heading", { name: /Use one clue, then retry Cellular respiration sequence/i })).toBeVisible();
  273 |   await expect(page.getByText(/not saved as proof of mastery/i)).not.toBeVisible();
  274 |   await page.getByLabel("Corrected idea in your own words").fill(
  275 |     "Glycolysis happens first, followed by the Krebs cycle and electron transport chain.",
  276 |   );
  277 |   await page.getByRole("button", { name: "Check my answer" }).dispatchEvent("click");
> 278 |   await expect(page.getByText("YOVA'S FORMATIVE CHECK")).toBeVisible({ timeout: 15_000 });
      |                                                          ^ Error: expect(locator).toBeVisible() failed
  279 |   await expect(page.getByText("The key idea is present.")).toBeVisible();
  280 |   await page.getByRole("button", { name: "I got the key idea" }).click();
  281 |   await expect(page.getByText(/required recheck records whether the repaired concept now holds/i)).toBeVisible();
  282 |   await page.getByRole("button", { name: "Continue" }).click();
  283 | 
  284 |   await page.getByRole("button", { name: "Somewhat sure" }).click();
  285 |   await page.getByRole("button", { name: "Cytoplasm" }).click();
  286 |   await page.getByRole("button", { name: "Continue" }).click();
  287 | 
  288 |   await page.getByLabel("Attempt from memory").fill(
  289 |     "Glycolysis occurs in the cytoplasm and does not directly require oxygen.",
  290 |   );
  291 |   await page.getByRole("button", { name: "Check my answer" }).dispatchEvent("click");
  292 |   await page.getByRole("button", { name: "I got the key idea" }).click();
  293 |   await page.getByRole("button", { name: "Continue" }).click();
  294 |   await page.getByRole("button", { name: "Finish this content" }).click();
  295 | 
  296 |   await expect(page.getByRole("heading", { name: "Today’s checks held up." })).toBeInViewport();
  297 |   await expect(page.getByRole("heading", { name: "The work is done. One part needs another check." })).not.toBeVisible();
  298 |   await expect(page.getByText("2 of 3", { exact: true })).toBeVisible();
  299 |   await expect(page.getByText("Initial evidence checks")).toBeVisible();
  300 |   await expect(page.getByText("Correct before in-session repair")).toBeVisible();
  301 |   await expect(page.getByText("Recorded, not graded")).toBeVisible();
  302 |   await expect(page.getByText("No gap remains after today’s required repairs.")).toBeVisible();
  303 |   const receipt = page.getByRole("region", { name: "What this session can change" });
  304 |   await expect(receipt).toContainText("Showing strength in this session: Cellular respiration sequence");
  305 |   await expect(receipt).not.toContainText("Needs another check: Cellular respiration sequence");
  306 |   await expect(receipt).not.toContainText("not been confirmed by an attempt in this session");
  307 |   await expect(page.getByText(/the successful repair means no duplicate follow-up is needed/i)).toBeVisible();
  308 |   await expect(page.getByText("Cellular respiration sequence", { exact: true }).first()).toBeVisible();
  309 |   await expect(page.getByText("NO CHANGE NEEDED")).toBeVisible();
  310 |   await expect(page.getByRole("heading", { name: "Complete this learning item" })).toBeVisible();
  311 |   await expect(page.getByText(/today’s evidence does not require another scheduled check/i)).toBeVisible();
  312 |   await expect(page.getByRole("heading", { name: "Add a short delayed check" })).not.toBeVisible();
  313 |   await page.getByRole("button", { name: "Finish and continue" }).click();
  314 |   await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Learner$/ })).toBeVisible();
  315 | });
  316 | 
  317 | test("Practice Problems starts with an unsupported written attempt, repairs a miss, then changes context", async ({ page }) => {
  318 |   type ProblemPracticeGenerationRequest = {
  319 |     planSessionId: string;
  320 |     routeRevisionId?: string;
  321 |     previewContext?: {
  322 |       studyRoute?: { approach?: { primaryMethodId?: string } };
  323 |       session?: { topicIds?: string[] };
  324 |     };
  325 |   };
  326 |   const generationRequests: ProblemPracticeGenerationRequest[] = [];
  327 | 
  328 |   await page.route("**/api/sessions/generate", async (route) => {
  329 |     const generationRequest = route.request().postDataJSON() as ProblemPracticeGenerationRequest;
  330 |     generationRequests.push(generationRequest);
  331 |     const topicId = generationRequest.previewContext?.session?.topicIds?.[0];
  332 |     if (!generationRequest.planSessionId || !topicId) {
  333 |       throw new Error("Expected the committed problem-practice session and its topic in the generation request.");
  334 |     }
  335 |     await route.fulfill({
  336 |       status: 200,
  337 |       contentType: "application/json",
  338 |       body: JSON.stringify(practiceProblemsSessionResponse({
  339 |         planSessionId: generationRequest.planSessionId,
  340 |         routeRevisionId: generationRequest.routeRevisionId,
  341 |         topicId,
  342 |       })),
  343 |     });
  344 |   });
  345 |   await page.route("**/api/sessions/evaluate", async (route) => {
  346 |     await route.fulfill({
  347 |       status: 200,
  348 |       contentType: "application/json",
  349 |       body: JSON.stringify({
  350 |         verdict: "secure",
  351 |         feedback: "The corrected setup keeps the low-function derivative first and squares the original denominator.",
  352 |         matchedIdeas: ["The quotient-rule numerator order and denominator square are both present."],
  353 |         missingIdeas: [],
  354 |         mode: "preview",
  355 |       }),
  356 |     });
  357 |   });
  358 | 
  359 |   await createPreviewAccount(page);
  360 |   await completeOnboarding(page);
  361 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  362 |   await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
  363 |     "Give me quotient-rule practice problems so I can test whether I can solve them independently.",
  364 |   );
  365 |   await page.getByRole("button", { name: "I understand the basics but need practice" }).click();
  366 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  367 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  368 |   await page.getByRole("button", { name: /Build and start session/ }).click();
  369 |   await confirmSessionSetup(page);
  370 | 
  371 |   expect(generationRequests[0]?.previewContext?.studyRoute?.approach?.primaryMethodId).toBe("practice_problems");
  372 |   await expect(page.getByRole("heading", { name: "Set up the quotient rule without support" })).toBeVisible();
  373 |   await expect(page.getByLabel("Method phase 1 of 3")).toContainText("Perform independently");
  374 |   await expect(page.getByLabel("Show your reasoning")).toBeVisible();
  375 |   await expect(page.locator(".answer-grid")).toHaveCount(0);
  376 |   await expect(page.locator(".teaching-lesson")).toHaveCount(0);
  377 | 
  378 |   await page.getByRole("button", { name: "Somewhat sure" }).click();
```