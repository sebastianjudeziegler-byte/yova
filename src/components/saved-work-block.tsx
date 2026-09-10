import type { WorkBlock } from "@/lib/session-blocks/schema";
import { LearningContent } from "./learning-content";

/** Read-only public content in the existing plan resource view. Private keys
 * and checked progress remain behind the authenticated runtime boundary. */
export function SavedWorkBlock({ block }: { block: WorkBlock }) {
  return <section aria-label="Saved session work block"><h3>{block.objective}</h3><p>{block.instructions}</p>
    <p>{block.personalization.profileReason}</p>
    {block.sources.map(source => <article className="resource-activity resource-note" key={source.id}>
      <h4>{source.title}</h4><p>{source.section}</p><LearningContent content={source.text} />
      {source.url && <a href={source.url} target="_blank" rel="noreferrer">Open source section</a>}
    </article>)}
    {block.activities.filter(activity => activity.kind === "ai_explanation").map(activity => <article className="resource-activity resource-note" key={activity.id}><h4>{activity.title}</h4><LearningContent content={activity.content} /></article>)}
    {block.questions.map(question => <article className="resource-activity resource-practice" key={question.id}>
      <h4><LearningContent content={question.prompt} inline /></h4>
      {question.workedExample && <aside><strong>Example first</strong><LearningContent content={question.workedExample} /></aside>}
      {question.choices.length > 0 && <ol>{question.choices.map(choice => <li key={choice}><LearningContent content={choice} inline /></li>)}</ol>}
      {question.reflectBeforeCheck && <p>Explain it in your own words before checking.</p>}
    </article>)}
    <p>{block.stoppingPoint}</p>
  </section>;
}
