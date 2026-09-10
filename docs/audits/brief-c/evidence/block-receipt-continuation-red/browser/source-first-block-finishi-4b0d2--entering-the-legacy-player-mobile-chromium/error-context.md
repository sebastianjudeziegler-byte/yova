# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: source-first-block.spec.ts >> finishing the final source-first block persists completion and exits without entering the legacy player
- Location: e2e/source-first-block.spec.ts:60:5

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('region', { name: 'Session work block' }).getByRole('button', { name: 'Check answer', exact: true })
Expected: 0
Received: 1
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" with timeout 5000ms
  - waiting for getByRole('region', { name: 'Session work block' }).getByRole('button', { name: 'Check answer', exact: true })
    14 × locator resolved to 1 element
       - unexpected value "1"

```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - button "Open Next.js Dev Tools" [ref=f1e7] [cursor=pointer]
  - alert [ref=f1e11]
  - main [ref=f1e12]:
    - region "Session work block" [ref=f1e13]:
      - generic [ref=f1e14]:
        - generic [ref=f1e15]: Your block · about 25 minutes
        - heading "Explain ATP and energy transfer after working through a concrete example." [level=1] [ref=f1e16]
        - paragraph [ref=f1e17]: Read page 1, then answer the short practice check. Help is available without restarting your work.
        - paragraph [ref=f1e18]: You prefer examples and hints in a short focus window, so this check has two questions.
      - generic "Block progress" [ref=f1e19]: 2 of 3 steps finished
      - generic [ref=f1e20]:
        - heading "Check ATP and energy transfer" [level=2] [ref=f1e21]
        - text: Practice check
        - heading "In your own words, why can a cell couple ATP hydrolysis to an energy-requiring process?" [level=3] [ref=f1e22]
        - generic [ref=f1e23]:
          - text: Your answer
          - textbox "Your answer" [ref=f1e24]
        - button "Check answer" [disabled] [ref=f1e25]
        - button "Give me a hint" [ref=f1e26] [cursor=pointer]
        - generic [ref=f1e27]:
          - button "Reveal answer" [ref=f1e28] [cursor=pointer]
          - button "Report bad question" [ref=f1e29] [cursor=pointer]
        - generic [ref=f1e30]:
          - button "Explain this" [ref=f1e31] [cursor=pointer]
          - button "Show me an example" [ref=f1e32] [cursor=pointer]
      - generic [ref=f1e33]:
        - paragraph [ref=f1e34]: Finish the source section and attempt each practice question. Review the feedback; you may continue without repeating a question.
        - generic [ref=f1e35]:
          - button "Save and leave" [ref=f1e36] [cursor=pointer]
          - button "Finish block" [disabled] [ref=f1e37]
```

# Test source

```ts
  65  |   const snapshot: YovaPreviewSnapshot = { version: 1, account: { id: "c0000000-0000-4000-8000-000000000099", email: "block@example.com", displayName: "Learner", createdAt: NOW.toISOString(), identityMode: "preview" }, signedIn: true, onboardingAnswers: [], onboardingCompleted: true, alphaEntered: true, plans: [plan], sessionCompletions: [], sessionInterruptions: [], updatedAt: NOW.toISOString() };
  66  |   await page.addInitScript(value => { if (!localStorage.getItem("yova.preview.v1")) localStorage.setItem("yova.preview.v1", JSON.stringify(value)); }, snapshot);
  67  |   let prepared = 0;
  68  |   let explanationStreams = 0;
  69  |   const newProgress = (blockId: string) => ({ blockId, sourceCompletedIds: [] as string[], attempts: [] as Array<{ questionId: string; outcome: string; feedback: string; assisted: boolean }>, revealedQuestionIds: [] as string[], reportedQuestionIds: [] as string[], hintCounts: {} as Record<string, number>, helpRequestedQuestionIds: [] as string[], complete: false, receipt: null as string | null });
  70  |   const states = new Map<string, ReturnType<typeof newProgress>>();
  71  |   await page.route("**/api/sessions/generate", async route => {
  72  |     prepared += 1;
  73  |     const body = route.request().postDataJSON();
  74  |     const session = plan.sessions.find(item => item.id === body.planSessionId)!;
  75  |     const resource = blockFixture();
  76  |     resource.block.id = session.id;
  77  |     resource.routeRevisionId = body.routeRevisionId;
  78  |     resource.cacheContext.routeRevisionId = body.routeRevisionId;
  79  |     resource.cacheContext.effectiveMinutes = session.estimatedMinutes;
  80  |     resource.cacheContext.scopeFingerprint = sessionCacheScopeFingerprint({
  81  |       plannedMinutes: session.estimatedMinutes, adjustment: body.sessionAdjustment,
  82  |       contractKey: sessionCacheContractKey({ reviewType: null, reviewConcept: null, title: session.title, methodReason: session.methodReason, topicIds: session.topicIds!, contentTargets: session.contentTargets!, completionEvidence: session.completionEvidence!, knowledgeTopics: plan.knowledgeMap!.topics.filter(topic => session.topicIds!.includes(topic.id)) }),
  83  |       routeRevisionId: body.routeRevisionId,
  84  |     });
  85  |     resource.block.estimatedMinutes = session.estimatedMinutes;
  86  |     resource.methodBriefing.methodId = session.studyRoute!.approach.primaryMethodId;
  87  |     resource.methodBriefing.name = session.method;
  88  |     resource.methodBriefing.learningMode = session.learningMode!;
  89  |     resource.block.learningMode = session.learningMode!;
  90  |     resource.block.objective = session.objective;
  91  |     const sourced = session.topicIds!.includes(BLOCK_TOPIC_ID);
  92  |     if (!sourced) {
  93  |       resource.coverage.focus = session.objective;
  94  |       resource.coverage.essentialIdeas = ["Enzymes lower activation energy."];
  95  |       resource.coverage.evidenceMap = [{ essentialIdea: "Enzymes lower activation energy.", activityConcept: "Enzyme catalysis" }];
  96  |       resource.topicIds = [OTHER_TOPIC]; resource.block.topicIds = [OTHER_TOPIC]; resource.block.sources = [];
  97  |       resource.block.activities = resource.block.activities.map((item, index) => ({ ...item, topicId: OTHER_TOPIC, ...(index === 0 ? { kind: "ai_explanation", sourceId: null, title: "Learn enzyme catalysis", content: "Enzymes lower the activation energy needed for a reaction. They do not change the reaction's free-energy difference." } : {}) }));
  98  |       resource.block.questions = resource.block.questions.map((item, index) => ({ ...item, topicId: OTHER_TOPIC,
  99  |         prompt: index === 0 ? "What does an enzyme change about a reaction?" : "Why does lowering activation energy allow a reaction to proceed faster?",
  100 |         choices: index === 0 ? ["The activation energy", "The reaction's free-energy difference", "The identity of its products"] : [],
  101 |         hints: ["Separate the reaction barrier from its overall free-energy difference."], workedExample: null,
  102 |       }));
  103 |     }
  104 |     await route.fulfill({ json: { planSessionId: body.planSessionId, session: resource, generation: { mode: "openai", persistence: "browser" } } });
  105 |   });
  106 |   await page.route("**/api/sessions/block", async route => {
  107 |     const body = route.request().postDataJSON();
  108 |     const progress = states.get(body.blockId) ?? newProgress(body.blockId);
  109 |     states.set(body.blockId, progress);
  110 |     if (body.action === "source_complete" && !progress.sourceCompletedIds.includes(body.sourceId)) progress.sourceCompletedIds.push(body.sourceId);
  111 |     if (body.action === "help_requested" && !progress.helpRequestedQuestionIds.includes(body.questionId)) progress.helpRequestedQuestionIds.push(body.questionId);
  112 |     if (body.action === "continue_after_help" && !progress.attempts.some(item => item.questionId === body.questionId)) {
  113 |       expect(progress.helpRequestedQuestionIds).toContain(body.questionId);
  114 |       progress.attempts.push({ questionId: body.questionId, outcome: "unscored", assisted: true, feedback: "You continued after help; this is not independent evidence." });
  115 |     }
  116 |     if (body.action === "answer" && !progress.attempts.some(item => item.questionId === body.questionId)) progress.attempts.push({ questionId: body.questionId, outcome: "secure", assisted: progress.helpRequestedQuestionIds.includes(body.questionId), feedback: "You connected the correct ATP products with favorable energy transfer." });
  117 |     if (body.action === "complete") {
  118 |       expect(progress.sourceCompletedIds).toHaveLength(1); expect(progress.attempts).toHaveLength(2);
  119 |       progress.complete = true; progress.receipt = "You demonstrated ATP products in your short check; the answer after requesting help remains unverified, and enzyme catalysis comes next.";
  120 |     }
  121 |     await route.fulfill({ json: { progress, ...(progress.complete ? { summary: { correctAnswers: 1, totalAnswers: 1, conceptEvidence: [], observedGap: "No checked gap." } } : {}) } });
  122 |   });
  123 |   await page.route("**/api/sessions/block/explanation", route => {
  124 |     explanationStreams += 1;
  125 |     return route.fulfill({ contentType: "text/plain", body: "Enzymes lower the activation energy needed for a reaction. They do not change the reaction's free-energy difference." });
  126 |   });
  127 |   let helpRequests = 0;
  128 |   await page.route("**/api/tutor", route => {
  129 |     helpRequests += 1;
  130 |     if (helpRequests === 1) return route.fulfill({ status: 503, json: { error: "Help is temporarily unavailable. Your practice is saved." } });
  131 |     const threadId = "c0000000-0000-4000-8000-000000000098";
  132 |     return route.fulfill({ json: { threadId, model: "fixture-only", persistence: "ephemeral", proposedAction: null,
  133 |       messages: [
  134 |         { id: "c0000000-0000-4000-8000-000000000096", threadId, role: "user", content: "Show me one example.", createdAt: NOW.toISOString() },
  135 |         { id: "c0000000-0000-4000-8000-000000000097", threadId, role: "assistant", content: "A coupled favorable reaction can supply free energy for a process that requires energy. You may continue when ready.", createdAt: NOW.toISOString() },
  136 |       ],
  137 |     } });
  138 |   });
  139 |   await page.goto("/?qa=preview");
  140 |   await openNext(page);
  141 |   const block = page.getByRole("region", { name: "Session work block" });
  142 |   await expect(block).toContainText("Cellular energetics lecture.pdf");
  143 |   await expect(block).toContainText("Page 1");
  144 |   await expect(block.getByRole("button", { name: "Mark source done" })).toBeVisible();
  145 |   await page.screenshot({ path: testInfo.outputPath("01-source-first.png"), fullPage: true });
  146 |   await block.getByRole("button", { name: "Mark source done" }).click();
  147 |   await expect(block.getByRole("button", { name: "Finish block" })).toBeDisabled();
  148 |   await expect(block).toContainText("Which products");
  149 |   await block.getByRole("button", { name: "ADP and inorganic phosphate", exact: true }).click();
  150 |   await block.getByRole("button", { name: "Check answer", exact: true }).click();
  151 |   await block.getByRole("button", { name: "Continue", exact: true }).click();
  152 |   await expect(block).toContainText("why can a cell couple", { ignoreCase: true });
  153 |   await block.getByRole("button", { name: "Explain this", exact: true }).click();
  154 |   await expect(block.getByRole("alert")).toContainText("saved");
  155 |   await block.getByRole("button", { name: "Save and leave", exact: true }).click();
  156 |   await page.reload();
  157 |   await openNext(page);
  158 |   await expect(block).toContainText("why can a cell couple", { ignoreCase: true });
  159 |   expect(prepared).toBe(1);
  160 |   await page.screenshot({ path: testInfo.outputPath("02-resumed-check.png"), fullPage: true });
  161 |   if (finalBlock) {
  162 |     await block.getByRole("button", { name: "Show me an example", exact: true }).click();
  163 |     await expect(block).toContainText("You may continue when ready.");
  164 |     await block.getByRole("button", { name: "Continue", exact: true }).click();
> 165 |     await expect(block.getByRole("button", { name: "Check answer", exact: true })).toHaveCount(0);
      |                                                                                    ^ Error: expect(locator).toHaveCount(expected) failed
  166 |     await expect(block.getByRole("button", { name: "Finish block" })).toBeEnabled();
  167 |     expect([...states.values()][0]!.attempts[1]!.outcome).toBe("unscored");
  168 |   } else {
  169 |     await block.getByLabel("Your answer").fill("The favorable hydrolysis reaction supplies free energy to the coupled process.");
  170 |     await block.getByRole("button", { name: "Check answer", exact: true }).click();
  171 |     await block.getByRole("button", { name: "Continue", exact: true }).click();
  172 |   }
  173 |   await block.getByRole("button", { name: "Finish block" }).click();
  174 |   await expect(page.getByRole("status").filter({ hasText: "You demonstrated ATP" })).toBeVisible();
  175 |   await page.screenshot({ path: testInfo.outputPath("03-receipt.png"), fullPage: true });
  176 |   await page.getByRole("button", { name: "Finish and continue", exact: true }).click();
  177 |   const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("yova.preview.v1")!).plans[0] as LearningPlan);
  178 |   expect(saved.sessions[0]!.status).toBe("complete");
  179 |   expect(explanationStreams).toBe(0);
  180 |   if (finalBlock) {
  181 |     await expect(page.getByRole("button", { name: "Learning", exact: true })).toBeVisible();
  182 |     await page.reload();
  183 |     await expect(page.getByRole("button", { name: "Learning", exact: true })).toBeVisible();
  184 |     const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("yova.preview.v1")!).plans[0] as LearningPlan);
  185 |     expect(restored.sessions.every(session => session.status === "complete")).toBe(true);
  186 |     return;
  187 |   }
  188 |   await openNext(page);
  189 |   await expect(block.getByRole("heading", { name: "Learn enzyme catalysis" })).toBeVisible();
  190 |   await expect(block.getByRole("button", { name: "Mark source done" })).toHaveCount(0);
  191 |   // Development StrictMode may reopen the same read-only saved stream. The
  192 |   // invariant is no default stream for the PDF, with reviewed text streamed
  193 |   // for the unsourced topic and no additional block preparation.
  194 |   await expect.poll(() => explanationStreams).toBeGreaterThan(0);
  195 |   expect(prepared).toBe(2);
  196 |   await expect(block).toContainText("Enzymes lower the activation energy");
  197 |   await page.screenshot({ path: testInfo.outputPath("04-unsourced-explanation.png"), fullPage: true });
  198 | });
  199 | 
  200 | }
  201 | 
```