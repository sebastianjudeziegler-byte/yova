import { expect, test, PLAN_FIXED_NOW } from "./helpers/frozen-clock";
import { activatePreviewPlan, openPlanSetupPreview } from "./helpers/plan-setup";
import type { Page } from "@playwright/test";
import type { LearningPlan } from "../src/lib/domain";
import type { PlanKnowledgeMap } from "../src/lib/knowledge-map/schema";

const zone="Europe/London";
test.use({timezoneId:zone,video:"on"});
const titles=["ATP and energy transfer","Glycolysis","Link reaction","Krebs cycle","Electron transport chain","Chemiosmosis"];
function topicMap(subject=titles):PlanKnowledgeMap{return{version:1,scopeJudgment:{band:"unit_or_exam",label:"Cellular respiration",minimumSessions:12,recommendedSessions:12,maximumSessions:12,minimumTeachingSessions:6,explanation:"Learn each part of respiration and practise applying it independently."},topics:subject.map((title,index)=>({id:`90000000-0000-4000-8000-${String(index+1).padStart(12,"0")}`,title,description:`Explain ${title} and apply it to unfamiliar questions.`,subtopics:[],prerequisiteTopicIds:[],status:"not_started",initialEvidence:null,sourceReferences:[],origin:"ai_generated",deferred:null})),placementCheck:{status:"available",completedAt:null,demonstratedTopicIds:[],gapTopicIds:[]}};}
async function acceptedMap(page:Page){await page.route("**/api/plans/generate**",async route=>{const body=route.request().postDataJSON();await route.continue({postData:JSON.stringify({...body,...(!body.knowledgeMap?{knowledgeMap:topicMap()}:{})})});});}
async function reachSchedule(page:Page,goal:string){await page.getByLabel("Learning goal or deadline").fill(goal);await page.getByRole("button",{name:"Continue",exact:true}).click();await page.getByRole("button",{name:/Create it for me/}).click();await page.getByRole("button",{name:"Continue",exact:true}).click();await page.getByRole("button",{name:"Skip corrections",exact:true}).click();}
async function generate(page:Page){await page.getByRole("button",{name:"Continue",exact:true}).click();const response=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/plans/generate"&&!new URL(response.url()).search);await page.getByRole("button",{name:"Skip placement and build plan",exact:true}).click();return await(await response).json();}
function dateIn(days:number){const date=new Date(PLAN_FIXED_NOW);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}

// Accepted-map fixtures isolate calendar/state integration. These tests exercise
// real receipt, composition, routing and activation endpoints, not AI quality.
for(const days of [1,3])test(`a ${days}-day deadline retains the full queue and states scheduling conflicts`,async({page},testInfo)=>{
 await acceptedMap(page);await openPlanSetupPreview(page);
 await reachSchedule(page,`Teach me cellular respiration from scratch for my biology test on ${dateIn(days)}. I can study every day evenings for 45 minutes.`);
 const generated=await generate(page);const plan=generated.plan as LearningPlan;
 expect(plan.planModel?.version).toBe("topic_plan_v2");expect(plan.deadline?.slice(0,10)).toBe(dateIn(days));
 expect(new Set(plan.sessions.flatMap(session=>session.topicIds??[])).size).toBe(titles.length);
 expect(plan.knowledgeMap!.topics.every(topic=>!topic.deferred)).toBe(true);
 const scheduled=[...plan.sessions].sort((left,right)=>left.scheduledFor.localeCompare(right.scheduledFor));
 for(let index=1;index<scheduled.length;index++){const previous=scheduled[index-1]!;expect(Date.parse(scheduled[index]!.scheduledFor)-Date.parse(previous.scheduledFor)-previous.estimatedMinutes*60_000).toBeGreaterThanOrEqual(5*60_000);}
 const late=plan.sessions.some(session=>Date.parse(session.scheduledFor)+session.estimatedMinutes*60_000>Date.parse(plan.deadline!));
 if(late){expect(plan.planModel!.constraints?.join(" ")).toContain("after the deadline");await expect(page.getByRole("region",{name:"Plan grouped by topic"})).toContainText("after the deadline");}
 const savedPlan=await activatePreviewPlan(page);
 const saved={plan:savedPlan,completions:await page.evaluate(()=>JSON.parse(localStorage.getItem("yova.preview.v1")??"{}").sessionCompletions??[])};
 expect(saved.plan.deadline).toBe(plan.deadline);expect(saved.plan.sessions).toHaveLength(plan.sessions.length);expect(saved.completions).toEqual([]);
 await testInfo.attach(`deadline-${days}-queue`,{body:JSON.stringify(saved.plan,null,2),contentType:"application/json"});
});

test("explicit weekdays and a goal date survive changes to availability",async({page})=>{
 await acceptedMap(page);await openPlanSetupPreview(page);
 await reachSchedule(page,`Prepare for a biology test on cellular respiration on ${dateIn(40)}. I can study only Monday, Wednesday and Friday afternoons for 25 minutes.`);
 for(const day of ["Monday","Wednesday","Friday"]){await expect(page.getByRole("button",{name:`Remove ${day}`,exact:true})).toBeVisible();await expect(page.getByLabel(`${day} time window`,{exact:true})).toHaveValue("Afternoon");}
 await page.getByRole("button",{name:"Quick choices",exact:true}).click();await page.getByRole("button",{name:"15 minutes",exact:true}).click();
 await expect(page.getByText("3 study windows available",{exact:true})).toBeVisible();await page.getByRole("button",{name:/Custom Choose each day/}).click();
 for(const day of ["Monday","Wednesday","Friday"])await expect(page.getByLabel(`${day} available minutes`,{exact:true})).toHaveValue("15");
 const generated=await generate(page);expect(generated.plan.deadline.slice(0,10)).toBe(dateIn(40));
 expect(generated.plan.schedulePreferences.availability.map((slot:{day:string})=>slot.day).sort()).toEqual(["Friday","Monday","Wednesday"]);
 for(const session of generated.plan.sessions){expect(session.estimatedMinutes).toBeLessThanOrEqual(15);expect(new Intl.DateTimeFormat("en-GB",{timeZone:zone,weekday:"long"}).format(new Date(session.scheduledFor))).toMatch(/^(Monday|Wednesday|Friday)$/);}
});

test("a historical topic date does not override the real deadline",async({page})=>{
 await openPlanSetupPreview(page);
 await reachSchedule(page,"Learn the causes and effects of September 11, 2001 for my history test in two weeks.");
 const generated=await generate(page);expect(generated.plan.deadline.slice(0,10)).toBe(dateIn(14));
 await expect(page.getByRole("region",{name:"Plan grouped by topic"})).toBeVisible();
});

test("changing the goal through Back replaces the accepted map and date",async({page})=>{
 await page.route("**/api/plans/generate**",async route=>{const body=route.request().postDataJSON();if(body.knowledgeMap)return route.continue();const photo=body.goal.includes("photosynthesis");const map=topicMap([photo?"Photosynthesis and chloroplasts":"Glycolysis products"]);map.topics[0]!.id=photo?"91000000-0000-4000-8000-000000000002":"91000000-0000-4000-8000-000000000001";await route.continue({postData:JSON.stringify({...body,knowledgeMap:map})});});
 await openPlanSetupPreview(page);await reachSchedule(page,`Learn glycolysis products for my biology test on ${dateIn(14)}.`);
 if(await page.getByRole("button",{name:"Quick choices",exact:true}).isVisible())await page.getByRole("button",{name:"Quick choices",exact:true}).click();
 await page.getByRole("button",{name:"Back",exact:true}).click();await page.getByRole("button",{name:"Back",exact:true}).click();await page.getByRole("button",{name:"Back",exact:true}).click();
 await reachSchedule(page,`Learn photosynthesis and chloroplasts for my biology test on ${dateIn(21)}.`);
 const generated=await generate(page);expect(generated.plan.deadline.slice(0,10)).toBe(dateIn(21));expect(JSON.stringify(generated.plan.sessions)).not.toMatch(/glycolysis/i);expect(generated.plan.knowledgeMap.topics[0].title).toBe("Photosynthesis and chloroplasts");
});
