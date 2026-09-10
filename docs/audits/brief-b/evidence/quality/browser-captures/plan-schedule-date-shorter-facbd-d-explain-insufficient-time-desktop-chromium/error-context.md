# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plan-schedule-date.spec.ts >> shorter sessions preserve weekly availability and explain insufficient time
- Location: e2e/plan-schedule-date.spec.ts:232:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.selectOption: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('.plan-adjustment-panel').getByRole('combobox', { name: /Future session window/ })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]
  - alert [ref=e11]
  - generic [ref=e12]:
    - link "Skip to main content" [ref=e13] [cursor=pointer]:
      - /url: "#main-content"
    - banner [ref=e14]:
      - generic [ref=e15]:
        - generic [ref=e16]: "Y"
        - generic [ref=e17]: YOVA
      - navigation "Main navigation" [ref=e18]:
        - button "Home" [ref=e19] [cursor=pointer]
        - button "Learning" [ref=e21] [cursor=pointer]
        - button "Calendar" [ref=e23] [cursor=pointer]
        - button "Ask YOVA" [ref=e25] [cursor=pointer]
        - button "You" [ref=e27] [cursor=pointer]
      - generic [ref=e29]:
        - button "Add to YOVA" [ref=e30] [cursor=pointer]:
          - generic [ref=e32]: Add
        - generic [ref=e33]:
          - generic "Learner · Private alpha" [ref=e34]: L
          - button "Sign out on this device" [ref=e35] [cursor=pointer]
    - main [ref=e39]:
      - generic [ref=e40]:
        - generic [ref=e41]:
          - generic [ref=e42]:
            - text: LEARNING
            - heading "What you’re working toward" [level=1] [ref=e43]
            - paragraph [ref=e44]: Every goal keeps its plan, materials, sessions, and progress in one place.
          - button "New plan" [ref=e45] [cursor=pointer]
        - navigation "Learning sections" [ref=e47]:
          - button "Active 1" [ref=e48] [cursor=pointer]:
            - text: Active
            - generic [ref=e49]: "1"
          - button "Recent 0" [ref=e50] [cursor=pointer]:
            - text: Recent
            - generic [ref=e51]: "0"
          - button "Archive 0" [ref=e52] [cursor=pointer]:
            - text: Archive
            - generic [ref=e53]: "0"
          - button "Methods 12" [ref=e54] [cursor=pointer]:
            - text: Methods
            - generic [ref=e55]: "12"
        - button "All active learning" [ref=e56] [cursor=pointer]
        - generic [ref=e59]:
          - generic [ref=e60]:
            - generic [ref=e61]: TEST · OCT 14
            - heading "Prepare for a Biology Test on Cell Membranes and Diffusion" [level=2] [ref=e62]
            - paragraph [ref=e63]: The core vocabulary and relationships in Photosynthesis and cellular…
            - generic [ref=e64]: Practice, diagnose, and repair
            - text: 0 of 6 sessions complete
          - generic [ref=e70]:
            - button "Start next session" [ref=e71] [cursor=pointer]
            - button "Adjust" [active] [ref=e72] [cursor=pointer]
            - button "Archive" [ref=e76] [cursor=pointer]
        - generic [ref=e80]:
          - generic [ref=e81]:
            - generic [ref=e82]:
              - text: KNOWLEDGE MAP
              - heading "What this plan is building" [level=3] [ref=e83]
              - paragraph [ref=e84]: Topics are ordered by prerequisite. Sessions below are how each topic moves from introduced to secure.
            - generic [ref=e85]: 0 of 10 secure
          - generic [ref=e86]:
            - generic [ref=e87]:
              - generic [ref=e88]: OPTIONAL PLACEMENT CHECK
              - strong [ref=e89]: Make the remaining plan more precise
              - paragraph [ref=e90]: Answer a few map-based questions so YOVA can replace lessons on demonstrated topics with shorter verification checks. Skipping never marks a topic as known.
            - button "Take the placement check" [ref=e91] [cursor=pointer]
          - list [ref=e94]:
            - listitem [ref=e95]:
              - generic [ref=e96]: "1"
              - generic [ref=e97]:
                - generic [ref=e98]:
                  - strong [ref=e99]: The core vocabulary and relationships in Photosynthesis and cellular…
                  - generic [ref=e100]: Not started
                - paragraph [ref=e101]: The knowledge and performance needed for The core vocabulary and relationships in Photosynthesis and cellular respiration.
                - text: Structured by YOVA for this goal
                - generic [ref=e102]:
                  - button "I already learned this" [ref=e103] [cursor=pointer]
                  - button "Attach a source" [ref=e104] [cursor=pointer]
            - listitem [ref=e105]:
              - generic [ref=e106]: "2"
              - generic [ref=e107]:
                - generic [ref=e108]:
                  - strong [ref=e109]: The current starting gaps revealed without notes
                  - generic [ref=e110]: Not started
                - paragraph [ref=e111]: The knowledge and performance needed for The current starting gaps revealed without notes.
                - generic [ref=e112]: Builds on The core vocabulary and relationships in Photosynthesis and cellular…
                - text: Structured by YOVA for this goal
                - generic [ref=e113]:
                  - button "I already learned this" [ref=e114] [cursor=pointer]
                  - button "Attach a source" [ref=e115] [cursor=pointer]
            - listitem [ref=e116]:
              - generic [ref=e117]: "3"
              - generic [ref=e118]:
                - generic [ref=e119]:
                  - strong [ref=e120]: A clear mental model of the weakest idea in…
                  - generic [ref=e121]: Not started
                - paragraph [ref=e122]: The knowledge and performance needed for A clear mental model of the weakest idea in Photosynthesis and cellular respiration.
                - generic [ref=e123]: Builds on The current starting gaps revealed without notes
                - text: Structured by YOVA for this goal
                - generic [ref=e124]:
                  - button "I already learned this" [ref=e125] [cursor=pointer]
                  - button "Attach a source" [ref=e126] [cursor=pointer]
            - listitem [ref=e127]:
              - generic [ref=e128]: "4"
              - generic [ref=e129]:
                - generic [ref=e130]:
                  - strong [ref=e131]: One concrete example that shows how the idea works
                  - generic [ref=e132]: Not started
                - paragraph [ref=e133]: The knowledge and performance needed for One concrete example that shows how the idea works.
                - generic [ref=e134]: Builds on A clear mental model of the weakest idea in…
                - text: Structured by YOVA for this goal
                - generic [ref=e135]:
                  - button "I already learned this" [ref=e136] [cursor=pointer]
                  - button "Attach a source" [ref=e137] [cursor=pointer]
            - listitem [ref=e138]:
              - generic [ref=e139]: "5"
              - generic [ref=e140]:
                - generic [ref=e141]:
                  - strong [ref=e142]: Choosing the correct idea in mixed situations
                  - generic [ref=e143]: Not started
                - paragraph [ref=e144]: The knowledge and performance needed for Choosing the correct idea in mixed situations.
                - generic [ref=e145]: Builds on One concrete example that shows how the idea works
                - text: Structured by YOVA for this goal
                - generic [ref=e146]:
                  - button "I already learned this" [ref=e147] [cursor=pointer]
                  - button "Attach a source" [ref=e148] [cursor=pointer]
            - listitem [ref=e149]:
              - generic [ref=e150]: "6"
              - generic [ref=e151]:
                - generic [ref=e152]:
                  - strong [ref=e153]: Explaining why tempting alternatives do not fit
                  - generic [ref=e154]: Not started
                - paragraph [ref=e155]: The knowledge and performance needed for Explaining why tempting alternatives do not fit.
                - generic [ref=e156]: Builds on Choosing the correct idea in mixed situations
                - text: Structured by YOVA for this goal
                - generic [ref=e157]:
                  - button "I already learned this" [ref=e158] [cursor=pointer]
                  - button "Attach a source" [ref=e159] [cursor=pointer]
            - listitem [ref=e160]:
              - generic [ref=e161]: "7"
              - generic [ref=e162]:
                - generic [ref=e163]:
                  - strong [ref=e164]: Representative unsupported questions
                  - generic [ref=e165]: Not started
                - paragraph [ref=e166]: The knowledge and performance needed for Representative unsupported questions.
                - generic [ref=e167]: Builds on Explaining why tempting alternatives do not fit
                - text: Structured by YOVA for this goal
                - generic [ref=e168]:
                  - button "I already learned this" [ref=e169] [cursor=pointer]
                  - button "Attach a source" [ref=e170] [cursor=pointer]
            - listitem [ref=e171]:
              - generic [ref=e172]: "8"
              - generic [ref=e173]:
                - generic [ref=e174]:
                  - strong [ref=e175]: Errors repaired with a different follow-up prompt
                  - generic [ref=e176]: Not started
                - paragraph [ref=e177]: The knowledge and performance needed for Errors repaired with a different follow-up prompt.
                - generic [ref=e178]: Builds on Representative unsupported questions
                - text: Structured by YOVA for this goal
                - generic [ref=e179]:
                  - button "I already learned this" [ref=e180] [cursor=pointer]
                  - button "Attach a source" [ref=e181] [cursor=pointer]
            - listitem [ref=e182]:
              - generic [ref=e183]: "9"
              - generic [ref=e184]:
                - generic [ref=e185]:
                  - strong [ref=e186]: One independent transfer attempt
                  - generic [ref=e187]: Not started
                - paragraph [ref=e188]: The knowledge and performance needed for One independent transfer attempt.
                - generic [ref=e189]: Builds on Errors repaired with a different follow-up prompt
                - text: Structured by YOVA for this goal
                - generic [ref=e190]:
                  - button "I already learned this" [ref=e191] [cursor=pointer]
                  - button "Attach a source" [ref=e192] [cursor=pointer]
            - listitem [ref=e193]:
              - generic [ref=e194]: "10"
              - generic [ref=e195]:
                - generic [ref=e196]:
                  - strong [ref=e197]: The highest-priority ideas still due for retrieval
                  - generic [ref=e198]: Not started
                - paragraph [ref=e199]: The knowledge and performance needed for The highest-priority ideas still due for retrieval.
                - generic [ref=e200]: Builds on One independent transfer attempt
                - text: Structured by YOVA for this goal
                - generic [ref=e201]:
                  - button "I already learned this" [ref=e202] [cursor=pointer]
                  - button "Attach a source" [ref=e203] [cursor=pointer]
        - region "Plan change preview" [ref=e204]:
          - generic [ref=e205]:
            - heading "Review your changes" [level=3] [ref=e206]
            - paragraph [ref=e207]: Adjust a line or leave it out, then confirm once.
          - group "Add another change" [ref=e208]:
            - generic [ref=e210]:
              - text: Change type
              - combobox "Change type" [ref=e211]:
                - option "I already learned this"
                - option "Attach a source"
                - option "Add a topic"
                - option "Remove future work"
                - option "Move a topic"
                - option "Change the deadline"
                - option "Change available time" [selected]
            - generic [ref=e212]:
              - text: Day
              - combobox "Day" [ref=e213]:
                - option "Monday" [selected]
                - option "Tuesday"
                - option "Wednesday"
                - option "Thursday"
                - option "Friday"
                - option "Saturday"
                - option "Sunday"
            - generic [ref=e214]:
              - text: Time window
              - textbox "Time window" [ref=e215]: 18:00–19:00
            - generic [ref=e216]:
              - text: Minutes
              - spinbutton "Minutes" [ref=e217]: "60"
            - generic [ref=e218]:
              - generic [ref=e219]:
                - 'checkbox "Keep existing window: Wednesday Afternoon" [checked] [ref=e220]'
                - text: "Keep existing window: Wednesday Afternoon"
              - generic [ref=e221]:
                - 'checkbox "Keep existing window: Friday Afternoon" [checked] [ref=e222]'
                - text: "Keep existing window: Friday Afternoon"
              - generic [ref=e223]:
                - 'checkbox "Keep existing window: Monday Afternoon" [checked] [ref=e224]'
                - text: "Keep existing window: Monday Afternoon"
            - paragraph [ref=e225]: Keep the windows you still want, and add the time above.
            - button "Preview change" [ref=e226] [cursor=pointer]
          - generic [ref=e227]:
            - button "Cancel" [ref=e228] [cursor=pointer]
            - button "Confirm changes" [disabled] [ref=e229]
        - generic [ref=e230]:
          - generic [ref=e231]:
            - generic [ref=e232]:
              - heading "Your plan" [level=3] [ref=e233]
              - paragraph [ref=e234]: The sequence YOVA will guide you through, one session at a time.
            - generic [ref=e235]: 6 sessions
          - generic [ref=e236]:
            - generic [ref=e237]:
              - generic [ref=e239]:
                - strong [ref=e240]: Practice The core vocabulary and relationships in Photosynthesis and cellular respiration
                - generic [ref=e241]: Practice first · Active Recall · Wed 2:00 PM
              - generic [ref=e242]: 25 min
            - generic [ref=e243]:
              - generic [ref=e245]:
                - strong [ref=e246]: Practice The current starting gaps revealed without notes, A clear mental model of the
                - generic [ref=e247]: Practice first · Concept Mapping · Fri 2:00 PM
              - generic [ref=e248]: 25 min
            - generic [ref=e249]:
              - generic [ref=e251]:
                - strong [ref=e252]: Practice One concrete example that shows how the idea works, Choosing the correct idea in
                - generic [ref=e253]: Practice first · Concept Mapping · Mon 2:00 PM
              - generic [ref=e254]: 25 min
            - generic [ref=e255]:
              - generic [ref=e257]:
                - strong [ref=e258]: Practice Explaining why tempting alternatives do not fit, Representative unsupported
                - generic [ref=e259]: Practice first · Concept Mapping · Wed 2:00 PM
              - generic [ref=e260]: 25 min
            - generic [ref=e261]:
              - generic [ref=e263]:
                - strong [ref=e264]: Practice Errors repaired with a different follow-up prompt, One independent transfer
                - generic [ref=e265]: Practice first · Concept Mapping · Fri 2:00 PM
              - generic [ref=e266]: 25 min
            - generic [ref=e267]:
              - generic [ref=e269]:
                - strong [ref=e270]: Practice The highest-priority ideas still due for retrieval
                - generic [ref=e271]: Practice first · Concept Mapping · Mon 2:00 PM
              - generic [ref=e272]: 25 min
        - generic [ref=e273]:
          - generic [ref=e274]:
            - heading "Learning source" [level=3] [ref=e275]
            - button "Add file or link" [ref=e276] [cursor=pointer]
          - paragraph [ref=e278]:
            - strong [ref=e279]: Created by YOVA
            - text: . Teaching and practice for this goal. Attach a source to a topic to plan time for it; completed work stays saved.
        - generic [ref=e280]:
          - generic [ref=e281]:
            - generic [ref=e282]:
              - heading "Study resources" [level=3] [ref=e283]
              - paragraph [ref=e284]: Reusable explanations and practice, attached to the session that needed them.
            - generic [ref=e285]: Created when relevant
          - generic [ref=e290]:
            - strong [ref=e291]: Nothing extra to browse yet
            - paragraph [ref=e292]: YOVA creates the teaching and practice needed for a session when you first start it. Those resources will stay here afterward.
    - contentinfo [ref=e293]:
      - navigation "Trust and support" [ref=e294]:
        - link "Support" [ref=e295] [cursor=pointer]:
          - /url: /support
        - link "Privacy" [ref=e296] [cursor=pointer]:
          - /url: /privacy
        - link "Terms" [ref=e297] [cursor=pointer]:
          - /url: /terms
```

# Test source

```ts
  147 |   await page.getByPlaceholder(/I have a biology test/).fill(
  148 |     `Prepare for a chemistry quiz on chemical equilibrium on ${writtenDeadline}`,
  149 |   );
  150 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  151 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  152 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  153 | 
  154 |   await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  155 |   const targetDate = page.getByRole("textbox", { name: "Target date" });
  156 |   await expect(targetDate).toHaveValue(inferred.input);
  157 |   await expect(page.locator(".schedule-deadline strong")).not.toHaveText("No fixed deadline");
  158 | 
  159 |   // Do not treat the date input's DOM value as proof. The summary is rendered
  160 |   // from React state, so this assertion verifies that a real input event reached
  161 |   // the application before any rhythm change causes another render.
  162 |   await targetDate.fill(manual.input);
  163 |   await expect(page.locator(".schedule-deadline strong")).not.toHaveText("No fixed deadline");
  164 |   await expect(page.locator(".schedule-deadline strong")).toContainText(manual.monthShort);
  165 | 
  166 |   await page.getByRole("button", { name: "Every day", exact: true }).click();
  167 |   await page.getByRole("button", { name: "Morning", exact: true }).click();
  168 |   await page.getByRole("button", { name: "45 minutes", exact: true }).click();
  169 |   await expect(targetDate).toHaveValue(manual.input);
  170 |   await expect(page.getByText("7 study windows available")).toBeVisible();
  171 |   await expect(page.locator(".schedule-preview-windows")).toContainText("Morning");
  172 |   await expect(page.locator(".schedule-preview-windows")).toContainText("45 min");
  173 | 
  174 |   await page.getByRole("button", { name: /Custom Choose each day/ }).click();
  175 |   const customTargetDate = page.getByRole("textbox", { name: "Custom target date" });
  176 |   await expect(customTargetDate).toHaveValue(manual.input);
  177 |   await page.getByLabel(/Monday time window/).selectOption("Evening");
  178 |   await page.getByRole("button", { name: /Remove Monday|Add Monday/ }).click();
  179 |   await expect(customTargetDate).toHaveValue(manual.input);
  180 | 
  181 |   await page.getByRole("button", { name: "Quick choices", exact: true }).click();
  182 |   await expect(targetDate).toHaveValue(manual.input);
  183 |   await page.getByRole("button", { name: "Back", exact: true }).click();
  184 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  185 |   await expect(targetDate).toHaveValue(manual.input);
  186 | });
  187 | 
  188 | test("explicit study days survive intake and later time changes", async ({ page }) => {
  189 |   await openPreviewApp(page);
  190 |   await page.getByRole("button", { name: /New plan|Build my first plan|Create another plan/ }).first().click();
  191 |   await page.getByPlaceholder(/I have a biology test/).fill("Prepare for a biology exam on cell transport in two weeks. I can study Monday, Wednesday and Friday afternoons for 25 minutes.");
  192 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  193 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  194 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  195 |   for (const day of ["Monday", "Wednesday", "Friday"]) {
  196 |     await expect(page.getByRole("button", { name: `Remove ${day}`, exact: true })).toBeVisible();
  197 |     await expect(page.getByLabel(`${day} time window`, { exact: true })).toHaveValue("Afternoon");
  198 |   }
  199 |   for (const day of ["Tuesday", "Thursday", "Saturday", "Sunday"]) await expect(page.getByRole("button", { name: `Add ${day}`, exact: true })).toBeVisible();
  200 |   await page.getByRole("button", { name: "Quick choices", exact: true }).click();
  201 |   await page.getByRole("button", { name: "15 minutes", exact: true }).click();
  202 |   await expect(page.getByText("3 study windows available")).toBeVisible();
  203 |   await page.getByRole("button", { name: /Custom Choose each day/ }).click();
  204 |   for (const day of ["Monday", "Wednesday", "Friday"]) {
  205 |     await expect(page.getByRole("button", { name: `Remove ${day}`, exact: true })).toBeVisible();
  206 |     await expect(page.getByLabel(`${day} available minutes`, { exact: true })).toHaveValue("15");
  207 |   }
  208 |   await page.getByRole("button", { name: "Quick choices", exact: true }).click();
  209 |   await page.getByRole("button", { name: "Back", exact: true }).click();
  210 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  211 |   await expect(page.getByText("3 study windows available")).toBeVisible();
  212 |   await expect(page.locator(".schedule-preview-windows")).toContainText("15 min");
  213 | });
  214 | 
  215 | test("a historical topic date cannot override the learner's real deadline", async ({ page }) => {
  216 |   await openPreviewApp(page);
  217 | 
  218 |   const expected = futureDate(14);
  219 |   await page.getByRole("button", { name: /New plan|Build my first plan|Create another plan/ }).first().click();
  220 |   await page.getByPlaceholder(/I have a biology test/).fill(
  221 |     "Write a paper about September 11, 2001 due in two weeks",
  222 |   );
  223 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  224 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  225 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  226 | 
  227 |   await expect(page.getByRole("heading", { name: "When would you prefer to work on this?" })).toBeVisible();
  228 |   await expect(page.locator(".plan-header")).toContainText("Step 3 of 4");
  229 |   await expect(page.getByRole("textbox", { name: "Target date" })).toHaveValue(expected.input);
  230 | });
  231 | 
  232 | test("shorter sessions preserve weekly availability and explain insufficient time", async ({ page }) => {
  233 |   await openPreviewApp(page);
  234 |   await page.getByRole("button", { name: /New plan|Build my first plan|Create another plan/ }).first().click();
  235 |   await page.getByPlaceholder(/I have a biology test/).fill("Prepare for a biology test on cell membranes and diffusion in six weeks. I can study only Monday, Wednesday and Friday afternoons for 25 minutes.");
  236 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  237 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  238 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  239 |   await page.getByRole("button", { name: "Continue to placement check" }).click();
  240 |   await page.getByRole("button", { name: "Skip for now" }).click();
  241 |   await page.getByRole("button", { name: "Generate my plan" }).click();
  242 |   await page.getByRole("button", { name: "Use this plan" }).click();
  243 |   await expect(page.getByRole("heading", { name: "Your plan", exact: true })).toBeVisible();
  244 |   const originalCount = await page.locator(".timeline-row").count();
  245 |   await page.getByRole("button", { name: "Adjust", exact: true }).click();
  246 |   const panel = page.locator(".plan-adjustment-panel");
> 247 |   await panel.getByRole("combobox", { name: /Future session window/ }).selectOption("15");
      |                                                                        ^ Error: locator.selectOption: Test timeout of 30000ms exceeded.
  248 |   await panel.getByRole("textbox", { name: /^Target date/ }).fill(futureDate(1).input);
  249 |   await panel.getByRole("button", { name: "Approve and rebuild plan" }).click();
  250 |   await expect(panel).toContainText("This change does not fit your selected study windows");
  251 |   await expect(page.locator(".timeline-row")).toHaveCount(originalCount);
  252 |   await panel.getByRole("textbox", { name: /^Target date/ }).fill(futureDate(47).input);
  253 |   await panel.getByRole("button", { name: "Approve and rebuild plan" }).click();
  254 |   await expect(panel).toHaveCount(0);
  255 |   const schedule = await page.evaluate(() => {
  256 |     const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1") ?? "{}");
  257 |     const plan = snapshot.plans.at(-1);
  258 |     return { preferences: plan.schedulePreferences, sessions: plan.sessions.map((session: { scheduledFor: string; estimatedMinutes: number }) => ({ at: session.scheduledFor, minutes: session.estimatedMinutes })) };
  259 |   });
  260 |   expect(schedule.preferences.availability.map((window: { day: string }) => window.day).sort()).toEqual(
  261 |     ["Monday", "Wednesday", "Friday"].sort(),
  262 |   );
  263 |   expect(schedule.sessions.length).toBeGreaterThan(originalCount);
  264 |   const days = new Map<string, number>();
  265 |   for (const session of schedule.sessions) {
  266 |     const at = new Date(session.at);
  267 |     expect(new Intl.DateTimeFormat("en-GB", { timeZone: TEST_TIME_ZONE, weekday: "long" }).format(at)).toMatch(/^(Monday|Wednesday|Friday)$/);
  268 |     const date = new Intl.DateTimeFormat("en-CA", { timeZone: TEST_TIME_ZONE }).format(at);
  269 |     days.set(date, (days.get(date) ?? 0) + session.minutes);
  270 |     expect(session.minutes).toBe(15);
  271 |   }
  272 |   expect([...days.values()].every((minutes) => minutes <= 25)).toBe(true);
  273 | });
  274 | 
  275 | test("an overfull plan returns to its schedule and recovers without a client crash", async ({ page }) => {
  276 |   const pageErrors: string[] = [];
  277 |   let planAttempts = 0;
  278 |   page.on("pageerror", (error) => pageErrors.push(error.message));
  279 |   await page.route("**/api/plans/generate**", async (route) => {
  280 |     const url = new URL(route.request().url());
  281 |     if (url.searchParams.get("mode") === "diagnostic") {
  282 |       await route.continue();
  283 |       return;
  284 |     }
  285 |     planAttempts += 1;
  286 |     if (planAttempts === 1) {
  287 |       await route.fulfill({
  288 |         status: 422,
  289 |         contentType: "application/json",
  290 |         body: JSON.stringify({
  291 |           code: "schedule_capacity",
  292 |           error: "The plan does not fit before the deadline.",
  293 |         }),
  294 |       });
  295 |       return;
  296 |     }
  297 |     await route.fulfill({
  298 |       status: 502,
  299 |       contentType: "application/json",
  300 |       body: JSON.stringify({ error: "Temporary planning service failure." }),
  301 |     });
  302 |   });
  303 |   await openPreviewApp(page);
  304 | 
  305 |   await page.getByRole("button", { name: /New plan|Build my first plan|Create another plan/ }).first().click();
  306 |   await page.getByPlaceholder(/I have a biology test/).fill(
  307 |     "I have a biology test tomorrow on cellular respiration.",
  308 |   );
  309 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  310 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  311 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  312 |   await page.getByRole("button", { name: "1–2 days", exact: true }).click();
  313 |   await page.getByRole("button", { name: "15 minutes", exact: true }).click();
  314 | 
  315 |   await finishPlanSetup(page);
  316 |   await page.getByRole("button", { name: "Generate my plan" }).click();
  317 | 
  318 |   const capacityGuidance = page.getByRole("alert").filter({
  319 |     hasText: "This plan needs more room before your target date.",
  320 |   });
  321 |   await expect(capacityGuidance).toContainText("Add another study day");
  322 |   await expect(capacityGuidance).toContainText("choose longer sessions");
  323 |   await expect(page.getByRole("heading", { name: "When would you prefer to study this material?" })).toBeVisible();
  324 | 
  325 |   // The second attempt exercises the deterministic browser fallback. It must
  326 |   // produce the same expected recovery instead of throwing outside the API
  327 |   // error handler and stranding the loading screen.
  328 |   await finishPlanSetup(page);
  329 |   await page.getByRole("button", { name: "Generate my plan" }).click();
  330 |   await expect(capacityGuidance).toBeVisible();
  331 |   expect(pageErrors).toEqual([]);
  332 | 
  333 |   const feasible = futureDate(14);
  334 |   await page.getByRole("textbox", { name: "Target date" }).fill(feasible.input);
  335 |   await page.getByRole("button", { name: "Every day", exact: true }).click();
  336 |   await page.getByRole("button", { name: "60 minutes", exact: true }).click();
  337 |   await finishPlanSetup(page);
  338 |   await page.getByRole("button", { name: "Generate my plan" }).click();
  339 | 
  340 |   await expect(page.getByText("Plan ready")).toBeVisible();
  341 |   expect(planAttempts).toBe(3);
  342 |   expect(pageErrors).toEqual([]);
  343 | });
  344 | 
  345 | test("changing the goal through Back replaces the old placement map", async ({ page }) => {
  346 |   await page.route("**/api/plans/generate**", async route => {
  347 |     const request = route.request().postDataJSON();
```