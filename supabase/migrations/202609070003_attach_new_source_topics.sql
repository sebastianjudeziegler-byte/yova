-- Preserve the existing topic prefix; append only durably mapped, unstarted
-- source topics with an explicit deferred marker. Inclusion is a separate
-- learner-approved plan adjustment. All source and saved-work checks remain.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('public.attach_materials_to_plan_without_study_routes(jsonb)'::regprocedure);
  previous text := $before$  if (candidate_map - 'topics') is distinct from (requested_plan.knowledge_map - 'topics')
    or jsonb_array_length(candidate_map -> 'topics')
      <> jsonb_array_length(requested_plan.knowledge_map -> 'topics')
    or exists (
      select 1
      from jsonb_array_elements(requested_plan.knowledge_map -> 'topics') with ordinality as stored(topic, position)
      join jsonb_array_elements(candidate_map -> 'topics') with ordinality as candidate(topic, position)
        using (position)
      where candidate.topic ->> 'id' is distinct from stored.topic ->> 'id'
    )
    or exists (
      select 1
      from jsonb_array_elements(requested_plan.knowledge_map -> 'topics') as stored(topic)
      where not exists (
        select 1
        from jsonb_array_elements(candidate_map -> 'topics') as candidate(topic)
        where candidate.topic ->> 'id' = stored.topic ->> 'id'
          and (candidate.topic - 'sourceReferences' - 'origin')
            = (stored.topic - 'sourceReferences' - 'origin')
      )
    )
    or exists (
      select 1
      from jsonb_array_elements(candidate_map -> 'topics') as candidate(topic)
      where not exists (
        select 1
        from jsonb_array_elements(requested_plan.knowledge_map -> 'topics') as stored(topic)
        where stored.topic ->> 'id' = candidate.topic ->> 'id'
      )
  ) then
    raise exception 'material_plan_rebuild_required';
  end if;

$before$;
begin
  if position(previous in definition)=0 then raise exception 'source topic patch did not match'; end if;
  definition := replace(definition, previous, $after$  if (candidate_map - 'topics') is distinct from (requested_plan.knowledge_map - 'topics')
    or jsonb_array_length(candidate_map -> 'topics')
      < jsonb_array_length(requested_plan.knowledge_map -> 'topics')
    or exists (
      select 1
      from jsonb_array_elements(requested_plan.knowledge_map -> 'topics') with ordinality as stored(topic, position)
      join jsonb_array_elements(candidate_map -> 'topics') with ordinality as candidate(topic, position)
        using (position)
      where candidate.topic ->> 'id' is distinct from stored.topic ->> 'id'
    )
    or exists (
      select 1
      from jsonb_array_elements(requested_plan.knowledge_map -> 'topics') as stored(topic)
      where not exists (
        select 1
        from jsonb_array_elements(candidate_map -> 'topics') as candidate(topic)
        where candidate.topic ->> 'id' = stored.topic ->> 'id'
          and (candidate.topic - 'sourceReferences' - 'origin')
            = (stored.topic - 'sourceReferences' - 'origin')
      )
    )
    or exists (
      select 1
      from jsonb_array_elements(candidate_map -> 'topics') as candidate(topic)
      where not exists (
        select 1
        from jsonb_array_elements(requested_plan.knowledge_map -> 'topics') as stored(topic)
        where stored.topic ->> 'id' = candidate.topic ->> 'id'
      ) and (
        candidate.topic ->> 'origin' is distinct from 'material'
        or candidate.topic ->> 'status' is distinct from 'not_started'
        or coalesce(candidate.topic -> 'initialEvidence', 'null'::jsonb) <> 'null'::jsonb
        or candidate.topic -> 'prerequisiteTopicIds' is distinct from '[]'::jsonb
        or candidate.topic -> 'deferred' is distinct from jsonb_build_object('reason', 'Added from a new source. Review and include this topic when you adjust the remaining plan.')
        or not exists (
          select 1 from (
            select metadata from public.material_uploads where user_id=current_user_id and id=any(requested_ids)
            union all
            select metadata from public.materials where user_id=current_user_id and learning_item_id=requested_plan.learning_item_id and id=any(requested_ids)
          ) source,
          jsonb_array_elements(source.metadata #> '{materialUnderstanding,topics}') mapped(topic)
          where (candidate.topic - 'origin' - 'status' - 'initialEvidence' - 'prerequisiteTopicIds' - 'deferred' - 'curriculumReference')
            = (mapped.topic - 'origin' - 'status' - 'initialEvidence' - 'prerequisiteTopicIds' - 'deferred' - 'curriculumReference')
            and coalesce(candidate.topic -> 'curriculumReference', 'null'::jsonb) = coalesce(mapped.topic -> 'curriculumReference', 'null'::jsonb)
        )
      )
    )
    or jsonb_array_length(candidate_map -> 'topics') > 40
    or (select count(distinct topic ->> 'id') from jsonb_array_elements(candidate_map -> 'topics') topic) <> jsonb_array_length(candidate_map -> 'topics')
  then
    raise exception 'material_plan_rebuild_required';
  end if;

$after$);
  previous := $coverage_before$  if exists (
    select 1 from unnest(requested_ids) as requested(id)
    where not exists (
      select 1
      from public.plan_sessions as session,
        jsonb_array_elements_text(coalesce(session.step_data -> 'topicIds', '[]'::jsonb)) as session_topic(id),
        jsonb_array_elements(candidate_map -> 'topics') as topic(value),
        jsonb_array_elements(topic.value -> 'sourceReferences') as reference(value)
      where session.plan_id = requested_plan.id
        and session.user_id = current_user_id
        and session.status in ('ready', 'upcoming')
        and topic.value ->> 'id' = session_topic.id
        and (reference.value ->> 'materialId')::uuid = requested.id
    )
  ) then
    raise exception 'material_plan_rebuild_required';
  end if;

$coverage_before$;
  if position(previous in definition)=0 then raise exception 'source topic coverage patch did not match'; end if;
  execute replace(definition, previous, $coverage_after$  if exists (
    select 1 from unnest(requested_ids) as requested(id)
    where not exists (
      select 1
      from public.plan_sessions as session,
        jsonb_array_elements_text(coalesce(session.step_data -> 'topicIds', '[]'::jsonb)) as session_topic(id),
        jsonb_array_elements(candidate_map -> 'topics') as topic(value),
        jsonb_array_elements(topic.value -> 'sourceReferences') as reference(value)
      where session.plan_id = requested_plan.id
        and session.user_id = current_user_id
        and session.status in ('ready', 'upcoming')
        and topic.value ->> 'id' = session_topic.id
        and (reference.value ->> 'materialId')::uuid = requested.id
    ) and not exists (
      select 1 from jsonb_array_elements(candidate_map -> 'topics') topic(value),
        jsonb_array_elements(topic.value -> 'sourceReferences') reference(value)
      where topic.value -> 'deferred' = jsonb_build_object('reason', 'Added from a new source. Review and include this topic when you adjust the remaining plan.')
        and (reference.value ->> 'materialId')::uuid = requested.id
    )
  ) then
    raise exception 'material_plan_rebuild_required';
  end if;

$coverage_after$);
end;
$migration$;
