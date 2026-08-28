-- Let a learner change one already-committed, untouched session method without
-- turning a one-session choice into a whole-plan adjustment. The immutable
-- predecessor remains in study_routes; only its direct committed successor
-- becomes the plan-session pointer.

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
  current_user_id uuid := auth.uid();
  requested_plan_id uuid;
  requested_session_id uuid;
  expected_route_revision_id uuid;
  requested_route jsonb := payload -> 'successorStudyRoute';
  requested_route_revision_id uuid;
  requested_predecessor_revision_id uuid;
  requested_method_id text;
  requested_plan public.plans%rowtype;
  requested_session public.plan_sessions%rowtype;
  predecessor_route public.study_routes%rowtype;
  existing_route public.study_routes%rowtype;
  exact_stored_alternative jsonb;
  requested_alternative jsonb;
  requested_phase jsonb;
  requested_phase_ordinality bigint;
  matching_alternative_count integer;
  expected_method_name text;
  expected_legacy_method_name text;
  expected_method_names text[];
  expected_alternative_name text;
  expected_alternative_source_names text[];
  expected_method_phases text[];
  expected_phase_count integer;
  expected_phase_minutes integer;
  expected_active_minutes integer;
  expected_activity_limit integer;
  expected_active_target_ids jsonb;
  expected_short_reason text;
  expected_route_evidence_ref text;
  expected_learner_choice_evidence_ref text;
  expected_evidence_refs jsonb;
  predecessor_method_id text;
  predecessor_method_name text;
  predecessor_method_names text[];
  expected_task_type text;
  expected_knowledge_stage text;
  expected_learning_mode text;
  expected_mode_label text;
  expected_eligible_method_ids text[];
  expected_eligible_method_names text[] := '{}'::text[];
  expected_alternative_method_ids text[];
  requested_alternative_method_ids text[];
  eligible_method_id text;
  eligible_method_name text;
  expected_method_requirement text;
  predecessor_method_requirement text;
  explanation_item text;
  expected_task_requirements jsonb := '[]'::jsonb;
  expected_learner_declarations jsonb := '[]'::jsonb;
  expected_observations jsonb := '[]'::jsonb;
  expected_uncertainties jsonb := '[]'::jsonb;
  router_component text;
  expected_router_components text[] := '{}'::text[];
  expected_router_version text;
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
        'successorStudyRoute'
      )
    )
    or pg_catalog.jsonb_typeof(requested_route) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_shape_invalid';
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
    requested_method_id := requested_route #>> '{approach,primaryMethodId}';
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_identity_invalid';
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
      message = 'post_commit_method_choice_identity_invalid';
  end if;

  -- Share the account -> plan -> ordered sessions -> route order used by every
  -- route-aware writer. The advisory lock also serializes cache, checkpoint,
  -- completion, interruption, adjustment, archive, reset, and deletion writes.
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
      errcode = '40001',
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

  -- Validate the direct-successor identity and method recipe even for a
  -- replay. A matching pointer alone is not an idempotency receipt: the exact
  -- stored route payload/fingerprint is verified later by the private commit
  -- function's replay branch.
  perform public.validate_study_route_write_identity(
    requested_route,
    requested_plan.id,
    requested_session.id,
    expected_route_revision_id,
    false
  );
  perform public.assert_study_route_payload_v1(requested_route - 'identity');

  expected_method_name := case requested_method_id
    when 'retrieval_practice' then 'Active Recall'
    when 'spaced_retrieval' then 'Spaced Repetition'
    when 'self_explanation' then 'Self-explanation'
    when 'worked_example_fading' then 'Worked Examples'
    when 'interleaved_practice' then 'Interleaving'
    when 'read_recall_review' then 'Read-recall-review'
    when 'retrieval_based_outlining' then 'Outline from Memory'
    when 'scaffolded_coding' then 'Trace–Code–Test'
    when 'practice_test_error_repair' then 'Practice Tests'
    else null
  end;
  expected_legacy_method_name := case requested_method_id
    when 'retrieval_practice' then 'Retrieval practice'
    when 'spaced_retrieval' then 'Spaced retrieval'
    when 'worked_example_fading' then 'Worked example fading'
    when 'interleaved_practice' then 'Interleaved practice'
    when 'retrieval_based_outlining' then 'Retrieval-based outlining'
    when 'scaffolded_coding' then 'Scaffolded coding with fading'
    when 'practice_test_error_repair'
      then 'Practice test and error repair'
    else expected_method_name
  end;
  expected_method_names := array[
    expected_method_name,
    expected_legacy_method_name
  ]::text[];
  expected_short_reason := 'You chose ' || expected_method_name
    || ' from the methods that fit this session.';
  expected_route_evidence_ref := 'route-revision:'
    || expected_route_revision_id::text;
  expected_learner_choice_evidence_ref := 'learner-choice:committed-route:'
    || requested_plan.id::text
    || ':' || requested_session.id::text
    || ':' || expected_route_revision_id::text
    || ':' || requested_method_id;
  expected_evidence_refs := '[]'::jsonb;
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
    @> pg_catalog.jsonb_build_array(expected_learner_choice_evidence_ref)
  ) then
    expected_evidence_refs := expected_evidence_refs
      || pg_catalog.jsonb_build_array(expected_learner_choice_evidence_ref);
  end if;

  if requested_route #>> '{identity,routeLineageId}'
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
    or requested_method_id is null
    or expected_method_name is null
    or requested_method_id
      is not distinct from predecessor_route.route_payload
        #>> '{approach,primaryMethodId}'
    or requested_route #>> '{approach,visibleMethodName}'
      is distinct from expected_method_name
    or requested_route #>> '{identity,createdAt}'
      is distinct from requested_route #>> '{identity,committedAt}' then
    raise exception using
      errcode = '40001',
      message = 'post_commit_method_choice_successor_invalid';
  end if;

  select alternative.value
  into exact_stored_alternative
  from pg_catalog.jsonb_array_elements(
    predecessor_route.route_payload #> '{agency,alternatives}'
  ) as alternative(value)
  where alternative.value ->> 'primaryMethodId' = requested_method_id
    and alternative.value ->> 'mode'
      = requested_route #>> '{approach,mode}'
    and alternative.value ->> 'executionEnvironment'
      = requested_route #>> '{approach,executionEnvironment}'
    and alternative.value ->> 'visibleMethodName'
      = any(expected_method_names)
    and (alternative.value ->> 'activeMinutes')::integer
      = (requested_route #>> '{timing,activeMinutes}')::integer
  limit 1;

  if exact_stored_alternative is null
    or exact_stored_alternative ->> 'alternativeId'
      is distinct from 'method-alternative:' || requested_method_id
    or not (
      exact_stored_alternative ->> 'visibleMethodName'
        = any(expected_method_names)
    )
    or exact_stored_alternative ->> 'tradeoff'
      is distinct from (
        (exact_stored_alternative ->> 'visibleMethodName')
          || ' also fits this task and stage, but it would use a different practice sequence.'
      ) then
    raise exception using
      errcode = '40001',
      message = 'post_commit_method_choice_not_offered';
  end if;

  if pg_catalog.jsonb_array_length(
      requested_route #> '{agency,alternatives}'
    ) <> pg_catalog.jsonb_array_length(
      predecessor_route.route_payload #> '{agency,alternatives}'
    ) then
    raise exception using
      errcode = '40001',
      message = 'post_commit_method_choice_alternative_conflict';
  end if;

  -- A method choice may replace only the named method and its executable phase
  -- skeleton. Targets, source boundary, mode, environment, timing, difficulty,
  -- support, completion evidence, and review contract remain immutable.
  if requested_route -> 'target'
      is distinct from predecessor_route.route_payload -> 'target'
    or requested_route -> 'timing'
      is distinct from predecessor_route.route_payload -> 'timing'
    or (requested_route -> 'approach')
        - 'primaryMethodId' - 'visibleMethodName'
      is distinct from (
        predecessor_route.route_payload -> 'approach'
      ) - 'primaryMethodId' - 'visibleMethodName'
    or (requested_route -> 'execution')
        - 'orderedPhases' - 'activityLimit'
      is distinct from (
        predecessor_route.route_payload -> 'execution'
      ) - 'orderedPhases' - 'activityLimit'
    or requested_route #>> '{provenance,profileVersion}'
      is distinct from predecessor_route.route_payload
        #>> '{provenance,profileVersion}' then
    raise exception using
      errcode = '40001',
      message = 'post_commit_method_choice_scope_conflict';
  end if;

  expected_method_phases := case requested_method_id
    when 'retrieval_practice'
      then array['retrieve', 'repair']::text[]
    when 'spaced_retrieval'
      then array['retrieve', 'schedule_return']::text[]
    when 'self_explanation'
      then array['model', 'explain']::text[]
    when 'worked_example_fading'
      then array['model', 'guided_practice', 'independent_practice']::text[]
    when 'interleaved_practice'
      then array['discriminate', 'independent_practice']::text[]
    when 'read_recall_review' then case
      when requested_route #>> '{approach,mode}' = 'practice'
        then array['retrieve', 'read_source', 'transfer']::text[]
      else array['read_source', 'retrieve', 'repair']::text[]
    end
    when 'retrieval_based_outlining'
      then array['retrieve', 'evidence_match', 'independent_practice']::text[]
    when 'scaffolded_coding'
      then array['code_trace', 'guided_practice', 'independent_practice']::text[]
    when 'practice_test_error_repair'
      then array['retrieve', 'repair', 'transfer']::text[]
    else null
  end;
  if requested_route #>> '{approach,mode}' = 'learn'
    and not ('model' = any(expected_method_phases)) then
    expected_method_phases := pg_catalog.array_prepend(
      'model'::text,
      expected_method_phases
    );
  end if;

  expected_phase_count := pg_catalog.array_length(expected_method_phases, 1);
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

  -- Reproduce the current hard-coded method router at the database trust
  -- boundary. The authenticated RPC may choose an offered method, but it may
  -- not forge a wider eligible set, a different explanation, or false router
  -- provenance around that choice.
  expected_task_type := predecessor_route.route_payload
    #>> '{target,taskFamily}';
  expected_learning_mode := case
    when predecessor_route.route_payload #>> '{approach,mode}' = 'learn'
      then 'learn'
    else 'study'
  end;
  expected_mode_label := case expected_learning_mode
    when 'learn' then 'Learn'
    else 'Practice'
  end;
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

  -- Immutable snapshot of method_eligibility_v1. Every current context has at
  -- most three eligible methods, matching the helper's two-alternative slice.
  -- A later eligibility or alternative-count change needs a replacement
  -- migration rather than silently changing this committed trust boundary.
  expected_eligible_method_ids := case
    expected_learning_mode || ':' || expected_task_type || ':'
      || expected_knowledge_stage
    when 'study:memorization:novice'
      then array['retrieval_practice', 'spaced_retrieval']::text[]
    when 'study:memorization:developing'
      then array[
        'retrieval_practice',
        'spaced_retrieval',
        'interleaved_practice'
      ]::text[]
    when 'study:memorization:retrieval_ready'
      then array[
        'practice_test_error_repair',
        'spaced_retrieval',
        'interleaved_practice'
      ]::text[]
    when 'study:conceptual_learning:novice'
      then array[
        'self_explanation',
        'read_recall_review',
        'retrieval_practice'
      ]::text[]
    when 'study:conceptual_learning:developing'
      then array[
        'self_explanation',
        'retrieval_practice',
        'spaced_retrieval'
      ]::text[]
    when 'study:conceptual_learning:retrieval_ready'
      then array['retrieval_practice', 'spaced_retrieval']::text[]
    when 'study:problem_solving:novice'
      then array['worked_example_fading', 'self_explanation']::text[]
    when 'study:problem_solving:developing'
      then array[
        'worked_example_fading',
        'interleaved_practice',
        'practice_test_error_repair'
      ]::text[]
    when 'study:problem_solving:retrieval_ready'
      then array[
        'interleaved_practice',
        'practice_test_error_repair'
      ]::text[]
    when 'study:reading_to_quiz:novice'
      then array[
        'read_recall_review',
        'self_explanation',
        'retrieval_practice'
      ]::text[]
    when 'study:reading_to_quiz:developing'
      then array[
        'read_recall_review',
        'retrieval_practice',
        'spaced_retrieval'
      ]::text[]
    when 'study:reading_to_quiz:retrieval_ready'
      then array[
        'practice_test_error_repair',
        'retrieval_practice',
        'spaced_retrieval'
      ]::text[]
    when 'study:writing_argumentation:novice'
      then array['retrieval_based_outlining']::text[]
    when 'study:writing_argumentation:developing'
      then array['retrieval_based_outlining']::text[]
    when 'study:writing_argumentation:retrieval_ready'
      then array['retrieval_based_outlining']::text[]
    when 'study:programming:novice'
      then array['scaffolded_coding', 'worked_example_fading']::text[]
    when 'study:programming:developing'
      then array['scaffolded_coding', 'interleaved_practice']::text[]
    when 'study:programming:retrieval_ready'
      then array['interleaved_practice', 'scaffolded_coding']::text[]
    when 'study:mixed_assessment:novice'
      then array['self_explanation', 'retrieval_practice']::text[]
    when 'study:mixed_assessment:developing'
      then array[
        'retrieval_practice',
        'interleaved_practice',
        'practice_test_error_repair'
      ]::text[]
    when 'study:mixed_assessment:retrieval_ready'
      then array[
        'practice_test_error_repair',
        'spaced_retrieval',
        'interleaved_practice'
      ]::text[]
    when 'learn:memorization:novice'
      then array['retrieval_practice']::text[]
    when 'learn:memorization:developing'
      then array['retrieval_practice']::text[]
    when 'learn:memorization:retrieval_ready'
      then array['retrieval_practice']::text[]
    when 'learn:conceptual_learning:novice'
      then array['self_explanation', 'read_recall_review']::text[]
    when 'learn:conceptual_learning:developing'
      then array['self_explanation']::text[]
    when 'learn:conceptual_learning:retrieval_ready'
      then array['self_explanation', 'read_recall_review']::text[]
    when 'learn:problem_solving:novice'
      then array['worked_example_fading', 'self_explanation']::text[]
    when 'learn:problem_solving:developing'
      then array['worked_example_fading']::text[]
    when 'learn:problem_solving:retrieval_ready'
      then array['worked_example_fading', 'self_explanation']::text[]
    when 'learn:reading_to_quiz:novice'
      then array['read_recall_review', 'self_explanation']::text[]
    when 'learn:reading_to_quiz:developing'
      then array['read_recall_review']::text[]
    when 'learn:reading_to_quiz:retrieval_ready'
      then array['read_recall_review', 'self_explanation']::text[]
    when 'learn:writing_argumentation:novice'
      then array['retrieval_based_outlining']::text[]
    when 'learn:writing_argumentation:developing'
      then array['retrieval_based_outlining']::text[]
    when 'learn:writing_argumentation:retrieval_ready'
      then array['retrieval_based_outlining']::text[]
    when 'learn:programming:novice'
      then array['scaffolded_coding', 'worked_example_fading']::text[]
    when 'learn:programming:developing'
      then array['scaffolded_coding']::text[]
    when 'learn:programming:retrieval_ready'
      then array['scaffolded_coding']::text[]
    when 'learn:mixed_assessment:novice'
      then array['self_explanation']::text[]
    when 'learn:mixed_assessment:developing'
      then array['self_explanation']::text[]
    when 'learn:mixed_assessment:retrieval_ready'
      then array['self_explanation']::text[]
    else null
  end;

  predecessor_method_id := predecessor_route.route_payload
    #>> '{approach,primaryMethodId}';
  predecessor_method_name := predecessor_route.route_payload
    #>> '{approach,visibleMethodName}';
  predecessor_method_names := case predecessor_method_id
    when 'retrieval_practice'
      then array['Active Recall', 'Retrieval practice']::text[]
    when 'spaced_retrieval'
      then array['Spaced Repetition', 'Spaced retrieval']::text[]
    when 'self_explanation' then array['Self-explanation']::text[]
    when 'worked_example_fading'
      then array['Worked Examples', 'Worked example fading']::text[]
    when 'interleaved_practice'
      then array['Interleaving', 'Interleaved practice']::text[]
    when 'read_recall_review' then array['Read-recall-review']::text[]
    when 'retrieval_based_outlining'
      then array['Outline from Memory', 'Retrieval-based outlining']::text[]
    when 'scaffolded_coding'
      then array['Trace–Code–Test', 'Scaffolded coding with fading']::text[]
    when 'practice_test_error_repair'
      then array['Practice Tests', 'Practice test and error repair']::text[]
    else null
  end;
  if expected_knowledge_stage is null
    or expected_eligible_method_ids is null
    or predecessor_method_names is null
    or predecessor_method_name is null
    or not (predecessor_method_name = any(predecessor_method_names))
    or not (requested_method_id = any(expected_eligible_method_ids)) then
    raise exception using
      errcode = '40001',
      message = 'post_commit_method_choice_policy_conflict';
  end if;

  foreach eligible_method_id in array expected_eligible_method_ids
  loop
    eligible_method_name := case eligible_method_id
      when 'retrieval_practice' then 'Active Recall'
      when 'spaced_retrieval' then 'Spaced Repetition'
      when 'self_explanation' then 'Self-explanation'
      when 'worked_example_fading' then 'Worked Examples'
      when 'interleaved_practice' then 'Interleaving'
      when 'read_recall_review' then 'Read-recall-review'
      when 'retrieval_based_outlining' then 'Outline from Memory'
      when 'scaffolded_coding' then 'Trace–Code–Test'
      when 'practice_test_error_repair'
        then 'Practice Tests'
      else null
    end;
    expected_eligible_method_names := pg_catalog.array_append(
      expected_eligible_method_names,
      eligible_method_name
    );
  end loop;

  select coalesce(
    pg_catalog.array_agg(candidate.method_id order by candidate.ordinality),
    '{}'::text[]
  )
  into expected_alternative_method_ids
  from pg_catalog.unnest(expected_eligible_method_ids)
    with ordinality as candidate(method_id, ordinality)
  where candidate.method_id <> requested_method_id;

  select coalesce(
    pg_catalog.array_agg(
      alternative.value ->> 'primaryMethodId'
      order by alternative.ordinality
    ),
    '{}'::text[]
  )
  into requested_alternative_method_ids
  from pg_catalog.jsonb_array_elements(
    requested_route #> '{agency,alternatives}'
  ) with ordinality as alternative(value, ordinality);

  if requested_alternative_method_ids
      is distinct from expected_alternative_method_ids then
    raise exception using
      errcode = '40001',
      message = 'post_commit_method_choice_alternative_conflict';
  end if;

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
      predecessor_route.route_payload #> '{explanation,learnerDeclarations}'
    ) as item(value)
  loop
    if explanation_item is distinct from predecessor_route.route_payload
        #>> '{explanation,shortReason}'
      and pg_catalog.jsonb_array_length(expected_learner_declarations) < 10
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

  select pg_catalog.count(*)::integer
  into predecessor_method_presentation_count
  from pg_catalog.jsonb_array_elements(
    predecessor_route.route_payload #> '{provenance,ruleTrace}'
  ) as trace(value)
  where trace.value ->> 'ruleId' = 'method_presentation_v1';
  if predecessor_method_presentation_count > 1
    or (
      predecessor_method_presentation_count = 1
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          predecessor_route.route_payload #> '{provenance,ruleTrace}'
        ) as trace(value)
        where trace.value ->> 'ruleId' = 'method_presentation_v1'
          and trace.value ->> 'result' = 'recognizable_method_names'
          and trace.value ->> 'reason'
            = 'Learner-facing method names come from the versioned presentation catalog; method IDs and learning recipes remain unchanged.'
          and trace.value -> 'evidenceRefs' = '[]'::jsonb
      )
    ) then
    raise exception using
      errcode = '40001',
      message = 'post_commit_method_choice_policy_conflict';
  end if;

  foreach router_component in array pg_catalog.string_to_array(
    predecessor_route.route_payload #>> '{provenance,routerVersion}',
    '+'
  )
  loop
    if router_component <> ''
      and router_component <> 'study_route_method_plan_integration_v1'
      and router_component <> 'method_runtime_capability_v1'
      and router_component <> 'method_presentation_v1'
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
      errcode = '40001',
      message = 'post_commit_method_choice_policy_conflict';
  end if;
  expected_router_version := pg_catalog.array_to_string(
    expected_router_components,
    '+'
  ) || '+study_route_method_plan_integration_v1'
    || '+method_runtime_capability_v1'
    || '+method_presentation_v1';

  expected_runtime_kind := case requested_method_id
    when 'retrieval_practice' then 'retrieval_round'
    when 'spaced_retrieval' then 'retrieval_round'
    when 'worked_example_fading' then 'worked_example'
    when 'practice_test_error_repair' then 'error_repair'
    else null
  end;
  expected_delivery_kind := case
    when expected_runtime_kind is null then 'validated_phase_contract'
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
    when requested_route #>> '{approach,executionEnvironment}' = 'inside_yova'
      and expected_learning_mode = 'learn'
      and requested_method_id in (
        'self_explanation',
        'worked_example_fading',
        'retrieval_practice'
      ) then 'streamed'
    when requested_route #>> '{approach,executionEnvironment}' = 'inside_yova'
      and (
        (expected_learning_mode = 'learn' and requested_method_id in (
          'self_explanation',
          'worked_example_fading'
        ))
        or (expected_learning_mode = 'study' and requested_method_id in (
          'retrieval_practice',
          'worked_example_fading'
        ))
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
      and requested_route #>> '{approach,executionEnvironment}' = 'inside_yova'
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

  expected_rule_trace := (
    predecessor_route.route_payload #> '{provenance,ruleTrace}'
  )
    || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'ruleId', 'post_commit_method_choice_v1',
        'result', predecessor_method_id || '->' || requested_method_id,
        'reason', 'The learner changed the exact ready session to one of the bounded methods saved on its committed route.',
        'evidenceRefs', pg_catalog.jsonb_build_array(
          expected_route_evidence_ref,
          expected_learner_choice_evidence_ref
        )
      ),
      pg_catalog.jsonb_build_object(
        'ruleId', 'method_decision_evidence_adapter_v1',
        'result', 'authorized_context_applied',
        'reason', 'Only structured learner declarations and exact route-bound outcomes allowed by the learner''s personalization controls entered method routing.',
        'evidenceRefs', '[]'::jsonb
      ),
      pg_catalog.jsonb_build_object(
        'ruleId', 'method_eligibility_v1',
        'result', pg_catalog.array_to_string(
          expected_eligible_method_ids,
          ','
        ),
        'reason', 'Task, knowledge stage, and ' || expected_mode_label
          || ' mode limited selection to '
          || pg_catalog.array_to_string(expected_eligible_method_names, ', ')
          || '.',
        'evidenceRefs', '[]'::jsonb
      ),
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
          'ruleId', 'method_presentation_v1',
          'result', 'recognizable_method_names',
          'reason', 'Learner-facing method names come from the versioned presentation catalog; method IDs and learning recipes remain unchanged.',
          'evidenceRefs', '[]'::jsonb
        )
      );
  end if;
  expected_rule_trace := expected_rule_trace
    || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'ruleId', 'study_route.material_successor',
        'result', 'created_provisional_successor',
        'reason', 'The learner changed this ready session from '
          || (
            predecessor_route.route_payload
              #>> '{approach,visibleMethodName}'
          )
          || ' to ' || expected_method_name || '.',
        'evidenceRefs', '[]'::jsonb
      )
    );

  if pg_catalog.jsonb_array_length(
      requested_route #> '{execution,orderedPhases}'
    ) <> expected_phase_count
    or (requested_route #>> '{execution,activityLimit}')::integer
      <> expected_activity_limit then
    raise exception using
      errcode = '40001',
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
        <> expected_phase_minutes
      or requested_phase -> 'targetIds'
        is distinct from expected_active_target_ids then
      raise exception using
        errcode = '40001',
        message = 'post_commit_method_choice_phase_contract_conflict';
    end if;
  end loop;

  if requested_route #>> '{agency,controlMode}'
      is distinct from 'learner_customizes'
    or requested_route #>> '{agency,selectedBy}'
      is distinct from 'learner'
    or requested_route #> '{agency,override,changedFields}'
      is distinct from '["primary_method"]'::jsonb
    or requested_route #>> '{agency,override,requestedAt}'
      is distinct from requested_route #>> '{identity,createdAt}'
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
    or requested_route #>> '{agency,override,reason}'
      is distinct from expected_short_reason
    or requested_route #>> '{provenance,routerVersion}'
      is distinct from expected_router_version
    or requested_route #>> '{provenance,profileVersion}'
      is distinct from predecessor_route.route_payload
        #>> '{provenance,profileVersion}'
    or requested_route #> '{provenance,evidenceRefs}'
      is distinct from expected_evidence_refs
    or requested_route #> '{provenance,ruleTrace}'
      is distinct from expected_rule_trace then
    raise exception using
      errcode = '40001',
      message = 'post_commit_method_choice_agency_conflict';
  end if;

  -- Successor alternatives may rotate only within the choice set already
  -- committed on the predecessor (plus its former primary for reversibility).
  for requested_alternative in
    select alternative.value
    from pg_catalog.jsonb_array_elements(
      requested_route #> '{agency,alternatives}'
    ) as alternative(value)
  loop
    expected_alternative_name := case
      requested_alternative ->> 'primaryMethodId'
      when 'retrieval_practice' then 'Active Recall'
      when 'spaced_retrieval' then 'Spaced Repetition'
      when 'self_explanation' then 'Self-explanation'
      when 'worked_example_fading' then 'Worked Examples'
      when 'interleaved_practice' then 'Interleaving'
      when 'read_recall_review' then 'Read-recall-review'
      when 'retrieval_based_outlining' then 'Outline from Memory'
      when 'scaffolded_coding' then 'Trace–Code–Test'
      when 'practice_test_error_repair'
        then 'Practice Tests'
      else null
    end;
    expected_alternative_source_names := case
      requested_alternative ->> 'primaryMethodId'
      when 'retrieval_practice'
        then array['Active Recall', 'Retrieval practice']::text[]
      when 'spaced_retrieval'
        then array['Spaced Repetition', 'Spaced retrieval']::text[]
      when 'self_explanation' then array['Self-explanation']::text[]
      when 'worked_example_fading'
        then array['Worked Examples', 'Worked example fading']::text[]
      when 'interleaved_practice'
        then array['Interleaving', 'Interleaved practice']::text[]
      when 'read_recall_review' then array['Read-recall-review']::text[]
      when 'retrieval_based_outlining'
        then array['Outline from Memory', 'Retrieval-based outlining']::text[]
      when 'scaffolded_coding'
        then array['Trace–Code–Test', 'Scaffolded coding with fading']::text[]
      when 'practice_test_error_repair'
        then array['Practice Tests', 'Practice test and error repair']::text[]
      else null
    end;
    if expected_alternative_name is null
      or expected_alternative_source_names is null
      or requested_alternative ->> 'alternativeId'
        is distinct from 'method-alternative:'
          || (requested_alternative ->> 'primaryMethodId')
      or requested_alternative ->> 'visibleMethodName'
        is distinct from expected_alternative_name
      or requested_alternative ->> 'tradeoff'
        is distinct from expected_alternative_name
          || ' also fits this task and stage, but it would use a different practice sequence.' then
      raise exception using
        errcode = '40001',
        message = 'post_commit_method_choice_alternative_conflict';
    end if;

    select pg_catalog.count(*)::integer
    into matching_alternative_count
    from (
      select
        predecessor_route.route_payload #>> '{approach,mode}' as mode,
        predecessor_route.route_payload
          #>> '{approach,executionEnvironment}' as execution_environment,
        predecessor_route.route_payload
          #>> '{approach,primaryMethodId}' as primary_method_id,
        predecessor_route.route_payload
          #>> '{approach,visibleMethodName}' as visible_method_name,
        null::text as alternative_id,
        null::text as tradeoff,
        (predecessor_route.route_payload
          #>> '{timing,activeMinutes}')::integer as active_minutes
      union all
      select
        alternative.value ->> 'mode',
        alternative.value ->> 'executionEnvironment',
        alternative.value ->> 'primaryMethodId',
        alternative.value ->> 'visibleMethodName',
        alternative.value ->> 'alternativeId',
        alternative.value ->> 'tradeoff',
        (alternative.value ->> 'activeMinutes')::integer
      from pg_catalog.jsonb_array_elements(
        predecessor_route.route_payload #> '{agency,alternatives}'
      ) as alternative(value)
    ) as allowed(
      mode,
      execution_environment,
      primary_method_id,
      visible_method_name,
      alternative_id,
      tradeoff,
      active_minutes
    )
    where allowed.mode = requested_alternative ->> 'mode'
      and allowed.execution_environment
        = requested_alternative ->> 'executionEnvironment'
      and allowed.primary_method_id
        = requested_alternative ->> 'primaryMethodId'
      and allowed.visible_method_name
        = any(expected_alternative_source_names)
      and (
        (
          allowed.alternative_id is null
          and allowed.tradeoff is null
        )
        or (
          allowed.alternative_id = 'method-alternative:'
            || allowed.primary_method_id
          and allowed.tradeoff = (
            allowed.visible_method_name
              || ' also fits this task and stage, but it would use a different practice sequence.'
          )
        )
      )
      and allowed.active_minutes
        = (requested_alternative ->> 'activeMinutes')::integer;

    if matching_alternative_count <> 1 then
      raise exception using
        errcode = '40001',
        message = 'post_commit_method_choice_alternative_conflict';
    end if;
  end loop;

  perform public.assert_study_route_successor_material_change(
    requested_route,
    requested_plan.id,
    requested_session.id
  );

  if requested_session.committed_route_revision_id
      = requested_route_revision_id then
    -- `commit_study_route_revision` compares the submitted identity, payload
    -- fingerprint, ownership, predecessor, timestamps, and current pointer.
    -- Its exact-replay branch also deliberately permits a later checkpoint or
    -- terminal status. Nothing below this branch may clear successor work.
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
        errcode = '40001',
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
        pg_catalog.btrim(requested_session.step_data ->> 'reviewConcept'),
        ''
      ) is not null
      or predecessor_route.route_payload #>> '{timing,durationSource}'
        = 'scheduled_review' then
      raise exception using
        errcode = '55000',
        message = 'post_commit_method_choice_review_protected';
    end if;

    -- A route must never change underneath generated content or learner work.
    -- In particular, deleting generatedSession would fire the mature trigger
    -- that also clears activeSessionCheckpoint, so both are rejected rather
    -- than invalidated here.
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

revoke all on function public.change_plan_session_method_with_route(jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.change_plan_session_method_with_route(jsonb)
to authenticated;

comment on function public.change_plan_session_method_with_route(jsonb) is
  'Commits one exact learner-chosen method successor for an untouched ready session and returns the authoritative route projection.';
