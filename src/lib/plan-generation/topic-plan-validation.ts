import { topicPlanAvailability } from "./topic-plan-availability";
import type { PlanGenerationRequest } from "./schema";
import type { NormalPlanEnvelopeComposition } from "./normal-plan-envelopes";
import { normalPlanModeDecisions, type NormalPlanRevisionContext } from "./normal-plan-revision-context";
import { TopicPlanModelSchema, TopicWorkloadSchema } from "./topic-plan-contract";
import { contentBudgetForMinutes } from "./content-budget";
import { classifyLearningTask } from "@/lib/learning/method-router";

/** Recheck the code-owned contracts at the provider boundary. Provider copy
 * cannot alter the learning targets, work, source scope, or dated availability. */
export function validateTopicComposition(request:PlanGenerationRequest, composition:NormalPlanEnvelopeComposition, now:Date, revisionContext?:NormalPlanRevisionContext) {
  const fail=(message:string):never=>{throw new Error(`Invalid topic plan: ${message}`);};
  if(!request.knowledgeMap || !composition.envelopes.length)fail("a map and work queue are required");
  const map=request.knowledgeMap!;
  if(!TopicPlanModelSchema.safeParse(composition.planModel).success)fail("plan model metadata is invalid");
  const topics=new Map(map.topics.map(topic=>[topic.id,topic]));
  const slots=topicPlanAvailability({...request,deadline:null},now,composition.envelopes.length,revisionContext);
  const initialModes=normalPlanModeDecisions({knowledgeMap:map,learningIntentRecommendation:{intent:request.learningIntent,basis:"Use accepted evidence."},sessions:map.topics.filter(t=>!t.deferred&&!t.removed).map(t=>({key:`first:${t.id}`,topicIds:[t.id]}))},revisionContext);
  const modeByTopic=new Map(initialModes.flatMap(mode=>mode.targetDecisions.map(target=>[target.topicId,target.learningMode])));
  const coverage=new Map<string,string[]>();
  const learningCounts=new Map<string,number>();
  const practice=new Set<string>();
  const scheduled=new Set<string>();
  const intervals:Array<{start:number;end:number}>=[];
  for(const [index,block] of composition.envelopes.entries()) {
    const work=TopicWorkloadSchema.safeParse(block.workload);
    if(!work.success)fail("block workload is invalid");
    const workload=work.data!;
    if(block.sequence!==index+1 || block.envelopeId!==`normal-plan-envelope-${String(index+1).padStart(3,"0")}`)fail("block identity or sequence changed");
    if(block.topicIds.length!==1 || !topics.has(block.topicIds[0]!))fail("block topic is invalid");
    const topic=topics.get(block.topicIds[0]!)!;
    if(topic.deferred||topic.removed)fail("a removed or deferred topic is scheduled");
    if(workload.topicSubtopics.length!==1||workload.topicSubtopics[0]!.topicId!==topic.id||workload.topicSubtopics[0]!.subtopics.some(part=>!topic.subtopics.includes(part)))fail("block content escaped its topic");
    if(block.learningMode==="learn") {
      if(modeByTopic.get(topic.id)!=="learn")fail("teaching contradicts accepted evidence");
      learningCounts.set(topic.id,(learningCounts.get(topic.id)??0)+1);
      coverage.set(topic.id,[...(coverage.get(topic.id)??[]),...workload.topicSubtopics[0]!.subtopics]);
      if(practice.has(topic.id))fail("teaching resumes after practice");
    } else practice.add(topic.id);
    if(block.learningMode!==block.targetModeDecisions[0]?.learningMode||block.targetModeDecisions[0]?.topicId!==topic.id)fail("mode target disagrees with block");
    const classification=classifyLearningTask([request.goal,request.startingContext??"",topic.title,topic.description,...topic.subtopics].join(" "));
    if(block.taskFamily!==classification.taskType || JSON.stringify(block.taskClassification)!==JSON.stringify(classification))fail("task family changed");
    if(block.timing.activeMinutes!==workload.estimatedMinutes||block.timing.elapsedMinutes!==workload.estimatedMinutes||block.contentBudget.minutes!==workload.estimatedMinutes||JSON.stringify(block.contentBudget)!==JSON.stringify(contentBudgetForMinutes(workload.estimatedMinutes)))fail("duration is not derived from the same workload");
    const slot=slots.find(slot=>slot.startsAt===block.availabilityStartsAt&&slot.dayIndex===block.availabilityDayIndex&&slot.windowIndex===block.availabilityWindowIndex);
    const start=Date.parse(block.scheduledFor), end=start+block.timing.activeMinutes*60_000;
    if(!slot||!Number.isFinite(start)||start<Date.parse(slot.startsAt)||end>Date.parse(slot.endsAt)||block.hardMaximumMinutes!==Math.floor((Date.parse(slot.endsAt)-start)/60_000)||block.timing.hardMaximumMinutes!==block.hardMaximumMinutes)fail("a date escaped strict availability");
    if(intervals.some(i=>start<i.end&&end>i.start))fail("block dates overlap");
    intervals.push({start,end});scheduled.add(topic.id);
  }
  for(const [topicId,count] of learningCounts){
    const topic=topics.get(topicId)!;
    if(count>3 || (!topic.subtopics.length&&count>1))fail("a topic was split past its boundaries");
    if(JSON.stringify(coverage.get(topicId))!==JSON.stringify(topic.subtopics))fail("subtopics were omitted or duplicated");
    if(!revisionContext&&!practice.has(topicId))fail("teaching has no practice placeholder");
  }
  for(const topic of map.topics) if(!scheduled.has(topic.id)&&!composition.deferrals.some(d=>d.topicId===topic.id))fail("an accepted topic silently disappeared");
}
