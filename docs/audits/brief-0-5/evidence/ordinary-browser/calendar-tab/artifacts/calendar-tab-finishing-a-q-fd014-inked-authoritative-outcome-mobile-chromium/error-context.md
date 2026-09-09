# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: calendar-tab.spec.ts >> finishing a quick-add plan replaces the manual deadline with one linked authoritative outcome
- Location: e2e/calendar-tab.spec.ts:164:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Your plan' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: 'Your plan' })

```

```yaml
- alert
- main:
  - text: YOVA Plan ready
  - heading "Cellular Respiration Exam. Cellular Respiration Exam" [level=1]
  - paragraph: 3 sessions organized into a coherent path. Nothing is active until you confirm it below.
  - text: Unclassified learning plan
  - region "Plan coverage":
    - strong: This plan covers part of your goal.
    - paragraph: "3 topics are saved for later: Errors repaired with a different follow-up prompt; One independent transfer attempt; The highest-priority ideas still due for retrieval. Change the available time or scope if you need these included before your deadline."
    - button "Make room for remaining scope" [disabled]
  - strong: Why this plan
  - paragraph: YOVA fixed this sequence from the accepted topic map, current evidence, available time, and session limits. Topics that do not fit are shown explicitly as deferred instead of being silently dropped.
  - region "How YOVA mapped this plan":
    - text: KNOWLEDGE MAP
    - strong: 10 mapped topics
    - paragraph: Each topic is scheduled or shown explicitly as deferred.
    - text: SESSION LOAD
    - strong: Usually 2 targets at a time
    - paragraph: Each target needs an explanation, attempt, or application before it counts as covered.
    - text: YOUR DELIVERY
    - strong: Example first
    - paragraph: Hint before answer after a miss. Recall without cues for later review.
    - text: YOUR SCHEDULE
    - strong: 5 preferred study windows
    - paragraph: Wednesday afternoon, 25 min; Thursday afternoon, 25 min; Friday afternoon, 25 min; Sunday afternoon, 25 min; Monday afternoon, 25 min
  - region "Check what YOVA plans to cover":
    - text: TOPIC MAP
    - heading "Check what YOVA plans to cover" [level=2]
    - paragraph: This is the learning contract behind the schedule. Every included topic must be taught or checked, and anything skipped is shown plainly.
    - strong: 7 included
    - list:
      - listitem:
        - text: "1"
        - strong: The core vocabulary and relationships in Photosynthesis and cellular…
        - paragraph: The knowledge and performance needed for The core vocabulary and relationships in Photosynthesis and cellular respiration.
        - emphasis: Practice and check · 1 session
      - listitem:
        - text: "2"
        - strong: The current starting gaps revealed without notes
        - paragraph: The knowledge and performance needed for The current starting gaps revealed without notes.
        - emphasis: Practice and check · 1 session
      - listitem:
        - text: "3"
        - strong: A clear mental model of the weakest idea in…
        - paragraph: The knowledge and performance needed for A clear mental model of the weakest idea in Photosynthesis and cellular respiration.
        - emphasis: Practice and check · 1 session
      - listitem:
        - text: "4"
        - strong: One concrete example that shows how the idea works
        - paragraph: The knowledge and performance needed for One concrete example that shows how the idea works.
        - emphasis: Practice and check · 1 session
      - listitem:
        - text: "5"
        - strong: Choosing the correct idea in mixed situations
        - paragraph: The knowledge and performance needed for Choosing the correct idea in mixed situations.
        - emphasis: Practice and check · 1 session
      - listitem:
        - text: "6"
        - strong: Explaining why tempting alternatives do not fit
        - paragraph: The knowledge and performance needed for Explaining why tempting alternatives do not fit.
        - emphasis: Practice and check · 1 session
      - listitem:
        - text: "7"
        - strong: Representative unsupported questions
        - paragraph: The knowledge and performance needed for Representative unsupported questions.
        - emphasis: Practice and check · 1 session
      - listitem:
        - text: "8"
        - strong: Errors repaired with a different follow-up prompt
        - paragraph: The knowledge and performance needed for Errors repaired with a different follow-up prompt.
        - paragraph: "Saved for later: The learner's remaining availability before the deadline cannot hold another coherent normal session."
        - emphasis: Deferred
      - listitem:
        - text: "9"
        - strong: One independent transfer attempt
        - paragraph: The knowledge and performance needed for One independent transfer attempt.
        - paragraph: "Saved for later: A prerequisite could not be scheduled in this plan, so the dependent target is deferred instead of being taught out of order."
        - emphasis: Deferred
      - listitem:
        - text: "10"
        - strong: The highest-priority ideas still due for retrieval
        - paragraph: The knowledge and performance needed for The highest-priority ideas still due for retrieval.
        - paragraph: "Saved for later: A prerequisite could not be scheduled in this plan, so the dependent target is deferred instead of being taught out of order."
        - emphasis: Deferred
    - strong: Something is off?
    - paragraph: Tell YOVA what is missing, outside your goal, or needs a different emphasis. Saying you know something changes the plan only after a quick verification. It never creates evidence by itself.
    - button "A topic is missing" [disabled]
    - button "I already know this and want a quick verification" [disabled]
    - button "This is outside my goal" [disabled]
    - button "Change the emphasis toward" [disabled]
    - textbox "Requested topic map change" [disabled]:
      - /placeholder: "Example: Include the causes of World War I, but leave detailed military technology outside this plan."
    - paragraph: Updating the map rebuilds the sessions and chooses their methods again. Review any methods you previously customized.
    - button "Update map and plan" [disabled]
  - status:
    - text: Alpha note
    - paragraph: This plan used YOVA's validated preview engine. Live AI generation becomes available when the server API key is connected.
  - text: 1 PLAN PHASE
  - heading "Practice and apply" [level=2]
  - paragraph: Produce answers independently, use the ideas in new situations, and repair exposed gaps.
  - 'article "Session 1: Practice The core vocabulary and relationships in Photosynthesis and cellular respiration"':
    - text: 1 PRACTICE FIRST · Wednesday 2:00 PM
    - heading "Practice The core vocabulary and relationships in Photosynthesis and cellular respiration" [level=3]
    - paragraph: Active Recall
    - 'region "Study recipe: Active Recall"':
      - text: Help Me Choose
      - strong: Practice · Active Recall
      - text: 25 minutes total
      - paragraph: YOVA recommends one valid recipe; your exact choice is confirmed before it is saved.
      - paragraph: Active Recall fits this task and your starting point. It helps you practise using what you know and find gaps to work on.
      - group: See the complete recipe
    - group "Method decision for Practice The core vocabulary and relationships in Photosynthesis and cellular respiration": Why YOVA chose this
    - paragraph: "Focus: The core vocabulary and relationships in Photosynthesis and cellular…"
    - strong: 1 focused target + 1 evidence check + about 25 min
  - 'article "Session 2: Practice The current starting gaps revealed without notes, A clear mental model of the"':
    - text: 2 PRACTICE FIRST · Thursday 2:00 PM
    - heading "Practice The current starting gaps revealed without notes, A clear mental model of the" [level=3]
    - paragraph: Concept Mapping
    - 'region "Study recipe: Concept Mapping"':
      - text: Help Me Choose
      - strong: Practice · Concept Mapping
      - text: 25 minutes total
      - paragraph: YOVA recommends one valid recipe; your exact choice is confirmed before it is saved.
      - paragraph: Concept Mapping fits this task and your starting point. It helps you practise using what you know and find gaps to work on.
      - group: See the complete recipe
    - group "Method decision for Practice The current starting gaps revealed without notes, A clear mental model of the": Why YOVA chose this
    - paragraph: "Focus: The current starting gaps revealed without notes; A clear mental model of the weakest idea in…; One concrete example that shows how the idea works"
    - strong: 3 focused targets + 3 evidence checks + about 25 min
  - 'article "Session 3: Practice Choosing the correct idea in mixed situations, Explaining why tempting"':
    - text: 3 PRACTICE FIRST · Friday 2:00 PM
    - heading "Practice Choosing the correct idea in mixed situations, Explaining why tempting" [level=3]
    - paragraph: Concept Mapping
    - 'region "Study recipe: Concept Mapping"':
      - text: Help Me Choose
      - strong: Practice · Concept Mapping
      - text: 25 minutes total
      - paragraph: YOVA recommends one valid recipe; your exact choice is confirmed before it is saved.
      - paragraph: Concept Mapping fits this task and your starting point. It helps you practise using what you know and find gaps to work on.
      - group: See the complete recipe
    - group "Method decision for Practice Choosing the correct idea in mixed situations, Explaining why tempting": Why YOVA chose this
    - paragraph: "Focus: Choosing the correct idea in mixed situations; Explaining why tempting alternatives do not fit; Representative unsupported questions"
    - strong: 3 focused targets + 3 evidence checks + about 25 min
  - region "Does this plan match what you need?":
    - text: BEFORE YOVA SAVES THIS
    - heading "Does this plan match what you need?" [level=2]
    - paragraph: Check the content, starting approach, source, and pace. If one part is wrong, change that input and YOVA will rebuild the draft.
    - text: CONTENT
    - strong: The core vocabulary and relationships in Photosynthesis and cellular…
    - text: STARTING APPROACH
    - strong: Practice first, then repair gaps
    - text: LEARNING SOURCE
    - strong: Teaching and practice created by YOVA
    - text: PACE
    - strong: 3 sessions · 25 minutes each
    - button "Change content" [disabled]
    - button "Change source" [disabled]
    - button "Change schedule" [disabled]
    - button "Change starting level" [disabled]
    - strong: Confirm only when this looks right.
    - text: YOVA will save the plan and make its first session available.
    - button "Saving plan…" [disabled]
```

# Test source

```ts
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
  179 |     await page.getByRole("button", { name: "Skip for now" }).click();
  180 |   }
  181 |   await expect(page.getByRole("heading", { name: "Everything YOVA will use" })).toBeVisible();
  182 |   await page.getByRole("button", { name: "Generate my plan" }).click();
  183 |   await expect(page.getByText("Plan ready")).toBeVisible();
  184 |   await page.getByRole("button", { name: "Use this plan" }).click();
> 185 |   await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
      |                                                                  ^ Error: expect(locator).toBeVisible() failed
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
  280 |   await completeOnboarding(page);
  281 |   await openCalendarTab(page);
  282 |   await seedCalendarAuthority(page);
  283 |   await setPreviewSessionSchedule(page, "causal-map-session", "2026-09-03T17:00:00.000Z");
  284 |   await seedAvailabilityOverrides(page);
  285 |   await page.reload();
```