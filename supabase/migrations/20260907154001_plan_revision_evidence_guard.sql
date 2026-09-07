-- Plan revision can change future scope and scheduling, but cannot score a
-- placement check or transfer demonstrated knowledge to a different topic.
-- Patch the installed writer so its route, concurrency and saved-work guards
-- (including later migrations) remain intact.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('public.adjust_learning_plan_with_routes(jsonb)'::regprocedure);
  anchor text := E'  select item.study_mode, item.source_mode\n';
begin
  if position(anchor in definition) = 0 then
    raise exception 'plan revision evidence guard did not match';
  end if;
  execute replace(definition, anchor, $guard$  if payload ? 'knowledgeMap' then
    if jsonb_typeof(payload -> 'knowledgeMap') is distinct from 'object'
      or jsonb_typeof(payload #> '{knowledgeMap,topics}') is distinct from 'array'
      or (payload #> '{knowledgeMap,placementCheck}') is distinct from (requested_plan.knowledge_map -> 'placementCheck') then
      raise exception 'plan_revision_cannot_change_evidence';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(payload #> '{knowledgeMap,topics}') candidate(topic)
      left join jsonb_array_elements(requested_plan.knowledge_map -> 'topics') stored(topic)
        on stored.topic ->> 'id' = candidate.topic ->> 'id'
      where (
        stored.topic is null and (
          candidate.topic ->> 'status' is distinct from 'not_started'
          or coalesce(candidate.topic -> 'initialEvidence', 'null'::jsonb) <> 'null'::jsonb
        )
      ) or (
        stored.topic is not null and (
          candidate.topic -> 'status' is distinct from stored.topic -> 'status'
          or coalesce(candidate.topic -> 'initialEvidence', 'null'::jsonb)
            is distinct from coalesce(stored.topic -> 'initialEvidence', 'null'::jsonb)
          or (
            (stored.topic ->> 'status' <> 'not_started'
              or coalesce(stored.topic -> 'initialEvidence', 'null'::jsonb) <> 'null'::jsonb)
            and (
              candidate.topic -> 'title' is distinct from stored.topic -> 'title'
              or candidate.topic -> 'description' is distinct from stored.topic -> 'description'
              or candidate.topic -> 'subtopics' is distinct from stored.topic -> 'subtopics'
            )
          )
        )
      )
    ) then
      raise exception 'plan_revision_cannot_change_evidence';
    end if;
  end if;

$guard$ || anchor);
end;
$migration$;
