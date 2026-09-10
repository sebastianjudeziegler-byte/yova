# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> an overdue arbitrary inside session splits and loads a route-faithful 10-minute workpad
- Location: e2e/core-learning-loop.spec.ts:1209:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.agenda-recovery-result')
Expected substring: "Split applied. Part 1 and each remaining part now have a 10-minute window."
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for locator('.agenda-recovery-result')

```

```yaml
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
    - button "Active 0"
    - button "Recent 1"
    - button "Archive 0"
    - button "Methods 12"
  - button "All recent learning"
  - text: TOPIC · FLEXIBLE
  - heading "Review Eigenvalues and Eigenvectors for Practice" [level=2]
  - paragraph: Review eigenvalues and eigenvectors for practice
  - text: Practice, diagnose, and repair 0 of 1 sessions complete
  - button "Start next session"
  - button "Adjust"
  - button "Archive"
  - text: Plan state
  - strong: Unfinished work
  - text: Knowledge-check accuracy
  - strong: No data
  - text: Last session felt
  - strong: Not rated
  - text: KNOWLEDGE MAP
  - heading "What this plan is building" [level=3]
  - paragraph: Topics are ordered by prerequisite. Sessions below are how each topic moves from introduced to secure.
  - text: 0 of 1 secure OPTIONAL PLACEMENT CHECK
  - strong: Make the remaining plan more precise
  - paragraph: Answer a few map-based questions so YOVA can replace lessons on demonstrated topics with shorter verification checks. Skipping never marks a topic as known.
  - button "Take the placement check"
  - list:
    - listitem:
      - text: "1"
      - strong: Review eigenvalues and eigenvectors for practice
      - text: Not started
      - paragraph: The knowledge and performance needed for Review eigenvalues and eigenvectors for practice.
      - text: Structured by YOVA for this goal
      - button "I already learned this"
      - button "Attach a source"
  - region "Plan change preview":
    - heading "Review your changes" [level=3]
    - paragraph: Adjust a line or leave it out, then confirm once.
    - group "Add another change":
      - text: Add another change Change type
      - combobox "Change type":
        - option "I already learned this"
        - option "Attach a source"
        - option "Add a topic"
        - option "Remove future work"
        - option "Move a topic"
        - option "Change the deadline"
        - option "Change available time" [selected]
      - text: Day
      - combobox "Day":
        - option "Monday" [selected]
        - option "Tuesday"
        - option "Wednesday"
        - option "Thursday"
        - option "Friday"
        - option "Saturday"
        - option "Sunday"
      - text: Time window
      - textbox "Time window": 18:00–19:00
      - text: Minutes
      - spinbutton "Minutes": "60"
      - paragraph: Keep the windows you still want, and add the time above.
      - button "Preview change"
    - button "Cancel"
    - button "Confirm changes" [disabled]
  - heading "Sessions in this study" [level=3]
  - paragraph: Completed sessions are checked. Unfinished sessions remain listed without being counted as completed.
  - text: 1 sessions
  - strong: Retrieve and apply Review eigenvalues and eigenvectors for practice
  - text: Practice first · Concept Mapping · Wed 9:34 AM 15 min
  - heading "Learning source" [level=3]
  - button "Add file or link"
  - paragraph:
    - strong: Created by YOVA
    - text: . Teaching and practice for this goal. Attach a source to a topic to plan time for it; completed work stays saved.
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
- alert
```

# Test source

```ts
  1163 |   await expect.poll(() => page.evaluate(() => {
  1164 |     const stored = window.localStorage.getItem("yova.preview.v1");
  1165 |     if (!stored) return [];
  1166 |     const snapshot = JSON.parse(stored) as {
  1167 |       plans?: Array<{
  1168 |         sessions?: Array<{
  1169 |           title?: string;
  1170 |           estimatedMinutes?: number;
  1171 |           status?: string;
  1172 |         }>;
  1173 |       }>;
  1174 |     };
  1175 |     return (snapshot.plans?.at(-1)?.sessions ?? []).map((session) => ({
  1176 |       title: session.title,
  1177 |       minutes: session.estimatedMinutes,
  1178 |       status: session.status,
  1179 |     }));
  1180 |   })).toEqual([
  1181 |     expect.objectContaining({ title: expect.stringContaining("Part 1 of 2"), minutes: 10, status: "ready" }),
  1182 |     expect.objectContaining({ title: expect.stringContaining("Part 2 of 2"), minutes: 10, status: "upcoming" }),
  1183 |   ]);
  1184 | 
  1185 |   await page.getByRole("button", { name: "Start Part 1 (10 min)", exact: true }).click();
  1186 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  1187 |   await expect(setupSummary).toContainText("about 10 minutes");
  1188 |   await expect(setupSummary).not.toContainText("about 15 minutes");
  1189 | 
  1190 |   await page.route("**/api/sessions/generate", async (route) => {
  1191 |     await route.fulfill({
  1192 |       status: 502,
  1193 |       contentType: "application/json",
  1194 |       body: JSON.stringify({
  1195 |         error: "Live generation did not produce a guided session that passed YOVA's learning checks.",
  1196 |         retryable: false,
  1197 |       }),
  1198 |     });
  1199 |   });
  1200 |   await page.getByRole("button", { name: "Continue" }).click();
  1201 |   await page.getByRole("button", { name: "Continue" }).click();
  1202 |   await page.getByRole("button", { name: "Prepare this session" }).click();
  1203 | 
  1204 |   await expect(page.getByText(/safe built-in session was loaded instead/i)).toBeVisible();
  1205 |   await expect(page.getByText("STEP 1 OF 3", { exact: true })).toBeVisible();
  1206 |   await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).not.toBeVisible();
  1207 | });
  1208 | 
  1209 | test("an overdue arbitrary inside session splits and loads a route-faithful 10-minute workpad", async ({ page }) => {
  1210 |   await createPreviewAccount(page);
  1211 |   await completeOnboarding(page);
  1212 | 
  1213 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  1214 |   await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
  1215 |     "Review eigenvalues and eigenvectors for practice",
  1216 |   );
  1217 |   await page.getByRole("button", { name: "15 minutes", exact: true }).click();
  1218 |   await page.getByRole("button", { name: "I understand the basics but need practice" }).click();
  1219 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  1220 |   await page.getByRole("button", { name: /Create it for me/ }).click();
  1221 |   await page.getByRole("button", { name: /Build and start session/ }).click();
  1222 |   await openExistingStudyNowSetup(page);
  1223 | 
  1224 |   const setupSummary = page.locator(".session-current-assumption");
  1225 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  1226 |   await expect(setupSummary).toContainText("about 15 minutes");
  1227 |   await page.getByRole("button", { name: "Not now", exact: true }).click();
  1228 | 
  1229 |   await page.evaluate(() => {
  1230 |     const stored = window.localStorage.getItem("yova.preview.v1");
  1231 |     if (!stored) throw new Error("Expected the inside-YOVA Study Now plan in the preview snapshot.");
  1232 |     const snapshot = JSON.parse(stored) as {
  1233 |       plans?: Array<{ sessions?: Array<{
  1234 |         scheduledFor?: string;
  1235 |         status?: string;
  1236 |         contentTargets?: string[];
  1237 |         completionEvidence?: string[];
  1238 |       }> }>;
  1239 |       updatedAt?: string;
  1240 |     };
  1241 |     const ready = snapshot.plans?.at(-1)?.sessions?.find((session) => session.status === "ready");
  1242 |     if (!ready) throw new Error("Expected a ready inside-YOVA session to make overdue.");
  1243 |     ready.scheduledFor = new Date(Date.now() - 6 * 60 * 60 * 1_000).toISOString();
  1244 |     // Acronym-only targets have no tokens in the curated-template heuristic.
  1245 |     // The generic fallback must use its exact saved-target contract instead.
  1246 |     ready.contentTargets = ["DNA and RNA"];
  1247 |     ready.completionEvidence = ["Explain the saved relationship in your own words"];
  1248 |     snapshot.updatedAt = new Date().toISOString();
  1249 |     window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  1250 |   });
  1251 |   await page.reload();
  1252 | 
  1253 |   await page.getByRole("button", { name: "Calendar", exact: true }).click();
  1254 |   await expect(page.getByText("A SESSION IS STILL WAITING", { exact: true })).toBeVisible();
  1255 |   await page.getByRole("button", { name: "Ran out of time", exact: true }).click();
  1256 |   const splitButton = page.getByRole("button", {
  1257 |     name: "Recommended: Split into 10-min sessions",
  1258 |     exact: true,
  1259 |   });
  1260 |   await expect(splitButton).toBeVisible();
  1261 |   await splitButton.click();
  1262 | 
> 1263 |   await expect(page.locator(".agenda-recovery-result")).toContainText(
       |                                                         ^ Error: expect(locator).toContainText(expected) failed
  1264 |     "Split applied. Part 1 and each remaining part now have a 10-minute window.",
  1265 |   );
  1266 |   await expect(page.getByRole("button", { name: "Start Part 1 (10 min)", exact: true })).toBeVisible();
  1267 |   await expect.poll(() => page.evaluate(() => {
  1268 |     const stored = window.localStorage.getItem("yova.preview.v1");
  1269 |     if (!stored) return [];
  1270 |     const snapshot = JSON.parse(stored) as {
  1271 |       plans?: Array<{ sessions?: Array<{ estimatedMinutes?: number; status?: string }> }>;
  1272 |     };
  1273 |     return (snapshot.plans?.at(-1)?.sessions ?? []).map((session) => ({
  1274 |       minutes: session.estimatedMinutes,
  1275 |       status: session.status,
  1276 |     }));
  1277 |   })).toEqual([
  1278 |     expect.objectContaining({ minutes: 10, status: "ready" }),
  1279 |     expect.objectContaining({ minutes: 10, status: "upcoming" }),
  1280 |   ]);
  1281 | 
  1282 |   await page.getByRole("button", { name: "Learning", exact: true }).click();
  1283 |   await page.getByRole("button", { name: /^Recent \d+$/ }).click();
  1284 |   const unfinishedStudyNowPlan = page.locator(".learning-goal-card").filter({
  1285 |     hasText: /eigenvalues and eigenvectors/i,
  1286 |   });
  1287 |   await expect(unfinishedStudyNowPlan).toContainText("NEXT SESSION");
  1288 |   await expect(unfinishedStudyNowPlan.getByRole("button", { name: "Start next", exact: true })).toBeVisible();
  1289 |   await unfinishedStudyNowPlan.getByRole("button", { name: "Open goal", exact: true }).click();
  1290 |   const learningDetailStart = page.getByRole("button", { name: "Start next session", exact: true });
  1291 |   await expect(page.getByText("Unfinished work", { exact: true })).toBeVisible();
  1292 |   await expect(learningDetailStart).toBeVisible();
  1293 |   await learningDetailStart.click();
  1294 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  1295 |   await expect(setupSummary).toContainText("about 10 minutes");
  1296 |   await expect(setupSummary).not.toContainText("about 15 minutes");
  1297 | 
  1298 |   await page.route("**/api/sessions/generate", async (route) => {
  1299 |     await route.fulfill({
  1300 |       status: 502,
  1301 |       contentType: "application/json",
  1302 |       body: JSON.stringify({
  1303 |         error: "Live generation did not produce a guided session that passed YOVA's learning checks.",
  1304 |         retryable: false,
  1305 |       }),
  1306 |     });
  1307 |   });
  1308 |   await page.getByRole("button", { name: "Continue" }).click();
  1309 |   await page.getByRole("button", { name: "Continue" }).click();
  1310 |   await page.getByRole("button", { name: "Prepare this session" }).click();
  1311 | 
  1312 |   await expect(page.getByText(/safe study-method workpad was loaded instead/i)).toBeVisible();
  1313 |   const methodWorkpad = page.getByLabel("Study-method workpad");
  1314 |   await expect(methodWorkpad).toBeVisible();
  1315 |   await expect(methodWorkpad.getByLabel("How to study this")).toContainText("Concept Mapping");
  1316 |   await expect(methodWorkpad).toContainText("DNA and RNA");
  1317 |   await expect(methodWorkpad).toContainText("This completes practice, not a knowledge check.");
  1318 |   await expect(page.getByText("STEP 1 OF 3", { exact: true })).toHaveCount(0);
  1319 |   await expect(page.getByRole("heading", { name: "Use the session target as your comparison frame" })).toHaveCount(0);
  1320 |   await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).not.toBeVisible();
  1321 |   await expect(page.getByText("COMPARISON CHECK", { exact: true })).toHaveCount(0);
  1322 | });
  1323 | 
  1324 | test("the backend rejects an opaque goal even when the browser guard is bypassed", async ({ request }) => {
  1325 |   const response = await request.post("/api/plans/generate", {
  1326 |     headers: { "X-Yova-Development-Preview": "plan-creator" },
  1327 |     data: {
  1328 |       intent: "study_now",
  1329 |       learningIntent: "learn",
  1330 |       goal: "Start Calc Unit 3",
  1331 |       materialMode: "none",
  1332 |       materials: [],
  1333 |       studyMode: "inside",
  1334 |       deadline: null,
  1335 |       timeZone: "America/Los_Angeles",
  1336 |       diagnosticResponses: [{
  1337 |         question: "Where are you starting?",
  1338 |         answer: "I have not learned this yet",
  1339 |         evaluation: "self_report",
  1340 |       }],
  1341 |       availability: [{ day: "Today", window: "Now", minutes: 15 }],
  1342 |       profileSummary: "The learner wants a short, clearly structured session.",
  1343 |     },
  1344 |   });
  1345 |   const body = await response.json();
  1346 | 
  1347 |   expect(response.status()).toBe(422);
  1348 |   expect(body.code).toBe("goal_needs_detail");
  1349 | });
  1350 | 
  1351 | test("plan generation remains a draft until the learner activates it", async ({ request }) => {
  1352 |   const deadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000);
  1353 |   const generationRequest = {
  1354 |     intent: "plan",
  1355 |     learningIntent: "learn",
  1356 |     goal: "Understand photosynthesis and cellular respiration for my biology test",
  1357 |     materialMode: "none",
  1358 |     materials: [],
  1359 |     studyMode: "inside",
  1360 |     deadline: deadline.toISOString(),
  1361 |     timeZone: "America/Los_Angeles",
  1362 |     diagnosticResponses: [{
  1363 |       question: "Where are you starting?",
```