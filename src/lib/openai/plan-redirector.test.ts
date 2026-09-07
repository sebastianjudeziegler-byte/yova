import { beforeEach, describe, expect, it, vi } from 'vitest';
const parse = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('@/lib/openai/client', () => ({ getOpenAIClient: () => ({ responses: { parse } }) }));
vi.mock('@/lib/openai/config', () => ({ getOpenAISessionConfig: () => ({ model: 'test' }) }));
import { redirectPlanWithOpenAI } from './plan-redirector';
import type { AdjustableSessionRow } from '@/lib/learning/content-based-plan-adjustment';
import { buildSessionMapDelta } from '@/lib/knowledge-map/session-delta';
import { PlanKnowledgeMapSchema } from '@/lib/knowledge-map/schema';

const topics = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'Brackets', description: 'Expand and solve linear equations with brackets.' },
  { id: '22222222-2222-4222-8222-222222222222', title: 'Fractions', description: 'Clear fractions and solve the equation.' },
];
const sessions: AdjustableSessionRow[] = topics.map((topic, i) => ({
  id: crypto.randomUUID(), sequence: i + 1, title: `Learn ${topic.title}`, objective: topic.description,
  method: 'Worked Examples', method_rationale: 'Use a model before an independent attempt.',
  scheduled_for: '2026-09-07T18:00:00Z', estimated_minutes: 15, status: 'upcoming',
  step_data: { learningMode: 'learn', topicIds: [topic.id], contentTargets: [topic.title], completionEvidence: ['Solve independently.'] },
}));
function output() {
  return { status: 'completed', output_parsed: { sessions: [...topics].reverse().map((topic, i) => ({
    title: `Friday Evening: Learn ${topic.title}`, topicAliases: [`topic_${2 - i}`], objective: topic.description,
    method: 'Worked Examples', methodReason: 'One complete example before independent practice.', learningMode: 'learn',
    contentTargets: [topic.title], completionEvidence: [`Solve a new ${topic.title} problem independently.`],
  })) } };
}
const input = () => ({ title: 'Linear equations', topic: 'Linear equations', direction: 'Teach fractions before brackets.', topics, sessions });
describe('direction revision topic integrity', () => {
  beforeEach(() => parse.mockReset());
  it('moves topic identity with revised content, preserving session and calendar identities', async () => {
    parse.mockResolvedValue(output());
    const revised = await redirectPlanWithOpenAI(input());
    const map = PlanKnowledgeMapSchema.parse({version:1,scopeJudgment:{band:'focused_skill',label:'Linear equations',minimumSessions:2,recommendedSessions:3,maximumSessions:4,minimumTeachingSessions:1,explanation:'Learn fractions and brackets, then solve independently.'},topics:topics.map(topic=>({...topic,subtopics:[],prerequisiteTopicIds:[],status:'not_started',initialEvidence:null,sourceReferences:[],origin:'ai_generated',deferred:null})),placementCheck:{status:'skipped',completedAt:null,demonstratedTopicIds:[],gapTopicIds:[]}});
    const row = revised[0]!;
    const delta = buildSessionMapDelta(map, {id:row.id,sequence:row.sequence,title:row.title,objective:row.objective,method:row.method,methodReason:row.method_rationale ?? "Use a model before an independent attempt.",scheduledFor:row.scheduled_for!,estimatedMinutes:row.estimated_minutes,amountLabel:'One independent check',status:'ready',learningMode:'learn',topicIds:(row.step_data as {topicIds:string[]}).topicIds}, [{topicId:topics[1]!.id,concept:'Fractions',outcome:'secure',activityType:'free_response'}]);
    console.info(JSON.stringify({case:'revised-fractions-progress',lessonTitle:row.title,objective:row.objective,evidence:(row.step_data as {completionEvidence:string[]}).completionEvidence,visibleMapChange:delta}));
    expect(delta.map(change=>({title:change.title,to:change.to}))).toEqual([{title:'Fractions',to:'evidenced'}]);
    expect(revised[0].step_data).toMatchObject({ topicIds: [topics[1].id], contentTargets: ['Fractions'] });
    expect(revised[1].step_data).toMatchObject({ topicIds: [topics[0].id], contentTargets: ['Brackets'] });
    expect(revised.map(row => row.id)).toEqual(sessions.map(row => row.id));
    expect(revised.map(row => row.scheduled_for)).toEqual(sessions.map(row => row.scheduled_for));
    expect(revised[0].title).toBe('Learn Fractions');
  });
  it.each(['unknown', 'omitted', 'duplicate'] as const)('rejects %s topic assignments before persistence', async kind => {
    const response = output();
    if (kind === 'unknown') response.output_parsed.sessions[0].topicAliases = ['made_up'];
    if (kind === 'omitted') response.output_parsed.sessions[0].topicAliases = ['topic_1'];
    if (kind === 'duplicate') response.output_parsed.sessions[0].topicAliases = ['topic_2', 'topic_2'];
    parse.mockResolvedValue(response);
    await expect(redirectPlanWithOpenAI(input())).rejects.toThrow('topic map');
  });
});
