# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plan-launch-live.spec.ts >> a live-generated deadline lesson streams, finishes unrated and preserves completion on reload
- Location: e2e/plan-launch-live.spec.ts:8:5

# Error details

```
TimeoutError: locator.click: Timeout 60000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'I got the key idea', exact: true })

```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - button "Open Next.js Dev Tools" [ref=f1e7] [cursor=pointer]
  - alert [ref=f1e11]
  - main [ref=f1e12]:
    - generic [ref=f1e13]:
      - generic [ref=f1e16]:
        - generic [ref=f1e17]: Teach Me Cellular Respiration From Scratch for My Test, Including ATP… · Session 1 of 1
        - strong [ref=f1e18]: Build ATP and energy transfer
      - generic [ref=f1e19]: 1 of 3 required steps complete · 0:00 elapsed
      - generic [ref=f1e23]:
        - button "Change direction" [ref=f1e24] [cursor=pointer]
        - button "Exit" [ref=f1e28] [cursor=pointer]
    - generic [ref=f1e29]:
      - complementary [ref=f1e30]:
        - text: · current step only
        - group [ref=f1e31]:
          - generic "Feynman Technique Teaching first · Step 2 of 5 · 5 learning phases" [ref=f1e32] [cursor=pointer]:
            - generic [ref=f1e33]:
              - strong [ref=f1e34]: Feynman Technique
              - generic [ref=f1e35]: Teaching first · Step 2 of 5 · 5 learning phases
          - text: · current step only
      - generic [ref=f1e38]:
        - region "Method phase 2 of 5" [ref=f1e39]:
          - generic [ref=f1e40]:
            - generic [ref=f1e41]: METHOD PHASE 2 OF 5
            - strong [ref=f1e42]: Explain why it works
            - paragraph [ref=f1e43]: Rebuild the relationship or reason in your own words, then compare it with the model.
          - emphasis [ref=f1e44]: Generate first
        - generic [ref=f1e45]:
          - generic [ref=f1e46]:
            - generic [ref=f1e47]:
              - generic [ref=f1e48]: STEP 2 OF 5
              - strong [ref=f1e49]: Explain
            - generic [ref=f1e50]: About 2 min
          - heading "ATP energy transfer" [level=1] [ref=f1e54]
          - paragraph [ref=f1e56]: How does ATP contribute usable energy in cellular respiration?
        - generic [ref=f1e57]:
          - generic [ref=f1e60]:
            - generic [ref=f1e61]: PREVIOUS LESSON AVAILABLE
            - strong [ref=f1e62]: ATP Energy Transfer
            - generic [ref=f1e63]: Open it without losing this question or your place.
          - button "Review the lesson" [ref=f1e64] [cursor=pointer]
        - generic [ref=f1e65]:
          - generic [ref=f1e66]:
            - generic [ref=f1e67]: Explain why it works
            - textbox "Explain why it works" [disabled] [ref=f1e68]:
              - /placeholder: Rebuild the relationship or reason in your own words, then compare it with the model.
              - text: ATP hydrolysis forms ADP and inorganic phosphate. This reaction releases free energy that can be coupled to cellular work.
          - generic [ref=f1e69]:
            - generic [ref=f1e70]:
              - generic [ref=f1e71]: YOVA'S FORMATIVE CHECK
              - strong [ref=f1e72]: YOVA could not judge this confidently.
              - paragraph [ref=f1e74]: Your explanation overlaps with part of the reference answer, but YOVA cannot confirm the full key idea from this response alone. Compare it carefully below.
              - generic [ref=f1e75]:
                - text: What your answer established
                - list [ref=f1e76]:
                  - listitem [ref=f1e77]: You included the idea connected to “energy.”
                  - listitem [ref=f1e78]: You included the idea connected to “phosphate.”
                  - listitem [ref=f1e79]: You included the idea connected to “work.”
              - generic [ref=f1e80]:
                - text: What is still missing
                - list [ref=f1e81]:
                  - listitem [ref=f1e82]: The relationship involving “contributes” is still missing.
                  - listitem [ref=f1e83]: The relationship involving “usable” is still missing.
            - generic [ref=f1e84]:
              - text: YOUR ATTEMPT
              - paragraph [ref=f1e86]: ATP hydrolysis forms ADP and inorganic phosphate. This reaction releases free energy that can be coupled to cellular work.
            - generic [ref=f1e87]:
              - text: MODEL ANSWER
              - paragraph [ref=f1e89]: ATP contributes usable energy when its terminal phosphate bond is hydrolyzed, releasing energy that cells can use for work.
              - group [ref=f1e90]:
                - generic "What this answer needs to show" [ref=f1e91] [cursor=pointer]
            - generic [ref=f1e92]: YOVA did not record a correct or incorrect result from this check. Continue after comparing with the model answer.
            - text: Your typed answer is not saved, and this uncertain or unavailable check created no concept or method evidence.
        - button "Continue" [ref=f1e95] [cursor=pointer]
    - complementary [ref=f1e98]:
      - button "Ask YOVA" [ref=f1e99] [cursor=pointer]
```

# Test source

```ts
  1  | import { readFileSync, writeFileSync } from "node:fs";
  2  | import { expect, test } from "@playwright/test";
  3  | import { freezePlanClock } from "./helpers/frozen-clock";
  4  | import type { LearningPlan, SessionResource } from "../src/lib/domain";
  5  |
  6  | test.skip(process.env.YOVA_RUN_LIVE_BROWSER_CANARY !== "1", "Explicit live-provider canary only.");
  7  |
  8  | test("a live-generated deadline lesson streams, finishes unrated and preserves completion on reload",async({page})=>{
  9  |   test.setTimeout(180_000);
  10 |   await freezePlanClock(page, new Date("2026-09-07T19:35:00.000Z"));
  11 |   const fixture = JSON.parse(readFileSync("docs/audits/2026-09-07-plan-creation/consolidated/evidence/live-ten-minute.json","utf8")) as {plan:LearningPlan;resource:SessionResource};
  12 |   const apiResults:Array<{path:string;status:number}> = [];
  13 |   page.on("response",response=>{
  14 |     const path = new URL(response.url()).pathname;
  15 |     if(path.startsWith("/api/"))apiResults.push({path,status:response.status()});
  16 |   });
  17 |   await page.goto("/?qa=preview");
  18 |   await page.getByRole("button",{name:"Build my plan"}).click();
  19 |   await page.getByLabel("First name").fill("Learner");
  20 |   await page.getByLabel("Email address").fill("live-launch-local@example.com");
  21 |   await page.getByRole("button",{name:"Continue",exact:true}).click();
  22 |   await page.getByRole("button",{name:/Personalize YOVA/}).click();
  23 |   const answers = ["Show a short recommendation and alternatives","I delay a little, then get going","20 to 30 minutes","A concrete example before the rule","Recalling it without notes, then checking","I recognize it but cannot recall it","Give me a small hint","Show one step at a time","Clear checkpoints inside the block","No extra support right now","Afternoon"];
  24 |   for(const [index,answer] of answers.entries()){
  25 |     await page.getByRole("button",{name:answer,exact:true}).click();
  26 |     await page.getByRole("button",{name:index===answers.length-1?"Build my setup":"Continue",exact:true}).click();
  27 |   }
  28 |   await page.getByRole("button",{name:"Open YOVA"}).click();
  29 |   await page.evaluate(({plan,resource})=>{
  30 |     const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1")??"{}");
  31 |     snapshot.plans=[{...plan,sessions:plan.sessions.map((session:LearningPlan["sessions"][number],index:number)=>index===0?{...session,status:"ready",resource}:session)}];
  32 |     localStorage.setItem("yova.preview.v1",JSON.stringify(snapshot));
  33 |   },fixture);
  34 |   await page.reload();
  35 |   await page.getByRole("button",{name:"Learning",exact:true}).click();
  36 |   await page.locator(".learning-goal-card").filter({hasText:fixture.plan.title}).getByRole("button",{name:"Start next"}).click();
  37 |   const early = page.getByRole("button",{name:"Start now, keep dates"});
  38 |   if(await early.isVisible())await early.click();
  39 |   await expect(page.locator(".session-setup-shell, .session-shell")).toBeVisible({timeout:30_000});
  40 |   if(await page.locator(".session-setup-shell").isVisible()){
  41 |     await page.getByRole("button",{name:"Continue",exact:true}).click();
  42 |     await page.getByRole("button",{name:"Continue",exact:true}).click();
  43 |     await page.getByRole("button",{name:"Prepare this session"}).click();
  44 |   }
  45 |   for(let step=0;step<15;step+=1){
  46 |     if(await page.getByText("SESSION COMPLETE",{exact:true}).isVisible())break;
  47 |     const activityHeading = await page.locator(".session-activity-header h1").innerText({timeout:60_000});
  48 |     const currentResource = await page.evaluate(planId=>{
  49 |       const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1")??"{}");
  50 |       return snapshot.plans?.find((plan:LearningPlan)=>plan.id===planId)?.sessions[0]?.resource;
  51 |     },fixture.plan.id) as SessionResource | undefined;
  52 |     const current = (currentResource??fixture.resource).activities.find(activity=>activity.title===activityHeading);
  53 |     const confidence = page.getByRole("button",{name:"Somewhat sure",exact:true});
  54 |     if(await confidence.isVisible() && await confidence.isEnabled())await confidence.click();
  55 |     const written = page.locator(".recall-response textarea");
  56 |     if(await written.isVisible() && await written.isEnabled()){
  57 |       await written.fill(current?.correctAnswer??"ATP hydrolysis forms ADP and inorganic phosphate. This reaction releases free energy that can be coupled to cellular work.");
  58 |       await page.getByRole("button",{name:"Check my answer",exact:true}).click();
> 59 |       await page.getByRole("button",{name:"I got the key idea",exact:true}).click({timeout:60_000});
     |                                                                             ^ TimeoutError: locator.click: Timeout 60000ms exceeded.
  60 |     } else if(current?.correctAnswer && await page.locator(".answer-grid").isVisible()) {
  61 |       await page.locator(".answer-grid").getByRole("button",{name:current.correctAnswer,exact:true}).click();
  62 |     }
  63 |     const advance = page.locator(".session-action-bar").getByRole("button");
  64 |     await expect(advance).toBeEnabled({timeout:75_000});
  65 |     await advance.click();
  66 |   }
  67 |   await expect(page.getByText("SESSION COMPLETE",{exact:true})).toBeVisible();
  68 |   await expect(page.locator(".completion-feedback .selected")).toHaveCount(0);
  69 |   await page.screenshot({path:"docs/audits/2026-09-07-plan-creation/consolidated/evidence/live-lesson-complete.png",fullPage:true});
  70 |   await page.getByRole("button",{name:"Finish and continue",exact:true}).click();
  71 |   await page.reload();
  72 |   const saved = await page.evaluate(planId=>{
  73 |     const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1")??"{}");
  74 |     return {plan:snapshot.plans?.find((plan:LearningPlan)=>plan.id===planId),completion:snapshot.sessionCompletions?.find((completion:{planId:string})=>completion.planId===planId)};
  75 |   },fixture.plan.id);
  76 |   expect(saved.plan.sessions[0].status).toBe("complete");
  77 |   expect(saved.completion.feedback).toBeNull();
  78 |   expect(saved.completion.totalAnswers).toBeGreaterThan(0);
  79 |   expect(apiResults.some(result=>result.path.includes("/lesson") && result.status===200)).toBe(true);
  80 |   writeFileSync("docs/audits/2026-09-07-plan-creation/consolidated/evidence/live-browser-completion.json",JSON.stringify({apiResults,saved},null,2));
  81 | });
  82 |
```
