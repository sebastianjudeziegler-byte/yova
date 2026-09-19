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

// The short-deadline degrade ladder (founder decision, 18 Sept 2026: restored as
// it worked on main, titles kept so the release comparison matches them). When
// every remaining window before the deadline is under ten minutes, the learner
// gets one quick priority action, not a plan and not a claim of learning.
async function expectPriorityCard(page:Page,generated:{kind?:string;priority?:{minutes:number;progressCredit:boolean}},minutes:number){
 expect(generated).toMatchObject({kind:"deadline_priority",priority:{minutes,progressCredit:false}});
 expect(generated).not.toHaveProperty("plan");
 await expect(page.getByRole("heading",{name:`Focus on ${titles[0]}`})).toBeVisible();
 await expect(page.getByText("This card does not record a completed session or mark the topic as learned.",{exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Use this plan",exact:true})).toHaveCount(0);
 await expect(page.getByRole("region",{name:"Plan grouped by topic"})).toHaveCount(0);
}
for(const minutes of [1,3,5,9])test(`explicit ${minutes}-minute availability remains a priority card`,async({page},testInfo)=>{
 await acceptedMap(page);await openPlanSetupPreview(page);
 await reachSchedule(page,`Teach me cellular respiration from scratch for my biology test on ${dateIn(1)}. I can study every day evenings for ${minutes} minutes.`);
 const generated=await generate(page);
 await expectPriorityCard(page,generated,minutes);
 await page.screenshot({path:testInfo.outputPath(`priority-${minutes}-minutes.png`),fullPage:true});
});
test("consolidated: a three-minute priority records no completion",async({page},testInfo)=>{
 // A real server deadline clips an ordinary 45-minute evening window to three
 // minutes under the frozen clock; nothing about the response is fabricated.
 const boundary=new Date(PLAN_FIXED_NOW);boundary.setUTCDate(boundary.getUTCDate()+1);boundary.setUTCHours(19,3,0,0);
 await page.route("**/api/plans/generate**",async route=>{
  const body=route.request().postDataJSON();
  const tinyWindow=route.request().url().includes("?mode=")?{}:{deadline:boundary.toISOString(),timeZone:"UTC",availability:[{day:new Intl.DateTimeFormat("en-US",{weekday:"long",timeZone:"UTC"}).format(boundary),window:"Evening",minutes:45}]};
  await route.continue({postData:JSON.stringify({...body,...(!body.knowledgeMap?{knowledgeMap:topicMap()}:{}),...tinyWindow})});
 });
 await openPlanSetupPreview(page);
 await reachSchedule(page,`Teach me cellular respiration from scratch for my biology test on ${dateIn(1)}. I can study every day evenings for 45 minutes.`);
 const generated=await generate(page);
 await expectPriorityCard(page,generated,3);
 await page.screenshot({path:testInfo.outputPath("priority-three-minutes.png"),fullPage:true});
 await page.getByRole("button",{name:"Done",exact:true}).click();
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem("yova.preview.v1")??"{}"));
 expect(state.sessionCompletions??[]).toEqual([]);
 expect((state.plans??[]).filter((plan:{status?:string})=>plan.status==="active")).toEqual([]);
});

// Brief 2.5 finding 10: the five cases above all had a study window before the
// deadline, which is why they passed while production showed no card. A
// deadline minutes away with every window later returned no card, and the plan
// was built from windows after the test.
test("a deadline nine minutes away outside every study window is a priority card",async({page},testInfo)=>{
 const deadline=new Date(PLAN_FIXED_NOW.getTime()+9*60_000);
 await page.route("**/api/plans/generate**",async route=>{
  const body=route.request().postDataJSON();
  const minutesAway=route.request().url().includes("?mode=")?{}:{deadline:deadline.toISOString(),timeZone:"UTC",availability:[{day:"Every day",window:"Evening",minutes:45}]};
  await route.continue({postData:JSON.stringify({...body,...(!body.knowledgeMap?{knowledgeMap:topicMap()}:{}),...minutesAway})});
 });
 await openPlanSetupPreview(page);
 await reachSchedule(page,`Teach me cellular respiration from scratch for my biology test on ${dateIn(1)}. I can study every day evenings for 45 minutes.`);
 const generated=await generate(page);
 await expectPriorityCard(page,generated,9);
 await page.screenshot({path:testInfo.outputPath("priority-nine-minutes-no-window.png"),fullPage:true});
});

// Accepted-map fixtures isolate calendar/state integration. These tests exercise
// real receipt, composition, routing and activation endpoints, not AI quality.
// Brief 2.5 root cause 2 replaces "retains the full queue and states scheduling
// conflicts": nothing is placed after the deadline; what does not fit is saved
// for later with the reason shown.
for(const days of [1,3])test(`a ${days}-day deadline places nothing after it and names what is saved for later`,async({page},testInfo)=>{
 await acceptedMap(page);await openPlanSetupPreview(page);
 await reachSchedule(page,`Teach me cellular respiration from scratch for my biology test on ${dateIn(days)}. I can study every day evenings for 45 minutes.`);
 const generated=await generate(page);const plan=generated.plan as LearningPlan;
 expect(plan.planModel?.version).toBe("topic_plan_v2");expect(plan.deadline?.slice(0,10)).toBe(dateIn(days));
 const scheduledTopics=new Set(plan.sessions.flatMap(session=>session.topicIds??[]));
 const deferred=plan.knowledgeMap!.topics.filter(topic=>topic.deferred);
 expect(scheduledTopics.size+deferred.length).toBe(titles.length);
 expect(plan.sessions[0]!.learningMode).toBe("learn");
 const scheduled=[...plan.sessions].sort((left,right)=>left.scheduledFor.localeCompare(right.scheduledFor));
 for(let index=1;index<scheduled.length;index++){const previous=scheduled[index-1]!;expect(Date.parse(scheduled[index]!.scheduledFor)-Date.parse(previous.scheduledFor)-previous.estimatedMinutes*60_000).toBeGreaterThanOrEqual(5*60_000);}
 expect(plan.sessions.filter(session=>Date.parse(session.scheduledFor)+session.estimatedMinutes*60_000>Date.parse(plan.deadline!))).toEqual([]);
 await expect(page.getByText("after the deadline")).toHaveCount(0);
 for(const topic of deferred){expect(topic.deferred!.reason).toMatch(/deadline/i);await expect(page.locator(`[data-deferred-topic-id="${topic.id}"]`)).toContainText(topic.deferred!.reason);}
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
