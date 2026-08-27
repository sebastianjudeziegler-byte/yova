-- Add storage compatibility for the disabled Blurting recipe without widening
-- authenticated issuance. Migration 002 owns the one-time plan-activation
-- permit; this migration owns the exact recipe payload and successor cleanup.

-- Close the preflight race with every route writer before tightening the
-- previously unused supporting-technique marker into a fail-closed contract.
begin;

lock table public.study_routes in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.study_routes as route
    where (route.route_payload #> '{approach}')
      ? 'visibleSupportingTechniqueId'
      or pg_catalog.lower(pg_catalog.btrim(coalesce(
        route.route_payload #>> '{approach,visibleMethodName}',
        ''
      ))) = 'blurting'
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          route.route_payload #> '{agency,alternatives}'
        ) as alternative(value)
        where pg_catalog.lower(pg_catalog.btrim(coalesce(
            alternative.value ->> 'visibleMethodName',
            ''
          ))) = 'blurting'
          or pg_catalog.btrim(coalesce(
            alternative.value ->> 'alternativeId',
            ''
          )) = 'blurting_v1'
          or pg_catalog.right(
            pg_catalog.btrim(coalesce(
              alternative.value ->> 'alternativeId',
              ''
            )),
            pg_catalog.length(':blurting_v1')
          ) = ':blurting_v1'
      )
      or exists (
        select 1
        from pg_catalog.unnest(pg_catalog.string_to_array(
          coalesce(
            route.route_payload #>> '{provenance,routerVersion}',
            ''
          ),
          '+'
        )) as component(value)
        where pg_catalog.btrim(component.value)
          = 'blurting_recipe_runtime_v1'
      )
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          route.route_payload #> '{provenance,ruleTrace}'
        ) as trace(value)
        where pg_catalog.btrim(coalesce(
            trace.value ->> 'ruleId',
            ''
          )) = 'blurting_recipe_runtime_v1'
          or (
            pg_catalog.btrim(coalesce(
              trace.value ->> 'ruleId',
              ''
            )) = 'method_recipe_v1'
            and pg_catalog.btrim(coalesce(
              trace.value ->> 'result',
              ''
            )) = 'recipe:blurting_v1'
          )
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'blurting_recipe_marker_preflight_failed';
  end if;
end;
$$;

create or replace function public.assert_study_route_blurting_recipe_v1(
  route_payload jsonb
)
returns void
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  target jsonb := route_payload -> 'target';
  approach jsonb := route_payload -> 'approach';
  timing jsonb := route_payload -> 'timing';
  execution jsonb := route_payload -> 'execution';
  agency jsonb := route_payload -> 'agency';
  provenance jsonb := route_payload -> 'provenance';
  source_requirements jsonb := route_payload #> '{target,sourceRequirements}';
  active_target_ids jsonb;
  active_target_count integer;
  active_minutes integer;
  knowledge_stage text;
  expected_recipe_reason text;
  expected_runtime_result text;
  expected_runtime_reason text;
  blurting_runtime_component_count integer;
  normalized_blurting_runtime_component_count integer;
  generic_runtime_component_count integer;
  latest_recipe_trace jsonb;
  latest_runtime_policy_trace jsonb;
  phase jsonb;
  phase_ordinality bigint;
  expected_phase_id text;
  expected_method_phase text;
  expected_phase_minutes integer;
  target_id_text text;
  matching_evidence_count integer;
  has_any_blurting_signal boolean;
begin
  -- Recipe markers are fail-closed. A future supporting technique needs its
  -- own append-only compatibility migration before it can be persisted.
  if approach ? 'visibleSupportingTechniqueId'
    and pg_catalog.btrim(coalesce(
      approach ->> 'visibleSupportingTechniqueId',
      ''
    ))
      is distinct from 'blurting_v1' then
    raise exception using
      errcode = '22023',
      message = 'study_route_blurting_recipe_invalid';
  end if;

  -- Recipe v1 is primary-only: method alternatives cannot carry a recipe
  -- marker in their schema, so neither its visible name nor reserved ID may be
  -- smuggled through an ordinary core-method alternative.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      agency -> 'alternatives'
    ) as alternative(value)
    where pg_catalog.lower(pg_catalog.btrim(
        coalesce(alternative.value ->> 'visibleMethodName', '')
      )) = 'blurting'
      or pg_catalog.btrim(coalesce(
        alternative.value ->> 'alternativeId',
        ''
      )) = 'blurting_v1'
      or pg_catalog.right(
        pg_catalog.btrim(coalesce(
          alternative.value ->> 'alternativeId',
          ''
        )),
        pg_catalog.length(':blurting_v1')
      ) = ':blurting_v1'
  ) then
    raise exception using
      errcode = '22023',
      message = 'study_route_blurting_recipe_invalid';
  end if;

  select
    (pg_catalog.count(*) filter (
      where component.value = 'blurting_recipe_runtime_v1'
    ))::integer,
    (pg_catalog.count(*) filter (
      where pg_catalog.btrim(component.value)
        = 'blurting_recipe_runtime_v1'
    ))::integer,
    (pg_catalog.count(*) filter (
      where pg_catalog.btrim(component.value)
        = 'method_runtime_capability_v1'
    ))::integer
  into
    blurting_runtime_component_count,
    normalized_blurting_runtime_component_count,
    generic_runtime_component_count
  from pg_catalog.unnest(
    pg_catalog.string_to_array(
      provenance ->> 'routerVersion',
      '+'
    )
  ) as component(value);

  -- Rule traces are append-only history. Only the exact technique/name/current
  -- router component activate this recipe; retained older traces never do.
  has_any_blurting_signal :=
    coalesce(
      pg_catalog.btrim(
        approach ->> 'visibleSupportingTechniqueId'
      ) = 'blurting_v1',
      false
    )
    or pg_catalog.lower(pg_catalog.btrim(
      coalesce(approach ->> 'visibleMethodName', '')
    )) = 'blurting'
    or normalized_blurting_runtime_component_count > 0;

  if has_any_blurting_signal is not true then
    return;
  end if;

  active_target_ids := public.study_route_active_topic_ids_v1(route_payload);
  active_target_count := pg_catalog.jsonb_array_length(active_target_ids);
  active_minutes := (timing ->> 'activeMinutes')::integer;

  select case
    when pg_catalog.bool_or(target_state.value ->> 'stage' = 'developing')
      then 'developing'
    else 'retrieval_ready'
  end
  into knowledge_stage
  from pg_catalog.jsonb_array_elements(
    target -> 'targetStates'
  ) as target_state(value)
  where active_target_ids @> pg_catalog.jsonb_build_array(
    target_state.value ->> 'targetId'
  );

  if approach ->> 'visibleSupportingTechniqueId'
      is distinct from 'blurting_v1'
    or approach ->> 'visibleMethodName' is distinct from 'Blurting'
    or approach ->> 'primaryMethodId'
      is distinct from 'retrieval_practice'
    or approach ->> 'mode' is distinct from 'practice'
    or coalesce(target ->> 'taskFamily', '') not in (
      'conceptual_learning',
      'reading_to_quiz'
    )
    or timing ->> 'durationSource' = 'scheduled_review'
    or active_minutes not between 10 and 60
    or active_target_count not between 1 and 3
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        target -> 'targetStates'
      ) as target_state(value)
      where active_target_ids @> pg_catalog.jsonb_build_array(
          target_state.value ->> 'targetId'
        )
        and target_state.value ->> 'stage' not in (
          'developing',
          'retrieval_ready'
        )
    )
    or coalesce(source_requirements ->> 'sourceType', '') not in (
      'user_materials',
      'trusted_external_source'
    )
    or source_requirements -> 'groundingRequired'
      is distinct from 'true'::jsonb
    or pg_catalog.jsonb_array_length(
      source_requirements -> 'requiredSourceIds'
    ) < 1
    or execution ->> 'initialSupport'
      is distinct from 'independent_start'
    or (execution ->> 'activityLimit')::integer < 3
    or blurting_runtime_component_count <> 1
    or normalized_blurting_runtime_component_count <> 1
    or generic_runtime_component_count <> 0 then
    raise exception using
      errcode = '22023',
      message = 'study_route_blurting_recipe_invalid';
  end if;

  expected_recipe_reason :=
    'Blurting selected under method_recipe_v1: ordinary Practice retrieval for '
    || (target ->> 'taskFamily') || '/' || knowledge_stage || ', '
    || active_minutes::text || ' active minutes, '
    || active_target_count::text || ' active target'
    || case when active_target_count = 1 then '' else 's' end
    || ', and a comparison source satisfy the recipe boundary.';

  select trace.value
  into latest_recipe_trace
  from pg_catalog.jsonb_array_elements(
    provenance -> 'ruleTrace'
  ) with ordinality as trace(value, ordinality)
  where trace.value ->> 'ruleId' = 'method_recipe_v1'
  order by trace.ordinality desc
  limit 1;

  if latest_recipe_trace is null
    or latest_recipe_trace ->> 'result'
      is distinct from 'recipe:blurting_v1'
    or latest_recipe_trace ->> 'reason'
      is distinct from expected_recipe_reason
    or latest_recipe_trace -> 'evidenceRefs'
      is distinct from '[]'::jsonb then
    raise exception using
      errcode = '22023',
      message = 'study_route_blurting_recipe_invalid';
  end if;

  select trace.value
  into latest_runtime_policy_trace
  from pg_catalog.jsonb_array_elements(
    provenance -> 'ruleTrace'
  ) with ordinality as trace(value, ordinality)
  where trace.value ->> 'ruleId' in (
    'method_runtime_capability_v1',
    'blurting_recipe_runtime_v1'
  )
  order by trace.ordinality desc
  limit 1;

  if approach ->> 'executionEnvironment' = 'inside_yova' then
    expected_runtime_result := 'full:dedicated_runtime:recovery_none';
    expected_runtime_reason :=
      'Blurting uses the dedicated broad-recall runtime inside YOVA: recall stays minimally cued, repair compares with the committed source, and transfer closes the source again.';
  else
    expected_runtime_result :=
      'full:outside_source_contract:recovery_none';
    expected_runtime_reason :=
      'Blurting uses the outside-source broad-recall contract: recall stays minimally cued, repair compares with the committed source, and transfer closes the source again.';
  end if;

  if latest_runtime_policy_trace is null
    or latest_runtime_policy_trace ->> 'ruleId'
      is distinct from 'blurting_recipe_runtime_v1'
    or latest_runtime_policy_trace ->> 'result'
      is distinct from expected_runtime_result
    or latest_runtime_policy_trace ->> 'reason'
      is distinct from expected_runtime_reason
    or latest_runtime_policy_trace -> 'evidenceRefs'
      is distinct from '[]'::jsonb then
    raise exception using
      errcode = '22023',
      message = 'study_route_blurting_recipe_invalid';
  end if;

  if pg_catalog.jsonb_array_length(
      execution -> 'orderedPhases'
    ) <> 3 then
    raise exception using
      errcode = '22023',
      message = 'study_route_blurting_recipe_invalid';
  end if;

  for phase, phase_ordinality in
    select item.value, item.ordinality
    from pg_catalog.jsonb_array_elements(
      execution -> 'orderedPhases'
    ) with ordinality as item(value, ordinality)
  loop
    expected_phase_id := case phase_ordinality
      when 1 then 'method-1-retrieve'
      when 2 then 'method-2-repair'
      when 3 then 'method-3-transfer'
    end;
    expected_method_phase := case phase_ordinality
      when 1 then 'retrieve'
      when 2 then 'repair'
      when 3 then 'transfer'
    end;
    expected_phase_minutes := active_minutes / 3
      + case
        when phase_ordinality <= (active_minutes % 3)::bigint then 1
        else 0
      end;

    if phase ->> 'phaseId' is distinct from expected_phase_id
      or phase ->> 'methodPhase' is distinct from expected_method_phase
      or (phase ->> 'activeMinutes')::integer
        <> expected_phase_minutes
      or pg_catalog.jsonb_array_length(phase -> 'targetIds')
        <> active_target_count
      or not ((phase -> 'targetIds') @> active_target_ids)
      or not (active_target_ids @> (phase -> 'targetIds')) then
      raise exception using
        errcode = '22023',
        message = 'study_route_blurting_recipe_invalid';
    end if;
  end loop;

  if pg_catalog.jsonb_array_length(
      execution -> 'completionEvidence'
    ) <> active_target_count
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        execution -> 'completionEvidence'
      ) as evidence(value)
      where evidence.value ->> 'kind' is distinct from 'verification'
        or evidence.value -> 'requiresIndependentAttempt'
          is distinct from 'true'::jsonb
        or pg_catalog.jsonb_array_length(
          evidence.value -> 'targetIds'
        ) <> 1
        or evidence.value ->> 'evidenceId'
          is distinct from 'blurting-final-check:'
            || (evidence.value #>> '{targetIds,0}')
    ) then
    raise exception using
      errcode = '22023',
      message = 'study_route_blurting_recipe_invalid';
  end if;

  for target_id_text in
    select target_id.value
    from pg_catalog.jsonb_array_elements_text(
      active_target_ids
    ) as target_id(value)
  loop
    select pg_catalog.count(*)::integer
    into matching_evidence_count
    from pg_catalog.jsonb_array_elements(
      execution -> 'completionEvidence'
    ) as evidence(value)
    where evidence.value -> 'targetIds'
      = pg_catalog.jsonb_build_array(target_id_text)
      and evidence.value ->> 'evidenceId'
        = 'blurting-final-check:' || target_id_text;

    if matching_evidence_count <> 1 then
      raise exception using
        errcode = '22023',
        message = 'study_route_blurting_recipe_invalid';
    end if;
  end loop;
end;
$$;

revoke all on function public.assert_study_route_blurting_recipe_v1(jsonb)
from public, anon, authenticated, service_role;

create or replace function public.assert_study_route_payload_v1(
  route_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target jsonb;
  approach jsonb;
  timing jsonb;
  execution jsonb;
  agency jsonb;
  explanation jsonb;
  provenance jsonb;
  source_requirements jsonb;
  target_state jsonb;
  next_review jsonb;
  phase jsonb;
  completion_item jsonb;
  deferred_target jsonb;
  alternative jsonb;
  route_override jsonb;
  rule_trace_entry jsonb;
  array_entry jsonb;
  target_id uuid;
  target_ids uuid[] := '{}'::uuid[];
  phase_target_ids uuid[];
  deferred_ids uuid[] := '{}'::uuid[];
  covered_ids uuid[] := '{}'::uuid[];
  evidence_target_ids uuid[];
  phase_id text;
  phase_ids text[] := '{}'::text[];
  evidence_id text;
  evidence_ids text[] := '{}'::text[];
  alternative_id text;
  alternative_ids text[] := '{}'::text[];
  alternative_signature text;
  alternative_signatures text[] := '{}'::text[];
  primary_signature text;
  changed_field text;
  changed_fields text[] := '{}'::text[];
  active_minutes integer;
  elapsed_minutes integer;
  hard_maximum_minutes integer;
  break_minutes integer := 0;
  phase_minutes integer := 0;
  phase_active_minutes integer;
  activity_limit integer;
  scheduled_for timestamptz;
  last_observed_at timestamptz;
  phase_ordinality integer := 0;
  break_phase_ordinality integer;
  active_target_count integer := 0;
begin
  perform public.study_route_assert_object_v1(
    route_payload,
    array['target', 'approach', 'timing', 'execution', 'agency', 'explanation', 'provenance'],
    array['target', 'approach', 'timing', 'execution', 'agency', 'explanation', 'provenance'],
    'study_route_semantic_root_invalid'
  );

  target := route_payload -> 'target';
  approach := route_payload -> 'approach';
  timing := route_payload -> 'timing';
  execution := route_payload -> 'execution';
  agency := route_payload -> 'agency';
  explanation := route_payload -> 'explanation';
  provenance := route_payload -> 'provenance';

  perform public.study_route_assert_object_v1(
    target,
    array['taskFamily', 'desiredOutcome', 'targetStates', 'sourceRequirements'],
    array['taskFamily', 'desiredOutcome', 'targetStates', 'sourceRequirements'],
    'study_route_semantic_target_invalid'
  );
  if target ->> 'taskFamily' not in (
    'memorization', 'conceptual_learning', 'problem_solving',
    'reading_to_quiz', 'writing_argumentation', 'programming',
    'mixed_assessment'
  ) or pg_catalog.jsonb_typeof(target -> 'taskFamily') is distinct from 'string' then
    raise exception using errcode = '22023', message = 'study_route_semantic_target_invalid';
  end if;
  perform public.study_route_text_v1(
    target -> 'desiredOutcome', 5, 500, 'study_route_semantic_target_invalid'
  );
  if pg_catalog.jsonb_typeof(target -> 'targetStates') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'study_route_semantic_target_invalid';
  end if;
  if pg_catalog.jsonb_array_length(target -> 'targetStates') not between 1 and 40 then
    raise exception using errcode = '22023', message = 'study_route_semantic_target_invalid';
  end if;

  for target_state in
    select element.value
    from pg_catalog.jsonb_array_elements(target -> 'targetStates') as element(value)
  loop
    perform public.study_route_assert_object_v1(
      target_state,
      array['targetId', 'stage', 'uncertainty', 'evidenceRefs'],
      array['targetId', 'stage', 'uncertainty', 'evidenceRefs', 'lastObservedAt', 'nextReview'],
      'study_route_semantic_target_state_invalid'
    );
    target_id := public.study_route_uuid_v1(
      target_state -> 'targetId', 'study_route_semantic_target_state_invalid'
    );
    if target_id = any(target_ids) then
      raise exception using errcode = '22023', message = 'study_route_semantic_target_state_invalid';
    end if;
    target_ids := pg_catalog.array_append(target_ids, target_id);
    if pg_catalog.jsonb_typeof(target_state -> 'stage') is distinct from 'string'
      or target_state ->> 'stage' not in ('novice', 'developing', 'retrieval_ready')
      or pg_catalog.jsonb_typeof(target_state -> 'uncertainty') is distinct from 'string'
      or target_state ->> 'uncertainty' not in ('unknown', 'high', 'medium', 'low') then
      raise exception using errcode = '22023', message = 'study_route_semantic_target_state_invalid';
    end if;
    perform public.study_route_assert_string_array_v1(
      target_state -> 'evidenceRefs', 0, 40, 1, 200, true,
      'study_route_semantic_target_state_invalid'
    );

    last_observed_at := null;
    if target_state ? 'lastObservedAt' then
      last_observed_at := public.study_route_timestamp_v1(
        target_state -> 'lastObservedAt', 'study_route_semantic_target_state_invalid'
      );
    end if;
    if target_state ? 'nextReview' then
      next_review := target_state -> 'nextReview';
      perform public.study_route_assert_object_v1(
        next_review,
        array['scheduledFor', 'reviewType', 'activeMinutes', 'reason', 'evidenceRefs'],
        array['scheduledFor', 'reviewType', 'activeMinutes', 'reason', 'evidenceRefs'],
        'study_route_semantic_review_invalid'
      );
      scheduled_for := public.study_route_timestamp_v1(
        next_review -> 'scheduledFor', 'study_route_semantic_review_invalid'
      );
      if pg_catalog.jsonb_typeof(next_review -> 'reviewType') is distinct from 'string'
        or next_review ->> 'reviewType' not in ('retrieval_check', 'transfer_check') then
        raise exception using errcode = '22023', message = 'study_route_semantic_review_invalid';
      end if;
      perform public.study_route_integer_v1(
        next_review -> 'activeMinutes', 2, 5, 'study_route_semantic_review_invalid'
      );
      perform public.study_route_text_v1(
        next_review -> 'reason', 8, 300, 'study_route_semantic_review_invalid'
      );
      perform public.study_route_assert_string_array_v1(
        next_review -> 'evidenceRefs', 0, 40, 1, 200, true,
        'study_route_semantic_review_invalid'
      );
      if last_observed_at is not null and scheduled_for <= last_observed_at then
        raise exception using errcode = '22023', message = 'study_route_semantic_review_invalid';
      end if;
    end if;
  end loop;

  source_requirements := target -> 'sourceRequirements';
  perform public.study_route_assert_object_v1(
    source_requirements,
    array['sourceType', 'requiredSourceIds', 'groundingRequired', 'instructions'],
    array['sourceType', 'requiredSourceIds', 'groundingRequired', 'instructions'],
    'study_route_semantic_source_invalid'
  );
  if pg_catalog.jsonb_typeof(source_requirements -> 'sourceType') is distinct from 'string'
    or source_requirements ->> 'sourceType' not in (
      'user_materials', 'yova_generated', 'trusted_external_source'
    )
    or pg_catalog.jsonb_typeof(source_requirements -> 'groundingRequired')
      is distinct from 'boolean' then
    raise exception using errcode = '22023', message = 'study_route_semantic_source_invalid';
  end if;
  perform public.study_route_assert_string_array_v1(
    source_requirements -> 'requiredSourceIds', 0, 20, 1, 200, true,
    'study_route_semantic_source_invalid'
  );
  if source_requirements ->> 'sourceType' <> 'yova_generated'
    and pg_catalog.jsonb_array_length(source_requirements -> 'requiredSourceIds') = 0 then
    raise exception using errcode = '22023', message = 'study_route_semantic_source_invalid';
  end if;
  if source_requirements ->> 'sourceType' = 'yova_generated'
    and pg_catalog.jsonb_array_length(source_requirements -> 'requiredSourceIds') <> 0 then
    raise exception using errcode = '22023', message = 'study_route_semantic_source_invalid';
  end if;
  perform public.study_route_assert_string_array_v1(
    source_requirements -> 'instructions', 0, 10, 5, 300, false,
    'study_route_semantic_source_invalid'
  );

  perform public.study_route_assert_object_v1(
    approach,
    array['mode', 'executionEnvironment', 'primaryMethodId', 'visibleMethodName', 'confidenceLevel'],
    array['mode', 'executionEnvironment', 'primaryMethodId', 'visibleMethodName', 'visibleSupportingTechniqueId', 'confidenceLevel'],
    'study_route_semantic_approach_invalid'
  );
  if pg_catalog.jsonb_typeof(approach -> 'mode') is distinct from 'string'
    or approach ->> 'mode' not in ('learn', 'practice')
    or pg_catalog.jsonb_typeof(approach -> 'executionEnvironment') is distinct from 'string'
    or approach ->> 'executionEnvironment' not in ('inside_yova', 'outside_yova')
    or pg_catalog.jsonb_typeof(approach -> 'primaryMethodId') is distinct from 'string'
    or approach ->> 'primaryMethodId' not in (
      'retrieval_practice', 'spaced_retrieval', 'self_explanation',
      'worked_example_fading', 'interleaved_practice', 'read_recall_review',
      'retrieval_based_outlining', 'scaffolded_coding',
      'practice_test_error_repair'
    )
    or pg_catalog.jsonb_typeof(approach -> 'confidenceLevel') is distinct from 'string'
    or approach ->> 'confidenceLevel' not in ('unknown', 'low', 'medium', 'high') then
    raise exception using errcode = '22023', message = 'study_route_semantic_approach_invalid';
  end if;
  perform public.study_route_text_v1(
    approach -> 'visibleMethodName', 2, 90, 'study_route_semantic_approach_invalid'
  );
  if approach ? 'visibleSupportingTechniqueId' then
    perform public.study_route_text_v1(
      approach -> 'visibleSupportingTechniqueId', 1, 200,
      'study_route_semantic_approach_invalid'
    );
  end if;
  if source_requirements ->> 'sourceType' = 'trusted_external_source'
    and approach ->> 'executionEnvironment' <> 'outside_yova' then
    raise exception using errcode = '22023', message = 'study_route_semantic_source_invalid';
  end if;

  perform public.study_route_assert_object_v1(
    timing,
    array['activeMinutes', 'elapsedMinutes', 'durationSource'],
    array['activeMinutes', 'elapsedMinutes', 'durationSource', 'hardMaximumMinutes', 'optionalTimedBreak'],
    'study_route_semantic_timing_invalid'
  );
  active_minutes := public.study_route_integer_v1(
    timing -> 'activeMinutes', 5, 180, 'study_route_semantic_timing_invalid'
  );
  elapsed_minutes := public.study_route_integer_v1(
    timing -> 'elapsedMinutes', 1, 240, 'study_route_semantic_timing_invalid'
  );
  if pg_catalog.jsonb_typeof(timing -> 'durationSource') is distinct from 'string'
    or timing ->> 'durationSource' not in (
      'router_default', 'profile_recommendation', 'observed_outcome_adjustment',
      'availability_cap',
      'learner_override', 'scheduled_review', 'legacy_reconstruction'
    ) then
    raise exception using errcode = '22023', message = 'study_route_semantic_timing_invalid';
  end if;
  hard_maximum_minutes := null;
  if timing ? 'hardMaximumMinutes' then
    hard_maximum_minutes := public.study_route_integer_v1(
      timing -> 'hardMaximumMinutes', 1, 240, 'study_route_semantic_timing_invalid'
    );
  end if;
  break_minutes := 0;
  if timing ? 'optionalTimedBreak' then
    perform public.study_route_assert_object_v1(
      timing -> 'optionalTimedBreak',
      array['minutes', 'afterPhaseId'],
      array['minutes', 'afterPhaseId'],
      'study_route_semantic_break_invalid'
    );
    break_minutes := public.study_route_integer_v1(
      timing #> '{optionalTimedBreak,minutes}', 1, 30,
      'study_route_semantic_break_invalid'
    );
    perform public.study_route_text_v1(
      timing #> '{optionalTimedBreak,afterPhaseId}', 1, 200,
      'study_route_semantic_break_invalid'
    );
  end if;
  if elapsed_minutes <> active_minutes + break_minutes
    or (hard_maximum_minutes is not null and elapsed_minutes > hard_maximum_minutes) then
    raise exception using errcode = '22023', message = 'study_route_semantic_timing_invalid';
  end if;

  perform public.study_route_assert_object_v1(
    execution,
    array['orderedPhases', 'difficultyTier', 'initialSupport', 'activityLimit', 'completionEvidence', 'deferredTargets'],
    array['orderedPhases', 'difficultyTier', 'initialSupport', 'activityLimit', 'completionEvidence', 'deferredTargets'],
    'study_route_semantic_execution_invalid'
  );
  if pg_catalog.jsonb_typeof(execution -> 'orderedPhases') is distinct from 'array'
    or pg_catalog.jsonb_typeof(execution -> 'completionEvidence') is distinct from 'array'
    or pg_catalog.jsonb_typeof(execution -> 'deferredTargets') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'study_route_semantic_execution_invalid';
  end if;
  if pg_catalog.jsonb_array_length(execution -> 'orderedPhases') not between 1 and 20
    or pg_catalog.jsonb_array_length(execution -> 'completionEvidence') not between 1 and 4
    or pg_catalog.jsonb_array_length(execution -> 'deferredTargets') not between 0 and 40
    or pg_catalog.jsonb_typeof(execution -> 'difficultyTier') is distinct from 'string'
    or execution ->> 'difficultyTier' not in ('unknown', 'foundational', 'standard', 'stretch')
    or pg_catalog.jsonb_typeof(execution -> 'initialSupport') is distinct from 'string'
    or execution ->> 'initialSupport' not in (
      'unknown', 'supported_start', 'fading', 'independent_start'
    ) then
    raise exception using errcode = '22023', message = 'study_route_semantic_execution_invalid';
  end if;
  activity_limit := public.study_route_integer_v1(
    execution -> 'activityLimit', 1, 20, 'study_route_semantic_execution_invalid'
  );

  phase_ordinality := 0;
  for phase in
    select element.value
    from pg_catalog.jsonb_array_elements(execution -> 'orderedPhases') as element(value)
  loop
    phase_ordinality := phase_ordinality + 1;
    perform public.study_route_assert_object_v1(
      phase,
      array['phaseId', 'methodPhase', 'activeMinutes', 'targetIds'],
      array['phaseId', 'methodPhase', 'activeMinutes', 'targetIds'],
      'study_route_semantic_phase_invalid'
    );
    phase_id := public.study_route_text_v1(
      phase -> 'phaseId', 1, 200, 'study_route_semantic_phase_invalid'
    );
    if phase_id = any(phase_ids) then
      raise exception using errcode = '22023', message = 'study_route_semantic_phase_invalid';
    end if;
    phase_ids := pg_catalog.array_append(phase_ids, phase_id);
    if pg_catalog.jsonb_typeof(phase -> 'methodPhase') is distinct from 'string'
      or phase ->> 'methodPhase' not in (
        'orient', 'model', 'read_source', 'retrieve', 'explain',
        'guided_practice', 'independent_practice', 'discriminate',
        'repair', 'evidence_match', 'code_trace', 'transfer',
        'schedule_return', 'reflect'
      ) then
      raise exception using errcode = '22023', message = 'study_route_semantic_phase_invalid';
    end if;
    phase_active_minutes := public.study_route_integer_v1(
      phase -> 'activeMinutes', 1, 180, 'study_route_semantic_phase_invalid'
    );
    phase_minutes := phase_minutes + phase_active_minutes;
    if pg_catalog.jsonb_typeof(phase -> 'targetIds') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'study_route_semantic_phase_invalid';
    end if;
    if pg_catalog.jsonb_array_length(phase -> 'targetIds') not between 0 and 40 then
      raise exception using errcode = '22023', message = 'study_route_semantic_phase_invalid';
    end if;
    phase_target_ids := '{}'::uuid[];
    for array_entry in
      select element.value
      from pg_catalog.jsonb_array_elements(phase -> 'targetIds') as element(value)
    loop
      target_id := public.study_route_uuid_v1(
        array_entry, 'study_route_semantic_phase_invalid'
      );
      if target_id = any(phase_target_ids) then
        raise exception using errcode = '22023', message = 'study_route_semantic_phase_invalid';
      end if;
      phase_target_ids := pg_catalog.array_append(phase_target_ids, target_id);
      if not (target_id = any(target_ids)) then
        raise exception using errcode = '22023', message = 'study_route_semantic_target_reference_invalid';
      end if;
      if not (target_id = any(covered_ids)) then
        covered_ids := pg_catalog.array_append(covered_ids, target_id);
      end if;
    end loop;
  end loop;
  if phase_minutes <> active_minutes then
    raise exception using errcode = '22023', message = 'study_route_semantic_phase_minutes_invalid';
  end if;

  for deferred_target in
    select element.value
    from pg_catalog.jsonb_array_elements(execution -> 'deferredTargets') as element(value)
  loop
    perform public.study_route_assert_object_v1(
      deferred_target,
      array['targetId', 'reason'],
      array['targetId', 'reason'],
      'study_route_semantic_deferred_target_invalid'
    );
    target_id := public.study_route_uuid_v1(
      deferred_target -> 'targetId', 'study_route_semantic_deferred_target_invalid'
    );
    if target_id = any(deferred_ids)
      or not (target_id = any(target_ids)) then
      raise exception using errcode = '22023', message = 'study_route_semantic_deferred_target_invalid';
    end if;
    deferred_ids := pg_catalog.array_append(deferred_ids, target_id);
    perform public.study_route_text_v1(
      deferred_target -> 'reason', 8, 300,
      'study_route_semantic_deferred_target_invalid'
    );
  end loop;

  foreach target_id in array deferred_ids loop
    if target_id = any(covered_ids) then
      raise exception using errcode = '22023', message = 'study_route_semantic_active_deferred_overlap';
    end if;
  end loop;
  foreach target_id in array target_ids loop
    if not (target_id = any(deferred_ids))
      and not (target_id = any(covered_ids)) then
      raise exception using errcode = '22023', message = 'study_route_semantic_target_coverage_invalid';
    end if;
    if not (target_id = any(deferred_ids)) then
      active_target_count := active_target_count + 1;
    end if;
  end loop;
  if active_target_count > 6 then
    raise exception using errcode = '22023', message = 'study_route_semantic_active_target_capacity_invalid';
  end if;

  for completion_item in
    select element.value
    from pg_catalog.jsonb_array_elements(execution -> 'completionEvidence') as element(value)
  loop
    perform public.study_route_assert_object_v1(
      completion_item,
      array['evidenceId', 'targetIds', 'kind', 'description', 'requiresIndependentAttempt'],
      array['evidenceId', 'targetIds', 'kind', 'description', 'requiresIndependentAttempt'],
      'study_route_semantic_completion_evidence_invalid'
    );
    evidence_id := public.study_route_text_v1(
      completion_item -> 'evidenceId', 1, 200,
      'study_route_semantic_completion_evidence_invalid'
    );
    if evidence_id = any(evidence_ids) then
      raise exception using errcode = '22023', message = 'study_route_semantic_completion_evidence_invalid';
    end if;
    evidence_ids := pg_catalog.array_append(evidence_ids, evidence_id);
    if pg_catalog.jsonb_typeof(completion_item -> 'targetIds') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'study_route_semantic_completion_evidence_invalid';
    end if;
    if pg_catalog.jsonb_array_length(completion_item -> 'targetIds') not between 1 and 40
      or pg_catalog.jsonb_typeof(completion_item -> 'kind') is distinct from 'string'
      or completion_item ->> 'kind' not in (
        'retrieval', 'application', 'explanation', 'artifact', 'verification'
      )
      or pg_catalog.jsonb_typeof(completion_item -> 'requiresIndependentAttempt')
        is distinct from 'boolean' then
      raise exception using errcode = '22023', message = 'study_route_semantic_completion_evidence_invalid';
    end if;
    perform public.study_route_text_v1(
      completion_item -> 'description', 8, 300,
      'study_route_semantic_completion_evidence_invalid'
    );
    evidence_target_ids := '{}'::uuid[];
    for array_entry in
      select element.value
      from pg_catalog.jsonb_array_elements(completion_item -> 'targetIds') as element(value)
    loop
      target_id := public.study_route_uuid_v1(
        array_entry, 'study_route_semantic_completion_evidence_invalid'
      );
      if target_id = any(evidence_target_ids)
        or not (target_id = any(target_ids))
        or target_id = any(deferred_ids) then
        raise exception using errcode = '22023', message = 'study_route_semantic_completion_evidence_invalid';
      end if;
      evidence_target_ids := pg_catalog.array_append(evidence_target_ids, target_id);
    end loop;
  end loop;

  if timing ? 'optionalTimedBreak' then
    break_phase_ordinality := pg_catalog.array_position(
      phase_ids,
      timing #>> '{optionalTimedBreak,afterPhaseId}'
    );
    if break_phase_ordinality is null
      or break_phase_ordinality = pg_catalog.array_length(phase_ids, 1) then
      raise exception using errcode = '22023', message = 'study_route_semantic_break_invalid';
    end if;
  end if;

  perform public.study_route_assert_object_v1(
    agency,
    array['controlMode', 'selectedBy', 'alternatives'],
    array['controlMode', 'selectedBy', 'alternatives', 'override'],
    'study_route_semantic_agency_invalid'
  );
  if pg_catalog.jsonb_typeof(agency -> 'controlMode') is distinct from 'string'
    or agency ->> 'controlMode' not in (
      'yova_decides', 'help_me_choose', 'learner_customizes', 'legacy_unknown'
    )
    or pg_catalog.jsonb_typeof(agency -> 'selectedBy') is distinct from 'string'
    or agency ->> 'selectedBy' not in ('yova', 'learner', 'legacy_unknown')
    or pg_catalog.jsonb_typeof(agency -> 'alternatives') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'study_route_semantic_agency_invalid';
  end if;
  if pg_catalog.jsonb_array_length(agency -> 'alternatives') not between 0 and 2 then
    raise exception using errcode = '22023', message = 'study_route_semantic_agency_invalid';
  end if;
  primary_signature := pg_catalog.jsonb_build_array(
    approach -> 'mode',
    approach -> 'executionEnvironment',
    approach -> 'primaryMethodId',
    timing -> 'activeMinutes'
  )::text;
  for alternative in
    select element.value
    from pg_catalog.jsonb_array_elements(agency -> 'alternatives') as element(value)
  loop
    perform public.study_route_assert_object_v1(
      alternative,
      array['alternativeId', 'mode', 'executionEnvironment', 'primaryMethodId', 'visibleMethodName', 'activeMinutes', 'tradeoff'],
      array['alternativeId', 'mode', 'executionEnvironment', 'primaryMethodId', 'visibleMethodName', 'activeMinutes', 'tradeoff'],
      'study_route_semantic_alternative_invalid'
    );
    alternative_id := public.study_route_text_v1(
      alternative -> 'alternativeId', 1, 200,
      'study_route_semantic_alternative_invalid'
    );
    if alternative_id = any(alternative_ids)
      or pg_catalog.jsonb_typeof(alternative -> 'mode') is distinct from 'string'
      or alternative ->> 'mode' not in ('learn', 'practice')
      or pg_catalog.jsonb_typeof(alternative -> 'executionEnvironment') is distinct from 'string'
      or alternative ->> 'executionEnvironment' not in ('inside_yova', 'outside_yova')
      or pg_catalog.jsonb_typeof(alternative -> 'primaryMethodId') is distinct from 'string'
      or alternative ->> 'primaryMethodId' not in (
        'retrieval_practice', 'spaced_retrieval', 'self_explanation',
        'worked_example_fading', 'interleaved_practice', 'read_recall_review',
        'retrieval_based_outlining', 'scaffolded_coding',
        'practice_test_error_repair'
      ) then
      raise exception using errcode = '22023', message = 'study_route_semantic_alternative_invalid';
    end if;
    alternative_ids := pg_catalog.array_append(alternative_ids, alternative_id);
    perform public.study_route_text_v1(
      alternative -> 'visibleMethodName', 2, 90,
      'study_route_semantic_alternative_invalid'
    );
    perform public.study_route_integer_v1(
      alternative -> 'activeMinutes', 1, 180,
      'study_route_semantic_alternative_invalid'
    );
    perform public.study_route_text_v1(
      alternative -> 'tradeoff', 8, 300,
      'study_route_semantic_alternative_invalid'
    );
    alternative_signature := pg_catalog.jsonb_build_array(
      alternative -> 'mode',
      alternative -> 'executionEnvironment',
      alternative -> 'primaryMethodId',
      alternative -> 'activeMinutes'
    )::text;
    if alternative_signature = primary_signature
      or alternative_signature = any(alternative_signatures) then
      raise exception using errcode = '22023', message = 'study_route_semantic_alternative_invalid';
    end if;
    alternative_signatures := pg_catalog.array_append(
      alternative_signatures,
      alternative_signature
    );
  end loop;

  if agency ? 'override' then
    route_override := agency -> 'override';
    perform public.study_route_assert_object_v1(
      route_override,
      array['requestedAt', 'changedFields'],
      array['requestedAt', 'changedFields', 'reason'],
      'study_route_semantic_override_invalid'
    );
    perform public.study_route_timestamp_v1(
      route_override -> 'requestedAt', 'study_route_semantic_override_invalid'
    );
    if pg_catalog.jsonb_typeof(route_override -> 'changedFields') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'study_route_semantic_override_invalid';
    end if;
    if pg_catalog.jsonb_array_length(route_override -> 'changedFields') not between 1 and 9
      or agency ->> 'selectedBy' <> 'learner' then
      raise exception using errcode = '22023', message = 'study_route_semantic_override_invalid';
    end if;
    for array_entry in
      select element.value
      from pg_catalog.jsonb_array_elements(route_override -> 'changedFields') as element(value)
    loop
      changed_field := public.study_route_text_v1(
        array_entry, 1, 40, 'study_route_semantic_override_invalid'
      );
      if changed_field not in (
        'targets', 'mode', 'execution_environment', 'primary_method',
        'duration', 'phase_order', 'support_bounds', 'review_contract',
        'method_recipe'
      ) or changed_field = any(changed_fields) then
        raise exception using errcode = '22023', message = 'study_route_semantic_override_invalid';
      end if;
      changed_fields := pg_catalog.array_append(changed_fields, changed_field);
    end loop;
    if route_override ? 'reason' then
      perform public.study_route_text_v1(
        route_override -> 'reason', 3, 300,
        'study_route_semantic_override_invalid'
      );
    end if;
  end if;

  perform public.study_route_assert_object_v1(
    explanation,
    array['shortReason', 'taskRequirements', 'learnerDeclarations', 'observations', 'uncertainties'],
    array['shortReason', 'taskRequirements', 'learnerDeclarations', 'observations', 'uncertainties'],
    'study_route_semantic_explanation_invalid'
  );
  perform public.study_route_text_v1(
    explanation -> 'shortReason', 8, 300,
    'study_route_semantic_explanation_invalid'
  );
  perform public.study_route_assert_string_array_v1(
    explanation -> 'taskRequirements', 0, 10, 3, 500, false,
    'study_route_semantic_explanation_invalid'
  );
  perform public.study_route_assert_string_array_v1(
    explanation -> 'learnerDeclarations', 0, 10, 3, 500, false,
    'study_route_semantic_explanation_invalid'
  );
  perform public.study_route_assert_string_array_v1(
    explanation -> 'observations', 0, 10, 3, 500, false,
    'study_route_semantic_explanation_invalid'
  );
  perform public.study_route_assert_string_array_v1(
    explanation -> 'uncertainties', 0, 10, 3, 500, false,
    'study_route_semantic_explanation_invalid'
  );

  perform public.study_route_assert_object_v1(
    provenance,
    array['routerVersion', 'profileVersion', 'evidenceRefs', 'ruleTrace'],
    array['routerVersion', 'profileVersion', 'evidenceRefs', 'ruleTrace'],
    'study_route_semantic_provenance_invalid'
  );
  perform public.study_route_text_v1(
    provenance -> 'routerVersion', 1, 256,
    'study_route_semantic_provenance_invalid'
  );
  perform public.study_route_text_v1(
    provenance -> 'profileVersion', 1, 200,
    'study_route_semantic_provenance_invalid'
  );
  perform public.study_route_assert_string_array_v1(
    provenance -> 'evidenceRefs', 0, 100, 1, 200, true,
    'study_route_semantic_provenance_invalid'
  );
  if pg_catalog.jsonb_typeof(provenance -> 'ruleTrace') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'study_route_semantic_provenance_invalid';
  end if;
  if pg_catalog.jsonb_array_length(provenance -> 'ruleTrace') not between 1 and 200 then
    raise exception using errcode = '22023', message = 'study_route_semantic_provenance_invalid';
  end if;
  for rule_trace_entry in
    select element.value
    from pg_catalog.jsonb_array_elements(provenance -> 'ruleTrace') as element(value)
  loop
    perform public.study_route_assert_object_v1(
      rule_trace_entry,
      array['ruleId', 'result', 'reason', 'evidenceRefs'],
      array['ruleId', 'result', 'reason', 'evidenceRefs'],
      'study_route_semantic_rule_trace_invalid'
    );
    perform public.study_route_text_v1(
      rule_trace_entry -> 'ruleId', 1, 200,
      'study_route_semantic_rule_trace_invalid'
    );
    perform public.study_route_text_v1(
      rule_trace_entry -> 'result', 1, 200,
      'study_route_semantic_rule_trace_invalid'
    );
    perform public.study_route_text_v1(
      rule_trace_entry -> 'reason', 3, 500,
      'study_route_semantic_rule_trace_invalid'
    );
    perform public.study_route_assert_string_array_v1(
      rule_trace_entry -> 'evidenceRefs', 0, 40, 1, 200, true,
      'study_route_semantic_rule_trace_invalid'
    );
  end loop;

  perform public.assert_study_route_blurting_recipe_v1(route_payload);
end;
$$;

revoke all on function public.assert_study_route_payload_v1(jsonb)
from public, anon, authenticated, service_role;

-- Re-run the complete latest validator while the write lock is still held.
-- This proves ordinary historical routes remain valid and closes the race
-- between the zero-signal scan and installing the replacement trigger body.
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

  -- The plan-activation wrapper in migration 002 binds this transaction to one
  -- locked, unexpired, payload-digest-matched permit before setting the private
  -- marker. Existing Blurting lineages remain readable/revisable with rollout
  -- off; only their first recipe revision needs the permit.
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
  normalized_router_version text;
  predecessor_has_blurting_recipe boolean := false;
  expected_override_changed_fields jsonb;
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

  predecessor_has_blurting_recipe :=
    predecessor_route.route_payload
      #>> '{approach,visibleSupportingTechniqueId}' = 'blurting_v1';

  expected_override_changed_fields := case
    when predecessor_has_blurting_recipe
      then '["primary_method", "method_recipe"]'::jsonb
    else '["primary_method"]'::jsonb
  end;

  -- A core-method successor leaves the active Blurting recipe while retaining
  -- its append-only policy/runtime trace history. Normalize current state
  -- before exact validation so old and new clients replay to the same route.
  if predecessor_has_blurting_recipe
    and requested_method_id is not null
    and requested_method_id is distinct from (
      predecessor_route.route_payload #>> '{approach,primaryMethodId}'
    )
    and pg_catalog.jsonb_typeof(requested_route -> 'approach') = 'object'
    and pg_catalog.jsonb_typeof(
      requested_route #> '{agency,override}'
    ) = 'object'
    and pg_catalog.jsonb_typeof(
      requested_route #> '{provenance,routerVersion}'
    ) = 'string' then
    select coalesce(
      pg_catalog.array_to_string(
        pg_catalog.array_agg(
          component.value order by component.ordinality
        ) filter (
          where component.value <> 'blurting_recipe_runtime_v1'
        ),
        '+'
      ),
      ''
    )
    into normalized_router_version
    from pg_catalog.unnest(
      pg_catalog.string_to_array(
        requested_route #>> '{provenance,routerVersion}',
        '+'
      )
    ) with ordinality as component(value, ordinality);

    requested_route := pg_catalog.jsonb_set(
      requested_route,
      '{approach}',
      (requested_route -> 'approach') - 'visibleSupportingTechniqueId',
      false
    );
    requested_route := pg_catalog.jsonb_set(
      requested_route,
      '{provenance,routerVersion}',
      pg_catalog.to_jsonb(normalized_router_version),
      false
    );
    requested_route := pg_catalog.jsonb_set(
      requested_route,
      '{agency,override,changedFields}',
      expected_override_changed_fields,
      false
    );
  end if;

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
    when 'retrieval_practice' then case
      when predecessor_has_blurting_recipe
        then array['Blurting']::text[]
      else array['Active Recall', 'Retrieval practice']::text[]
    end
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
      and router_component <> 'blurting_recipe_runtime_v1'
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
      is distinct from expected_override_changed_fields
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
        case
          when predecessor_has_blurting_recipe
            then 'Active Recall'
          else predecessor_route.route_payload
            #>> '{approach,visibleMethodName}'
        end as visible_method_name,
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

comment on function public.assert_study_route_blurting_recipe_v1(jsonb) is
  'Validates the exact disabled-compatible Blurting StudyRoute recipe while retaining append-only policy and runtime trace history.';
comment on function public.guard_study_route_payload_v1() is
  'Validates every route payload and requires the plan-bound activation permit only for the first Blurting revision after a non-Blurting predecessor.';
comment on function public.change_plan_session_method_with_route(jsonb) is
  'Commits one exact learner-chosen core-method successor and removes current Blurting recipe state while retaining its trace history.';

commit;
