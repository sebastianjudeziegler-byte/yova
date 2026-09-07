import { describe, expect, it } from 'vitest';
import type { KnowledgeMapTopic } from '@/lib/knowledge-map/schema';
import { deferredTopicSessionFields } from './deferred-topic-session';
const topic: KnowledgeMapTopic = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Solving simultaneous equations',
  description: 'Solve two equations by elimination and substitution, then verify both solutions.',
  subtopics: ['Elimination', 'Substitution'], prerequisiteTopicIds: [], status: 'not_started',
  sourceReferences: [], initialEvidence: null, origin: 'ai_generated', deferred: { reason: 'Added from new material.' },
};
describe('including deferred topics', () => {
  it('uses procedural teaching eligibility instead of a universal explanation method', () => {
    const result = deferredTopicSessionFields(topic, 'Solve linear equations');
    expect(result.method).toBe('Worked Examples');
    expect(result.step_data).toMatchObject({ learningMode: 'learn', topicIds: [topic.id], contentTargets: [topic.title] });
    expect(result.step_data.completionEvidence[0]).toMatch(/^Solve/);
  });
  it('checks previously encountered topics instead of treating them as new', () => {
    const result = deferredTopicSessionFields({ ...topic, status: 'evidenced' }, 'Solve linear equations');
    expect(result.method).toBe('Practice Problems');
    expect(result.step_data.learningMode).toBe('study');
    expect(result.title).toMatch(/^Check/);
  });
});
