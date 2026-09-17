import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PlanRevisionPreview } from "./plan-revision-preview";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import { shortDeadlineRequest, auditNow } from "@/evals/plan-creation-blocker-cases";
it("offers whole-plan material attachment before individual topics and labels immediate application",()=>{
 const plan=generatePreviewPlan(shortDeadlineRequest(30), auditNow);
 plan.planModel={version:"topic_plan_v2",learningGoal:"Understand and apply biology topics",ruleIds:[],personalizationSentence:"",scheduleMode:"movable",collapsedQueue:false,topicNotes:[],constraints:[]};
 const html=renderToStaticMarkup(createElement(PlanRevisionPreview,{plan,initialDelta:{operations:[]},initialType:"attach_source",onPreview:async()=>{throw new Error("not called during render");},onApply:async()=>{},onCancel:()=>{},choicesForSession:()=>({methods:[],times:[]}),onCapacityChoice:async()=>null,onStageFile:async()=>({materialId:"unused",name:"unused"})}));
 expect(html).toContain('value="whole_plan"');expect(html).toContain("Whole plan");expect(html).toContain("Attach material");
 expect(html.indexOf("Whole plan")).toBeLessThan(html.indexOf(plan.knowledgeMap!.topics[0].title));
});
