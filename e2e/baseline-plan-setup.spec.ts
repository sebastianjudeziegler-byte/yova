import { expect, test } from "./helpers/frozen-clock";
import { openPlanSetupPreview } from "./helpers/plan-setup";
import type { PlanKnowledgeMap } from "../src/lib/knowledge-map/schema";

test.use({ video: "on" });
const id=(n:number)=>`91000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const map:PlanKnowledgeMap={version:1,scopeJudgment:{band:"unit_or_exam",label:"Cell transport",minimumSessions:2,recommendedSessions:4,maximumSessions:8,minimumTeachingSessions:2,explanation:"Understand and apply transport processes to unfamiliar experiments."},topics:["Diffusion","Osmosis"].map((title,index)=>({id:id(index+1),title,description:`Explain ${title.toLowerCase()} in unfamiliar cell transport experiments.`,subtopics:["Direction","Energy"],prerequisiteTopicIds:[],status:"not_started",initialEvidence:null,sourceReferences:[],origin:"ai_generated",deferred:null})),placementCheck:{status:"available",completedAt:null,demonstratedTopicIds:[],gapTopicIds:[]}};

test("an initial topic-map failure keeps setup recoverable and retries the same goal",async({page})=>{
 const goal="Learn cell transport for my biology test next Friday: diffusion and osmosis.";
 let attempts=0;
 await page.route("**/api/plans/generate?mode=understanding",async route=>{
  expect(route.request().postDataJSON().goal).toBe(goal);
  attempts++;
  if(attempts===1){await route.fulfill({status:503,json:{error:"Topic mapping is temporarily unavailable."}});return;}
  await route.continue({postData:JSON.stringify({...route.request().postDataJSON(),knowledgeMap:map})});
 });
 await openPlanSetupPreview(page);
 await page.getByLabel("Learning goal or deadline").fill(goal);
 await page.getByRole("button",{name:"Continue",exact:true}).click();
 await page.getByRole("button",{name:/Create it for me/}).click();
 await page.getByRole("button",{name:"Continue",exact:true}).click();
 await expect(page.getByRole("heading",{name:"The topic map is not ready yet"})).toBeVisible();
 await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
 await page.getByRole("button",{name:"Retry topic map",exact:true}).click();
 await expect(page.getByRole("heading",{name:"What YOVA understood"})).toBeVisible();
 expect(attempts).toBe(2);
 await page.getByRole("button",{name:"Skip corrections",exact:true}).click();
 await expect(page.getByRole("heading",{name:"When would you prefer to study this material?"})).toBeVisible();
});

test("setup corrections are atomic, recoverable and do not automatically start placement",async({page})=>{
 let diagnosticRequests=0; let rejectCorrection=true;
 await page.route("**/api/plans/generate**",async route=>{
  const body=route.request().postDataJSON();const mode=new URL(route.request().url()).searchParams.get("mode");
  if(mode==="diagnostic") diagnosticRequests++;
  if(mode==="understanding" && body.setupCorrections && rejectCorrection){rejectCorrection=false;await route.fulfill({status:503,json:{error:"The correction could not be saved. Try again."}});return;}
  // Accepted-map fixture exercises scope UI/server receipt integration only.
  // It makes no claim about AI mapping or generated learning quality.
  await route.continue({postData:JSON.stringify({...body,...(!body.knowledgeMap?{knowledgeMap:map}:{})})});
 });
 await openPlanSetupPreview(page);
 await page.getByLabel("Learning goal or deadline").fill("A-level biology: apply diffusion and osmosis in experiments for my test next Friday.");
 await page.getByRole("button",{name:"An assignment",exact:true}).click();
 await page.getByRole("button",{name:"Continue",exact:true}).click();
 await page.getByRole("button",{name:/Create it for me/}).click();
 await page.getByRole("button",{name:"Continue",exact:true}).click();
 await expect(page.getByRole("heading",{name:"What YOVA understood"})).toBeVisible();
 await page.getByLabel("Already covered: Diffusion").check();
 await page.getByLabel("Move Osmosis up").click();
 await page.getByLabel("Add a topic",{exact:true}).fill("Active transport");
 await page.getByRole("button",{name:"Add topic",exact:true}).click();
 await page.getByRole("button",{name:"Continue",exact:true}).click();
 await expect(page.getByRole("alert")).toContainText("could not be saved");
 await expect(page.getByLabel("Already covered: Diffusion")).toBeChecked();
 await expect(page.getByText("Active transport",{exact:true})).toBeVisible();
 const corrected=page.waitForResponse(response=>response.url().includes("mode=understanding") && response.request().postDataJSON().setupCorrections);
 await page.getByRole("button",{name:"Continue",exact:true}).click();
 const result=await (await corrected).json();
 expect(result.knowledgeMap.topics.map((topic:{title:string})=>topic.title)).toEqual(["Osmosis","Diffusion","Active transport"]);
 expect(result.knowledgeMap.topics[1].initialEvidence).toMatchObject({source:"learner_report",checked:false});
 await expect(page.getByRole("heading",{name:"When would you prefer to study this material?"})).toBeVisible();
 await page.getByRole("button",{name:"Continue",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Check your starting point?"})).toBeVisible();
 expect(diagnosticRequests).toBe(0);
 const generated=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/plans/generate" && !new URL(response.url()).search);
 await page.getByRole("button",{name:"Skip placement and build plan"}).click();
 const generation=await (await generated).json();
 expect(generation.plan.planModel.version).toBe("topic_plan_v2");
 await expect(page.getByRole("region",{name:"Plan grouped by topic"})).toBeVisible();
 await page.getByRole("button",{name:"Use this plan",exact:true}).click();
 await expect(page.getByRole("button",{name:"Start next block",exact:true})).toBeVisible();
});

test("an abandoned placement keeps answered evidence and ignores unseen questions",async({page})=>{
 await page.route("**/api/plans/generate**",async route=>{const body=route.request().postDataJSON();await route.continue({postData:JSON.stringify({...body,...(!body.knowledgeMap?{knowledgeMap:map}:{})})});});
 await openPlanSetupPreview(page);
 await page.getByLabel("Learning goal or deadline").fill("Learn cell transport for a biology test next Friday: diffusion and osmosis.");
 await page.getByRole("button",{name:"Continue",exact:true}).click();await page.getByRole("button",{name:/Create it for me/}).click();await page.getByRole("button",{name:"Continue",exact:true}).click();
 await page.getByRole("button",{name:"Skip corrections"}).click();await page.getByRole("button",{name:"Continue",exact:true}).click();
 const prepared=page.waitForResponse(response=>response.url().includes("mode=diagnostic"));
 await page.getByRole("button",{name:"Start placement check"}).click();
 const questions=(await (await prepared).json()).questions;
 await page.getByRole("button",{name:questions[0].options[0],exact:true}).click();await page.getByRole("button",{name:"Next question",exact:true}).click();
 const scored=page.waitForResponse(response=>response.url().includes("/diagnostic/score"));
 await page.getByRole("button",{name:"Skip for now",exact:true}).click();
 const score=await (await scored).json();expect(score.responses).toHaveLength(1);expect(score.knowledgeMap.placementCheck.status).toBe("partial");expect(score.knowledgeMap.placementCheck.gapTopicIds).toEqual([]);
 await expect(page.getByRole("region",{name:"Plan grouped by topic"})).toBeVisible();
});
