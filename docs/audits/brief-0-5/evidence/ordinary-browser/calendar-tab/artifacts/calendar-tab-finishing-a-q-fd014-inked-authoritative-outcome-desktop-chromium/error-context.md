# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: calendar-tab.spec.ts >> finishing a quick-add plan replaces the manual deadline with one linked authoritative outcome
- Location: e2e/calendar-tab.spec.ts:164:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Skip for now' })

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]
  - alert [ref=e11]
  - main [ref=e12]:
    - generic [ref=e13]:
      - generic [ref=e14]: YOVA
      - generic [ref=e17]: Step 4 of 5
      - button "Exit" [ref=e18] [cursor=pointer]
    - generic [ref=e21]:
      - heading "Preparing a short placement check…" [level=1] [ref=e26]
      - paragraph [ref=e27]: YOVA is sampling prerequisite and central topics from your knowledge map.
      - generic [ref=e28]:
        - generic [ref=e29]: Mapping the goal
        - generic [ref=e32]: Writing self-contained questions
```

# Test source

```ts
  79  |   await expect(confirmation.getByLabel("Type")).toHaveValue("deadline");
  80  |   await expect(confirmation.getByLabel("Duration")).toHaveValue("90");
  81  |   await expect(confirmation.getByLabel("Calendar time")).not.toHaveValue("");
  82  |   await expect(confirmation.getByLabel("Due time")).not.toHaveValue("");
  83  |   await expect(confirmation.getByRole("button", { name: "Save and build plan" })).toBeVisible();
  84  | 
  85  |   expect(await storedManualEvents(page)).toEqual([]);
  86  |   await confirmation.getByRole("button", { name: "Save to calendar" }).click();
  87  |   await expect(page.locator(".calendar-block-detail").getByRole("heading", { name: "Stats Pset", exact: true })).toBeVisible();
  88  | 
  89  |   let stored = await storedManualEvents(page);
  90  |   expect(stored).toHaveLength(1);
  91  |   expect(stored[0]).toMatchObject({
  92  |     title: "Stats Pset",
  93  |     eventType: "deadline",
  94  |     fixed: false,
  95  |     done: false,
  96  |     durationMinutes: 90,
  97  |   });
  98  | 
  99  |   await page.reload();
  100 |   await openCalendarTab(page);
  101 |   await page.getByRole("button", { name: /^Stats Pset, / }).click();
  102 |   const detail = page.locator(".calendar-block-detail");
  103 |   await expect(detail).toContainText("Why here");
  104 |   await expect(detail).toContainText("Added manually. YOVA has not inferred a placement reason.");
  105 |   await expect(detail).toContainText("Fully editable because you added it manually.");
  106 |   await expect(detail.getByRole("button", { name: "Build plan" })).toBeVisible();
  107 | 
  108 |   await detail.getByRole("button", { name: "Close calendar detail" }).click();
  109 |   const changes = page.locator(".calendar-change-log");
  110 |   await changes.getByText(/Recent schedule changes/).click();
  111 |   await expect(changes).toContainText("Added Stats Pset to the calendar.");
  112 |   await changes.getByRole("button", { name: "Undo latest change" }).click();
  113 | 
  114 |   await expect(page.getByRole("button", { name: /^Stats Pset, / })).toHaveCount(0);
  115 |   stored = await storedManualEvents(page);
  116 |   expect(stored).toEqual([]);
  117 |   await expect(changes).toContainText("Undone");
  118 | });
  119 | 
  120 | test("quick add clamps an overlong title before confirmation and persists without crashing", async ({ page }) => {
  121 |   await openPreviewCalendar(page);
  122 | 
  123 |   const overlongTitle = "a".repeat(220);
  124 |   const clampedTitle = `A${"a".repeat(159)}`;
  125 |   const quickAdd = page.getByLabel("Quick add a calendar item");
  126 |   await quickAdd.fill(`${overlongTitle} tonight, 30 min`);
  127 |   await quickAdd.press("Enter");
  128 | 
  129 |   const confirmation = page.getByRole("dialog", { name: "Confirm quick add" });
  130 |   const title = confirmation.getByLabel("Title");
  131 |   await expect(title).toHaveValue(clampedTitle);
  132 |   await expect(title).toHaveAttribute("maxlength", "160");
  133 |   await confirmation.getByRole("button", { name: "Save to calendar" }).click();
  134 | 
  135 |   await expect(page.locator(".calendar-action-error")).toHaveCount(0);
  136 |   const stored = await storedManualEvents(page);
  137 |   expect(stored).toHaveLength(1);
  138 |   expect(stored[0]?.title).toBe(clampedTitle);
  139 | });
  140 | 
  141 | test("exiting a quick-add plan draft returns to Calendar without losing or duplicating the manual deadline", async ({ page }) => {
  142 |   await openPreviewCalendar(page);
  143 | 
  144 |   await page.getByLabel("Quick add a calendar item").fill("cellular respiration exam due friday, 90 min tonight");
  145 |   await page.getByLabel("Quick add a calendar item").press("Enter");
  146 |   const confirmation = page.getByRole("dialog", { name: "Confirm quick add" });
  147 |   await confirmation.getByRole("button", { name: "Save and build plan" }).click();
  148 | 
  149 |   await chooseCalendarGeneratedSource(page);
  150 |   // Dispatch through the button itself so Next's development-only portal
  151 |   // cannot intercept the mobile pointer before the app receives the action.
  152 |   await page.getByRole("button", { name: "Exit", exact: true }).dispatchEvent("click");
  153 |   await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();
  154 | 
  155 |   expect(await storedManualEvents(page)).toHaveLength(1);
  156 |   expect(await previewAuthorityCounts(page)).toEqual({ plans: 0, milestones: 0 });
  157 | 
  158 |   await page.reload();
  159 |   await openCalendarTab(page);
  160 |   await expect(page.getByRole("button", { name: /^Cellular Respiration Exam, / })).toHaveCount(1);
  161 |   expect(await storedManualEvents(page)).toHaveLength(1);
  162 | });
  163 | 
  164 | test("finishing a quick-add plan replaces the manual deadline with one linked authoritative outcome", async ({ page }) => {
  165 |   await openPreviewCalendar(page);
  166 | 
  167 |   await page.getByLabel("Quick add a calendar item").fill("cellular respiration exam due friday, 90 min tonight");
  168 |   await page.getByLabel("Quick add a calendar item").press("Enter");
  169 |   const confirmation = page.getByRole("dialog", { name: "Confirm quick add" });
  170 |   await confirmation.getByLabel("Due time").fill(await futureLocalDateTime(page, 9));
  171 |   await confirmation.getByRole("button", { name: "Save and build plan" }).click();
  172 | 
  173 |   await chooseCalendarGeneratedSource(page);
  174 |   const reviewInputs = page.getByRole("button", { name: "Review plan inputs" });
  175 |   if (await reviewInputs.isVisible()) {
  176 |     await reviewInputs.click();
  177 |   } else {
  178 |     await page.getByRole("button", { name: "Continue to placement check" }).click();
> 179 |     await page.getByRole("button", { name: "Skip for now" }).click();
      |                                                              ^ Error: locator.click: Test timeout of 30000ms exceeded.
  180 |   }
  181 |   await expect(page.getByRole("heading", { name: "Everything YOVA will use" })).toBeVisible();
  182 |   await page.getByRole("button", { name: "Generate my plan" }).click();
  183 |   await expect(page.getByText("Plan ready")).toBeVisible();
  184 |   await page.getByRole("button", { name: "Use this plan" }).click();
  185 |   await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
  186 | 
  187 |   await expect.poll(() => quickAddPlanCommitState(page)).toMatchObject({
  188 |     planCount: 1,
  189 |     milestoneCount: 1,
  190 |     manualEventCount: 0,
  191 |     milestoneLinkedToPlan: true,
  192 |   });
  193 | 
  194 |   await openCalendarTab(page);
  195 |   await expect(page.locator(".calendar-outcome-row").filter({ hasText: "Cellular Respiration Exam" })).toHaveCount(1);
  196 |   await expect(page.locator(".calendar-issue").filter({ hasText: "Cellular Respiration Exam has no preparation plan" })).toHaveCount(0);
  197 |   await expect(page.getByRole("button", { name: /^Cellular Respiration Exam, .*Exam$/ })).toHaveCount(0);
  198 | });
  199 | 
  200 | test("authoritative plans, unplanned outcomes, evidence-backed reasons, and opt-in time adjustment stay connected", async ({ page }) => {
  201 |   await createPreviewAccount(page);
  202 |   await completeOnboarding(page);
  203 |   await openCalendarTab(page);
  204 |   await seedCalendarAuthority(page);
  205 |   await page.reload();
  206 |   await openCalendarTab(page);
  207 | 
  208 |   const planBlock = page.getByRole("button", { name: /^Causal map review, / });
  209 |   await expect(planBlock).toBeVisible();
  210 |   await planBlock.click();
  211 | 
  212 |   const detail = page.locator(".calendar-block-detail");
  213 |   await expect(detail).toContainText("Why here");
  214 |   await expect(detail).toContainText("session 1 of 1");
  215 |   await expect(detail).toContainText("Why this method");
  216 |   await expect(detail).toContainText("Concept Mapping");
  217 |   await expect(detail).toContainText("A cause map exposes missing links before retrieval.");
  218 |   await expect(detail).toContainText("Flexibility");
  219 |   await expect(detail).toContainText("Related outcome");
  220 |   await expect(detail.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  221 |   await expect(detail.getByRole("button", { name: "Move", exact: true })).toBeVisible();
  222 |   await expect(detail.getByRole("button", { name: "Open plan", exact: true })).toBeVisible();
  223 | 
  224 |   await detail.getByRole("button", { name: "Close calendar detail" }).click();
  225 |   const attention = page.locator(".calendar-attention");
  226 |   await expect(attention.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  227 |   const unplannedIssue = attention.locator(".calendar-issue").filter({ hasText: "Unplanned term paper" });
  228 |   await expect(unplannedIssue).toContainText("has no preparation plan");
  229 |   await expect(unplannedIssue.getByRole("button", { name: "Build plan" })).toBeVisible();
  230 | 
  231 |   const outcomes = page.locator(".calendar-outcomes");
  232 |   await expect(outcomes).toContainText("History Midterm");
  233 |   await expect(outcomes).toContainText("Unplanned term paper");
  234 |   await expect(outcomes).not.toContainText(/% prepared/i);
  235 |   await page.locator(".calendar-week-reasons").getByRole("button", { name: "Show all" }).click();
  236 |   await expect(page.locator(".calendar-week-reasons")).toContainText("nearest open outcome");
  237 | 
  238 |   const originalSchedule = await previewSessionSchedule(page, "causal-map-session");
  239 |   const adjustment = page.locator(".agenda-adjustment-tools");
  240 |   await adjustment.getByText("Adjust today’s available time", { exact: true }).click();
  241 |   await adjustment.getByLabel("Minutes available today").fill("10");
  242 |   await adjustment.getByLabel("What changed? Optional").fill("busy");
  243 |   await adjustment.getByRole("button", { name: "Review options" }).click();
  244 |   await expect(adjustment).toContainText("PROPOSED ADJUSTMENT");
  245 |   await expect(adjustment).toContainText(/Move one unfinished block|Shorten one safe content block|No safe automatic change/);
  246 |   await expect.poll(() => storedAvailabilityReason(page)).toBe("You said: busy.");
  247 |   expect(await previewSessionSchedule(page, "causal-map-session")).toBe(originalSchedule);
  248 | });
  249 | 
  250 | test("Calendar Start opens the exact ready session and fails closed on an ambiguous legacy plan", async ({ page }) => {
  251 |   await createPreviewAccount(page);
  252 |   await completeOnboarding(page);
  253 |   await seedCalendarAuthority(page);
  254 |   await setPreviewSessionSchedule(page, "causal-map-session", FIXED_NOW.toISOString());
  255 |   await page.reload();
  256 |   await openCalendarTab(page);
  257 | 
  258 |   await page.getByRole("button", { name: /^Causal map review, / }).click();
  259 |   await page.locator(".calendar-block-detail").getByRole("button", { name: "Start", exact: true }).click();
  260 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  261 |   await expect(page.locator(".session-current-assumption")).toContainText("Causal map review");
  262 |   await page.getByRole("button", { name: "Not now", exact: true }).click();
  263 |   await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();
  264 | 
  265 |   await seedSecondReadySession(page);
  266 |   await page.reload();
  267 |   await openCalendarTab(page);
  268 |   await page.getByRole("button", { name: /^Causal map review, / }).click();
  269 |   await page.locator(".calendar-block-detail").getByRole("button", { name: "Start", exact: true }).click();
  270 | 
  271 |   await expect(page.locator(".calendar-inspector").getByRole("alert")).toContainText(
  272 |     "That exact learning block is no longer ready. Reload Calendar to use the current plan order.",
  273 |   );
  274 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toHaveCount(0);
  275 |   await expect(page.getByRole("heading", { name: "Plan the work that gets you there" })).toBeVisible();
  276 | });
  277 | 
  278 | test("a future overloaded-day issue edits only that date's availability", async ({ page }) => {
  279 |   await createPreviewAccount(page);
```