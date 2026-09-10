# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> an overdue outside teaching-first session splits into runnable 10-minute parts
- Location: e2e/core-learning-loop.spec.ts:1103:5

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
  - heading "Understand How the Krebs Cycle Actually Produces NADH and FADH2" [level=2]
  - paragraph: How the Krebs cycle actually produces NADH and FADH2
  - text: Building understanding, then practice 0 of 1 sessions complete
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
      - strong: How the Krebs cycle actually produces NADH and FADH2
      - text: Not started
      - paragraph: The knowledge and performance needed for I want to understand how the Krebs cycle actually produces NADH and FADH2.
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
  - strong: Learn I want to understand how the Krebs cycle actually...
  - text: Teaching first · Feynman Technique · Wed 9:51 AM 15 min
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
  1058 |   await expect(page.getByText(/Your session was recovered/)).toBeVisible();
  1059 |   await expect(page.locator(".method-session-shell > header > span")).not.toHaveText("0:00 elapsed");
  1060 | });
  1061 | 
  1062 | test("a 10-minute outside teaching-first session loads its built-in method lesson", async ({ page }) => {
  1063 |   await freezePlanClock(page);
  1064 |   await page.route("**/api/sessions/generate", async (route) => {
  1065 |     await route.fulfill({
  1066 |       status: 502,
  1067 |       contentType: "application/json",
  1068 |       body: JSON.stringify({
  1069 |         error: "Live generation did not produce a guided session that passed YOVA's learning checks.",
  1070 |         retryable: false,
  1071 |       }),
  1072 |     });
  1073 |   });
  1074 |   await createPreviewAccount(page);
  1075 |   await completeOnboarding(page);
  1076 | 
  1077 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  1078 |   await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
  1079 |     "I want to understand how the Krebs cycle actually produces NADH and FADH2",
  1080 |   );
  1081 |   await page.getByRole("button", { name: "15 minutes", exact: true }).click();
  1082 |   await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  1083 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  1084 |   await page.getByRole("button", { name: /Guide me outside YOVA/ }).click();
  1085 |   await page.getByRole("button", { name: /Build and start session/ }).click();
  1086 |   await rebuildLatestStudyNowPlanForMinutes(page, 10);
  1087 | 
  1088 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  1089 |   await page.getByRole("button", { name: "Continue" }).click();
  1090 |   await page.getByRole("button", { name: "I need more support first" }).click();
  1091 |   await page.getByRole("button", { name: "Continue" }).click();
  1092 |   await expect(page.getByText(/add more guidance inside the planned method/i)).toBeVisible();
  1093 |   await expect(page.getByText("Time in this recipe", { exact: true })).toBeVisible();
  1094 |   await expect(page.getByText("10 minutes", { exact: true })).toBeVisible();
  1095 |   await page.getByRole("button", { name: "Prepare this session" }).click();
  1096 | 
  1097 |   await expect(page.getByText(/safe built-in session was loaded instead/i)).toBeVisible();
  1098 |   await expect(page.getByText("STEP 1 OF 3", { exact: true })).toBeVisible();
  1099 |   await expect(page.locator(".session-activity-header").getByRole("heading", { name: /How to use/i })).toBeVisible();
  1100 |   await expect(page.getByRole("heading", { name: "YOVA already knows what this lesson should cover." })).not.toBeVisible();
  1101 | });
  1102 | 
  1103 | test("an overdue outside teaching-first session splits into runnable 10-minute parts", async ({ page }) => {
  1104 |   await createPreviewAccount(page);
  1105 |   await completeOnboarding(page);
  1106 | 
  1107 |   await page.getByRole("button", { name: "Study something now", exact: true }).first().click();
  1108 |   await page.getByPlaceholder("Example: Help me understand the product rule and practice using it.").fill(
  1109 |     "I want to understand how the Krebs cycle actually produces NADH and FADH2",
  1110 |   );
  1111 |   await page.getByRole("button", { name: "15 minutes", exact: true }).click();
  1112 |   await page.getByRole("button", { name: "I haven't learned this yet" }).click();
  1113 |   await page.getByRole("button", { name: /Choose how YOVA should help/ }).click();
  1114 |   await page.getByRole("button", { name: /Guide me outside YOVA/ }).click();
  1115 |   await page.getByRole("button", { name: /Build and start session/ }).click();
  1116 |   await openExistingStudyNowSetup(page);
  1117 | 
  1118 |   const setupSummary = page.locator(".session-current-assumption");
  1119 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
  1120 |   await expect(setupSummary).toContainText("about 15 minutes");
  1121 |   await page.getByRole("button", { name: "Not now", exact: true }).click();
  1122 | 
  1123 |   await expect.poll(() => page.evaluate(() => {
  1124 |     const stored = window.localStorage.getItem("yova.preview.v1");
  1125 |     if (!stored) return null;
  1126 |     const snapshot = JSON.parse(stored) as {
  1127 |       plans?: Array<{ sessions?: Array<{ estimatedMinutes?: number; status?: string }> }>;
  1128 |     };
  1129 |     const ready = snapshot.plans?.at(-1)?.sessions?.find((session) => session.status === "ready");
  1130 |     return ready?.estimatedMinutes ?? null;
  1131 |   })).toBe(15);
  1132 | 
  1133 |   await page.evaluate(() => {
  1134 |     const stored = window.localStorage.getItem("yova.preview.v1");
  1135 |     if (!stored) throw new Error("Expected the Study Now plan in the preview snapshot.");
  1136 |     const snapshot = JSON.parse(stored) as {
  1137 |       plans?: Array<{ sessions?: Array<{ scheduledFor?: string; status?: string }> }>;
  1138 |       updatedAt?: string;
  1139 |     };
  1140 |     const ready = snapshot.plans?.at(-1)?.sessions?.find((session) => session.status === "ready");
  1141 |     if (!ready) throw new Error("Expected a ready session to make overdue.");
  1142 |     ready.scheduledFor = new Date(Date.now() - 6 * 60 * 60 * 1_000).toISOString();
  1143 |     snapshot.updatedAt = new Date().toISOString();
  1144 |     window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  1145 |   });
  1146 |   await page.reload();
  1147 | 
  1148 |   await page.getByRole("button", { name: "Calendar", exact: true }).click();
  1149 |   await expect(page.getByText("A SESSION IS STILL WAITING", { exact: true })).toBeVisible();
  1150 |   await page.getByRole("button", { name: "Ran out of time", exact: true }).click();
  1151 |   const splitButton = page.getByRole("button", {
  1152 |     name: "Recommended: Split into 10-min sessions",
  1153 |     exact: true,
  1154 |   });
  1155 |   await expect(splitButton).toBeVisible();
  1156 |   await splitButton.click();
  1157 | 
> 1158 |   await expect(page.locator(".agenda-recovery-result")).toContainText(
       |                                                         ^ Error: expect(locator).toContainText(expected) failed
  1159 |     "Split applied. Part 1 and each remaining part now have a 10-minute window.",
  1160 |   );
  1161 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).not.toBeVisible();
  1162 |   await expect(page.getByRole("button", { name: "Start Part 1 (10 min)", exact: true })).toBeVisible();
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
```