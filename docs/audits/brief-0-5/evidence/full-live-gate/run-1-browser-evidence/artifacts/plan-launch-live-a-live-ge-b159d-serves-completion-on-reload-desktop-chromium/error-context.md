# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plan-launch-live.spec.ts >> a live-generated deadline lesson streams, finishes unrated and preserves completion on reload
- Location: e2e/plan-launch-live.spec.ts:9:5

# Error details

```
Error: ENOENT: no such file or directory, open '/var/folders/6g/f_6s5bsj5_9bspsksgj3_vdw0000gn/T/yova-live-gate-Wx5p5s/run-1/fixtures/deadline/live-ten-minute.json'
```

# Test source

```ts
  1  | import { readFileSync, writeFileSync } from "node:fs";
  2  | import { expect, test } from "@playwright/test";
  3  | import { freezePlanClock } from "./helpers/frozen-clock";
  4  | import { liveFixturePath } from "../src/evals/live-fixtures";
  5  | import type { LearningPlan, SessionResource } from "../src/lib/domain";
  6  | 
  7  | test.skip(process.env.YOVA_RUN_LIVE_BROWSER_CANARY !== "1", "Explicit live-provider canary only.");
  8  | 
  9  | test("a live-generated deadline lesson streams, finishes unrated and preserves completion on reload",async({page})=>{
  10 |   test.setTimeout(180_000);
> 11 |   const fixture = JSON.parse(readFileSync(liveFixturePath("deadline", "live-ten-minute.json"),"utf8")) as {plan:LearningPlan;resource:SessionResource};
     |                                          ^ Error: ENOENT: no such file or directory, open '/var/folders/6g/f_6s5bsj5_9bspsksgj3_vdw0000gn/T/yova-live-gate-Wx5p5s/run-1/fixtures/deadline/live-ten-minute.json'
  12 |   await freezePlanClock(page, new Date(fixture.plan.createdAt));
  13 |   const apiResults:Array<{path:string;status:number}> = [];
  14 |   page.on("response",response=>{
  15 |     const path = new URL(response.url()).pathname;
  16 |     if(path.startsWith("/api/"))apiResults.push({path,status:response.status()});
  17 |   });
  18 |   await page.goto("/?qa=preview");
  19 |   await page.getByRole("button",{name:"Build my plan"}).click();
  20 |   await page.getByLabel("First name").fill("Learner");
  21 |   await page.getByLabel("Email address").fill("live-launch-local@example.com");
  22 |   await page.getByRole("button",{name:"Continue",exact:true}).click();
  23 |   await page.getByRole("button",{name:/Personalize YOVA/}).click();
  24 |   const answers = ["Show a short recommendation and alternatives","I delay a little, then get going","20 to 30 minutes","A concrete example before the rule","Recalling it without notes, then checking","I recognize it but cannot recall it","Give me a small hint","Show one step at a time","Clear checkpoints inside the block","No extra support right now","Afternoon"];
  25 |   for(const [index,answer] of answers.entries()){
  26 |     await page.getByRole("button",{name:answer,exact:true}).click();
  27 |     await page.getByRole("button",{name:index===answers.length-1?"Build my setup":"Continue",exact:true}).click();
  28 |   }
  29 |   await page.getByRole("button",{name:"Open YOVA"}).click();
  30 |   await page.evaluate(({plan,resource})=>{
  31 |     const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1")??"{}");
  32 |     snapshot.plans=[{...plan,sessions:plan.sessions.map((session:LearningPlan["sessions"][number],index:number)=>index===0?{...session,status:"ready",resource}:session)}];
  33 |     localStorage.setItem("yova.preview.v1",JSON.stringify(snapshot));
  34 |   },fixture);
  35 |   await page.reload();
  36 |   await page.getByRole("button",{name:"Learning",exact:true}).click();
  37 |   await page.locator(".learning-goal-card").filter({hasText:fixture.plan.title}).getByRole("button",{name:"Start next"}).click();
  38 |   const early = page.getByRole("button",{name:"Start now, keep dates"});
  39 |   if(await early.isVisible())await early.click();
  40 |   await expect(page.locator(".session-setup-shell, .session-shell")).toBeVisible({timeout:30_000});
  41 |   if(await page.locator(".session-setup-shell").isVisible()){
  42 |     await page.getByRole("button",{name:"Continue",exact:true}).click();
  43 |     await page.getByRole("button",{name:"Continue",exact:true}).click();
  44 |     await page.getByRole("button",{name:"Prepare this session"}).click();
  45 |   }
  46 |   for(let step=0;step<15;step+=1){
  47 |     if(await page.getByText("SESSION COMPLETE",{exact:true}).isVisible())break;
  48 |     const activityHeading = await page.locator(".session-activity-header h1").innerText({timeout:60_000});
  49 |     const currentResource = await page.evaluate(planId=>{
  50 |       const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1")??"{}");
  51 |       return snapshot.plans?.find((plan:LearningPlan)=>plan.id===planId)?.sessions[0]?.resource;
  52 |     },fixture.plan.id) as SessionResource | undefined;
  53 |     const current = (currentResource??fixture.resource).activities.find(activity=>activity.title===activityHeading);
  54 |     const confidence = page.getByRole("button",{name:"Somewhat sure",exact:true});
  55 |     if(await confidence.isVisible() && await confidence.isEnabled())await confidence.click();
  56 |     const written = page.locator(".recall-response textarea");
  57 |     if(await written.isVisible() && await written.isEnabled()){
  58 |       await written.fill(current?.correctAnswer??"ATP hydrolysis forms ADP and inorganic phosphate. This reaction releases free energy that can be coupled to cellular work.");
  59 |       await page.getByRole("button",{name:"Check my answer",exact:true}).click();
  60 |       await page.getByRole("button",{name:"I got the key idea",exact:true}).click({timeout:60_000});
  61 |     } else if(current?.correctAnswer && await page.locator(".answer-grid").isVisible()) {
  62 |       await page.locator(".answer-grid").getByRole("button",{name:current.correctAnswer,exact:true}).click();
  63 |     }
  64 |     const advance = page.locator(".session-action-bar").getByRole("button");
  65 |     await expect(advance).toBeEnabled({timeout:75_000});
  66 |     await advance.click();
  67 |   }
  68 |   await expect(page.getByText("SESSION COMPLETE",{exact:true})).toBeVisible();
  69 |   await expect(page.locator(".completion-feedback .selected")).toHaveCount(0);
  70 |   await page.screenshot({path:test.info().outputPath("lesson-complete.png"),fullPage:true});
  71 |   await page.getByRole("button",{name:"Finish and continue",exact:true}).click();
  72 |   await page.reload();
  73 |   const saved = await page.evaluate(planId=>{
  74 |     const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1")??"{}");
  75 |     return {plan:snapshot.plans?.find((plan:LearningPlan)=>plan.id===planId),completion:snapshot.sessionCompletions?.find((completion:{planId:string})=>completion.planId===planId)};
  76 |   },fixture.plan.id);
  77 |   expect(saved.plan.sessions[0].status).toBe("complete");
  78 |   expect(saved.completion.feedback).toBeNull();
  79 |   expect(saved.completion.totalAnswers).toBeGreaterThan(0);
  80 |   expect(apiResults.some(result=>result.path.includes("/lesson") && result.status===200)).toBe(true);
  81 |   writeFileSync(test.info().outputPath("completion.json"),JSON.stringify({apiResults,saved},null,2));
  82 | });
  83 | 
```