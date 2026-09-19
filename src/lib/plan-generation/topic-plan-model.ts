import { routingEvidenceForTopic } from "@/lib/routing/route-for-session";
import { baselineSourceForTopic } from "@/lib/session-shapes/source-context";
import { startingDifficultyTopicIds } from "./learner-plan-copy";
import { topicPlanAvailability } from "./topic-plan-availability";
import { emptyOnboardingAnswers, onboardingAnswerId, onboardingSupportNeeds, type OnboardingAnswers } from "@/lib/onboarding/answers";
import { learnerReportedCoverage, measuredPlacementEvidence } from "@/lib/knowledge-map/topic-evidence";
import { PlanKnowledgeMapSchema, type KnowledgeMapTopic, type PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import { classifyLearningTask } from "@/lib/learning/method-router";
import { routeSession } from "@/lib/routing/session-route";
import { contentBudgetForMinutes } from "@/lib/plan-generation/content-budget";
import { normalPlanModeDecisions } from "@/lib/plan-generation/normal-plan-revision-context";
import { NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION, NORMAL_PLAN_SESSION_RESET_MINUTES, NormalPlanEnvelopeComposerError, type NormalPlanEnvelopeInput, type NormalPlanEnvelopeComposition, type NormalPlanSessionEnvelope } from "@/lib/plan-generation/normal-plan-envelopes";
import { PlanGenerationRequestSchema, type PlanGenerationRequest } from "@/lib/plan-generation/schema";
import { TopicPlanModelSchema, TopicWorkloadSchema, type TopicPlanModel, type TopicWorkload } from "@/lib/plan-generation/topic-plan-contract";
import { NORMAL_DURATION_RECOMMENDER_VERSION } from "@/lib/study-route/duration-recommendation";

const LENGTHS = { minutes_10_15: [3,15], minutes_20_30: [5,30], minutes_30_45: [8,45], minutes_45_60: [12,60], task_dependent: [5,30] } as const;
const DAY = 86_400_000;
const MINUTE = 60_000;

function profilePolicy(answers: OnboardingAnswers, fallbackMinutes = 30) {
  const get = (id: Parameters<typeof onboardingAnswerId>[1]) => onboardingAnswerId(answers,id);
  const length = get("session_length");
  const base = LENGTHS[length as keyof typeof LENGTHS] ?? ([fallbackMinutes <= 15 ? 3 : fallbackMinutes <= 30 ? 5 : fallbackMinutes <= 45 ? 8 : 12, Math.min(60, Math.max(15, fallbackMinutes))] as const);
  const support = onboardingSupportNeeds(answers);
  const focus = ["often","very_often"].includes(get("focus_loss") ?? "");
  let capacity: number = base[0];
  let ceiling: number = base[1];
  if (focus) { capacity = Math.max(2, capacity - 3); ceiling = [15,30,45,60][Math.max(0, [15,30,45,60].findIndex(v=>v>=ceiling)-1)]!; }
  if (support.includes("shorter_sections")) { capacity = Math.max(2,capacity - 2); ceiling = Math.max(10,Math.floor(ceiling*.75)); }
  const collapsed = get("extra_context") === "long_plan_shutdown";
  if (collapsed) capacity = Math.min(capacity, 2);
  return {get,support,capacity,ceiling,focus,collapsed,frontload:["often_delay","deadline_pressure","planning_avoidance"].includes(get("starting_pattern") ?? ""), stepByStep:get("difficulty_help")==="step_by_step", extraPractice:get("extra_context")==="forget_during_tests"};
}

/** No prose or model judgement participates in topic sizing. */
export function topicWeight(topic: KnowledgeMapTopic, topics: readonly KnowledgeMapTopic[]) {
  const map = new Map(topics.map(item=>[item.id,item]));
  const depths = new Map<string, number>();
  const depth = (item: KnowledgeMapTopic, seen = new Set<string>()): number => {
    if (seen.has(item.id)) return 0;
    const cached = depths.get(item.id);
    if (cached !== undefined) return cached;
    const value = Math.max(0,...item.prerequisiteTopicIds.map(id=>map.has(id) ? 1+depth(map.get(id)!,new Set([...seen,item.id])) : 0));
    depths.set(item.id,value);
    return value;
  };
  const demonstrated = measuredPlacementEvidence(topic)?.outcome === "demonstrated";
  const covered = learnerReportedCoverage(topic) || (["taught","evidenced","secure"].includes(topic.status) && measuredPlacementEvidence(topic)?.outcome !== "gap");
  return Math.max(1,(Math.max(1,topic.subtopics.length) + depth(topic)) * (demonstrated ? .5 : covered ? .65 : 1));
}
function learnCount(topic: KnowledgeMapTopic, topics: readonly KnowledgeMapTopic[], capacity: number) {
  if (learnerReportedCoverage(topic) || measuredPlacementEvidence(topic)?.outcome === "demonstrated" || (["taught","evidenced","secure"].includes(topic.status) && measuredPlacementEvidence(topic)?.outcome !== "gap")) return 0;
  return topic.subtopics.length ? Math.min(3,topic.subtopics.length, Math.max(1,Math.ceil(topicWeight(topic,topics)/capacity))) : 1;
}
export function estimateTopicBlockRange(map: PlanKnowledgeMap, answers: OnboardingAnswers = emptyOnboardingAnswers()): {min:number;max:number} {
  const policy=profilePolicy(answers);
  const topics=map.topics.filter(topic=>!topic.deferred && !topic.removed);
  const count=topics.reduce((n,topic)=>n+learnCount(topic,topics,policy.capacity)+1+(policy.extraPractice?1:0),0);
  return {min:policy.ceiling >= 41 && topics.length > 1 ? Math.ceil(count / 2) : count,max:count};
}

function orderedTopics(map: PlanKnowledgeMap) {
  const ids = new Set(map.topics.map(t=>t.id));
  if(ids.size!==map.topics.length) throw new NormalPlanEnvelopeComposerError("duplicate_topic_id","The topic map repeats a topic identity.");
  for (const topic of map.topics) {
    if(new Set(topic.prerequisiteTopicIds).size!==topic.prerequisiteTopicIds.length) throw new NormalPlanEnvelopeComposerError("duplicate_prerequisite","The topic map repeats a prerequisite.");
    if(topic.prerequisiteTopicIds.some(id=>!ids.has(id))) throw new NormalPlanEnvelopeComposerError("unknown_prerequisite","A prerequisite is missing from the accepted map.");
  }
  const remaining=[...map.topics], ordered:KnowledgeMapTopic[]=[];
  while(remaining.length) {
    const index=remaining.findIndex(t=>t.prerequisiteTopicIds.every(id=>ordered.some(p=>p.id===id)));
    if(index<0) throw new NormalPlanEnvelopeComposerError("prerequisite_cycle","The topic map contains a prerequisite cycle.");
    ordered.push(remaining.splice(index,1)[0]!);
  }
  return ordered;
}
function sourceMinutes(topic: KnowledgeMapTopic, input: Pick<NormalPlanEnvelopeInput,"request">, fraction: number) {
  // A scope outline is never teaching content, including mixed files.
  const refs=topic.sourceReferences.filter(ref=>ref.sectionRole==="content_source");
  const words=refs.reduce((n,ref)=>{
    const material=input.request.materials.find(m=>m.id===ref.materialId);
    if(!material?.textContent || material.understanding?.role==="scope_outline") return n;
    return n + (material.textContent.slice(ref.startCharacter,ref.endCharacter).match(/\S+/g)?.length ?? 0);
  },0);
  return words ? Math.max(1,Math.ceil(words*fraction/200)) : 0;
}
function period(instant: string, zone:string) {
  const hour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:zone,hour:"2-digit",hourCycle:"h23"}).format(new Date(instant)));
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "late_night";
}
function localDay(instant:string,zone:string){ return new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(instant)); }
function hasWorkedExample(topic:KnowledgeMapTopic,input:NormalPlanEnvelopeInput) {
  return topic.sourceReferences.some(ref=>ref.sectionRole==="content_source" && /worked example|example\s*\d|solution:/iu.test(input.request.materials.find(m=>m.id===ref.materialId)?.textContent?.slice(ref.startCharacter,ref.endCharacter) ?? ""));
}

type Draft = {topic:KnowledgeMapTopic; subtopics:string[]; learn:boolean; round:number; splitIndex:number; splitCount:number};
export function composeTopicPlanEnvelopes(input: NormalPlanEnvelopeInput): NormalPlanEnvelopeComposition {
  const parsed=PlanGenerationRequestSchema.safeParse(input.request);
  if(!parsed.success) throw new NormalPlanEnvelopeComposerError("invalid_request","Use a valid plan request.");
  const request=parsed.data;
  if(request.intent!=="plan") throw new NormalPlanEnvelopeComposerError("not_normal_plan","The topic planner accepts ordinary plans only.");
  if(!request.knowledgeMap) throw new NormalPlanEnvelopeComposerError("missing_knowledge_map","Accept a topic map before creating the plan.");
  if(!Number.isFinite(input.now.getTime())) throw new NormalPlanEnvelopeComposerError("invalid_clock","Use a valid server time.");
  if(request.deadline && Date.parse(request.deadline)<=input.now.getTime()) throw new NormalPlanEnvelopeComposerError("deadline_passed","This deadline has passed. Choose a future date or remove the deadline.");
  if(input.searchDays!==undefined && (!Number.isInteger(input.searchDays)||input.searchDays<1||input.searchDays>366)) throw new NormalPlanEnvelopeComposerError("invalid_search_days","Availability search days must be 1–366.");
  if(!input.durationContext.profileVersion || input.durationContext.profileVersion==="legacy_unknown") throw new NormalPlanEnvelopeComposerError("invalid_profile_version","Use an authorized profile snapshot.");
  if(input.learningIntentRecommendation.intent!==request.learningIntent || !input.learningIntentRecommendation.basis.trim()) throw new NormalPlanEnvelopeComposerError("invalid_learning_intent","The plan intent must match its accepted recommendation.");
  const map=PlanKnowledgeMapSchema.parse(request.knowledgeMap);
  const priority=startingDifficultyTopicIds(request);
  const dependencies=new Set(priority);
  const collect=(id:string)=>{for(const prerequisite of map.topics.find(topic=>topic.id===id)?.prerequisiteTopicIds??[])if(!dependencies.has(prerequisite)){dependencies.add(prerequisite);collect(prerequisite);}};
  priority.forEach(collect);
  const ordered=orderedTopics({...map,topics:[...map.topics].sort((left,right)=>Number(dependencies.has(right.id))-Number(dependencies.has(left.id)))});
  const answers=input.durationContext.onboardingAnswers ?? emptyOnboardingAnswers();
  const policy=profilePolicy(answers,input.durationContext.profile.sustainableMinutes ?? 30);
  const rules=new Map<string,string>();
  const fire=(id:string,reason:string)=>{rules.set(id,reason);};
  const constraints:string[]=[];
  const deferrals: NormalPlanEnvelopeComposition["deferrals"][number][]=[];
  const deferredIds=new Set<string>();
  const topics=ordered.filter(topic=>{
    const blocked=topic.prerequisiteTopicIds.filter(id=>deferredIds.has(id));
    if(topic.deferred || topic.removed || blocked.length) {
      deferredIds.add(topic.id);
      deferrals.push({topicId:topic.id,reasonCode:blocked.length&&!topic.deferred?"prerequisite_deferred":"accepted_map_deferral",reason:topic.deferred?.reason ?? (topic.removed?"You removed this topic from the accepted scope.":"A prerequisite is outside this plan."),prerequisiteTopicIds:blocked});
      return false;
    }
    return true;
  });
  if(!topics.length) throw new NormalPlanEnvelopeComposerError("empty_active_target_set","Choose at least one topic for this plan.");
  const firstModes=normalPlanModeDecisions({knowledgeMap:map,learningIntentRecommendation:input.learningIntentRecommendation,sessions:topics.map(t=>({key:`first:${t.id}`,topicIds:[t.id]}))},input.revisionContext);
  const firstMode=new Map(topics.map((topic,i)=>[topic.id,firstModes[i]!]));
  const drafts:Draft[]=[];
  const notes:TopicPlanModel["topicNotes"]=[];
  for(const topic of topics) {
    const count=firstMode.get(topic.id)!.learningMode==="learn" ? Math.max(1,learnCount(topic,topics,policy.capacity)) : 0;
    const weight=topicWeight(topic,topics);
    notes.push({topicId:topic.id,learnBlockCount:count,topicWeight:weight,note:count>1 ? `Split into ${count} blocks at subtopic boundaries — ${topic.subtopics.length} subtopics.` : count===0 ? "Teaching skipped; start with an independent practice check." : "One focused learning block, followed by practice."});
    if(weight/policy.capacity>3) { fire("plan.sizing.three_block_guardrail","Dense topics stop at three learning blocks, with every subtopic retained."); }
    for(let part=0;part<count;part++) drafts.push({topic,subtopics:topic.subtopics.slice(Math.floor(part*topic.subtopics.length/count),Math.floor((part+1)*topic.subtopics.length/count)),learn:true,round:0,splitIndex:part,splitCount:count});
  }
  const practice=topics.flatMap(topic=>Array.from({length:policy.extraPractice?2:1},(_,i)=>({topic,subtopics:[...topic.subtopics],learn:false,round:i+1,splitIndex:0,splitCount:1})));
  // Revision rebuilds one scoped unit at a time; preserve its requested unit count.
  if(input.revisionContext && map.scopeJudgment.maximumSessions===1) {
    const first=drafts[0] ?? practice[0]!; drafts.splice(0,drafts.length,first);
  } else drafts.push(...practice);

  const q2=policy.get("session_length"); if(q2)fire(`P2.capacity.${q2}`,`Your session-length answer sets a ${policy.ceiling}-minute ceiling and topic-sized blocks.`);
  if(policy.focus)fire(`P3.focus.${policy.get("focus_loss")}`,"Shorter blocks are separated across days to protect focus.");
  const guidance=policy.get("guidance"); const scheduleMode=guidance==="learner_choice"?"learner_placed":guidance==="exact_guidance"?"fixed":"movable";
  if(guidance)fire(`P4.guidance.${guidance}`,guidance==="learner_choice"?"The queue stays in order; you choose its dates.":guidance==="exact_guidance"?"Each block has a proposed date and a clear next action.":"Each block has a proposed date that you can move.");
  if(policy.stepByStep)fire("P5.difficulty.step_by_step","There is at most one learning block per day.");
  const q6=policy.get("prove_knowing");
  const q6Applied=q6 && !policy.support.includes("reduced_text_visual_structure") && drafts.some(d=>{
    if(!d.learn)return false;
    const task=classifyLearningTask([request.goal,d.topic.title,d.topic.description,...d.subtopics].join(" ")).taskType;
    const route=routeSession({taskType:task,blockKind:"learn",evidence:"not_assessed",hasSource:d.topic.sourceReferences.some(r=>r.sectionRole==="content_source"),topicHasProblems:task==="problem_solving",answers});
    return route.ruleIds.includes(`L3.q6.${q6}`);
  });
  if(q6Applied)fire(`P6.produce.${q6}`,"Learning blocks show the task-appropriate method selected from your profile.");
  const q7=policy.get("gist_detail"); if(q7)fire(`P7.weighting.${q7}`,q7==="gist_leaning"?"Practice gives extra attention to precise recall.":q7==="detail_leaning"?"Practice gives extra attention to relationships and comparisons.":"Practice balances recall with application.");
  const q8=policy.get("starting_pattern"); if(q8)fire(`P8.start.${q8}`,policy.frontload?"The first block is short and proposed at the next available opportunity.":"Blocks are spread across your available days.");
  for(const support of policy.support)if(support==="shorter_sections"||support==="frequent_check_ins")fire(`P9.support.${support}`,support==="shorter_sections"?"Shorter sections reduce the amount in each sitting.":"The first practice check is brought forward by one day when availability allows.");
  if(policy.extraPractice)fire("P10.extra.forget_during_tests","Each topic has one extra practice block with tighter spacing.");
  if(policy.collapsed)fire("P10.extra.long_plan_shutdown","The next block stays prominent and the rest of the queue is collapsed.");

  // Brief 2.5 root cause 2: availability is searched only up to the deadline.
  // No block is ever suggested after it; see the fitting ladder below.
  const allSlots=topicPlanAvailability(request,input.now,drafts.length,input.revisionContext);
  if(!allSlots.length) throw new NormalPlanEnvelopeComposerError("no_normal_session_capacity",request.deadline?"No study window falls before the deadline. Add time before it or move the deadline.":"There is no available day in the next year. Add an available day to place this queue.");
  const peak=policy.get("energy_window") ?? input.durationContext.profile.preferredWindow;
  const deadlineAt=request.deadline ? Date.parse(request.deadline) : null;
  const deadlineDays=request.deadline ? Math.ceil((Date.parse(request.deadline)-input.now.getTime())/DAY) : null;
  const close=deadlineDays!==null && deadlineDays<=3;
  if(close)fire("plan.deadline.first_passes","With the deadline close, first passes come before return practice.");
  const gap=deadlineDays===null?3:deadlineDays<=3?1:deadlineDays<=9?2:3;
  // Reserve each topic's return dates before unrelated learning consumes those
  // opportunities. The final queue is sorted by the actual placed dates.
  // Close deadlines deliberately prioritize first passes instead.
  if (!close) {
    const grouped = topics.flatMap(topic => drafts.filter(draft => draft.topic.id === topic.id));
    drafts.splice(0,drafts.length,...grouped);
  }
  const legacyExact=Boolean(input.durationContext.legacyExactDuration);
  /**
   * One placement attempt over a queue. Returns null when any block would not
   * fit before the deadline, so the caller can compress or leave work out.
   * Rules and constraints are kept per attempt: only the accepted attempt's
   * rules are recorded, never a rule from a discarded attempt.
   */
  // level 0: normal spacing; 1: learning blocks are not spread one per day;
  // 2: practice returns sooner too; 3: also shorter blocks, so two fit in one
  // window (never under 15 minutes).
  const place=(queue:Draft[],level:0|1|2|3)=>{
  const compressed=level>=2;
  const used=new Map<string,number>(); const completedLearning=new Map<string,number>(); const completedPractice=new Map<string,number>();
  const learnDays=new Set<string>(); const usedDays=new Set<string>();
  const envelopes:NormalPlanSessionEnvelope[]=[];
  const placedRules=new Map<string,string>(); const placedConstraints:string[]=[];
  const firePlaced=(ruleId:string,reason:string)=>{placedRules.set(ruleId,reason);};
  const ruleIds=()=>[...new Set([...rules.keys(),...placedRules.keys()])];
  const consumed = new Set<Draft>();
  const readyBefore = (topicId: string, start: number) => {
    const topic = topics.find(item => item.id === topicId)!;
    if (learnCount(topic, topics, policy.capacity) === 0) return true;
    const learning = queue.filter(item => item.topic.id === topicId && item.learn);
    return learning.length > 0 && learning.every(item => consumed.has(item)) && (completedLearning.get(topicId) ?? Infinity) <= start;
  };
  for(const [index,draft] of queue.entries()) {
    if (consumed.has(draft)) continue;
    const prerequisiteEnd=Math.max(input.now.getTime(),...draft.topic.prerequisiteTopicIds.map(id=>completedLearning.get(id)??input.now.getTime()));
    const priorLearn=completedLearning.get(draft.topic.id) ?? prerequisiteEnd;
    const firstGap=compressed?0:Math.max(0,gap-(policy.support.includes("frequent_check_ins")?1:0)-(policy.extraPractice?1:0));
    const practiceGap=draft.round===1?firstGap:compressed?1:deadlineDays===null?7:deadlineDays<=3?1:deadlineDays<=9?3:5;
    let earliest=draft.learn ? Math.max(prerequisiteEnd,completedLearning.get(draft.topic.id)??input.now.getTime()) : (draft.round===1?priorLearn:completedPractice.get(draft.topic.id)??priorLearn)+practiceGap*DAY;
    const exampleFirst = draft.learn && (policy.get("difficulty_help")==="concrete_example" || policy.get("extra_context")==="examples_before_ready") && hasWorkedExample(draft.topic,input);
    if(level===0&&!policy.frontload&&!close&&draft.learn&&!exampleFirst) earliest=Math.max(earliest,input.now.getTime()+Math.min(index+1,7)*DAY);
    const candidates=allSlots.filter(slot=>Date.parse(slot.endsAt)>earliest && slot.minutes>=8 && (!policy.focus||!usedDays.has(localDay(slot.startsAt,request.timeZone))) && (!draft.learn||!policy.stepByStep||!learnDays.has(localDay(slot.startsAt,request.timeZone))));
    // Only choose energy among opportunities on the next permissible day.
    const firstDay=candidates[0]?.dayIndex;
    const today=candidates.filter(slot=>slot.dayIndex===firstDay);
    const preferred=today.find(slot=>peak&&peak!=="varies" && (draft.learn ? period(slot.startsAt,request.timeZone)===peak : period(slot.startsAt,request.timeZone)!==peak));
    let slot=preferred ?? candidates[0];
    if(!slot && input.durationContext.legacyExactDuration) throw new NormalPlanEnvelopeComposerError("no_normal_session_capacity","The existing revision does not fit its reserved availability before the deadline.");
    if(!slot) return null;
    let start=Math.max(Date.parse(slot.startsAt)+(used.get(slot.startsAt)??0)*MINUTE,earliest);
    let remaining=Math.floor((Date.parse(slot.endsAt)-start)/MINUTE);
    if(remaining<8) {
      const next=candidates.find(s=>Date.parse(s.startsAt)>Date.parse(slot!.startsAt) && s.minutes-(used.get(s.startsAt)??0)>=8);
      if(next) {slot=next;start=Math.max(Date.parse(slot.startsAt)+(used.get(slot.startsAt)??0)*MINUTE,earliest);remaining=Math.floor((Date.parse(slot.endsAt)-start)/MINUTE);}
    }
    if(remaining<8) {
      if(legacyExact) throw new NormalPlanEnvelopeComposerError("no_normal_session_capacity","Add a window of at least eight minutes to place the remaining topic work.");
      return null;
    }
    const atPeak=!peak||peak==="varies"||period(new Date(start).toISOString(),request.timeZone)===peak;
    const legacySourceBudget = input.durationContext.legacyExactDuration ? input.durationContext.sourceStudyBudgetMinutes : undefined;
    let ceiling=Math.min(Math.max(policy.ceiling,legacySourceBudget??0),remaining, input.durationContext.learnerOverrideMinutes ?? 60);
    if(!atPeak)ceiling=Math.max(8,Math.floor(ceiling*.8));
    const packedCeiling=Math.max(15,Math.floor((slot.minutes-NORMAL_PLAN_SESSION_RESET_MINUTES)/2));
    if(level===3&&packedCeiling<ceiling){ceiling=packedCeiling;firePlaced("plan.deadline.shorter_blocks","Blocks are shorter than usual so more of your topics fit before the deadline.");}
    if(draft.learn && topicWeight(draft.topic,topics)>=9)ceiling=Math.max(8,Math.floor(ceiling*.85));
    if(index===0&&policy.frontload)ceiling=Math.min(ceiling,8);
    let workload=buildWorkload(draft,input,answers,Math.max(8,ceiling),ruleIds());
    if (input.durationContext.legacyExactDuration && (input.durationContext.learnerOverrideMinutes || legacySourceBudget)) workload = {...workload,estimatedMinutes:Math.min(ceiling,input.durationContext.learnerOverrideMinutes ?? legacySourceBudget!)};
    const groupedDrafts = [draft];
    const firstRoute = sweepRoute(draft, input, answers, start);
    // Additional work is a different ready topic, never extra copies of the
    // same questions. Keep provider calls and resumable execution bounded.
    if (!input.revisionContext && !input.durationContext.legacyExactDuration
      && workload.questionCount === 32 && ceiling - workload.estimatedMinutes >= 8
      && firstRoute.firstPracticeRound === "active_recall" && !(draft.learn && policy.stepByStep)) {
      const next = queue.find((candidate, candidateIndex) => {
        if (candidateIndex <= index || consumed.has(candidate) || candidate.topic.id === draft.topic.id || candidate.learn !== draft.learn || candidate.round !== draft.round) return false;
        if (queue.slice(0, candidateIndex).some(previous => previous.topic.id === candidate.topic.id && previous.learn === candidate.learn && !consumed.has(previous))) return false;
        if (!candidate.topic.prerequisiteTopicIds.every(id => readyBefore(id, start))) return false;
        if (!candidate.learn) {
          if (!readyBefore(candidate.topic.id, start)) return false;
          const prior = candidate.round === 1 ? completedLearning.get(candidate.topic.id) ?? input.now.getTime() : completedPractice.get(candidate.topic.id);
          if (prior === undefined || prior + practiceGap * DAY > start) return false;
        }
        const route = sweepRoute(candidate, input, answers, start);
        return route.firstPracticeRound === "active_recall" && sweepRouteSignature(route) === sweepRouteSignature(firstRoute);
      });
      if (next) {
        const nextWorkload = buildWorkload(next, input, answers, Math.floor(ceiling - workload.estimatedMinutes), ruleIds());
        const segments = [draft, next].map((item, part) => ({ segmentId: `segment-${part + 1}`, learningMode: item.learn ? "learn" as const : "study" as const, taskType: firstRoute.input.taskType, workload: { ...(part ? nextWorkload : workload), suggestedDate: scheduleMode !== "learner_placed" } })) as NonNullable<TopicWorkload["segments"]>;
        workload = TopicWorkloadSchema.parse({ ...workload, suggestedDate: scheduleMode !== "learner_placed", segments,
          topicSubtopics: segments.flatMap(segment => segment.workload.topicSubtopics),
          ...Object.fromEntries((["questionCount", "recallQuestionCount", "transferQuestionCount", "produceSteps", "sourceReadMinutes", "estimatedMinutes"] as const).map(field => [field, segments.reduce((sum, segment) => sum + segment.workload[field], 0)])),
        });
        groupedDrafts.push(next);
        firePlaced("plan.workload.next_ready_topic", "When useful work leaves room, the block continues with one compatible topic whose prerequisites are already ready.");
      }
    }
    const scheduledFor=new Date(start).toISOString();
    const finish=start+workload.estimatedMinutes*MINUTE;
    if(deadlineAt!==null&&finish>deadlineAt) {
      if(legacyExact) throw new NormalPlanEnvelopeComposerError("no_normal_session_capacity","The existing revision does not fit its reserved availability before the deadline.");
      return null;
    }
    if(index===0&&policy.frontload&&start>input.now.getTime()+DAY)placedConstraints.push("Your next available window is more than 24 hours away, so the first block uses that opportunity.");
    if(peak&&peak!=="varies"&&((draft.learn&&atPeak)||(!draft.learn&&!atPeak)))firePlaced(`P1.energy.${peak}`,"Learning uses your preferred energy window; practice uses other available windows where possible.");
    if(draft.learn&&(policy.get("difficulty_help")==="concrete_example"||policy.get("extra_context")==="examples_before_ready")&&hasWorkedExample(draft.topic,input))firePlaced("P5.difficulty.concrete_example","A learning block with a worked example uses its next available opportunity.");
    const initial=firstMode.get(draft.topic.id)!;
    const target=initial.targetDecisions[0]!;
    const targetDecision=draft.learn ? target : {...target,learningMode:"study" as const,basisCode:draft.round>0&&initial.learningMode==="learn"?"planned_later_attempt" as const:target.basisCode};
    const mode=draft.learn?"learn" as const:"study" as const;
    const modeBasis=mode==="learn"?"instruction_required" as const:"independent_attempt" as const;
    const classification=classifyLearningTask([request.goal,request.startingContext??"",draft.topic.title,draft.topic.description,...draft.topic.subtopics].join(" "));
    envelopes.push({envelopeId:`normal-plan-envelope-${String(index+1).padStart(3,"0")}`,sequence:index+1,kind:draft.learn||initial.learningMode==="study"&&draft.round===1?"initial_coverage":draft.round>1?"additional_practice":"required_practice",topicIds:groupedDrafts.map(item=>item.topic.id),learningMode:mode,modeBasisCode:modeBasis,targetModeDecisions:groupedDrafts.map(item=>item===draft?targetDecision:item.learn?firstMode.get(item.topic.id)!.targetDecisions[0]!:{...firstMode.get(item.topic.id)!.targetDecisions[0]!,learningMode:"study" as const,basisCode:item.round>0&&firstMode.get(item.topic.id)!.learningMode==="learn"?"planned_later_attempt" as const:firstMode.get(item.topic.id)!.targetDecisions[0]!.basisCode}),taskFamily:classification.taskType,taskClassification:classification,scheduledFor,availabilityStartsAt:slot.startsAt,availabilityDayIndex:slot.dayIndex,availabilityWindowIndex:slot.windowIndex,hardMaximumMinutes:remaining,timing:{activeMinutes:workload.estimatedMinutes,elapsedMinutes:workload.estimatedMinutes,durationSource:input.durationContext.learnerOverrideMinutes?"learner_override":remaining<policy.ceiling?"availability_cap":q2||input.durationContext.profile.sustainableMinutes?"profile_recommendation":"router_default",hardMaximumMinutes:remaining},contentBudget:contentBudgetForMinutes(workload.estimatedMinutes),durationRouterVersion:NORMAL_DURATION_RECOMMENDER_VERSION,durationRuleTrace:[{ruleId:"plan.workload.content_estimate",result:`${workload.questionCount}_questions_${workload.estimatedMinutes}_minutes`,reason:"The estimate counts the reading, production, questions and answer reveals in this block; the profile is a ceiling.",evidenceRefs:[]}],prerequisiteEvidenceRefs:groupedDrafts.flatMap(item=>item.topic.prerequisiteTopicIds).flatMap(id=>{ const prerequisite=topics.find(t=>t.id===id); if(!prerequisite)return []; const e=measuredPlacementEvidence(prerequisite); return e?.outcome==="gap"?[]:e?.outcome==="demonstrated"?[`placement:${id}:${e.observedAt}`]:["evidenced","secure"].includes(prerequisite.status)?[`knowledge-map-topic:${id}:status:${prerequisite.status}`]:[]; }),modeRuleTrace:[{ruleId:"initial_plan_mode_routing_v1",result:`${mode}:${modeBasis}`,reason:draft.learn?"This subtopic chunk needs instruction before practice.":"Practice checks this topic independently.",evidenceRefs:[...target.evidenceRefs]}],workload:{...workload,suggestedDate:scheduleMode!=="learner_placed"}});
    used.set(slot.startsAt,Math.ceil((finish-Date.parse(slot.startsAt))/MINUTE)+NORMAL_PLAN_SESSION_RESET_MINUTES);
    usedDays.add(localDay(scheduledFor,request.timeZone));
    for (const item of groupedDrafts) {
      consumed.add(item);
      if(item.learn){learnDays.add(localDay(scheduledFor,request.timeZone));completedLearning.set(item.topic.id,finish);} else completedPractice.set(item.topic.id,finish);
    }
  }
  return {envelopes,rules:placedRules,constraints:placedConstraints};
  };

  // Fitting ladder when the work does not fit before the deadline (Brief 2.5
  // root cause 2, spec section 7): compress spacing first; then leave out the
  // lowest-priority practice, with the reason shown; then defer the
  // lowest-priority topics, with the reason shown. A topic's teaching and its
  // first practice are essential, except that with the deadline close first
  // passes outrank returns (spec section 7): a taught topic's practice is then
  // optional too, and added back wherever it still fits.
  const taught=new Set(drafts.filter(draft=>draft.learn).map(draft=>draft.topic.id));
  const essential=(draft:Draft)=>draft.learn||(draft.round===1&&!(close&&taught.has(draft.topic.id)));
  const practiceDeferredTopicIds:string[]=[];
  const inOrder=(keep:ReadonlySet<Draft>)=>drafts.filter(draft=>keep.has(draft));
  let placed=place(drafts,0);
  if(!placed&&deadlineAt!==null&&!legacyExact) {
    placed=place(drafts,1);
    if(placed) rules.set("plan.deadline.compressed_learning","Learning blocks sit closer together so the work fits before your deadline.");
    else {
      rules.set("plan.deadline.compressed_spacing","Practice returns sooner than usual so the work fits before your deadline.");
      placed=place(drafts,2) ?? place(drafts,3);
    }
    // A revision never changes scope on its own: if its unit does not fit, the
    // caller reports a capacity blocker with the learner's choices instead.
    if(!placed&&!input.revisionContext) {
      const keep=new Set(drafts.filter(essential));
      const active=[...topics];
      placed=place(inOrder(keep),3);
      while(!placed&&active.length>1) {
        // Topics are prerequisite-ordered and priority-sorted, so the last one
        // has the lowest priority and nothing still scheduled depends on it.
        const topic=active.pop()!;
        for(const draft of drafts)if(draft.topic.id===topic.id)keep.delete(draft);
        deferredIds.add(topic.id);
        deferrals.push({topicId:topic.id,reasonCode:"deadline_capacity",reason:"There is not enough study time before your deadline to teach this topic as well. Add time before the deadline or move it to include this topic.",prerequisiteTopicIds:[]});
        placed=place(inOrder(keep),3);
      }
      if(!placed) throw new NormalPlanEnvelopeComposerError("no_normal_session_capacity","No study window before the deadline can hold a block. Add time before it or move the deadline.");
      const optional=drafts.filter(draft=>!essential(draft)&&!deferredIds.has(draft.topic.id)).sort((a,b)=>a.round-b.round||active.indexOf(a.topic)-active.indexOf(b.topic));
      const leftOut:Draft[]=[];
      for(const draft of optional) {
        const attempt=place(inOrder(new Set([...keep,draft])),3);
        if(attempt){keep.add(draft);placed=attempt;} else leftOut.push(draft);
      }
      for(const draft of leftOut) {
        constraints.push(`${draft.topic.title}: a practice block is left out because it does not fit before your deadline. Add time before the deadline to bring it back.`);
        if(draft.round===1&&!practiceDeferredTopicIds.includes(draft.topic.id))practiceDeferredTopicIds.push(draft.topic.id);
      }
    }
  }
  if(!placed) throw new NormalPlanEnvelopeComposerError("no_normal_session_capacity",deadlineAt!==null?"No study window before the deadline can hold a block. Add time before it or move the deadline.":"Add a window of at least eight minutes to place the remaining topic work.");
  for(const [ruleId,reason] of placed.rules)rules.set(ruleId,reason);
  constraints.push(...placed.constraints);
  const envelopes=[...placed.envelopes];
  envelopes.sort((left,right)=>Date.parse(left.scheduledFor)-Date.parse(right.scheduledFor)||left.sequence-right.sequence);
  const sequenced=envelopes.map((envelope,index)=>({...envelope,sequence:index+1,envelopeId:`normal-plan-envelope-${String(index+1).padStart(3,"0")}`}));
  const planModel=TopicPlanModelSchema.parse({version:"topic_plan_v2",learningGoal:request.goal,ruleIds:[...rules.keys()],personalizationSentence:[...rules.values()].join(" ").slice(0,1600),scheduleMode,collapsedQueue:policy.collapsed,topicNotes:notes,constraints:[...new Set(constraints)].slice(0,40),practiceDeferredTopicIds});
  return deepFreeze({version:NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION,status:"complete",profileVersion:input.durationContext.profileVersion,envelopes:sequenced,deferrals,planModel});
}

function sweepRoute(draft: Draft, input: NormalPlanEnvelopeInput, answers: OnboardingAnswers, start: number) {
  const taskType = classifyLearningTask([input.request.goal, input.request.startingContext ?? "", draft.topic.title, draft.topic.description, ...draft.topic.subtopics].join(" ")).taskType;
  const hasSource = Boolean(baselineSourceForTopic({ materials: input.request.materials, sourceMode: input.request.materialMode === "upload" ? "user_materials" : "yova_generated" }, draft.topic).description);
  return routeSession({ taskType, blockKind: draft.learn ? "learn" : "practice", evidence: routingEvidenceForTopic(draft.topic), hasSource, topicHasProblems: taskType === "mixed_assessment" && ["problem_solving", "programming"].includes(classifyLearningTask(`${draft.topic.title} ${draft.topic.description}`).taskType), answers, subtopicCount: draft.topic.subtopics.length, daysToDeadline: input.request.deadline ? Math.max(0, (Date.parse(input.request.deadline) - start) / DAY) : null });
}
function sweepRouteSignature(route: ReturnType<typeof routeSession>) {
  return JSON.stringify([route.input.taskType, route.input.evidence, route.input.hasSource, route.shape, route.shapeVariant, route.learnPath, route.entry, route.produceStep, route.produceBeforeStudy, route.workedStructureBeforeProduce, route.briefStudyStep, route.explanationFocus, route.firstPracticeRound]);
}

function buildWorkload(draft:Draft,input:Pick<NormalPlanEnvelopeInput,"request">,answers:OnboardingAnswers,ceiling:number,ruleIds:string[]):TopicWorkload {
  const topic=draft.topic;
  const task=classifyLearningTask([input.request.goal,topic.title,topic.description,...draft.subtopics].join(" ")).taskType;
  const source=sourceMinutes(topic,input,1/draft.splitCount);
  const route=routeSession({taskType:task,blockKind:draft.learn?"learn":"practice",evidence:"not_assessed",hasSource:source>0,topicHasProblems:task==="problem_solving",answers,subtopicCount:draft.subtopics.length});
  const produceSteps=draft.learn&&route.shape==="A"&&route.produceStep!=="retrieval_questions"?1:0;
  const read=draft.learn?Math.min(source||Math.max(2,draft.subtopics.length),Math.max(2,Math.floor(ceiling*.35))):0;
  const fixed=read+produceSteps*3+(draft.learn?2:1);
  const transferRatio=(route.questionMix.application+route.questionMix.compare_contrast+route.questionMix.prediction)/(Object.values(route.questionMix).reduce((sum,count)=>sum+count,0)||1);
  let questionCount=0,recall=0,transfer=0,minutes=Math.max(8,fixed);
  // Add useful application work until close to the real ceiling, never inflate
  // the timer independently of the work. Each reveal costs another 15 seconds.
  const desired=ceiling*.85;
  while(questionCount<32) {
    const next=questionCount+1, t=Math.round(next*transferRatio), r=next-t;
    const estimated=Math.max(8,Math.ceil(fixed+r*.75+t*1.5+next*.25));
    if(estimated>ceiling)break;
    questionCount=next;recall=r;transfer=t;minutes=estimated;
    if(minutes>=desired&&questionCount>=5)break;
  }
  return TopicWorkloadSchema.parse({version:"topic_workload_v1",topicSubtopics:[{topicId:topic.id,subtopics:draft.subtopics}],questionCount,recallQuestionCount:recall,transferQuestionCount:transfer,produceSteps,sourceReadMinutes:read,estimatedMinutes:minutes,ceilingMinutes:ceiling,practicePlaceholder:!draft.learn,practiceRound:draft.round,suggestedDate:true,ruleIds});
}

function deepFreeze<T>(value:T):T { if(value && typeof value==="object"&&!Object.isFrozen(value)){for(const child of Object.values(value))deepFreeze(child);Object.freeze(value);}return value;}

/** Reuses the same estimator for one immediate block, without building a timeline. */
export function immediateTopicWorkload({ request, topic, topics = [topic], learn, answers = emptyOnboardingAnswers(), ceilingMinutes }: { request: PlanGenerationRequest; topic: KnowledgeMapTopic; topics?: KnowledgeMapTopic[]; learn: boolean; answers?: OnboardingAnswers; ceilingMinutes: number }): TopicWorkload {
  const policy=profilePolicy(answers,ceilingMinutes);
  const combined={...topic,subtopics:topics.flatMap(item=>item.subtopics).slice(0,12),sourceReferences:topics.flatMap(item=>item.sourceReferences)};
  const work=buildWorkload({topic:combined,subtopics:combined.subtopics,learn,round:0,splitIndex:0,splitCount:1},{request},answers,Math.max(8,Math.min(60,policy.ceiling,ceilingMinutes)),["plan.workload.content_estimate"]);
  return {...work,topicSubtopics:topics.slice(0,4).map(item=>({topicId:item.id,subtopics:item.subtopics})),practicePlaceholder:false,suggestedDate:false};
}
