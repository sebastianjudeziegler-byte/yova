# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> the session tutor stays anchored to the exact learning activity
- Location: e2e/core-learning-loop.spec.ts:2518:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.session-setup-shell, .session-shell, .method-session-shell, .session-recovery-shell').or(getByRole('button', { name: /Start this session/ }))
Expected: visible
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 30000ms
  - waiting for locator('.session-setup-shell, .session-shell, .method-session-shell, .session-recovery-shell').or(getByRole('button', { name: /Start this session/ }))
  - Test timeout of 30000ms exceeded.

```

```yaml
- alert
- main:
  - text: YOVA PREPARING YOUR SESSION
  - 'heading "Preparing your next section: Compound growth and personal finance basics" [level=1]':
    - text: "Preparing your next section:"
    - emphasis: Compound growth and personal finance basics
  - paragraph: YOVA is choosing a focused objective, the right amount of support, and a clear way to show what you understood.
  - article:
    - strong: Focused content
    - text: Only the ideas that fit this session
  - article:
    - strong: Delivery
    - text: The task selects the method; your context adjusts the support
  - article:
    - strong: Teaching and practice
    - text: Explanation first when the topic is new
  - article:
    - strong: Completion evidence
    - text: Finished work, not elapsed time
  - status:
    - strong: Preparing the content and activity sequence.
    - text: 0:04 elapsed
  - button "Cancel"
```

# Test source

```ts
  4173 |       id: topic.id ?? null,
  4174 |       status: topic.status ?? null,
  4175 |     }));
  4176 | 
  4177 |     return {
  4178 |       planId: plan.id,
  4179 |       sessionId: session.id,
  4180 |       sessionSequence: session.sequence ?? 0,
  4181 |       sessionStatus: session.status ?? null,
  4182 |       sessionTopicIds: session.topicIds ?? [],
  4183 |       sessionContentTargets: session.contentTargets ?? [],
  4184 |       sessionCompletionEvidence: session.completionEvidence ?? [],
  4185 |       topicStatuses,
  4186 |       topicStatusesSerialized: JSON.stringify(topicStatuses),
  4187 |       verificationSession,
  4188 |       completion,
  4189 |     };
  4190 |   }, {
  4191 |     requestedPlanId: planId,
  4192 |     requestedSessionId: sessionId,
  4193 |   });
  4194 | }
  4195 | 
  4196 | async function readRecoveryState(page: Page) {
  4197 |   return page.evaluate(() => {
  4198 |     let checkpoints: Array<{ runId?: string; status?: string; completedSteps?: number }> = [];
  4199 |     let snapshot: {
  4200 |       plans?: Array<{ sessions?: Array<{ resource?: unknown }> }>;
  4201 |       sessionCompletions?: Array<{ id?: string }>;
  4202 |       sessionInterruptions?: unknown[];
  4203 |     } = {};
  4204 | 
  4205 |     try {
  4206 |       const rawCheckpoints = window.localStorage.getItem("yova.active-session-checkpoints.v1");
  4207 |       const parsedCheckpoints: unknown = rawCheckpoints ? JSON.parse(rawCheckpoints) : [];
  4208 |       checkpoints = Array.isArray(parsedCheckpoints)
  4209 |         ? parsedCheckpoints as Array<{ runId?: string; status?: string; completedSteps?: number }>
  4210 |         : [];
  4211 |     } catch {
  4212 |       checkpoints = [];
  4213 |     }
  4214 | 
  4215 |     try {
  4216 |       const rawSnapshot = window.localStorage.getItem("yova.preview.v1");
  4217 |       const parsedSnapshot: unknown = rawSnapshot ? JSON.parse(rawSnapshot) : {};
  4218 |       snapshot = parsedSnapshot && typeof parsedSnapshot === "object"
  4219 |         ? parsedSnapshot as typeof snapshot
  4220 |         : {};
  4221 |     } catch {
  4222 |       snapshot = {};
  4223 |     }
  4224 | 
  4225 |     const checkpoint = checkpoints.at(-1);
  4226 |     return {
  4227 |       checkpointStatus: checkpoint?.status ?? null,
  4228 |       completedSteps: checkpoint?.completedSteps ?? null,
  4229 |       lastCheckpointRunId: checkpoint?.runId ?? null,
  4230 |       sessionCompletions: snapshot.sessionCompletions?.length ?? 0,
  4231 |       completionId: snapshot.sessionCompletions?.at(-1)?.id ?? null,
  4232 |       sessionInterruptions: snapshot.sessionInterruptions?.length ?? 0,
  4233 |       hasSessionResource: Boolean(snapshot.plans?.[0]?.sessions?.[0]?.resource),
  4234 |     };
  4235 |   });
  4236 | }
  4237 | 
  4238 | async function completeOnboarding(page: Page) {
  4239 |   await page.getByRole("button", { name: /Personalize YOVA/ }).click();
  4240 | 
  4241 |   for (const [index, answer] of onboardingAnswers.entries()) {
  4242 |     await page.getByRole("button", { name: answer, exact: true }).click();
  4243 |     const nextLabel = index === onboardingAnswers.length - 1 ? "Build my setup" : "Continue";
  4244 |     await page.getByRole("button", { name: nextLabel }).click();
  4245 |   }
  4246 | 
  4247 |   await expect(page.getByRole("heading", { name: "YOVA will begin like this." })).toBeVisible();
  4248 |   await page.getByRole("button", { name: "Open YOVA" }).click();
  4249 | }
  4250 | 
  4251 | async function leaveSession(page: Page, progressText: string) {
  4252 |   await page.getByRole("button", { name: "Exit" }).dispatchEvent("click");
  4253 |   await expect(page.getByRole("dialog", { name: "Your plan will stay open." })).toContainText(progressText);
  4254 |   await page.getByRole("button", { name: "Save progress and leave" }).dispatchEvent("click");
  4255 | }
  4256 | 
  4257 | function recommendedLearningPlan(page: Page) {
  4258 |   return page.getByRole("region", { name: "Recommended learning plan" });
  4259 | }
  4260 | 
  4261 | async function expectSavedSessionRecommendation(page: Page, completedSteps?: number) {
  4262 |   const recommendation = recommendedLearningPlan(page);
  4263 |   await expect(recommendation.getByText("CONTINUE · PROGRESS SAVED", { exact: true })).toBeVisible();
  4264 |   await expect(recommendation.getByRole("button", { name: "Continue session" })).toBeVisible();
  4265 | 
  4266 |   if (completedSteps !== undefined) {
  4267 |     await expect(page.getByText(new RegExp(`^${completedSteps} of \\d+ sections? saved$`))).toBeVisible();
  4268 |   }
  4269 | }
  4270 | 
  4271 | async function confirmSessionSetup(page: Page) {
  4272 |   const review = page.getByRole("button", { name: /Start this session/ });
> 4273 |   await expect(page.locator(".session-setup-shell, .session-shell, .method-session-shell, .session-recovery-shell").or(review)).toBeVisible({ timeout: 30_000 });
       |                                                                                                                                 ^ Error: expect(locator).toBeVisible() failed
  4274 |   if (await review.isVisible()) { await review.click(); return; }
  4275 |   if (!await page.locator(".session-setup-shell").isVisible()) return;
  4276 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible({
  4277 |     timeout: 15_000,
  4278 |   });
  4279 |   await expect(page.getByLabel("Why YOVA chose this approach")).toBeVisible();
  4280 |   await page.getByRole("button", { name: "Continue" }).click();
  4281 |   await expect(page.getByRole("heading", { name: "Has anything changed?" })).toBeVisible();
  4282 |   await page.getByRole("button", { name: "Continue" }).click();
  4283 |   await expect(page.getByRole("heading", { name: "Set the pace for today." })).toBeVisible();
  4284 |   await page.getByRole("button", { name: "Prepare this session" }).click();
  4285 | }
  4286 | 
  4287 | async function createOneOffLearningSession(
  4288 |   page: Page,
  4289 |   request: string,
  4290 |   learningMode: "learn" | "study" = "learn",
  4291 | ) {
  4292 |   await page.getByRole("button", {
  4293 |     name: /^(?:Study something now|Study now Quick, off-plan)$/,
  4294 |   }).first().click();
  4295 |   await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(request);
  4296 |   await page.getByRole("button", {
  4297 |     name: learningMode === "learn"
  4298 |       ? "I haven't learned this yet"
  4299 |       : "I understand the basics but need practice",
  4300 |   }).click();
  4301 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  4302 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  4303 |   await page.getByRole("button", { name: /Build and start session/ }).click();
  4304 |   const ready = page.getByRole("button", { name: /Start this session/ });
  4305 |   await expect(ready.or(page.locator(".session-shell, .method-session-shell")).or(page.getByRole("button", { name: "Return to YOVA", exact: true }))).toBeVisible({ timeout: 30_000 });
  4306 |   if (await ready.isVisible()) await ready.click();
  4307 | }
  4308 | 
  4309 | async function exitSessionWithoutProgress(page: Page) {
  4310 |   await page.getByRole("button", { name: "Exit" }).dispatchEvent("click");
  4311 |   await expect(page.getByRole("dialog", { name: "Your plan will stay open." })).toBeVisible();
  4312 |   await page.getByRole("button", { name: "Save progress and leave" }).dispatchEvent("click");
  4313 | }
  4314 | 
  4315 | function practiceProblemsSessionResponse({
  4316 |   planSessionId,
  4317 |   routeRevisionId,
  4318 |   topicId,
  4319 | }: {
  4320 |   planSessionId: string;
  4321 |   routeRevisionId?: string;
  4322 |   topicId: string;
  4323 | }) {
  4324 |   const response = streamedResumeSessionResponse(routeRevisionId);
  4325 |   const question = response.session.activities[2]!;
  4326 |   const reflection = response.session.activities[0]!;
  4327 | 
  4328 |   return SessionGenerationResponseSchema.parse({
  4329 |     ...response,
  4330 |     planSessionId,
  4331 |     session: {
  4332 |       ...response.session,
  4333 |       topicIds: [topicId],
  4334 |       routingContext: {
  4335 |         taskType: "problem_solving",
  4336 |         knowledgeStage: "developing",
  4337 |       },
  4338 |       rationale: "Begin with a complete unsupported quotient-rule setup, repair only an observed miss, and then require a changed-context transfer problem.",
  4339 |       coverage: {
  4340 |         focus: "Apply the quotient rule independently and preserve its numerator order in a different function.",
  4341 |         essentialIdeas: ["The quotient rule differentiates the numerator and denominator in a fixed subtraction order and squares the original denominator."],
  4342 |         completionEvidence: ["Set up one representative quotient-rule derivative and one changed-context derivative without a shown solution."],
  4343 |         evidenceMap: [{
  4344 |           essentialIdea: "The quotient rule differentiates the numerator and denominator in a fixed subtraction order and squares the original denominator.",
  4345 |           activityConcept: "Quotient-rule numerator order",
  4346 |         }],
  4347 |         deferredContent: [],
  4348 |       },
  4349 |       methodBriefing: {
  4350 |         ...response.session.methodBriefing,
  4351 |         learningMode: "study",
  4352 |         taskType: "problem_solving",
  4353 |         methodId: "practice_problems",
  4354 |         name: "Practice Problems",
  4355 |         what: "Attempt one representative quotient-rule problem before feedback, then solve a changed-context problem.",
  4356 |         why: "An unsupported setup shows whether the learner can choose and apply the rule instead of only recognizing it.",
  4357 |         how: [
  4358 |           "Write the complete quotient-rule setup before looking at the comparison.",
  4359 |           "Repair only the exact gap exposed by the attempt.",
  4360 |           "Apply the same rule to a different numerator and denominator.",
  4361 |         ],
  4362 |         completion: "Complete the representative and changed-context problems without seeing either solution first.",
  4363 |       },
  4364 |       activities: [{
  4365 |         ...question,
  4366 |         topicId,
  4367 |         methodPhase: "independent_practice",
  4368 |         estimatedMinutes: 7,
  4369 |         type: "free_response",
  4370 |         concept: "Quotient-rule numerator order",
  4371 |         label: "Practice problem",
  4372 |         title: "Set up the quotient rule without support",
  4373 |         body: "Differentiate f(x) = (x² + 1) / (x - 3). Show the quotient-rule setup before simplifying.",
```