import { routingEvidenceForTopic } from "@/lib/routing/route-for-session";
import { baselineSourceForTopic } from "@/lib/session-shapes/source-context";
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
  const learningEnds = new Map<string, number>();
  const practiceEnds = new Map<string, number>();
  const deadlineDays = request.deadline ? Math.ceil((Date.parse(request.deadline) - now.getTime()) / 86_400_000) : null;
  const firstGap = Math.max(0, (deadlineDays === null ? 3 : deadlineDays <= 3 ? 1 : deadlineDays <= 9 ? 2 : 3)
    - Number(composition.planModel!.ruleIds.includes("P9.support.frequent_check_ins")) - Number(composition.planModel!.ruleIds.includes("P10.extra.forget_during_tests")));
  const readyBefore = (id: string, start: number) => modeByTopic.get(id) === "study" || (learningEnds.get(id) ?? Infinity) <= start;
  for(const [index,block] of composition.envelopes.entries()) {
    const work=TopicWorkloadSchema.safeParse(block.workload);
    if(!work.success)fail("block workload is invalid");
    const workload=work.data!;
    if(block.sequence!==index+1 || block.envelopeId!==`normal-plan-envelope-${String(index+1).padStart(3,"0")}`)fail("block identity or sequence changed");
    const scopeIds = workload.topicSubtopics.map(part => part.topicId);
    if (JSON.stringify(block.topicIds) !== JSON.stringify(scopeIds) || scopeIds.some(id => !topics.has(id))) fail("block topic is invalid");
    if (scopeIds.length !== (workload.segments ? 2 : 1)) fail("ordinary blocks require one topic or two isolated segments");
    if (workload.segments?.some(segment => segment.learningMode !== block.learningMode || segment.taskType !== block.taskFamily)) fail("segment routing escaped the block");
    const firstTopic = topics.get(scopeIds[0]!)!;
    const sourcePresent = (topic: typeof firstTopic) => Boolean(baselineSourceForTopic({ materials: request.materials, sourceMode: request.materialMode === "upload" ? "user_materials" : "yova_generated" }, topic).description);
    if (workload.segments && scopeIds.slice(1).some(id => {
      const topic = topics.get(id)!;
      return routingEvidenceForTopic(topic) !== routingEvidenceForTopic(firstTopic) || sourcePresent(topic) !== sourcePresent(firstTopic)
        || topic.prerequisiteTopicIds.some(prerequisite => scopeIds.includes(prerequisite) && modeByTopic.get(prerequisite) === "learn");
    })) fail("segments do not have compatible independent entry conditions");
    if (workload.segments) {
      const start = Date.parse(block.scheduledFor);
      for (const segment of workload.segments) {
        const topic = topics.get(segment.workload.topicSubtopics[0]!.topicId)!;
        if (!topic.prerequisiteTopicIds.every(id => readyBefore(id, start))) fail("a segment prerequisite is not ready before the block");
        if (block.learningMode === "study") {
          if (!readyBefore(topic.id, start)) fail("a practice segment is missing prior learning");
          const prior = workload.practiceRound === 1 ? learningEnds.get(topic.id) ?? now.getTime() : practiceEnds.get(topic.id);
          const gap = workload.practiceRound === 1 ? firstGap : deadlineDays === null ? 7 : deadlineDays <= 3 ? 1 : deadlineDays <= 9 ? 3 : 5;
          if (prior === undefined || start < prior + gap * 86_400_000) fail("a practice segment was swept before its return was due");
        }
      }
    }
    for (const [partIndex, part] of workload.topicSubtopics.entries()) {
      const topic = topics.get(part.topicId)!;
      if(topic.deferred||topic.removed)fail("a removed or deferred topic is scheduled");
      if(part.subtopics.some(subtopic=>!topic.subtopics.includes(subtopic)))fail("block content escaped its topic");
      if(block.learningMode==="learn") {
        if(modeByTopic.get(topic.id)!=="learn")fail("teaching contradicts accepted evidence");
        learningCounts.set(topic.id,(learningCounts.get(topic.id)??0)+1);
        coverage.set(topic.id,[...(coverage.get(topic.id)??[]),...part.subtopics]);
        if(practice.has(topic.id))fail("teaching resumes after practice");
      } else practice.add(topic.id);
      if(block.learningMode!==block.targetModeDecisions[partIndex]?.learningMode||block.targetModeDecisions[partIndex]?.topicId!==topic.id)fail("mode target disagrees with block");
      const classification=classifyLearningTask([request.goal,request.startingContext??"",topic.title,topic.description,...topic.subtopics].join(" "));
      if(block.taskFamily!==classification.taskType || (partIndex === 0 && JSON.stringify(block.taskClassification)!==JSON.stringify(classification)))fail("task family changed");
      scheduled.add(topic.id);
    }
    if(block.timing.activeMinutes!==workload.estimatedMinutes||block.timing.elapsedMinutes!==workload.estimatedMinutes||block.contentBudget.minutes!==workload.estimatedMinutes||JSON.stringify(block.contentBudget)!==JSON.stringify(contentBudgetForMinutes(workload.estimatedMinutes)))fail("duration is not derived from the same workload");
    const slot=slots.find(slot=>slot.startsAt===block.availabilityStartsAt&&slot.dayIndex===block.availabilityDayIndex&&slot.windowIndex===block.availabilityWindowIndex);
    const start=Date.parse(block.scheduledFor), end=start+block.timing.activeMinutes*60_000;
    if(!slot||!Number.isFinite(start)||start<Date.parse(slot.startsAt)||end>Date.parse(slot.endsAt)||block.hardMaximumMinutes!==Math.floor((Date.parse(slot.endsAt)-start)/60_000)||block.timing.hardMaximumMinutes!==block.hardMaximumMinutes)fail("a date escaped strict availability");
    if(intervals.some(i=>start<i.end&&end>i.start))fail("block dates overlap");
    intervals.push({start,end});
    for (const topicId of scopeIds) {
      if (block.learningMode === "study") practiceEnds.set(topicId, end);
      else if (JSON.stringify(coverage.get(topicId)) === JSON.stringify(topics.get(topicId)!.subtopics)) learningEnds.set(topicId, end);
    }
  }
  for(const [topicId,count] of learningCounts){
    const topic=topics.get(topicId)!;
    if(count>3 || (!topic.subtopics.length&&count>1))fail("a topic was split past its boundaries");
    if(JSON.stringify(coverage.get(topicId))!==JSON.stringify(topic.subtopics))fail("subtopics were omitted or duplicated");
    if(!revisionContext&&!practice.has(topicId))fail("teaching has no practice placeholder");
  }
  for(const topic of map.topics) if(!scheduled.has(topic.id)&&!composition.deferrals.some(d=>d.topicId===topic.id))fail("an accepted topic silently disappeared");
}
