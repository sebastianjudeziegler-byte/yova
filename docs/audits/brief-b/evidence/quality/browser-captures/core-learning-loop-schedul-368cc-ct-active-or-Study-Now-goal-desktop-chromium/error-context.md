# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> scheduled-review setup stays fixed and opens the exact active or Study Now goal
- Location: e2e/core-learning-loop.spec.ts:3050:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByLabel('Add source materials')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByLabel('Add source materials')

```

```yaml
- alert
- link "Skip to main content":
  - /url: "#main-content"
- banner:
  - text: YOVA
  - navigation "Main navigation":
    - button "Home"
    - button "Learning"
    - button "Calendar"
    - button "Ask YOVA"
    - button "You"
  - button "Add to YOVA": Add
  - text: L
  - button "Sign out on this device"
- main:
  - text: LEARNING
  - heading "What you’re working toward" [level=1]
  - paragraph: Every goal keeps its plan, materials, sessions, and progress in one place.
  - button "New plan"
  - navigation "Learning sections":
    - button "Active 1"
    - button "Recent 1"
    - button "Archive 0"
    - button "Methods 12"
  - button "All recent learning"
  - text: TOPIC · FLEXIBLE
  - heading "Study Now Osmosis Practice" [level=2]
  - paragraph: Osmosis and water potential
  - text: Practice, diagnose, and repair 0 of 2 sessions complete
  - button "Start next session"
  - button "Adjust"
  - button "Archive"
  - text: Plan state
  - strong: Unfinished work
  - text: Knowledge-check accuracy
  - strong: No data
  - text: Last session felt
  - strong: Not rated
  - heading "Sessions in this study" [level=3]
  - paragraph: Completed sessions are checked. Unfinished sessions remain listed without being counted as completed.
  - text: 2 sessions
  - strong: Verify osmosis and water potential
  - text: Practice first · Independent retrieval verification · Thu 5:00 AM 10 min
  - strong: Reconnect the idea with a trusted source
  - text: Teaching first · Read, recall, review · Fri 5:00 AM 15 min
  - heading "Learning source" [level=3]
  - button "Add file or link"
  - strong: osmosis-notes.txt
  - text: 148 B · Private source for this goal
  - heading "Study resources" [level=3]
  - paragraph: Reusable explanations and practice, attached to the session that needed them.
  - text: Created when relevant
  - strong: Nothing extra to browse yet
  - paragraph: YOVA creates the teaching and practice needed for a session when you first start it. Those resources will stay here afterward.
- contentinfo:
  - navigation "Trust and support":
    - link "Support":
      - /url: /support
    - link "Privacy":
      - /url: /privacy
    - link "Terms":
      - /url: /terms
```

# Test source

```ts
  3112 |       kind: "topic",
  3113 |       deadline: null,
  3114 |       status: "active",
  3115 |       sourceMode: "yova_generated",
  3116 |       studyMode: "inside_yova",
  3117 |       learningIntent: "study",
  3118 |       creationIntent: "plan",
  3119 |       sessionArchitectureVersion: "filled_teaching_v1",
  3120 |       rationale: "Use a delayed return to check the relationship without reteaching first.",
  3121 |       createdAt: "2026-08-20T10:00:00.000Z",
  3122 |       materials: [],
  3123 |       sessions: [scheduledReview({
  3124 |         id: "67000000-0000-4000-8000-000000000011",
  3125 |         title: "Verify mantle convection",
  3126 |         concept: "Mantle convection and plate motion",
  3127 |         includeExactArrays: true,
  3128 |       })],
  3129 |     }, {
  3130 |       id: "68000000-0000-4000-8000-000000000001",
  3131 |       learningItemId: "68000000-0000-4000-8000-000000000002",
  3132 |       title: "Study Now Osmosis Practice",
  3133 |       topic: "Osmosis and water potential",
  3134 |       kind: "topic",
  3135 |       deadline: null,
  3136 |       status: "active",
  3137 |       sourceMode: "user_materials",
  3138 |       studyMode: "outside_yova",
  3139 |       learningIntent: "study",
  3140 |       creationIntent: "study_now",
  3141 |       sessionArchitectureVersion: "filled_teaching_v1",
  3142 |       rationale: "Use a delayed return to check the relationship without reteaching first.",
  3143 |       createdAt: "2026-08-20T11:00:00.000Z",
  3144 |       materials: [{
  3145 |         id: "68000000-0000-4000-8000-000000000003",
  3146 |         name: "osmosis-notes.txt",
  3147 |         mimeType: "text/plain",
  3148 |         sizeBytes: 148,
  3149 |         textContent: "Water crosses a selectively permeable membrane toward the side with lower water potential.",
  3150 |         processingStatus: "ready",
  3151 |       }],
  3152 |       sessions: [scheduledReview({
  3153 |         id: "68000000-0000-4000-8000-000000000011",
  3154 |         title: "Verify osmosis and water potential",
  3155 |         concept: "Osmosis and water potential",
  3156 |         // Production still contains a legacy reviewConcept-only row. Setup and
  3157 |         // preview generation must keep that row usable without inventing an
  3158 |         // adjustment or requiring newly persisted arrays.
  3159 |         includeExactArrays: false,
  3160 |       }), {
  3161 |         id: "68000000-0000-4000-8000-000000000012",
  3162 |         sequence: 2,
  3163 |         title: "Reconnect the idea with a trusted source",
  3164 |         objective: "Review the trusted source, then explain the relationship independently.",
  3165 |         method: "Read, recall, review",
  3166 |         methodReason: "Ordinary unfinished work can provide teaching without changing the scheduled check.",
  3167 |         scheduledFor: "2026-08-21T12:00:00.000Z",
  3168 |         estimatedMinutes: 15,
  3169 |         amountLabel: "One source review and one independent explanation",
  3170 |         learningMode: "learn",
  3171 |         topicIds: ["68000000-0000-4000-8000-000000000019"],
  3172 |         contentTargets: ["Osmosis and water potential"],
  3173 |         completionEvidence: ["Explain the relationship without reopening the source"],
  3174 |         status: "upcoming",
  3175 |       }],
  3176 |     }];
  3177 |     snapshot.updatedAt = new Date().toISOString();
  3178 |     window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  3179 |   });
  3180 | 
  3181 |   const allowanceResponse = page.waitForResponse((response) => (
  3182 |     response.url().includes("/api/sessions/allowance")
  3183 |   ));
  3184 |   await page.reload();
  3185 |   await allowanceResponse;
  3186 |   await expect(page.getByRole("button", { name: "Study now Quick, off-plan" })).toBeEnabled();
  3187 |   await expect(page.getByLabel("Guided-session allowance")).toHaveCount(0);
  3188 |   await page.getByRole("button", { name: "Learning", exact: true }).click();
  3189 | 
  3190 |   const activeCard = page.locator(".learning-goal-card").filter({ hasText: "Active Plate Motion Goal" });
  3191 |   await activeCard.getByRole("button", { name: "Start next" }).click();
  3192 |   await expect(page.getByRole("heading", { name: "Confirm this quick verification." })).toBeVisible();
  3193 |   await page.getByRole("button", { name: "Continue" }).click();
  3194 |   await page.getByRole("button", { name: "Open the goal instead" }).click();
  3195 |   await expect(page.locator(".tabs").getByRole("button", { name: /^Active/ })).toHaveClass(/active/);
  3196 |   await expect(page.getByRole("heading", { name: "Active Plate Motion Goal" })).toBeVisible();
  3197 | 
  3198 |   await page.locator(".tabs").getByRole("button", { name: /^Recent/ }).click();
  3199 |   const studyNowCard = page.locator(".learning-goal-card").filter({ hasText: "Study Now Osmosis Practice" });
  3200 |   await studyNowCard.getByRole("button", { name: "Open goal" }).click();
  3201 |   await page.getByRole("button", { name: "Start next session" }).click();
  3202 |   await expect(page.getByText("Exactly 3 multiple-choice questions", { exact: false })).toBeVisible();
  3203 |   await page.getByRole("button", { name: "Continue" }).click();
  3204 |   await expect(page.getByRole("heading", { name: "This return check has a fixed starting point." })).toBeVisible();
  3205 |   await expect(page.getByRole("button", { name: "I need this taught first" })).toHaveCount(0);
  3206 |   await expect(page.getByRole("group", { name: "Support for this session" })).toHaveCount(0);
  3207 |   await expect(page.getByLabel("Time available right now")).toHaveCount(0);
  3208 |   await expect(page.getByLabel("Anything YOVA should account for?")).toHaveCount(0);
  3209 |   await page.getByRole("button", { name: "Open the goal instead" }).click();
  3210 |   await expect(page.locator(".tabs").getByRole("button", { name: /^Recent/ })).toHaveClass(/active/);
  3211 |   await expect(page.getByRole("heading", { name: "Study Now Osmosis Practice" })).toBeVisible();
> 3212 |   await expect(page.getByLabel("Add source materials")).toBeVisible();
       |                                                         ^ Error: expect(locator).toBeVisible() failed
  3213 |   await expect(page.getByText("osmosis-notes.txt", { exact: true })).toBeVisible();
  3214 |   await page.getByRole("button", { name: "Adjust", exact: true }).click();
  3215 |   await expect(page.getByRole("heading", { name: "Change the plan without losing progress" })).toBeVisible();
  3216 |   await expect(page.getByText("1 scheduled review keeps the original duration, concept, and return time.", { exact: false })).toBeVisible();
  3217 |   await page.getByRole("button", { name: "Close", exact: true }).click();
  3218 | 
  3219 |   await page.getByRole("button", { name: "Start next session" }).click();
  3220 |   await page.getByRole("button", { name: "Continue" }).click();
  3221 |   await page.getByRole("button", { name: "Prepare scheduled review" }).click();
  3222 |   await expect.poll(() => generationRequests.length).toBe(1);
  3223 |   await expect(page.locator(".session-activity-header").getByRole("heading", { name: "What drives net water movement?" })).toBeVisible();
  3224 |   await expect(page.locator(".session-step-meta")).toContainText("STEP 1 OF 3");
  3225 |   await expect(page.getByLabel("Study-method workpad")).toHaveCount(0);
  3226 |   await expect(page.getByLabel("Guided teaching sequence")).toHaveCount(0);
  3227 |   await expect(page.getByLabel("Live YOVA lesson")).toHaveCount(0);
  3228 |   await openMobileSessionGuide(page);
  3229 |   await expect(page.getByLabel("Scheduled review learning support locked").filter({ visible: true })).toBeVisible();
  3230 |   await expect(page.getByRole("button", { name: "Ask YOVA is locked during this scheduled review" })).toBeDisabled();
  3231 |   await expect(page.getByLabel("Quick help options")).toHaveCount(0);
  3232 |   await expect(page.getByText("Water moves from higher water potential toward lower water potential.", { exact: true })).toHaveCount(0);
  3233 |   await expect(page.getByText("Water crosses a selectively permeable membrane toward the side with lower water potential.", { exact: true })).toHaveCount(0);
  3234 | 
  3235 |   await page.getByRole("button", { name: "The water-potential difference", exact: true }).click();
  3236 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  3237 |   await page.getByRole("button", { name: "Water", exact: true }).click();
  3238 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  3239 |   await page.getByRole("button", { name: "Movement continues both ways with no net change", exact: true }).click();
  3240 | 
  3241 |   await expect(page.getByRole("button", { name: "Ask YOVA", exact: true })).toBeVisible();
  3242 |   await openMobileSessionGuide(page);
  3243 |   await page.getByText("Content and sources", { exact: true }).filter({ visible: true }).click();
  3244 |   await expect(page.getByLabel("Session source coverage").filter({ visible: true })).toContainText("osmosis-notes.txt");
  3245 |   await page.getByText("See what YOVA used", { exact: true }).filter({ visible: true }).click();
  3246 |   await expect(page.getByLabel("Session source coverage").filter({ visible: true })).toContainText("Water crosses a selectively permeable membrane toward the side with lower water potential.");
  3247 |   expect(generationRequests[0]).not.toHaveProperty("sessionAdjustment");
  3248 |   expect(generationRequests[0]).toMatchObject({
  3249 |     planId: "68000000-0000-4000-8000-000000000001",
  3250 |     planSessionId: "68000000-0000-4000-8000-000000000011",
  3251 |     previewContext: {
  3252 |       session: {
  3253 |         learningMode: "study",
  3254 |         reviewConcept: "Osmosis and water potential",
  3255 |         reviewType: "verify",
  3256 |       },
  3257 |     },
  3258 |   });
  3259 | });
  3260 | 
  3261 | test("a normal conceptual plan visibly moves from Learn to later Practice and commits both route modes", async ({ page }) => {
  3262 |   await createPreviewAccount(page);
  3263 |   await completeOnboarding(page);
  3264 | 
  3265 |   await beginPlanFromAdd(page, "I have never studied cellular respiration. Teach me from scratch for my exam in three weeks.");
  3266 |   await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  3267 |   await page.getByRole("button", { name: "45 minutes", exact: true }).click();
  3268 |   await page.getByRole("button", { name: "Continue" }).click();
  3269 |   await page.getByRole("button", { name: "Skip for now" }).click();
  3270 |   await page.getByRole("button", { name: "Generate my plan" }).click();
  3271 |   await expect(page.getByText("Plan ready")).toBeVisible({ timeout: 30_000 });
  3272 | 
  3273 |   const visibleDraftRoutes = await page.locator(".generated-timeline article").evaluateAll((articles) => (
  3274 |     articles.map((article) => ({
  3275 |       title: article.querySelector("h3")?.textContent?.trim() ?? "",
  3276 |       modeLabel: article.querySelector("small")?.textContent?.trim() ?? "",
  3277 |     }))
  3278 |   ));
  3279 |   const visibleLearnIndex = visibleDraftRoutes.findIndex((session) => (
  3280 |     session.modeLabel.startsWith("TEACHING FIRST")
  3281 |   ));
  3282 |   const visiblePracticeIndex = visibleDraftRoutes.findIndex((session, index) => (
  3283 |     index > visibleLearnIndex && session.modeLabel.startsWith("PRACTICE FIRST")
  3284 |   ));
  3285 |   expect(visibleLearnIndex, JSON.stringify(visibleDraftRoutes)).toBeGreaterThanOrEqual(0);
  3286 |   expect(visiblePracticeIndex, JSON.stringify(visibleDraftRoutes)).toBeGreaterThan(visibleLearnIndex);
  3287 | 
  3288 |   await page.getByRole("button", { name: "Use this plan" }).click();
  3289 |   await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
  3290 | 
  3291 |   const activatedRoutes = await page.evaluate(() => {
  3292 |     const raw = window.localStorage.getItem("yova.preview.v1");
  3293 |     if (!raw) throw new Error("Expected the activated conceptual plan in preview storage.");
  3294 |     const snapshot = JSON.parse(raw) as { plans?: LearningPlan[] };
  3295 |     const plan = snapshot.plans?.at(-1);
  3296 |     if (!plan) throw new Error("Expected the latest activated conceptual plan.");
  3297 |     return plan.sessions.map((session) => ({
  3298 |       title: session.title,
  3299 |       learningMode: session.learningMode,
  3300 |       routeMode: session.studyRoute?.approach.mode ?? null,
  3301 |       lifecycle: session.studyRoute?.identity.lifecycleStatus ?? null,
  3302 |     }));
  3303 |   });
  3304 |   expect(activatedRoutes.map((session) => session.title)).toEqual(
  3305 |     visibleDraftRoutes.map((session) => session.title),
  3306 |   );
  3307 |   const committedLearnIndex = activatedRoutes.findIndex((session) => (
  3308 |     session.learningMode === "learn" && session.routeMode === "learn"
  3309 |   ));
  3310 |   const committedPracticeIndex = activatedRoutes.findIndex((session, index) => (
  3311 |     index > committedLearnIndex
  3312 |     && session.learningMode === "study"
```