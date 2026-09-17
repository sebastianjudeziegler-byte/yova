import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PlanCreator } from "./plan-creator";
import { GroupedTopicPlan, groupedPlanTopics } from "./grouped-topic-plan";
import { WhatYovaUnderstood } from "./what-yova-understood";
import { PlanEditPanel, topicReorderOperations, addedTopicOperation } from "./plan-edit-panel";
import { PlanKnowledgeMapSchema } from "@/lib/knowledge-map/schema";
import type { LearningPlan } from "@/lib/domain";

vi.mock("@/components/brand-mark", () => ({ BrandMark: () => createElement("span", null, "YOVA") }));

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const map = PlanKnowledgeMapSchema.parse({ version: 1,
 scopeJudgment: { band: "focused_skill", label: "Transport", minimumSessions: 1, recommendedSessions: 2, maximumSessions: 4, minimumTeachingSessions: 1, explanation: "Apply the processes of cell transport in unfamiliar examples." },
 topics: [first,second].map((id,index) => ({ id, title: index ? "Osmosis" : "Diffusion", description: "Explain the transport process.", subtopics: ["Direction", "Energy"], origin: "ai_generated" })),
});
const plan: LearningPlan = { id:first,learningItemId:first,title:"Cell transport",topic:"Biology",kind:"test",deadline:null,status:"active",sourceMode:"yova_generated",studyMode:"inside_yova",learningIntent:"learn",rationale:"",createdAt:"2026-09-17T10:00:00Z",knowledgeMap:map,
 planModel:{version:"topic_plan_v2",learningGoal:"Apply cell transport in experiments",ruleIds:["P2.q10.long_plan_shutdown"],personalizationSentence:"Your next block is shown first because long plans feel overwhelming.",scheduleMode:"movable",collapsedQueue:true,topicNotes:[{topicId:first,note:"Split into 2 blocks — 5 subtopics",learnBlockCount:2,topicWeight:5}],constraints:["Your next available day is after tomorrow."]},
 sessions:[{id:first,sequence:1,title:"Learn diffusion",objective:"Explain diffusion",method:"Concept Mapping",methodReason:"Connect the ideas",scheduledFor:"2026-09-17T10:00:00Z",estimatedMinutes:12,amountLabel:"12 minutes",learningMode:"learn",topicIds:[first],status:"complete"},{id:second,sequence:2,title:"Practice osmosis",objective:"Apply osmosis",method:"Active Recall",methodReason:"Use the idea",scheduledFor:"2026-09-18T10:00:00Z",estimatedMinutes:18,amountLabel:"18 minutes",learningMode:"study",topicIds:[second],status:"ready"}],
};
const noop=()=>{};
describe("functional plan setup and grouped view",()=>{
 it("places starting context and alternative entry links on the first screen",()=>{
  const html=renderToStaticMarkup(createElement(PlanCreator,{profileSummary:"A learner who prefers short guided sessions.",onExit:noop,onFinish:noop,onCreateEvent:noop,onStudyNow:noop}));
  expect(html).toContain("Anything YOVA should account for?");
  expect(html).toContain("Add an event instead");expect(html).toContain("Just study something now");expect(html).toContain("Step 1 of 6");
  expect(html).not.toContain('type="date"');
 });
 it("shows total blocks including practice, next action, profile reason and collapsed remaining topics",()=>{
  const html=renderToStaticMarkup(createElement(GroupedTopicPlan,{plan,onStartBlock:noop,onAddMaterial:noop,onEditPlan:noop,now:new Date("2026-09-17T10:00:00Z")}));
  expect(html).toContain("2 blocks · 1 done");expect(html).toContain("Start next block");expect(html).toContain("1 more topic");expect(html).toContain("Your next available day is after tomorrow.");
  expect(html).toContain("Add material");expect(html).toContain("Edit plan");expect(html).not.toContain("<details open");
  expect(groupedPlanTopics(plan)[0].complete).toBe(true);
 });
 it("does not display a personalization claim without a fired rule",()=>{
  const html=renderToStaticMarkup(createElement(GroupedTopicPlan,{plan:{...plan,planModel:{...plan.planModel!,ruleIds:[]}},onAddMaterial:noop,onEditPlan:noop}));
  expect(html).not.toContain(plan.planModel!.personalizationSentence);
 });
 it("lets the learner correct topic sources and covered declarations without pretending these are scores",()=>{
  const html=renderToStaticMarkup(createElement(WhatYovaUnderstood,{knowledgeMap:map,materials:[],onContinue:noop,onSkip:noop,onBack:noop}));
  expect(html).toContain("What YOVA understood");expect(html).toContain("YOVA will teach this");expect(html).toContain("does not mark a topic as known");expect(html).toContain("Remove Diffusion");expect(html).toContain("Add a topic");expect(html).not.toContain("Your materials");
 });
 it("offers removal of a topic with completed work through the preview editor",()=>{
  const html=renderToStaticMarkup(createElement(PlanEditPanel,{plan,onPreview:noop,onClose:noop}));
  expect(html).toContain("Remove Diffusion");expect(html).toContain("Preview changes");expect(html).toContain("Add study window");
 });
 it("places an added topic at the first or a later position through authorized map anchors",()=>{
  expect(addedTopicOperation("Foundations",["pending-added-topic",first,second])).toMatchObject({op:"add_topic",before_topic_id:first});
  expect(addedTopicOperation("Foundations",[first,"pending-added-topic",second])).toMatchObject({op:"add_topic",after_topic_id:first});
 });
 it("expresses moving the first topic with existing reorder operations",()=>{
  const operations=topicReorderOperations(["a","b","c"],["c","a","b"]);
  const working=["a","b","c"];
  for(const operation of operations){if(operation.op!=="reorder")continue;working.splice(working.indexOf(operation.topic_id),1);working.splice(working.indexOf(operation.after_topic_id)+1,0,operation.topic_id);}
  expect(working).toEqual(["c","a","b"]);expect(topicReorderOperations(["a","b"],["a","b"])).toEqual([]);
 });
});
