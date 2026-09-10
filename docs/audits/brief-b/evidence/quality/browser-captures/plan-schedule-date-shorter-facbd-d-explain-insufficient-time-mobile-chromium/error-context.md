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
      - generic [ref=e15]: "Y"
      - navigation "Main navigation" [ref=e17]:
        - button "Home" [ref=e18] [cursor=pointer]
        - button "Learning" [ref=e20] [cursor=pointer]
        - button "Calendar" [ref=e22] [cursor=pointer]
        - button "Ask YOVA" [ref=e24] [cursor=pointer]
        - button "You" [ref=e26] [cursor=pointer]
      - generic [ref=e28]:
        - button "Add to YOVA" [ref=e29] [cursor=pointer]:
          - generic [ref=e31]: Add
        - generic [ref=e32]:
          - generic "Learner · Private alpha" [ref=e33]: L
          - button "Sign out on this device" [ref=e34] [cursor=pointer]
    - main [ref=e38]:
      - generic [ref=e39]:
        - generic [ref=e40]:
          - generic [ref=e41]:
            - text: LEARNING
            - heading "What you’re working toward" [level=1] [ref=e42]
            - paragraph [ref=e43]: Every goal keeps its plan, materials, sessions, and progress in one place.
          - button "New plan" [ref=e44] [cursor=pointer]
        - navigation "Learning sections" [ref=e46]:
          - button "Active 1" [ref=e47] [cursor=pointer]:
            - text: Active
            - generic [ref=e48]: "1"
          - button "Recent 0" [ref=e49] [cursor=pointer]:
            - text: Recent
            - generic [ref=e50]: "0"
          - button "Archive 0" [ref=e51] [cursor=pointer]:
            - text: Archive
            - generic [ref=e52]: "0"
          - button "Methods 12" [ref=e53] [cursor=pointer]:
            - text: Methods
            - generic [ref=e54]: "12"
        - button "All active learning" [ref=e55] [cursor=pointer]
        - generic [ref=e58]:
          - generic [ref=e59]:
            - generic [ref=e60]: TEST · OCT 14
            - heading "Prepare for a Biology Test on Cell Membranes and Diffusion" [level=2] [ref=e61]
            - paragraph [ref=e62]: The core vocabulary and relationships in Photosynthesis and cellular…
            - generic [ref=e63]: Practice, diagnose, and repair
            - text: 0 of 6 sessions complete
          - generic [ref=e69]:
            - button "Start next session" [ref=e70] [cursor=pointer]
            - button "Adjust" [active] [ref=e71] [cursor=pointer]
            - button "Archive" [ref=e75] [cursor=pointer]
        - generic [ref=e79]:
          - generic [ref=e80]:
            - generic [ref=e81]:
              - text: KNOWLEDGE MAP
              - heading "What this plan is building" [level=3] [ref=e82]
              - paragraph [ref=e83]: Topics are ordered by prerequisite. Sessions below are how each topic moves from introduced to secure.
            - generic [ref=e84]: 0 of 10 secure
          - generic [ref=e85]:
            - generic [ref=e86]:
              - generic [ref=e87]: OPTIONAL PLACEMENT CHECK
              - strong [ref=e88]: Make the remaining plan more precise
              - paragraph [ref=e89]: Answer a few map-based questions so YOVA can replace lessons on demonstrated topics with shorter verification checks. Skipping never marks a topic as known.
            - button "Take the placement check" [ref=e90] [cursor=pointer]
          - list [ref=e93]:
            - listitem [ref=e94]:
              - generic [ref=e95]: "1"
              - generic [ref=e96]:
                - generic [ref=e97]:
                  - strong [ref=e98]: The core vocabulary and relationships in Photosynthesis and cellular…
                  - generic [ref=e99]: Not started
                - paragraph [ref=e100]: The knowledge and performance needed for The core vocabulary and relationships in Photosynthesis and cellular respiration.
                - text: Structured by YOVA for this goal
                - generic [ref=e101]:
                  - button "I already learned this" [ref=e102] [cursor=pointer]
                  - button "Attach a source" [ref=e103] [cursor=pointer]
            - listitem [ref=e104]:
              - generic [ref=e105]: "2"
              - generic [ref=e106]:
                - generic [ref=e107]:
                  - strong [ref=e108]: The current starting gaps revealed without notes
                  - generic [ref=e109]: Not started
                - paragraph [ref=e110]: The knowledge and performance needed for The current starting gaps revealed without notes.
                - generic [ref=e111]: Builds on The core vocabulary and relationships in Photosynthesis and cellular…
                - text: Structured by YOVA for this goal
                - generic [ref=e112]:
                  - button "I already learned this" [ref=e113] [cursor=pointer]
                  - button "Attach a source" [ref=e114] [cursor=pointer]
            - listitem [ref=e115]:
              - generic [ref=e116]: "3"
              - generic [ref=e117]:
                - generic [ref=e118]:
                  - strong [ref=e119]: A clear mental model of the weakest idea in…
                  - generic [ref=e120]: Not started
                - paragraph [ref=e121]: The knowledge and performance needed for A clear mental model of the weakest idea in Photosynthesis and cellular respiration.
                - generic [ref=e122]: Builds on The current starting gaps revealed without notes
                - text: Structured by YOVA for this goal
                - generic [ref=e123]:
                  - button "I already learned this" [ref=e124] [cursor=pointer]
                  - button "Attach a source" [ref=e125] [cursor=pointer]
            - listitem [ref=e126]:
              - generic [ref=e127]: "4"
              - generic [ref=e128]:
                - generic [ref=e129]:
                  - strong [ref=e130]: One concrete example that shows how the idea works
                  - generic [ref=e131]: Not started
                - paragraph [ref=e132]: The knowledge and performance needed for One concrete example that shows how the idea works.
                - generic [ref=e133]: Builds on A clear mental model of the weakest idea in…
                - text: Structured by YOVA for this goal
                - generic [ref=e134]:
                  - button "I already learned this" [ref=e135] [cursor=pointer]
                  - button "Attach a source" [ref=e136] [cursor=pointer]
            - listitem [ref=e137]:
              - generic [ref=e138]: "5"
              - generic [ref=e139]:
                - generic [ref=e140]:
                  - strong [ref=e141]: Choosing the correct idea in mixed situations
                  - generic [ref=e142]: Not started
                - paragraph [ref=e143]: The knowledge and performance needed for Choosing the correct idea in mixed situations.
                - generic [ref=e144]: Builds on One concrete example that shows how the idea works
                - text: Structured by YOVA for this goal
                - generic [ref=e145]:
                  - button "I already learned this" [ref=e146] [cursor=pointer]
                  - button "Attach a source" [ref=e147] [cursor=pointer]
            - listitem [ref=e148]:
              - generic [ref=e149]: "6"
              - generic [ref=e150]:
                - generic [ref=e151]:
                  - strong [ref=e152]: Explaining why tempting alternatives do not fit
                  - generic [ref=e153]: Not started
                - paragraph [ref=e154]: The knowledge and performance needed for Explaining why tempting alternatives do not fit.
                - generic [ref=e155]: Builds on Choosing the correct idea in mixed situations
                - text: Structured by YOVA for this goal
                - generic [ref=e156]:
                  - button "I already learned this" [ref=e157] [cursor=pointer]
                  - button "Attach a source" [ref=e158] [cursor=pointer]
            - listitem [ref=e159]:
              - generic [ref=e160]: "7"
              - generic [ref=e161]:
                - generic [ref=e162]:
                  - strong [ref=e163]: Representative unsupported questions
                  - generic [ref=e164]: Not started
                - paragraph [ref=e165]: The knowledge and performance needed for Representative unsupported questions.
                - generic [ref=e166]: Builds on Explaining why tempting alternatives do not fit
                - text: Structured by YOVA for this goal
                - generic [ref=e167]:
                  - button "I already learned this" [ref=e168] [cursor=pointer]
                  - button "Attach a source" [ref=e169] [cursor=pointer]
            - listitem [ref=e170]:
              - generic [ref=e171]: "8"
              - generic [ref=e172]:
                - generic [ref=e173]:
                  - strong [ref=e174]: Errors repaired with a different follow-up prompt
                  - generic [ref=e175]: Not started
                - paragraph [ref=e176]: The knowledge and performance needed for Errors repaired with a different follow-up prompt.
                - generic [ref=e177]: Builds on Representative unsupported questions
                - text: Structured by YOVA for this goal
                - generic [ref=e178]:
                  - button "I already learned this" [ref=e179] [cursor=pointer]
                  - button "Attach a source" [ref=e180] [cursor=pointer]
            - listitem [ref=e181]:
              - generic [ref=e182]: "9"
              - generic [ref=e183]:
                - generic [ref=e184]:
                  - strong [ref=e185]: One independent transfer attempt
                  - generic [ref=e186]: Not started
                - paragraph [ref=e187]: The knowledge and performance needed for One independent transfer attempt.
                - generic [ref=e188]: Builds on Errors repaired with a different follow-up prompt
                - text: Structured by YOVA for this goal
                - generic [ref=e189]:
                  - button "I already learned this" [ref=e190] [cursor=pointer]
                  - button "Attach a source" [ref=e191] [cursor=pointer]
            - listitem [ref=e192]:
              - generic [ref=e193]: "10"
              - generic [ref=e194]:
                - generic [ref=e195]:
                  - strong [ref=e196]: The highest-priority ideas still due for retrieval
                  - generic [ref=e197]: Not started
                - paragraph [ref=e198]: The knowledge and performance needed for The highest-priority ideas still due for retrieval.
                - generic [ref=e199]: Builds on One independent transfer attempt
                - text: Structured by YOVA for this goal
                - generic [ref=e200]:
                  - button "I already learned this" [ref=e201] [cursor=pointer]
                  - button "Attach a source" [ref=e202] [cursor=pointer]
        - region "Plan change preview" [ref=e203]:
          - generic [ref=e204]:
            - heading "Review your changes" [level=3] [ref=e205]
            - paragraph [ref=e206]: Adjust a line or leave it out, then confirm once.
          - group "Add another change" [ref=e207]:
            - generic [ref=e209]:
              - text: Change type
              - combobox "Change type" [ref=e210]:
                - option "I already learned this"
                - option "Attach a source"
                - option "Add a topic"
                - option "Remove future work"
                - option "Move a topic"
                - option "Change the deadline"
                - option "Change available time" [selected]
            - generic [ref=e211]:
              - text: Day
              - combobox "Day" [ref=e212]:
                - option "Monday" [selected]
                - option "Tuesday"
                - option "Wednesday"
                - option "Thursday"
                - option "Friday"
                - option "Saturday"
                - option "Sunday"
            - generic [ref=e213]:
              - text: Time window
              - textbox "Time window" [ref=e214]: 18:00–19:00
            - generic [ref=e215]:
              - text: Minutes
              - spinbutton "Minutes" [ref=e216]: "60"
            - generic [ref=e217]:
              - generic [ref=e218]:
                - 'checkbox "Keep existing window: Wednesday Afternoon" [checked] [ref=e219]'
                - text: "Keep existing window: Wednesday Afternoon"
              - generic [ref=e220]:
                - 'checkbox "Keep existing window: Friday Afternoon" [checked] [ref=e221]'
                - text: "Keep existing window: Friday Afternoon"
              - generic [ref=e222]:
                - 'checkbox "Keep existing window: Monday Afternoon" [checked] [ref=e223]'
                - text: "Keep existing window: Monday Afternoon"
            - paragraph [ref=e224]: Keep the windows you still want, and add the time above.
            - button "Preview change" [ref=e225] [cursor=pointer]
          - generic [ref=e226]:
            - button "Cancel" [ref=e227] [cursor=pointer]
            - button "Confirm changes" [disabled] [ref=e228]
        - generic [ref=e229]:
          - generic [ref=e230]:
            - generic [ref=e231]:
              - heading "Your plan" [level=3] [ref=e232]
              - paragraph [ref=e233]: The sequence YOVA will guide you through, one session at a time.
            - generic [ref=e234]: 6 sessions
          - generic [ref=e235]:
            - generic [ref=e236]:
              - generic [ref=e238]:
                - strong [ref=e239]: Practice The core vocabulary and relationships in Photosynthesis and cellular respiration
                - generic [ref=e240]: Practice first · Active Recall · Wed 2:00 PM
              - generic [ref=e241]: 25 min
            - generic [ref=e242]:
              - generic [ref=e244]:
                - strong [ref=e245]: Practice The current starting gaps revealed without notes, A clear mental model of the
                - generic [ref=e246]: Practice first · Concept Mapping · Fri 2:00 PM
              - generic [ref=e247]: 25 min
            - generic [ref=e248]:
              - generic [ref=e250]:
                - strong [ref=e251]: Practice One concrete example that shows how the idea works, Choosing the correct idea in
                - generic [ref=e252]: Practice first · Concept Mapping · Mon 2:00 PM
              - generic [ref=e253]: 25 min
            - generic [ref=e254]:
              - generic [ref=e256]:
                - strong [ref=e257]: Practice Explaining why tempting alternatives do not fit, Representative unsupported
                - generic [ref=e258]: Practice first · Concept Mapping · Wed 2:00 PM
              - generic [ref=e259]: 25 min
            - generic [ref=e260]:
              - generic [ref=e262]:
                - strong [ref=e263]: Practice Errors repaired with a different follow-up prompt, One independent transfer
                - generic [ref=e264]: Practice first · Concept Mapping · Fri 2:00 PM
              - generic [ref=e265]: 25 min
            - generic [ref=e266]:
              - generic [ref=e268]:
                - strong [ref=e269]: Practice The highest-priority ideas still due for retrieval
                - generic [ref=e270]: Practice first · Concept Mapping · Mon 2:00 PM
              - generic [ref=e271]: 25 min
        - generic [ref=e272]:
          - generic [ref=e273]:
            - heading "Learning source" [level=3] [ref=e274]
            - button "Add file or link" [ref=e275] [cursor=pointer]
          - paragraph [ref=e277]:
            - strong [ref=e278]: Created by YOVA
            - text: . Teaching and practice for this goal. Attach a source to a topic to plan time for it; completed work stays saved.
        - generic [ref=e279]:
          - generic [ref=e280]:
            - generic [ref=e281]:
              - heading "Study resources" [level=3] [ref=e282]
              - paragraph [ref=e283]: Reusable explanations and practice, attached to the session that needed them.
            - generic [ref=e284]: Created when relevant
          - generic [ref=e289]:
            - strong [ref=e290]: Nothing extra to browse yet
            - paragraph [ref=e291]: YOVA creates the teaching and practice needed for a session when you first start it. Those resources will stay here afterward.
    - contentinfo [ref=e292]:
      - navigation "Trust and support" [ref=e293]:
        - link "Support" [ref=e294] [cursor=pointer]:
          - /url: /support
        - link "Privacy" [ref=e295] [cursor=pointer]:
          - /url: /privacy
        - link "Terms" [ref=e296] [cursor=pointer]:
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