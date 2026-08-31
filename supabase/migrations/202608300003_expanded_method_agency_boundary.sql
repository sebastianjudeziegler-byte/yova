-- Extend the immutable StudyRoute boundary for the three additive methods and
-- the Feynman/SQ3R presentation upgrade without copying the mature route
-- validator or the 1,400-line legacy post-commit writer. Historical requests
-- continue through renamed private implementations; versioned routes use the
-- smaller exact-choice path below.

begin;

lock table public.study_routes in share row exclusive mode;

-- Pretesting measures a starting point; it is not evidence that teaching or
-- repair has already happened. Keep the established topic-status refresh
-- contract, but exclude pretest-only concept evidence in the database as the
-- final authority. Legacy attempts without a phase remain eligible, while a
-- phased attempt can mark a session taught only after at least one
-- non-pretest concept check exists.
create or replace function public.refresh_plan_knowledge_map_topic_statuses(
  requested_plan_id uuid,
  requested_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_map jsonb;
  refreshed_topics jsonb;
begin
  select plan.knowledge_map
  into current_map
  from public.plans as plan
  where plan.id = requested_plan_id
    and plan.user_id = requested_user_id
  for update;

  if not found
    or pg_catalog.jsonb_typeof(current_map -> 'topics') <> 'array' then
    return;
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    topic.value || pg_catalog.jsonb_build_object(
      'status', case
        when coalesce(topic.value ->> 'status', 'not_started') = 'secure'
          then 'secure'
        when evidence.secure_count >= 2
          and evidence.latest_outcome = 'secure' then 'secure'
        when coalesce(topic.value ->> 'status', 'not_started') = 'evidenced'
          then 'evidenced'
        when evidence.evidence_count > 0 then 'evidenced'
        when completion.was_taught then 'taught'
        else 'not_started'
      end
    ) order by topic.ordinality
  ), '[]'::jsonb)
  into refreshed_topics
  from pg_catalog.jsonb_array_elements(current_map -> 'topics')
    with ordinality as topic(value, ordinality)
  left join lateral (
    select exists (
      select 1
      from public.plan_sessions as session
      where session.plan_id = requested_plan_id
        and session.user_id = requested_user_id
        and session.status = 'complete'
        and (
          case
            when pg_catalog.jsonb_typeof(
              session.step_data #> '{generatedSession,topicIds}'
            ) = 'array' then case
              when pg_catalog.jsonb_array_length(
                  session.step_data #> '{generatedSession,topicIds}'
                ) between 1 and 6
                and pg_catalog.jsonb_typeof(
                  session.step_data -> 'topicIds'
                ) = 'array'
                and (session.step_data -> 'topicIds')
                  @> (session.step_data #> '{generatedSession,topicIds}')
                and not exists (
                  select 1
                  from pg_catalog.jsonb_array_elements(
                    session.step_data #> '{generatedSession,topicIds}'
                  ) as generated_topic(value)
                  where pg_catalog.jsonb_typeof(generated_topic.value)
                      <> 'string'
                    or (generated_topic.value #>> '{}') !~*
                      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                ) then session.step_data
                  #> '{generatedSession,topicIds}'
              else coalesce(
                session.step_data -> 'topicIds',
                '[]'::jsonb
              )
            end
            else coalesce(
              session.step_data -> 'topicIds',
              '[]'::jsonb
            )
          end
        ) ? (topic.value ->> 'id')
        and exists (
          select 1
          from public.session_attempts as teaching_attempt
          where teaching_attempt.plan_session_id = session.id
            and teaching_attempt.user_id = requested_user_id
            and teaching_attempt.id::text is distinct from nullif(
              pg_catalog.current_setting(
                'yova.unguided_attempt_id',
                true
              ),
              ''
            )
            and coalesce(
              teaching_attempt.result_data ->> 'completionMode',
              'guided'
            ) <> 'unguided_practice'
            and (
              pg_catalog.jsonb_typeof(
                teaching_attempt.result_data -> 'conceptEvidence'
              ) is distinct from 'array'
              or pg_catalog.jsonb_array_length(
                teaching_attempt.result_data -> 'conceptEvidence'
              ) = 0
              or exists (
                select 1
                from pg_catalog.jsonb_array_elements(
                  teaching_attempt.result_data -> 'conceptEvidence'
                ) as teaching_item(value)
                where teaching_item.value ->> 'methodPhase'
                  is distinct from 'pretest'
              )
            )
        )
    ) as was_taught
  ) as completion on true
  left join lateral (
    select
      pg_catalog.count(*)::integer as evidence_count,
      pg_catalog.count(*) filter (
        where item.value ->> 'outcome' = 'secure'
      )::integer as secure_count,
      (
        pg_catalog.array_agg(
          item.value ->> 'outcome'
          order by attempt.completed_at desc, item.ordinality desc
        )
      )[1] as latest_outcome
    from public.session_attempts as attempt
    join public.plan_sessions as session
      on session.id = attempt.plan_session_id
      and session.plan_id = requested_plan_id
      and session.user_id = requested_user_id
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(
        attempt.result_data -> 'conceptEvidence',
        '[]'::jsonb
      )
    ) with ordinality as item(value, ordinality)
    where item.value ->> 'topicId' = topic.value ->> 'id'
      and item.value ->> 'methodPhase' is distinct from 'pretest'
      and attempt.id::text is distinct from nullif(
        pg_catalog.current_setting('yova.unguided_attempt_id', true),
        ''
      )
      and coalesce(
        attempt.result_data ->> 'completionMode',
        'guided'
      ) <> 'unguided_practice'
  ) as evidence on true;

  update public.plans
  set knowledge_map = pg_catalog.jsonb_set(
    current_map,
    '{topics}',
    refreshed_topics,
    false
  )
  where id = requested_plan_id
    and user_id = requested_user_id;
end;
$$;

create or replace function public.study_route_method_names_v2(
  method_id text
)
returns text[]
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select case method_id
    when 'retrieval_practice'
      then array['Active Recall', 'Retrieval practice']::text[]
    when 'spaced_retrieval'
      then array['Spaced Repetition', 'Spaced retrieval']::text[]
    when 'self_explanation'
      then array['Feynman Technique', 'Self-explanation']::text[]
    when 'worked_example_fading'
      then array['Worked Examples', 'Worked example fading']::text[]
    when 'interleaved_practice'
      then array['Interleaving', 'Interleaved practice']::text[]
    when 'read_recall_review'
      then array['SQ3R', 'Read-recall-review', 'Read recall review']::text[]
    when 'pretesting' then array['Pretesting']::text[]
    when 'concept_mapping' then array['Concept Mapping']::text[]
    when 'practice_problems' then array['Practice Problems']::text[]
    when 'retrieval_based_outlining'
      then array['Outline from Memory', 'Retrieval-based outlining']::text[]
    when 'scaffolded_coding'
      then array['Trace–Code–Test', 'Scaffolded coding with fading']::text[]
    when 'practice_test_error_repair'
      then array['Practice Tests', 'Practice test and error repair']::text[]
    else null
  end
$$;

create or replace function public.study_route_method_name_v2(
  method_id text
)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select (public.study_route_method_names_v2(method_id))[1]
$$;

create or replace function public.study_route_method_what_v2(
  method_id text
)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select case method_id
    when 'retrieval_practice'
      then 'Produce an answer from memory before looking at the source.'
    when 'spaced_retrieval'
      then 'Return to important material across separated sessions and retrieve it before reviewing.'
    when 'self_explanation'
      then 'Explain an idea in plain language, compare it with an accurate source, repair the gaps, and explain it again.'
    when 'worked_example_fading'
      then 'Study one complete solution, then solve a similar task as support is gradually removed.'
    when 'interleaved_practice'
      then 'Mix related problem or concept types so the learner must decide which approach applies.'
    when 'read_recall_review'
      then 'Survey a bounded source, create a guiding question, read for that answer, recall it closed-source, and review the gaps.'
    when 'pretesting'
      then 'Make a brief ungraded prediction before instruction, study an accurate model, and answer a changed follow-up; an observed miss may create repair later at runtime.'
    when 'concept_mapping'
      then 'Retrieve the important concepts, state labeled relationships between them, verify those links, and repair the map.'
    when 'practice_problems'
      then 'Solve a representative problem independently, then solve a changed-context problem; an observed miss may create repair later at runtime.'
    when 'retrieval_based_outlining'
      then 'Build the claim and structure from memory before returning to sources for evidence and revision.'
    when 'scaffolded_coding'
      then 'Trace and complete a working code example before writing a comparable solution with less support.'
    when 'practice_test_error_repair'
      then 'Attempt representative questions under reduced support, then diagnose and repair the specific errors.'
    else null
  end
$$;

create or replace function public.study_route_method_phases_v2(
  method_id text,
  learning_mode text
)
returns text[]
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  phases text[];
begin
  if learning_mode not in ('learn', 'study') then
    raise exception using
      errcode = '22023',
      message = 'study_route_method_mode_invalid';
  end if;

  phases := case method_id
    when 'retrieval_practice'
      then array['retrieve', 'repair']::text[]
    when 'spaced_retrieval'
      then array['retrieve', 'schedule_return']::text[]
    when 'self_explanation'
      then array['model', 'explain', 'repair', 'reexplain']::text[]
    when 'worked_example_fading'
      then array['model', 'guided_practice', 'independent_practice']::text[]
    when 'interleaved_practice'
      then array['discriminate', 'independent_practice']::text[]
    when 'read_recall_review'
      then array['survey', 'question', 'read_source', 'retrieve', 'review']::text[]
    when 'pretesting'
      then array['pretest', 'model', 'transfer']::text[]
    when 'concept_mapping'
      then array['retrieve', 'connect', 'evidence_match', 'repair']::text[]
    when 'practice_problems'
      then array['independent_practice', 'transfer']::text[]
    when 'retrieval_based_outlining'
      then array['retrieve', 'evidence_match', 'independent_practice']::text[]
    when 'scaffolded_coding'
      then array['code_trace', 'guided_practice', 'independent_practice']::text[]
    when 'practice_test_error_repair'
      then array['retrieve', 'repair', 'transfer']::text[]
    else null
  end;

  if phases is null then
    raise exception using
      errcode = '22023',
      message = 'study_route_method_id_invalid';
  end if;
  if learning_mode = 'learn' and not ('model' = any(phases)) then
    phases := pg_catalog.array_prepend('model'::text, phases);
  end if;
  return phases;
end;
$$;

create or replace function public.study_route_method_tradeoff_v2(
  route_payload jsonb,
  method_id text
)
returns text
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  method_name text := public.study_route_method_name_v2(method_id);
  method_what text := public.study_route_method_what_v2(method_id);
  task_type text := route_payload #>> '{target,taskFamily}';
  mode_label text := case route_payload #>> '{approach,mode}'
    when 'learn' then 'Learn'
    when 'practice' then 'Practice'
    else null
  end;
begin
  if method_name is null
    or method_what is null
    or task_type is null
    or mode_label is null then
    raise exception using
      errcode = '22023',
      message = 'study_route_method_tradeoff_invalid';
  end if;
  return pg_catalog.left(
    method_name || ' also fits this '
      || pg_catalog.replace(task_type, '_', ' ')
      || ' ' || mode_label || ' session. ' || method_what,
    300
  );
end;
$$;

-- This small catalog guard closes the null holes in the original generic
-- validator and binds every persisted ID to an honest recognized name.
create or replace function public.assert_study_route_method_catalog_v2(
  route_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  method_id text;
  method_name text;
  supporting_technique text;
  allowed_names text[];
  phase jsonb;
  alternative jsonb;
begin
  if pg_catalog.jsonb_typeof(route_payload) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'study_route_semantic_root_invalid';
  end if;

  method_id := route_payload #>> '{approach,primaryMethodId}';
  method_name := route_payload #>> '{approach,visibleMethodName}';
  supporting_technique := route_payload
    #>> '{approach,visibleSupportingTechniqueId}';
  allowed_names := public.study_route_method_names_v2(method_id);
  if method_id is null
    or allowed_names is null
    or method_name is null
    or (
      supporting_technique is not distinct from 'blurting_v1'
      and (
        method_id is distinct from 'retrieval_practice'
        or method_name is distinct from 'Blurting'
      )
    )
    or (
      supporting_technique is distinct from 'blurting_v1'
      and not (method_name = any(allowed_names))
    ) then
    raise exception using
      errcode = '22023',
      message = 'study_route_semantic_method_catalog_invalid';
  end if;

  if pg_catalog.jsonb_typeof(
      route_payload #> '{execution,orderedPhases}'
    ) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'study_route_semantic_phase_invalid';
  end if;
  for phase in
    select item.value
    from pg_catalog.jsonb_array_elements(
      route_payload #> '{execution,orderedPhases}'
    ) as item(value)
  loop
    if pg_catalog.jsonb_typeof(phase -> 'methodPhase')
        is distinct from 'string'
      or phase ->> 'methodPhase' is null
      or not ((phase ->> 'methodPhase') = any(array[
        'orient', 'survey', 'question', 'pretest', 'model',
        'read_source', 'retrieve', 'explain', 'reexplain',
        'guided_practice', 'independent_practice', 'discriminate',
        'connect', 'repair', 'evidence_match', 'code_trace',
        'transfer', 'schedule_return', 'reflect', 'review'
      ]::text[])) then
      raise exception using
        errcode = '22023',
        message = 'study_route_semantic_phase_invalid';
    end if;
  end loop;

  if pg_catalog.jsonb_typeof(
      route_payload #> '{agency,alternatives}'
    ) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'study_route_semantic_agency_invalid';
  end if;
  for alternative in
    select item.value
    from pg_catalog.jsonb_array_elements(
      route_payload #> '{agency,alternatives}'
    ) as item(value)
  loop
    method_id := alternative ->> 'primaryMethodId';
    method_name := alternative ->> 'visibleMethodName';
    allowed_names := public.study_route_method_names_v2(method_id);
    if pg_catalog.jsonb_typeof(alternative -> 'primaryMethodId')
        is distinct from 'string'
      or pg_catalog.jsonb_typeof(alternative -> 'visibleMethodName')
        is distinct from 'string'
      or method_id is null
      or method_name is null
      or allowed_names is null
      or not (method_name = any(allowed_names)) then
      raise exception using
        errcode = '22023',
        message = 'study_route_semantic_alternative_invalid';
    end if;
  end loop;
end;
$$;

revoke all on function public.study_route_method_names_v2(text)
from public, anon, authenticated, service_role;
revoke all on function public.study_route_method_name_v2(text)
from public, anon, authenticated, service_role;
revoke all on function public.study_route_method_what_v2(text)
from public, anon, authenticated, service_role;
revoke all on function public.study_route_method_phases_v2(text, text)
from public, anon, authenticated, service_role;
revoke all on function public.study_route_method_tradeoff_v2(jsonb, text)
from public, anon, authenticated, service_role;
revoke all on function public.assert_study_route_method_catalog_v2(jsonb)
from public, anon, authenticated, service_role;

alter function public.assert_study_route_payload_v1(jsonb)
rename to assert_study_route_payload_legacy_v1;

revoke all on function public.assert_study_route_payload_legacy_v1(jsonb)
from public, anon, authenticated, service_role;

-- New IDs/phases are mapped only for the structural legacy pass. The v2
-- catalog guard above validates the original payload first, so this adapter
-- cannot widen the public contract or rewrite stored data.
create or replace function public.assert_study_route_payload_v1(
  route_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  adapted_payload jsonb := route_payload;
  adapted_alternatives jsonb;
  adapted_phases jsonb;
  requires_expanded_adapter boolean := false;
begin
  perform public.assert_study_route_method_catalog_v2(route_payload);

  if pg_catalog.jsonb_typeof(
      route_payload #> '{provenance,routerVersion}'
    ) is distinct from 'string'
    or pg_catalog.char_length(
      route_payload #>> '{provenance,routerVersion}'
    ) not between 1 and 256 then
    raise exception using
      errcode = '22023',
      message = 'study_route_semantic_provenance_invalid';
  end if;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      route_payload #> '{execution,orderedPhases}'
    ) as phase(value)
    where phase.value ->> 'methodPhase' in (
      'survey', 'question', 'pretest', 'reexplain', 'connect', 'review'
    )
  ) or route_payload #>> '{approach,primaryMethodId}' in (
    'pretesting', 'concept_mapping', 'practice_problems'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      route_payload #> '{agency,alternatives}'
    ) as alternative(value)
    where alternative.value ->> 'primaryMethodId' in (
      'pretesting', 'concept_mapping', 'practice_problems'
    )
  )
  into requires_expanded_adapter;

  if not requires_expanded_adapter then
    perform public.assert_study_route_payload_legacy_v1(route_payload);
    return;
  end if;

  adapted_payload := pg_catalog.jsonb_set(
    adapted_payload,
    '{approach,primaryMethodId}',
    '"retrieval_practice"'::jsonb,
    false
  );
  adapted_payload := pg_catalog.jsonb_set(
    adapted_payload,
    '{approach,visibleMethodName}',
    '"Active Recall"'::jsonb,
    false
  );
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          alternative.value,
          '{primaryMethodId}',
          pg_catalog.to_jsonb(case alternative.ordinality
            when 1 then 'spaced_retrieval'::text
            else 'self_explanation'::text
          end),
          false
        ),
        '{visibleMethodName}',
        pg_catalog.to_jsonb(case alternative.ordinality
          when 1 then 'Spaced Repetition'::text
          else 'Self-explanation'::text
        end),
        false
      ) order by alternative.ordinality
    ),
    '[]'::jsonb
  )
  into adapted_alternatives
  from pg_catalog.jsonb_array_elements(
    route_payload #> '{agency,alternatives}'
  ) with ordinality as alternative(value, ordinality);
  adapted_payload := pg_catalog.jsonb_set(
    adapted_payload,
    '{agency,alternatives}',
    adapted_alternatives,
    false
  );

  select pg_catalog.jsonb_agg(
    case
      when phase.value ->> 'methodPhase' in (
        'survey', 'question', 'pretest', 'reexplain', 'connect', 'review'
      ) then pg_catalog.jsonb_set(
        phase.value,
        '{methodPhase}',
        '"reflect"'::jsonb,
        false
      )
      else phase.value
    end order by phase.ordinality
  )
  into adapted_phases
  from pg_catalog.jsonb_array_elements(
    route_payload #> '{execution,orderedPhases}'
  ) with ordinality as phase(value, ordinality);
  adapted_payload := pg_catalog.jsonb_set(
    adapted_payload,
    '{execution,orderedPhases}',
    adapted_phases,
    false
  );

  perform public.assert_study_route_payload_legacy_v1(adapted_payload);
end;
$$;

revoke all on function public.assert_study_route_payload_v1(jsonb)
from public, anon, authenticated, service_role;

-- Recreate the trigger function so its validator reference resolves to the
-- new wrapper even on a server that previously compiled the PL/pgSQL body.
create or replace function public.guard_study_route_payload_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  predecessor_is_blurting boolean := false;
begin
  perform public.assert_study_route_payload_v1(new.route_payload);

  if new.route_payload #>> '{approach,visibleSupportingTechniqueId}'
      = 'blurting_v1'
    and new.predecessor_revision_id is not null then
    select exists (
      select 1
      from public.study_routes as predecessor
      where predecessor.route_revision_id = new.predecessor_revision_id
        and predecessor.route_lineage_id = new.route_lineage_id
        and predecessor.plan_session_id = new.plan_session_id
        and predecessor.plan_id = new.plan_id
        and predecessor.user_id = new.user_id
        and predecessor.revision_number = new.revision_number - 1
        and predecessor.route_payload
          #>> '{approach,visibleSupportingTechniqueId}' = 'blurting_v1'
    )
    into predecessor_is_blurting;
  end if;

  if new.route_payload #>> '{approach,visibleSupportingTechniqueId}'
      = 'blurting_v1'
    and not predecessor_is_blurting
    and public.current_plan_activation_permit_matches_v1(
      new.user_id,
      new.plan_id
    ) is distinct from true then
    raise exception using
      errcode = '42501',
      message = 'study_route_blurting_activation_permit_required';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_study_route_payload_v1()
from public, anon, authenticated, service_role;

-- Existing immutable payloads must also satisfy the stronger wrapper before
-- the transaction can publish it.
do $$
declare
  existing_payload jsonb;
begin
  for existing_payload in
    select route.route_payload
    from public.study_routes as route
    order by route.created_at, route.route_revision_id
  loop
    perform public.assert_study_route_payload_v1(existing_payload);
  end loop;
end;
$$;

alter function public.change_plan_session_method_with_route(jsonb)
rename to change_plan_session_method_with_route_legacy_v1;

revoke all on function
  public.change_plan_session_method_with_route_legacy_v1(jsonb)
from public, anon, authenticated, service_role;

create or replace function public.change_plan_session_method_with_route_v2(
  payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_plan_id uuid;
  requested_session_id uuid;
  expected_route_revision_id uuid;
  requested_route jsonb := payload -> 'successorStudyRoute';
  selection_scope text := coalesce(
    payload ->> 'selectionScope',
    'stored_alternative'
  );
  requested_route_revision_id uuid;
  requested_predecessor_revision_id uuid;
  requested_method_id text;
  predecessor_method_id text;
  predecessor_method_name text;
  expected_method_name text;
  expected_method_names text[];
  predecessor_method_names text[];
  requested_plan public.plans%rowtype;
  requested_session public.plan_sessions%rowtype;
  predecessor_route public.study_routes%rowtype;
  existing_route public.study_routes%rowtype;
  predecessor_has_blurting_recipe boolean := false;
  exact_stored_alternative jsonb;
  stored_alternative jsonb;
  stored_alternative_id text;
  stored_alternative_name text;
  stored_alternative_tradeoff text;
  stored_alternative_ordinality bigint;
  matching_alternative_count integer := 0;
  authorized_choice_ids text[] := '{}'::text[];
  expected_alternative_ids text[] := '{}'::text[];
  requested_alternative jsonb;
  requested_alternative_ordinality bigint;
  expected_alternative_id text;
  expected_alternative_name text;
  expected_alternative_tradeoff text;
  expected_method_phases text[];
  expected_phase_count integer;
  expected_phase_minutes integer;
  expected_active_minutes integer;
  expected_activity_limit integer;
  expected_active_target_ids jsonb;
  requested_phase jsonb;
  requested_phase_ordinality bigint;
  expected_task_type text;
  expected_knowledge_stage text;
  expected_learning_mode text;
  expected_mode_label text;
  expected_short_reason text;
  expected_method_requirement text;
  predecessor_method_requirement text;
  explanation_item text;
  expected_task_requirements jsonb := '[]'::jsonb;
  expected_learner_declarations jsonb := '[]'::jsonb;
  expected_observations jsonb := '[]'::jsonb;
  expected_uncertainties jsonb := '[]'::jsonb;
  expected_route_evidence_ref text;
  expected_learner_choice_evidence_ref text;
  expected_evidence_refs jsonb := '[]'::jsonb;
  predecessor_rule_trace jsonb;
  requested_rule_trace jsonb;
  requested_trace_prefix jsonb;
  predecessor_trace_count integer;
  requested_eligibility_trace jsonb;
  requested_eligibility_trace_count integer;
  predecessor_eligibility_trace jsonb;
  expected_eligibility_trace jsonb;
  expected_eligible_method_ids text[];
  validated_eligible_method_ids text[] := '{}'::text[];
  expected_eligible_method_names text[] := '{}'::text[];
  eligible_method_id text;
  eligible_method_name text;
  predecessor_method_presentation_count integer;
  expected_rule_trace jsonb;
  expected_runtime_kind text;
  expected_delivery_kind text;
  expected_delivery_description text;
  expected_primary_generation_path text;
  expected_bounded_recovery text;
  expected_recovery_description text;
  expected_runtime_result text;
  expected_runtime_reason text;
  expected_router_components text[] := '{}'::text[];
  compacted_router_components text[] := '{}'::text[];
  compacted_router_evidence_refs jsonb := '[]'::jsonb;
  router_was_compacted boolean := false;
  router_component text;
  required_router_component text;
  expected_router_version text;
  expected_override_changed_fields jsonb;
  response_status text := 'updated';
  canonical_route jsonb;
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'post_commit_method_choice_authentication_required';
  end if;

  if pg_catalog.jsonb_typeof(payload) is distinct from 'object'
    or not (payload ?& array[
      'planId',
      'planSessionId',
      'expectedRouteRevisionId',
      'successorStudyRoute'
    ])
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(payload) as payload_key(key)
      where payload_key.key not in (
        'planId',
        'planSessionId',
        'expectedRouteRevisionId',
        'successorStudyRoute',
        'selectionScope'
      )
    )
    or pg_catalog.jsonb_typeof(requested_route) is distinct from 'object'
    or selection_scope not in (
      'stored_alternative',
      'other_eligible_method'
    ) then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_scope_conflict';
  end if;

  begin
    requested_plan_id := (payload ->> 'planId')::uuid;
    requested_session_id := (payload ->> 'planSessionId')::uuid;
    expected_route_revision_id := (
      payload ->> 'expectedRouteRevisionId'
    )::uuid;
    requested_route_revision_id := (
      requested_route #>> '{identity,routeRevisionId}'
    )::uuid;
    requested_predecessor_revision_id := (
      requested_route #>> '{identity,supersedesRevisionId}'
    )::uuid;
    requested_method_id := requested_route
      #>> '{approach,primaryMethodId}';
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_scope_conflict';
  end;

  if requested_plan_id is null
    or requested_session_id is null
    or expected_route_revision_id is null
    or requested_route_revision_id is null
    or requested_predecessor_revision_id
      is distinct from expected_route_revision_id
    or requested_route #>> '{identity,planId}'
      is distinct from requested_plan_id::text
    or requested_route #>> '{identity,sessionId}'
      is distinct from requested_session_id::text
    or requested_route #>> '{identity,lifecycleStatus}'
      is distinct from 'committed' then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_scope_conflict';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  select plan.*
  into requested_plan
  from public.plans as plan
  where plan.id = requested_plan_id
    and plan.user_id = current_user_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'post_commit_method_choice_plan_not_found';
  end if;

  perform session.id
  from public.plan_sessions as session
  where session.plan_id = requested_plan.id
    and session.user_id = current_user_id
  order by session.sequence, session.id
  for update;

  select session.*
  into requested_session
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.plan_id = requested_plan.id
    and session.user_id = current_user_id;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'post_commit_method_choice_session_not_found';
  end if;

  select route.*
  into predecessor_route
  from public.study_routes as route
  where route.route_revision_id = expected_route_revision_id
    and route.plan_id = requested_plan.id
    and route.plan_session_id = requested_session.id
    and route.user_id = current_user_id
  for update;
  if not found
    or predecessor_route.lifecycle not in ('committed', 'superseded') then
    raise exception using
      errcode = '55000',
      message = 'post_commit_method_choice_predecessor_conflict';
  end if;

  select route.*
  into existing_route
  from public.study_routes as route
  where route.route_revision_id = requested_route_revision_id
    and route.plan_id = requested_plan.id
    and route.plan_session_id = requested_session.id
    and route.user_id = current_user_id
  for update;

  perform public.validate_study_route_write_identity(
    requested_route,
    requested_plan.id,
    requested_session.id,
    expected_route_revision_id,
    false
  );
  perform public.assert_study_route_payload_v1(requested_route - 'identity');

  predecessor_method_id := predecessor_route.route_payload
    #>> '{approach,primaryMethodId}';
  predecessor_method_name := predecessor_route.route_payload
    #>> '{approach,visibleMethodName}';
  predecessor_has_blurting_recipe := predecessor_route.route_payload
    #>> '{approach,visibleSupportingTechniqueId}'
      is not distinct from 'blurting_v1';
  expected_method_names := public.study_route_method_names_v2(
    requested_method_id
  );
  expected_method_name := expected_method_names[1];
  predecessor_method_names := case
    when predecessor_has_blurting_recipe then array['Blurting']::text[]
    else public.study_route_method_names_v2(predecessor_method_id)
  end;

  -- "Other methods" is not a client-supplied authorization token. It is a
  -- narrow request available only on an immutable predecessor whose server-
  -- issued agency contract already records I'll Customize. The requested
  -- method is checked again below against that predecessor's exact immutable
  -- method_eligibility_v2 cohort before any successor can be committed.
  if selection_scope = 'other_eligible_method'
    and predecessor_route.route_payload #>> '{agency,controlMode}'
      is distinct from 'learner_customizes' then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_agency_conflict';
  end if;

  if expected_method_names is null
    or expected_method_name is null
    or predecessor_method_names is null
    or predecessor_method_name is null
    or not (predecessor_method_name = any(predecessor_method_names))
    or requested_method_id is not distinct from predecessor_method_id
    or requested_route #>> '{approach,visibleMethodName}'
      is distinct from expected_method_name
    or requested_route #>> '{identity,routeLineageId}'
      is distinct from predecessor_route.route_lineage_id::text
    or requested_route_revision_id is not distinct from requested_plan.id
    or requested_route_revision_id is not distinct from requested_session.id
    or requested_route_revision_id
      is not distinct from predecessor_route.route_lineage_id
    or requested_route_revision_id
      is not distinct from expected_route_revision_id
    or (requested_route #>> '{identity,revisionNumber}')::integer
      is distinct from predecessor_route.revision_number + 1
    or (requested_route #>> '{identity,schemaVersion}')::integer
      is distinct from predecessor_route.schema_version::integer
    or requested_route #>> '{identity,createdAt}'
      is distinct from requested_route #>> '{identity,committedAt}' then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_scope_conflict';
  end if;

  authorized_choice_ids := pg_catalog.array_append(
    authorized_choice_ids,
    predecessor_method_id
  );
  for stored_alternative, stored_alternative_ordinality in
    select alternative.value, alternative.ordinality
    from pg_catalog.jsonb_array_elements(
      predecessor_route.route_payload #> '{agency,alternatives}'
    ) with ordinality as alternative(value, ordinality)
  loop
    stored_alternative_id := stored_alternative ->> 'primaryMethodId';
    stored_alternative_name := stored_alternative ->> 'visibleMethodName';
    stored_alternative_tradeoff := stored_alternative ->> 'tradeoff';
    if stored_alternative_id is null
      or stored_alternative_name is null
      or public.study_route_method_names_v2(stored_alternative_id) is null
      or not (
        stored_alternative_name = any(
          public.study_route_method_names_v2(stored_alternative_id)
        )
      )
      or stored_alternative ->> 'alternativeId'
        is distinct from 'method-alternative:' || stored_alternative_id
      or stored_alternative ->> 'mode'
        is distinct from predecessor_route.route_payload
          #>> '{approach,mode}'
      or stored_alternative ->> 'executionEnvironment'
        is distinct from predecessor_route.route_payload
          #>> '{approach,executionEnvironment}'
      or (stored_alternative ->> 'activeMinutes')::integer
        is distinct from (
          predecessor_route.route_payload #>> '{timing,activeMinutes}'
        )::integer
      or (
        stored_alternative_tradeoff is distinct from
          public.study_route_method_tradeoff_v2(
            predecessor_route.route_payload,
            stored_alternative_id
          )
        and stored_alternative_tradeoff is distinct from
          stored_alternative_name
            || ' also fits this task and stage, but it would use a different practice sequence.'
      )
      or stored_alternative_id = any(authorized_choice_ids) then
      raise exception using
        errcode = '22023',
        message = 'post_commit_method_choice_alternative_conflict';
    end if;
    authorized_choice_ids := pg_catalog.array_append(
      authorized_choice_ids,
      stored_alternative_id
    );
    if stored_alternative_id = requested_method_id then
      exact_stored_alternative := stored_alternative;
      matching_alternative_count := matching_alternative_count + 1;
    end if;
  end loop;

  if selection_scope = 'stored_alternative'
    and (
      matching_alternative_count <> 1
      or exact_stored_alternative is null
    ) then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_not_offered';
  end if;

  foreach stored_alternative_id in array authorized_choice_ids
  loop
    if stored_alternative_id <> requested_method_id
      and coalesce(
        pg_catalog.array_length(expected_alternative_ids, 1),
        0
      ) < 2 then
      expected_alternative_ids := pg_catalog.array_append(
        expected_alternative_ids,
        stored_alternative_id
      );
    end if;
  end loop;

  if pg_catalog.jsonb_array_length(
      requested_route #> '{agency,alternatives}'
    ) is distinct from coalesce(
      pg_catalog.array_length(expected_alternative_ids, 1),
      0
    ) then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_alternative_conflict';
  end if;

  for requested_alternative, requested_alternative_ordinality in
    select alternative.value, alternative.ordinality
    from pg_catalog.jsonb_array_elements(
      requested_route #> '{agency,alternatives}'
    ) with ordinality as alternative(value, ordinality)
  loop
    expected_alternative_id := expected_alternative_ids[
      requested_alternative_ordinality::integer
    ];
    expected_alternative_name := public.study_route_method_name_v2(
      expected_alternative_id
    );
    expected_alternative_tradeoff :=
      public.study_route_method_tradeoff_v2(
        requested_route,
        expected_alternative_id
      );
    if requested_alternative ->> 'primaryMethodId'
        is distinct from expected_alternative_id
      or requested_alternative ->> 'alternativeId'
        is distinct from 'method-alternative:' || expected_alternative_id
      or requested_alternative ->> 'visibleMethodName'
        is distinct from expected_alternative_name
      or requested_alternative ->> 'mode'
        is distinct from requested_route #>> '{approach,mode}'
      or requested_alternative ->> 'executionEnvironment'
        is distinct from requested_route
          #>> '{approach,executionEnvironment}'
      or (requested_alternative ->> 'activeMinutes')::integer
        is distinct from (
          requested_route #>> '{timing,activeMinutes}'
        )::integer
      or requested_alternative ->> 'tradeoff'
        is distinct from expected_alternative_tradeoff then
      raise exception using
        errcode = '22023',
        message = 'post_commit_method_choice_alternative_conflict';
    end if;
  end loop;

  if requested_route -> 'target'
      is distinct from predecessor_route.route_payload -> 'target'
    or requested_route -> 'timing'
      is distinct from predecessor_route.route_payload -> 'timing'
    or (requested_route -> 'approach')
        - 'primaryMethodId' - 'visibleMethodName'
        - 'visibleSupportingTechniqueId'
      is distinct from (
        predecessor_route.route_payload -> 'approach'
      ) - 'primaryMethodId' - 'visibleMethodName'
        - 'visibleSupportingTechniqueId'
    or (requested_route -> 'execution')
        - 'orderedPhases' - 'activityLimit'
      is distinct from (
        predecessor_route.route_payload -> 'execution'
      ) - 'orderedPhases' - 'activityLimit'
    or requested_route #>> '{provenance,profileVersion}'
      is distinct from predecessor_route.route_payload
        #>> '{provenance,profileVersion}'
    or (
      predecessor_has_blurting_recipe
      and requested_route #> '{approach,visibleSupportingTechniqueId}'
        is not null
    )
    or (
      not predecessor_has_blurting_recipe
      and requested_route #> '{approach,visibleSupportingTechniqueId}'
        is distinct from predecessor_route.route_payload
          #> '{approach,visibleSupportingTechniqueId}'
    ) then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_scope_conflict';
  end if;

  expected_learning_mode := case
    when requested_route #>> '{approach,mode}' = 'learn' then 'learn'
    else 'study'
  end;
  expected_mode_label := case expected_learning_mode
    when 'learn' then 'Learn'
    else 'Practice'
  end;
  expected_method_phases := public.study_route_method_phases_v2(
    requested_method_id,
    expected_learning_mode
  );
  expected_phase_count := pg_catalog.array_length(
    expected_method_phases,
    1
  );
  expected_active_minutes := (
    predecessor_route.route_payload #>> '{timing,activeMinutes}'
  )::integer;
  expected_activity_limit := greatest(
    (
      predecessor_route.route_payload #>> '{execution,activityLimit}'
    )::integer,
    expected_phase_count
  );
  expected_active_target_ids := public.study_route_active_topic_ids_v1(
    predecessor_route.route_payload
  );

  if pg_catalog.jsonb_array_length(
      requested_route #> '{execution,orderedPhases}'
    ) is distinct from expected_phase_count
    or (requested_route #>> '{execution,activityLimit}')::integer
      is distinct from expected_activity_limit then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_phase_contract_conflict';
  end if;

  for requested_phase, requested_phase_ordinality in
    select phase.value, phase.ordinality
    from pg_catalog.jsonb_array_elements(
      requested_route #> '{execution,orderedPhases}'
    ) with ordinality as phase(value, ordinality)
  loop
    expected_phase_minutes := expected_active_minutes / expected_phase_count
      + case
        when requested_phase_ordinality <= (
          expected_active_minutes % expected_phase_count
        )::bigint then 1
        else 0
      end;
    if requested_phase ->> 'phaseId'
        is distinct from 'method-' || requested_phase_ordinality::text
          || '-' || expected_method_phases[
            requested_phase_ordinality::integer
          ]
      or requested_phase ->> 'methodPhase'
        is distinct from expected_method_phases[
          requested_phase_ordinality::integer
        ]
      or (requested_phase ->> 'activeMinutes')::integer
        is distinct from expected_phase_minutes
      or requested_phase -> 'targetIds'
        is distinct from expected_active_target_ids then
      raise exception using
        errcode = '22023',
        message = 'post_commit_method_choice_phase_contract_conflict';
    end if;
  end loop;

  expected_task_type := predecessor_route.route_payload
    #>> '{target,taskFamily}';
  select case
    when pg_catalog.count(*) = 0 then null
    when pg_catalog.bool_or(target.value ->> 'stage' = 'novice')
      then 'novice'
    when pg_catalog.bool_or(target.value ->> 'stage' = 'developing')
      then 'developing'
    else 'retrieval_ready'
  end
  into expected_knowledge_stage
  from pg_catalog.jsonb_array_elements(
    predecessor_route.route_payload #> '{target,targetStates}'
  ) as target(value)
  where expected_active_target_ids @> pg_catalog.jsonb_build_array(
    target.value ->> 'targetId'
  );
  if expected_task_type is null or expected_knowledge_stage is null then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_scope_conflict';
  end if;

  predecessor_rule_trace := predecessor_route.route_payload
    #> '{provenance,ruleTrace}';
  requested_rule_trace := requested_route
    #> '{provenance,ruleTrace}';
  predecessor_trace_count := pg_catalog.jsonb_array_length(
    predecessor_rule_trace
  );
  select coalesce(
    pg_catalog.jsonb_agg(trace.value order by trace.ordinality),
    '[]'::jsonb
  )
  into requested_trace_prefix
  from pg_catalog.jsonb_array_elements(requested_rule_trace)
    with ordinality as trace(value, ordinality)
  where trace.ordinality <= predecessor_trace_count;
  if requested_trace_prefix is distinct from predecessor_rule_trace then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_agency_conflict';
  end if;

  select
    pg_catalog.count(*)::integer,
    (pg_catalog.jsonb_agg(trace.value order by trace.ordinality) -> 0)
  into
    requested_eligibility_trace_count,
    requested_eligibility_trace
  from pg_catalog.jsonb_array_elements(requested_rule_trace)
    with ordinality as trace(value, ordinality)
  where trace.ordinality > predecessor_trace_count
    and trace.value ->> 'ruleId' = 'method_eligibility_v2';
  if requested_eligibility_trace_count is distinct from 1
    or pg_catalog.jsonb_typeof(requested_eligibility_trace)
      is distinct from 'object'
    or requested_eligibility_trace ->> 'ruleId'
      is distinct from 'method_eligibility_v2'
    or pg_catalog.jsonb_typeof(
      requested_eligibility_trace -> 'result'
    ) is distinct from 'string' then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_agency_conflict';
  end if;
  expected_eligible_method_ids := pg_catalog.string_to_array(
    requested_eligibility_trace ->> 'result',
    ','
  );
  if coalesce(
      pg_catalog.array_length(expected_eligible_method_ids, 1),
      0
    ) not between 1 and 12 then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_agency_conflict';
  end if;
  foreach eligible_method_id in array expected_eligible_method_ids
  loop
    eligible_method_name := public.study_route_method_name_v2(
      eligible_method_id
    );
    if eligible_method_name is null
      or eligible_method_id = any(validated_eligible_method_ids) then
      raise exception using
        errcode = '22023',
        message = 'post_commit_method_choice_agency_conflict';
    end if;
    validated_eligible_method_ids := pg_catalog.array_append(
      validated_eligible_method_ids,
      eligible_method_id
    );
    expected_eligible_method_names := pg_catalog.array_append(
      expected_eligible_method_names,
      eligible_method_name
    );
  end loop;
  if not (requested_method_id = any(expected_eligible_method_ids)) then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_not_offered';
  end if;
  foreach stored_alternative_id in array authorized_choice_ids
  loop
    if not (
      stored_alternative_id = any(expected_eligible_method_ids)
    ) then
      raise exception using
        errcode = '22023',
        message = 'post_commit_method_choice_agency_conflict';
    end if;
  end loop;

  expected_eligibility_trace := pg_catalog.jsonb_build_object(
    'ruleId', 'method_eligibility_v2',
    'result', pg_catalog.array_to_string(
      expected_eligible_method_ids,
      ','
    ),
    'reason', 'Task, knowledge stage, and ' || expected_mode_label
      || ' mode limited selection to '
      || pg_catalog.array_to_string(
        expected_eligible_method_names,
        ', '
      ) || '.',
    'evidenceRefs', '[]'::jsonb
  );
  if requested_eligibility_trace
      is distinct from expected_eligibility_trace then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_agency_conflict';
  end if;

  select trace.value
  into predecessor_eligibility_trace
  from pg_catalog.jsonb_array_elements(predecessor_rule_trace)
    with ordinality as trace(value, ordinality)
  where trace.value ->> 'ruleId' = 'method_eligibility_v2'
  order by trace.ordinality desc
  limit 1;
  if selection_scope = 'other_eligible_method'
    and predecessor_eligibility_trace is null then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_agency_conflict';
  end if;
  if predecessor_eligibility_trace is not null
    and predecessor_eligibility_trace
      is distinct from expected_eligibility_trace then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_agency_conflict';
  end if;

  expected_short_reason := 'You chose ' || expected_method_name
    || ' from the methods that fit this session.';
  predecessor_method_requirement := predecessor_method_name
    || ' is eligible for this '
    || pg_catalog.replace(expected_task_type, '_', ' ')
    || ' ' || expected_mode_label || ' route at the '
    || pg_catalog.replace(expected_knowledge_stage, '_', ' ')
    || ' stage.';
  expected_method_requirement := expected_method_name
    || ' is eligible for this '
    || pg_catalog.replace(expected_task_type, '_', ' ')
    || ' ' || expected_mode_label || ' route at the '
    || pg_catalog.replace(expected_knowledge_stage, '_', ' ')
    || ' stage.';

  expected_task_requirements := pg_catalog.jsonb_build_array(
    expected_method_requirement
  );
  for explanation_item in
    select item.value
    from pg_catalog.jsonb_array_elements_text(
      predecessor_route.route_payload #> '{explanation,taskRequirements}'
    ) as item(value)
  loop
    if explanation_item is distinct from predecessor_method_requirement
      and pg_catalog.jsonb_array_length(expected_task_requirements) < 10
      and not (
        expected_task_requirements
          @> pg_catalog.jsonb_build_array(explanation_item)
      ) then
      expected_task_requirements := expected_task_requirements
        || pg_catalog.jsonb_build_array(explanation_item);
    end if;
  end loop;

  expected_learner_declarations := pg_catalog.jsonb_build_array(
    expected_short_reason
  );
  for explanation_item in
    select item.value
    from pg_catalog.jsonb_array_elements_text(
      predecessor_route.route_payload
        #> '{explanation,learnerDeclarations}'
    ) as item(value)
  loop
    if explanation_item is distinct from predecessor_route.route_payload
        #>> '{explanation,shortReason}'
      and pg_catalog.jsonb_array_length(
        expected_learner_declarations
      ) < 10
      and not (
        expected_learner_declarations
          @> pg_catalog.jsonb_build_array(explanation_item)
      ) then
      expected_learner_declarations := expected_learner_declarations
        || pg_catalog.jsonb_build_array(explanation_item);
    end if;
  end loop;

  for explanation_item in
    select item.value
    from pg_catalog.jsonb_array_elements_text(
      predecessor_route.route_payload #> '{explanation,observations}'
    ) as item(value)
  loop
    if explanation_item is distinct from predecessor_route.route_payload
        #>> '{explanation,shortReason}' then
      expected_observations := expected_observations
        || pg_catalog.jsonb_build_array(explanation_item);
    end if;
  end loop;

  for explanation_item in
    select item.value
    from pg_catalog.jsonb_array_elements_text(
      predecessor_route.route_payload #> '{explanation,uncertainties}'
    ) as item(value)
  loop
    if explanation_item not in (
      'The legacy record does not show who selected the route or which control mode was active.',
      'The intended phase skeleton comes from the method contract rather than a saved executed sequence.'
    ) then
      expected_uncertainties := expected_uncertainties
        || pg_catalog.jsonb_build_array(explanation_item);
    end if;
  end loop;

  expected_route_evidence_ref := 'route-revision:'
    || expected_route_revision_id::text;
  expected_learner_choice_evidence_ref :=
    'learner-choice:committed-route:'
      || requested_plan.id::text
      || ':' || requested_session.id::text
      || ':' || expected_route_revision_id::text
      || ':' || requested_method_id;
  for explanation_item in
    select evidence_ref.value
    from pg_catalog.jsonb_array_elements_text(
      predecessor_route.route_payload #> '{provenance,evidenceRefs}'
    ) as evidence_ref(value)
  loop
    if not (
      expected_evidence_refs
        @> pg_catalog.jsonb_build_array(explanation_item)
    ) then
      expected_evidence_refs := expected_evidence_refs
        || pg_catalog.jsonb_build_array(explanation_item);
    end if;
  end loop;
  if not (
    expected_evidence_refs
      @> pg_catalog.jsonb_build_array(expected_route_evidence_ref)
  ) then
    expected_evidence_refs := expected_evidence_refs
      || pg_catalog.jsonb_build_array(expected_route_evidence_ref);
  end if;
  if not (
    expected_evidence_refs
      @> pg_catalog.jsonb_build_array(
        expected_learner_choice_evidence_ref
      )
  ) then
    expected_evidence_refs := expected_evidence_refs
      || pg_catalog.jsonb_build_array(
        expected_learner_choice_evidence_ref
      );
  end if;

  select pg_catalog.count(*)::integer
  into predecessor_method_presentation_count
  from pg_catalog.jsonb_array_elements(predecessor_rule_trace)
    as trace(value)
  where trace.value ->> 'ruleId' = 'method_presentation_v2';
  if predecessor_method_presentation_count > 1
    or (
      predecessor_method_presentation_count = 1
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(predecessor_rule_trace)
          as trace(value)
        where trace.value = pg_catalog.jsonb_build_object(
          'ruleId', 'method_presentation_v2',
          'result', 'recognizable_method_names',
          'reason', 'Learner-facing method names come from the versioned presentation catalog; method IDs and learning recipes remain unchanged.',
          'evidenceRefs', '[]'::jsonb
        )
      )
    ) then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_agency_conflict';
  end if;

  foreach router_component in array pg_catalog.string_to_array(
    predecessor_route.route_payload #>> '{provenance,routerVersion}',
    '+'
  )
  loop
    if router_component <> ''
      and (
        (
          predecessor_has_blurting_recipe
          and router_component <> 'blurting_recipe_runtime_v1'
        )
        or (
          not predecessor_has_blurting_recipe
          and router_component
            not in (
              'study_route_method_plan_integration_v1',
              'method_runtime_capability_v1',
              'method_presentation_v2'
            )
        )
      )
      and not (router_component = any(expected_router_components)) then
      expected_router_components := pg_catalog.array_append(
        expected_router_components,
        router_component
      );
    end if;
  end loop;
  if coalesce(
      pg_catalog.array_length(expected_router_components, 1),
      0
    ) = 0 then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_agency_conflict';
  end if;
  compacted_router_components := expected_router_components;
  foreach required_router_component in array array[
    'study_route_method_plan_integration_v1',
    'method_decision_evidence_adapter_v2',
    'method_evidence_v1',
    'method_compare_v1',
    'method_runtime_capability_v1',
    'method_presentation_v2',
    'study_route_agency_mode_controller_v1'
  ]::text[]
  loop
    if not (
      required_router_component = any(expected_router_components)
    ) then
      expected_router_components := pg_catalog.array_append(
        expected_router_components,
        required_router_component
      );
    end if;
  end loop;
  expected_router_version := pg_catalog.array_to_string(
    expected_router_components,
    '+'
  );
  if pg_catalog.char_length(expected_router_version) > 256 then
    router_was_compacted := true;
    expected_router_components := array[
      'study_route_method_plan_integration_v1',
      'method_decision_evidence_adapter_v2',
      'method_evidence_v1',
      'method_compare_v1',
      'method_runtime_capability_v1',
      'method_presentation_v2',
      'study_route_agency_mode_controller_v1'
    ]::text[];
    if 'task_mastery_v1' = any(compacted_router_components)
      and 'personalized_v1' = any(compacted_router_components) then
      raise exception using
        errcode = '22023',
        message = 'post_commit_method_choice_agency_conflict';
    end if;
    if 'task_mastery_v1' = any(compacted_router_components)
      or 'personalized_v1' = any(compacted_router_components) then
      expected_router_components := pg_catalog.array_append(
        expected_router_components,
        'personalization_rollout_v1'
      );
      expected_router_components := pg_catalog.array_append(
        expected_router_components,
        case
          when 'personalized_v1' = any(compacted_router_components)
            then 'personalized_v1'
          else 'task_mastery_v1'
        end
      );
    end if;
    expected_router_version := pg_catalog.array_to_string(
      expected_router_components,
      '+'
    );
  end if;
  if pg_catalog.char_length(expected_router_version) > 256 then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_agency_conflict';
  end if;

  expected_runtime_kind := case requested_method_id
    when 'retrieval_practice' then 'retrieval_round'
    when 'spaced_retrieval' then 'retrieval_round'
    when 'worked_example_fading' then 'worked_example'
    when 'practice_test_error_repair' then 'error_repair'
    else null
  end;
  expected_delivery_kind := case
    when expected_runtime_kind is null
      then 'validated_phase_contract'
    else 'dedicated_runtime'
  end;
  expected_delivery_description := case
    when expected_runtime_kind is null
      then 'the generic activity renderer under the method''s validated phase contract'
    else 'the dedicated '
      || pg_catalog.replace(expected_runtime_kind, '_', ' ')
      || ' interaction'
  end;
  expected_primary_generation_path := case
    when requested_route #>> '{approach,executionEnvironment}'
        = 'inside_yova'
      and expected_learning_mode = 'learn'
      and requested_method_id in (
        'self_explanation',
        'worked_example_fading',
        'retrieval_practice'
      ) then 'streamed'
    when requested_route #>> '{approach,executionEnvironment}'
        = 'inside_yova'
      and (
        (
          expected_learning_mode = 'learn'
          and requested_method_id in (
            'self_explanation',
            'worked_example_fading'
          )
        )
        or (
          expected_learning_mode = 'study'
          and requested_method_id in (
            'retrieval_practice',
            'worked_example_fading'
          )
        )
      ) then 'reliable_or_full'
    else 'full'
  end;
  expected_bounded_recovery := case
    when expected_learning_mode = 'learn'
      and requested_method_id in (
        'retrieval_practice',
        'self_explanation',
        'worked_example_fading'
      ) then 'candidate'
    when expected_learning_mode = 'study'
      and requested_route #>> '{approach,executionEnvironment}'
        = 'inside_yova'
      and requested_method_id in (
        'retrieval_practice',
        'spaced_retrieval',
        'worked_example_fading'
      ) then 'candidate'
    else 'none'
  end;
  expected_recovery_description := case expected_bounded_recovery
    when 'candidate'
      then 'A bounded model recovery is possible only when its additional source, target, pacing, and evidence checks also pass.'
    else 'If primary generation fails, YOVA must retry or show recovery instead of relabeling a generic fallback as this method.'
  end;
  expected_runtime_result := expected_primary_generation_path
    || ':' || expected_delivery_kind
    || ':recovery_' || expected_bounded_recovery;
  expected_runtime_reason := 'YOVA can deliver this route through '
    || pg_catalog.replace(expected_primary_generation_path, '_', ' ')
    || ' generation and ' || expected_delivery_description || '. '
    || expected_recovery_description;

  expected_rule_trace := predecessor_rule_trace
    || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'ruleId', 'post_commit_method_choice_v1',
        'result', predecessor_method_id || '->' || requested_method_id,
        'reason', case selection_scope
          when 'other_eligible_method'
            then 'The learner requested an eligible, deliverable method through I''ll Customize Other methods for this exact ready session.'
          else 'The learner changed the exact ready session to one of the bounded methods saved on its committed route.'
        end,
        'evidenceRefs', pg_catalog.jsonb_build_array(
          expected_route_evidence_ref,
          expected_learner_choice_evidence_ref
        )
      )
    );
  if router_was_compacted then
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb('router-component:' || component.value)
        order by component.ordinality
      ),
      '[]'::jsonb
    )
    into compacted_router_evidence_refs
    from pg_catalog.unnest(compacted_router_components)
      with ordinality as component(value, ordinality);
    expected_rule_trace := expected_rule_trace
      || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'ruleId', 'study_route.router_history_compaction_v1',
          'result', 'prior_router_chain_compacted',
          'reason', 'The bounded routerVersion keeps the complete current method and rollout policy set. The exact ordered predecessor router components remain in this trace for audit and rollback.',
          'evidenceRefs', compacted_router_evidence_refs
        )
      );
  end if;
  expected_rule_trace := expected_rule_trace
    || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'ruleId', 'method_decision_evidence_adapter_v2',
        'result', 'authorized_context_applied',
        'reason', 'Only structured learner declarations and exact route-bound outcomes allowed by the learner''s personalization controls entered method routing.',
        'evidenceRefs', '[]'::jsonb
      ),
      pg_catalog.jsonb_build_object(
        'ruleId', 'method_evidence_v1',
        'result', 'thresholded_outcome_evidence',
        'reason', 'Method outcomes can rank an eligible method only after the versioned session, checked-answer, and distinct-study-day evidence minimums are met.',
        'evidenceRefs', '[]'::jsonb
      ),
      pg_catalog.jsonb_build_object(
        'ruleId', 'method_compare_v1',
        'result', 'comparison_context_required',
        'reason', 'Outcome evidence may enter method routing only after the versioned task, stage, mode, environment, difficulty, duration, support, target-relationship, and assessment context matches.',
        'evidenceRefs', '[]'::jsonb
      ),
      expected_eligibility_trace,
      pg_catalog.jsonb_build_object(
        'ruleId', 'canonical_method_selection_v1',
        'result', 'learner_choice:' || requested_method_id,
        'reason', expected_short_reason,
        'evidenceRefs', pg_catalog.jsonb_build_array(
          expected_learner_choice_evidence_ref
        )
      ),
      pg_catalog.jsonb_build_object(
        'ruleId', 'method_runtime_capability_v1',
        'result', expected_runtime_result,
        'reason', expected_runtime_reason,
        'evidenceRefs', '[]'::jsonb
      )
    );
  if predecessor_method_presentation_count = 0 then
    expected_rule_trace := expected_rule_trace
      || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'ruleId', 'method_presentation_v2',
          'result', 'recognizable_method_names',
          'reason', 'Learner-facing method names come from the versioned presentation catalog; method IDs and learning recipes remain unchanged.',
          'evidenceRefs', '[]'::jsonb
        )
      );
  end if;
  expected_rule_trace := expected_rule_trace
    || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'ruleId', 'study_route_agency_mode_controller_v1',
        'result', 'ill_customize:learner_choice:alternatives:' || coalesce(
          pg_catalog.array_to_string(expected_alternative_ids, ','),
          'none'
        ),
        'reason', 'The learner chose this exact route-bound method, so the shared agency controller recorded learner customization and kept at most two eligible, deliverable alternatives.',
        'evidenceRefs', pg_catalog.jsonb_build_array(
          expected_learner_choice_evidence_ref
        )
      ),
      pg_catalog.jsonb_build_object(
        'ruleId', 'study_route.material_successor',
        'result', 'created_provisional_successor',
        'reason', 'The learner changed this ready session from '
          || predecessor_method_name || ' to '
          || expected_method_name || '.',
        'evidenceRefs', '[]'::jsonb
      )
    );

  expected_override_changed_fields := case
    when predecessor_has_blurting_recipe
      then '["primary_method", "method_recipe"]'::jsonb
    else '["primary_method"]'::jsonb
  end;
  if requested_route #>> '{agency,controlMode}'
      is distinct from 'learner_customizes'
    or requested_route #>> '{agency,selectedBy}'
      is distinct from 'learner'
    or requested_route #> '{agency,override,changedFields}'
      is distinct from expected_override_changed_fields
    or requested_route #>> '{agency,override,requestedAt}'
      is distinct from requested_route #>> '{identity,createdAt}'
    or requested_route #>> '{agency,override,reason}'
      is distinct from expected_short_reason
    or requested_route #>> '{explanation,shortReason}'
      is distinct from expected_short_reason
    or requested_route #> '{explanation,taskRequirements}'
      is distinct from expected_task_requirements
    or requested_route #> '{explanation,learnerDeclarations}'
      is distinct from expected_learner_declarations
    or requested_route #> '{explanation,observations}'
      is distinct from expected_observations
    or requested_route #> '{explanation,uncertainties}'
      is distinct from expected_uncertainties
    or requested_route #>> '{provenance,routerVersion}'
      is distinct from expected_router_version
    or requested_route #> '{provenance,evidenceRefs}'
      is distinct from expected_evidence_refs
    or requested_rule_trace is distinct from expected_rule_trace then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_agency_conflict';
  end if;

  perform public.assert_study_route_successor_material_change(
    requested_route,
    requested_plan.id,
    requested_session.id
  );

  if requested_session.committed_route_revision_id
      = requested_route_revision_id then
    -- Exact replay is checked before all mutable work-state gates. The private
    -- commit helper verifies the full receipt and never clears saved work.
    perform public.commit_study_route_revision(requested_route);
    perform public.assert_committed_study_route_projection(
      requested_route,
      requested_plan.id,
      requested_session.id
    );
    response_status := 'replayed';
  else
    if requested_session.committed_route_revision_id
        is distinct from expected_route_revision_id
      or predecessor_route.lifecycle <> 'committed' then
      raise exception using
        errcode = '55000',
        message = 'post_commit_method_choice_stale_revision';
    end if;

    if requested_plan.status <> 'active' then
      raise exception using
        errcode = '55000',
        message = 'post_commit_method_choice_plan_inactive';
    end if;
    if requested_session.status <> 'ready' then
      raise exception using
        errcode = '55000',
        message = 'post_commit_method_choice_session_not_ready';
    end if;
    if requested_session.step_data ->> 'reviewType' in (
        'repair_and_retrieve',
        'verify',
        'maintenance_transfer'
      )
      or nullif(
        pg_catalog.btrim(
          requested_session.step_data ->> 'reviewConcept'
        ),
        ''
      ) is not null
      or predecessor_route.route_payload #>> '{timing,durationSource}'
        = 'scheduled_review' then
      raise exception using
        errcode = '55000',
        message = 'post_commit_method_choice_review_protected';
    end if;
    if requested_session.step_data ? 'activeSessionCheckpoint'
      or requested_session.step_data ? 'generatedSession'
      or exists (
        select 1
        from public.learning_events as event
        where event.user_id = current_user_id
          and event.plan_session_id = requested_session.id
          and event.event_type = 'session_interrupted'
      )
      or exists (
        select 1
        from public.session_attempts as attempt
        where attempt.user_id = current_user_id
          and attempt.plan_session_id = requested_session.id
      ) then
      raise exception using
        errcode = '55000',
        message = 'post_commit_method_choice_saved_work_protected';
    end if;

    perform public.persist_study_route_scalar_projection(
      requested_plan.id,
      requested_session.id,
      requested_route
    );
    perform public.commit_study_route_revision(requested_route);
    perform public.assert_committed_study_route_projection(
      requested_route,
      requested_plan.id,
      requested_session.id
    );
  end if;

  select session.*
  into requested_session
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.plan_id = requested_plan_id
    and session.user_id = current_user_id;

  select route.*
  into existing_route
  from public.study_routes as route
  where route.route_revision_id = requested_route_revision_id
    and route.plan_id = requested_plan_id
    and route.plan_session_id = requested_session_id
    and route.user_id = current_user_id
    and route.lifecycle = 'committed';

  if requested_session.id is null
    or existing_route.route_revision_id is null
    or requested_session.committed_route_revision_id
      is distinct from existing_route.route_revision_id then
    raise exception using
      errcode = '55000',
      message = 'post_commit_method_choice_readback_failed';
  end if;

  canonical_route := pg_catalog.jsonb_build_object(
    'identity',
    pg_catalog.jsonb_build_object(
      'routeLineageId', existing_route.route_lineage_id,
      'routeRevisionId', existing_route.route_revision_id,
      'revisionNumber', existing_route.revision_number,
      'schemaVersion', existing_route.schema_version,
      'lifecycleStatus', existing_route.lifecycle,
      'planId', existing_route.plan_id,
      'sessionId', existing_route.plan_session_id,
      'createdAt', existing_route.created_at,
      'committedAt', existing_route.committed_at,
      'supersedesRevisionId', existing_route.predecessor_revision_id
    )
  ) || existing_route.route_payload;

  return pg_catalog.jsonb_build_object(
    'status', response_status,
    'planId', requested_plan.id,
    'planSessionId', requested_session.id,
    'previousRouteRevisionId', expected_route_revision_id,
    'session', pg_catalog.jsonb_build_object(
      'id', requested_session.id,
      'method', requested_session.method,
      'methodReason', requested_session.method_rationale,
      'estimatedMinutes', requested_session.estimated_minutes,
      'studyRoute', canonical_route
    )
  );
end;
$$;

revoke all on function
  public.change_plan_session_method_with_route_v2(jsonb)
from public, anon, authenticated, service_role;

-- Keep the public RPC signature stable. Version markers choose the additive
-- implementation; an attempt to strip those markers from a v2 predecessor is
-- still rejected by the legacy function's exact policy/trace comparison.
create or replace function public.change_plan_session_method_with_route(
  payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  requested_route jsonb := payload -> 'successorStudyRoute';
  use_versioned_path boolean := false;
begin
  use_versioned_path :=
    pg_catalog.strpos(
      coalesce(
        requested_route #>> '{provenance,routerVersion}',
        ''
      ),
      'study_route_agency_mode_controller_v1'
    ) > 0
    or pg_catalog.strpos(
      coalesce(
        requested_route #>> '{provenance,routerVersion}',
        ''
      ),
      'method_presentation_v2'
    ) > 0
    or requested_route #>> '{approach,primaryMethodId}' in (
      'pretesting',
      'concept_mapping',
      'practice_problems'
    )
    or requested_route #>> '{approach,visibleMethodName}' in (
      'Feynman Technique',
      'SQ3R'
    );

  if use_versioned_path then
    return public.change_plan_session_method_with_route_v2(payload);
  end if;
  return public.change_plan_session_method_with_route_legacy_v1(payload);
end;
$$;

revoke all on function public.change_plan_session_method_with_route(jsonb)
from public, anon, authenticated, service_role;
grant execute on function
  public.change_plan_session_method_with_route(jsonb)
to authenticated;

comment on function public.assert_study_route_payload_v1(jsonb) is
  'Validates the 12-method/Feynman/SQ3R route catalog null-safely, then delegates structural validation through a private legacy adapter.';
comment on function
  public.change_plan_session_method_with_route_v2(jsonb) is
  'Private exact-choice writer for versioned agency routes; alternatives can rotate only inside the immutable predecessor choice set.';
comment on function public.change_plan_session_method_with_route(jsonb) is
  'Stable authenticated adapter for legacy and versioned post-commit method choice implementations.';

-- Deployment tooling must not certify an application release against the
-- earlier 300001 contract after expanded methods and the versioned agency
-- writer become required. Keep v1 intact for older clients and expose a new,
-- service-only, read-only capability contract for this migration head.
create or replace function public.signed_in_generation_readiness_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_readiness jsonb;
  expanded_method_agency_ready boolean;
  result_ready boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'signed_in_generation_readiness_service_role_required';
  end if;

  base_readiness := public.signed_in_generation_readiness_v1();
  expanded_method_agency_ready :=
    pg_catalog.to_regprocedure(
      'public.assert_study_route_method_catalog_v2(jsonb)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.assert_study_route_payload_v1(jsonb)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.change_plan_session_method_with_route_v2(jsonb)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.change_plan_session_method_with_route(jsonb)'
    ) is not null
    and coalesce(
      pg_catalog.has_function_privilege(
        'authenticated',
        'public.change_plan_session_method_with_route(jsonb)',
        'execute'
      ),
      false
    )
    and not coalesce(
      pg_catalog.has_function_privilege(
        'anon',
        'public.change_plan_session_method_with_route(jsonb)',
        'execute'
      ),
      false
    )
    and not coalesce(
      pg_catalog.has_function_privilege(
        'authenticated',
        'public.change_plan_session_method_with_route_v2(jsonb)',
        'execute'
      ),
      false
    )
    and not coalesce(
      pg_catalog.has_function_privilege(
        'service_role',
        'public.assert_study_route_method_catalog_v2(jsonb)',
        'execute'
      ),
      false
    )
    and pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(
          'public.assert_study_route_payload_v1(jsonb)'
        )::oid
      ),
      'assert_study_route_method_catalog_v2'
    ) > 0
    and pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(
          'public.change_plan_session_method_with_route(jsonb)'
        )::oid
      ),
      'change_plan_session_method_with_route_v2'
    ) > 0;

  result_ready := coalesce(
    (base_readiness ->> 'ready')::boolean,
    false
  ) and expanded_method_agency_ready;

  return pg_catalog.jsonb_build_object(
    'contractVersion', '202608300003',
    'ready', result_ready,
    'studyRoutesSchema', coalesce(
      (base_readiness ->> 'studyRoutesSchema')::boolean,
      false
    ),
    'planSessionsRoutePointer', coalesce(
      (base_readiness ->> 'planSessionsRoutePointer')::boolean,
      false
    ),
    'requiredRouteRpcs', coalesce(
      (base_readiness ->> 'requiredRouteRpcs')::boolean,
      false
    ),
    'expandedMethodAgencyBoundary', expanded_method_agency_ready
  );
end;
$$;

revoke all on function public.signed_in_generation_readiness_v2()
from public, anon, authenticated, service_role;
grant execute on function public.signed_in_generation_readiness_v2()
to service_role;

comment on function public.signed_in_generation_readiness_v2() is
  'Read-only release gate for signed-in StudyRoutes, expanded methods, and the versioned agency writer through migration 202608300003.';

notify pgrst, 'reload schema';

commit;
