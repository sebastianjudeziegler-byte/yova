import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { LearningPlan, SessionResource } from "../src/lib/domain";

test.skip(process.env.YOVA_RUN_LIVE_BROWSER_CANARY !== "1", "Explicit live-provider canary only.");

test("a live-generated deadline lesson streams, finishes unrated and preserves completion on reload",async({page})=>{
  test.setTimeout(180_000);
  const fixture = JSON.parse(readFileSync("docs/audits/2026-09-07-plan-creation/consolidated/evidence/live-ten-minute.json","utf8")) as {plan:LearningPlan;resource:SessionResource};
  const apiResults:Array<{path:string;status:number}> = [];
  page.on("response",response=>{
    const path = new URL(response.url()).pathname;
    if(path.startsWith("/api/"))apiResults.push({path,status:response.status()});
  });
  await page.goto("/?qa=preview");
  await page.getByRole("button",{name:"Build my plan"}).click();
  await page.getByLabel("First name").fill("Learner");
  await page.getByLabel("Email address").fill("live-launch-local@example.com");
  await page.getByRole("button",{name:"Continue",exact:true}).click();
  await page.getByRole("button",{name:/Personalize YOVA/}).click();
  const answers = ["Show a short recommendation and alternatives","I delay a little, then get going","20 to 30 minutes","A concrete example before the rule","Recalling it without notes, then checking","I recognize it but cannot recall it","Give me a small hint","Show one step at a time","Clear checkpoints inside the block","No extra support right now","Afternoon"];
  for(const [index,answer] of answers.entries()){
    await page.getByRole("button",{name:answer,exact:true}).click();
    await page.getByRole("button",{name:index===answers.length-1?"Build my setup":"Continue",exact:true}).click();
  }
  await page.getByRole("button",{name:"Open YOVA"}).click();
  await page.evaluate(({plan,resource})=>{
    const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1")??"{}");
    snapshot.plans=[{...plan,sessions:plan.sessions.map((session:LearningPlan["sessions"][number],index:number)=>index===0?{...session,status:"ready",resource}:session)}];
    localStorage.setItem("yova.preview.v1",JSON.stringify(snapshot));
  },fixture);
  await page.reload();
  await page.getByRole("button",{name:"Learning",exact:true}).click();
  await page.locator(".learning-goal-card").filter({hasText:fixture.plan.title}).getByRole("button",{name:"Start next"}).click();
  const early = page.getByRole("button",{name:"Start now, keep dates"});
  if(await early.isVisible())await early.click();
  await expect(page.locator(".session-setup-shell, .session-shell")).toBeVisible({timeout:30_000});
  if(await page.locator(".session-setup-shell").isVisible()){
    await page.getByRole("button",{name:"Continue",exact:true}).click();
    await page.getByRole("button",{name:"Continue",exact:true}).click();
    await page.getByRole("button",{name:"Prepare this session"}).click();
  }
  for(let step=0;step<15;step+=1){
    if(await page.getByText("SESSION COMPLETE",{exact:true}).isVisible())break;
    const activityHeading = await page.locator(".session-activity-header h1").innerText({timeout:60_000});
    const currentResource = await page.evaluate(planId=>{
      const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1")??"{}");
      return snapshot.plans?.find((plan:LearningPlan)=>plan.id===planId)?.sessions[0]?.resource;
    },fixture.plan.id) as SessionResource | undefined;
    const current = (currentResource??fixture.resource).activities.find(activity=>activity.title===activityHeading);
    const confidence = page.getByRole("button",{name:"Somewhat sure",exact:true});
    if(await confidence.isVisible() && await confidence.isEnabled())await confidence.click();
    const written = page.locator(".recall-response textarea");
    if(await written.isVisible() && await written.isEnabled()){
      await written.fill(current?.correctAnswer??"ATP hydrolysis forms ADP and inorganic phosphate. This reaction releases free energy that can be coupled to cellular work.");
      await page.getByRole("button",{name:"Check my answer",exact:true}).click();
      await page.getByRole("button",{name:"I got the key idea",exact:true}).click({timeout:60_000});
    } else if(current?.correctAnswer && await page.locator(".answer-grid").isVisible()) {
      await page.locator(".answer-grid").getByRole("button",{name:current.correctAnswer,exact:true}).click();
    }
    const advance = page.locator(".session-action-bar").getByRole("button");
    await expect(advance).toBeEnabled({timeout:75_000});
    await advance.click();
  }
  await expect(page.getByText("SESSION COMPLETE",{exact:true})).toBeVisible();
  await expect(page.locator(".completion-feedback .selected")).toHaveCount(0);
  await page.screenshot({path:"docs/audits/2026-09-07-plan-creation/consolidated/evidence/live-lesson-complete.png",fullPage:true});
  await page.getByRole("button",{name:"Finish and continue",exact:true}).click();
  await page.reload();
  const saved = await page.evaluate(planId=>{
    const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1")??"{}");
    return {plan:snapshot.plans?.find((plan:LearningPlan)=>plan.id===planId),completion:snapshot.sessionCompletions?.find((completion:{planId:string})=>completion.planId===planId)};
  },fixture.plan.id);
  expect(saved.plan.sessions[0].status).toBe("complete");
  expect(saved.completion.feedback).toBeNull();
  expect(saved.completion.totalAnswers).toBeGreaterThan(0);
  expect(apiResults.some(result=>result.path.includes("/lesson") && result.status===200)).toBe(true);
  writeFileSync("docs/audits/2026-09-07-plan-creation/consolidated/evidence/live-browser-completion.json",JSON.stringify({apiResults,saved},null,2));
});
