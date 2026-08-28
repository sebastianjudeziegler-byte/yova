-- Add durable-shape compatibility for the disabled broad-recall runtime.
-- The application still denies broad_recall_v1 generation. These definitions
-- only prepare the existing checkpoint/interruption boundaries for a later,
-- separately reviewed rollout, and bind any future broad marker to the exact
-- committed Blurting route and its route-stamped cached resource.

-- Close the preflight race with every durable activity-progress writer. There
-- was no production broad-recall writer before this migration, so any existing
-- marker is an unknown/manual value that must be investigated rather than
-- grandfathered into the new contract.
begin;

lock table
  public.plan_sessions,
  public.session_attempts,
  public.learning_events
in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.plan_sessions as session
    where pg_catalog.lower(pg_catalog.btrim(coalesce(
        session.step_data #>> '{activeSessionCheckpoint,activityProgress,kind}',
        ''
      ))) = 'broad_recall'
      or pg_catalog.lower(pg_catalog.btrim(coalesce(
        session.step_data #>> '{activeSessionCheckpoint,activityProgress,format}',
        ''
      ))) = 'broad_recall_v1'
  ) or exists (
    select 1
    from public.session_attempts as attempt
    where pg_catalog.lower(pg_catalog.btrim(coalesce(
        attempt.result_data #>> '{activityProgress,kind}',
        ''
      ))) = 'broad_recall'
      or pg_catalog.lower(pg_catalog.btrim(coalesce(
        attempt.result_data #>> '{activityProgress,format}',
        ''
      ))) = 'broad_recall_v1'
  ) or exists (
    select 1
    from public.learning_events as event
    where pg_catalog.lower(pg_catalog.btrim(coalesce(
        event.event_data #>> '{activityProgress,kind}',
        ''
      ))) = 'broad_recall'
      or pg_catalog.lower(pg_catalog.btrim(coalesce(
        event.event_data #>> '{activityProgress,format}',
        ''
      ))) = 'broad_recall_v1'
  ) then
    raise exception using
      errcode = '55000',
      message = 'broad_recall_progress_preflight_failed';
  end if;
end;
$$;

-- Keep the established validator signature. Retrieval-round behavior is the
-- migration-200002 implementation verbatim; the second branch adds only the
-- strict, transcript-free broad-recall event-prefix shape.
create or replace function public.is_valid_session_activity_progress(progress jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  prompt_count integer;
  activity_index integer;
  rating jsonb;
  rating_value text;
  retrieval_queue integer[];
  attempts integer[];
  active_index integer;
  queue_length integer;
  gap_count integer;
  binding jsonb;
  progress_event jsonb;
  event_ordinality bigint;
  binding_count integer;
begin
  if progress is null or pg_catalog.jsonb_typeof(progress) = 'null' then
    return true;
  end if;

  if pg_catalog.jsonb_typeof(progress) <> 'object' then
    return false;
  end if;

  if progress ->> 'kind' = 'retrieval_round' then
    if not (progress ?& array['kind', 'activityIndex', 'promptCount', 'ratings'])
      or exists (
        select 1
        from pg_catalog.jsonb_object_keys(progress) as progress_keys(progress_key)
        where progress_key not in ('kind', 'activityIndex', 'promptCount', 'ratings')
      )
      or pg_catalog.jsonb_typeof(progress -> 'activityIndex') <> 'number'
      or pg_catalog.jsonb_typeof(progress -> 'promptCount') <> 'number'
      or pg_catalog.jsonb_typeof(progress -> 'ratings') <> 'array' then
      return false;
    end if;

    begin
      activity_index := (progress ->> 'activityIndex')::integer;
      prompt_count := (progress ->> 'promptCount')::integer;
    exception when others then
      return false;
    end;

    if activity_index not between 0 and 23
      or prompt_count not between 3 and 10
      or pg_catalog.jsonb_array_length(progress -> 'ratings') > prompt_count * 2
      or pg_catalog.octet_length(progress::text) > 500
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(progress -> 'ratings') as ratings(entry)
        where pg_catalog.jsonb_typeof(entry) <> 'string'
          or entry #>> '{}' not in ('got_it', 'partly', 'missed')
      ) then
      return false;
    end if;

    retrieval_queue := array(select pg_catalog.generate_series(0, prompt_count - 1));
    attempts := pg_catalog.array_fill(0, array[prompt_count]);

    for rating in
      select entry
      from pg_catalog.jsonb_array_elements(progress -> 'ratings') as ratings(entry)
    loop
      queue_length := coalesce(pg_catalog.array_length(retrieval_queue, 1), 0);
      if queue_length = 0 then
        return false;
      end if;

      active_index := retrieval_queue[1];
      retrieval_queue := case
        when queue_length = 1 then '{}'::integer[]
        else retrieval_queue[2:queue_length]
      end;
      attempts[active_index + 1] := attempts[active_index + 1] + 1;
      rating_value := rating #>> '{}';

      if rating_value in ('partly', 'missed')
        and attempts[active_index + 1] < 2 then
        retrieval_queue := pg_catalog.array_append(retrieval_queue, active_index);
      end if;
    end loop;

    return true;
  end if;

  if pg_catalog.jsonb_typeof(progress -> 'kind') is distinct from 'string'
    or progress ->> 'kind' is distinct from 'broad_recall' then
    return false;
  end if;

  if not (progress ?& array[
      'kind',
      'format',
      'activityIndex',
      'gapCount',
      'bindings',
      'events'
    ])
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(progress) as progress_keys(progress_key)
      where progress_key not in (
        'kind',
        'format',
        'activityIndex',
        'gapCount',
        'bindings',
        'events'
      )
    )
    or progress ->> 'format' is distinct from 'broad_recall_v1'
    or pg_catalog.jsonb_typeof(progress -> 'format') is distinct from 'string'
    or pg_catalog.jsonb_typeof(progress -> 'activityIndex') is distinct from 'number'
    or pg_catalog.jsonb_typeof(progress -> 'gapCount') is distinct from 'number'
    or pg_catalog.jsonb_typeof(progress -> 'bindings') is distinct from 'array'
    or pg_catalog.jsonb_typeof(progress -> 'events') is distinct from 'array'
    or pg_catalog.octet_length(progress::text) > 3500 then
    return false;
  end if;

  begin
    activity_index := (progress ->> 'activityIndex')::integer;
    gap_count := (progress ->> 'gapCount')::integer;
  exception when others then
    return false;
  end;

  binding_count := pg_catalog.jsonb_array_length(progress -> 'bindings');
  if activity_index not between 0 and 23
    or gap_count not between 1 and 6
    or binding_count not between 1 and 3
    or pg_catalog.jsonb_array_length(progress -> 'events') > 3 then
    return false;
  end if;

  for binding in
    select entry
    from pg_catalog.jsonb_array_elements(progress -> 'bindings') as bindings(entry)
  loop
    if pg_catalog.jsonb_typeof(binding) is distinct from 'object'
      or not (binding ?& array['targetId', 'evidenceId'])
      or exists (
        select 1
        from pg_catalog.jsonb_object_keys(binding) as binding_keys(binding_key)
        where binding_key not in ('targetId', 'evidenceId')
      )
      or pg_catalog.jsonb_typeof(binding -> 'targetId') is distinct from 'string'
      or pg_catalog.jsonb_typeof(binding -> 'evidenceId') is distinct from 'string'
      or coalesce(binding ->> 'targetId', '')
        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or pg_catalog.length(binding ->> 'evidenceId') > 200
      or binding ->> 'evidenceId'
        is distinct from 'blurting-final-check:' || (binding ->> 'targetId') then
      return false;
    end if;
  end loop;

  if (
      select pg_catalog.count(distinct binding.value ->> 'targetId')
      from pg_catalog.jsonb_array_elements(progress -> 'bindings') as binding(value)
    ) <> binding_count
    or (
      select pg_catalog.count(distinct binding.value ->> 'evidenceId')
      from pg_catalog.jsonb_array_elements(progress -> 'bindings') as binding(value)
    ) <> binding_count then
    return false;
  end if;

  for progress_event, event_ordinality in
    select event.value, event.ordinality
    from pg_catalog.jsonb_array_elements(progress -> 'events')
      with ordinality as event(value, ordinality)
  loop
    if pg_catalog.jsonb_typeof(progress_event) is distinct from 'object'
      or pg_catalog.jsonb_typeof(progress_event -> 'type') is distinct from 'string' then
      return false;
    end if;

    if event_ordinality = 1 then
      if progress_event ->> 'type' is distinct from 'comparison_completed'
        or not (progress_event ?& array['type', 'gapStatuses'])
        or exists (
          select 1
          from pg_catalog.jsonb_object_keys(progress_event) as event_keys(event_key)
          where event_key not in ('type', 'gapStatuses')
        )
        or pg_catalog.jsonb_typeof(progress_event -> 'gapStatuses') is distinct from 'array'
        or pg_catalog.jsonb_array_length(progress_event -> 'gapStatuses') <> gap_count
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements(progress_event -> 'gapStatuses') as status(entry)
          where pg_catalog.jsonb_typeof(status.entry) is distinct from 'string'
            or status.entry #>> '{}' not in ('covered', 'partial', 'missing')
        ) then
        return false;
      end if;
    elsif event_ordinality = 2 then
      if progress_event ->> 'type' is distinct from 'correction_completed'
        or exists (
          select 1
          from pg_catalog.jsonb_object_keys(progress_event) as event_keys(event_key)
          where event_key <> 'type'
        ) then
        return false;
      end if;
    elsif event_ordinality = 3 then
      if progress_event ->> 'type' is distinct from 'transfer_evaluated'
        or not (progress_event ?& array['type', 'results'])
        or exists (
          select 1
          from pg_catalog.jsonb_object_keys(progress_event) as event_keys(event_key)
          where event_key not in ('type', 'results')
        )
        or pg_catalog.jsonb_typeof(progress_event -> 'results') is distinct from 'array'
        or pg_catalog.jsonb_array_length(progress_event -> 'results') <> binding_count
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements(progress_event -> 'results') as result(entry)
          where pg_catalog.jsonb_typeof(result.entry) is distinct from 'string'
            or result.entry #>> '{}' not in ('secure', 'needs_review', 'unverified')
        ) then
        return false;
      end if;
    else
      return false;
    end if;
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

-- Merge only privacy-safe progress for the same activity identity. Both
-- formats are immutable prefixes: a longer prefix wins, equal is idempotent,
-- and divergent history is never overwritten by save time.
create or replace function public.merge_session_activity_progress_v1(
  stored_progress jsonb,
  requested_progress jsonb
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  stored_count integer;
  requested_count integer;
  shared_count integer;
  has_common_prefix boolean := true;
begin
  if not public.is_valid_session_activity_progress(stored_progress)
    or not public.is_valid_session_activity_progress(requested_progress) then
    raise exception using
      errcode = '40001',
      message = 'active_session_checkpoint_conflict';
  end if;

  if pg_catalog.jsonb_typeof(stored_progress) is distinct from 'object' then
    return requested_progress;
  end if;
  if pg_catalog.jsonb_typeof(requested_progress) is distinct from 'object' then
    return stored_progress;
  end if;

  if stored_progress ->> 'kind'
      is distinct from requested_progress ->> 'kind' then
    raise exception using
      errcode = '40001',
      message = 'active_session_checkpoint_conflict';
  end if;

  if stored_progress ->> 'kind' = 'retrieval_round' then
    if stored_progress ->> 'activityIndex'
        is distinct from requested_progress ->> 'activityIndex'
      or stored_progress ->> 'promptCount'
        is distinct from requested_progress ->> 'promptCount' then
      raise exception using
        errcode = '40001',
        message = 'active_session_checkpoint_conflict';
    end if;

    stored_count := pg_catalog.jsonb_array_length(stored_progress -> 'ratings');
    requested_count := pg_catalog.jsonb_array_length(requested_progress -> 'ratings');
    shared_count := least(stored_count, requested_count);
    if shared_count > 0 then
      select pg_catalog.bool_and(
        stored_progress -> 'ratings' -> prefix_index
          = requested_progress -> 'ratings' -> prefix_index
      )
      into has_common_prefix
      from pg_catalog.generate_series(0, shared_count - 1) as indexes(prefix_index);
    end if;
  elsif stored_progress ->> 'kind' = 'broad_recall' then
    if stored_progress ->> 'format'
        is distinct from requested_progress ->> 'format'
      or stored_progress ->> 'activityIndex'
        is distinct from requested_progress ->> 'activityIndex'
      or stored_progress ->> 'gapCount'
        is distinct from requested_progress ->> 'gapCount'
      or stored_progress -> 'bindings'
        is distinct from requested_progress -> 'bindings' then
      raise exception using
        errcode = '40001',
        message = 'active_session_checkpoint_conflict';
    end if;

    stored_count := pg_catalog.jsonb_array_length(stored_progress -> 'events');
    requested_count := pg_catalog.jsonb_array_length(requested_progress -> 'events');
    shared_count := least(stored_count, requested_count);
    if shared_count > 0 then
      select pg_catalog.bool_and(
        stored_progress -> 'events' -> prefix_index
          = requested_progress -> 'events' -> prefix_index
      )
      into has_common_prefix
      from pg_catalog.generate_series(0, shared_count - 1) as indexes(prefix_index);
    end if;
  else
    raise exception using
      errcode = '40001',
      message = 'active_session_checkpoint_conflict';
  end if;

  if not coalesce(has_common_prefix, true) then
    raise exception using
      errcode = '40001',
      message = 'active_session_checkpoint_conflict';
  end if;

  return case
    when requested_count >= stored_count then requested_progress
    else stored_progress
  end;
end;
$$;

-- This is the server-side route/resource boundary for future broad writes.
-- It deliberately reads the committed route and the route-stamped cache from
-- storage instead of accepting method identity, target identity, or runtime
-- metadata from the browser. The app's cache contract still denies this
-- runtime, so the boundary is dormant until that separate rollout is enabled.
create or replace function public.assert_broad_recall_progress_binding_v1(
  requested_user_id uuid,
  requested_session_id uuid,
  progress jsonb,
  requested_resource_generated_at timestamptz
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  committed_route_revision_id uuid;
  route_payload jsonb;
  generated_session jsonb;
  active_target_ids jsonb;
  binding_target_ids jsonb;
  activity_index integer;
  gap_count integer;
  generated_activity jsonb;
  method_runtime jsonb;
  runtime_binding jsonb;
  runtime_binding_identity jsonb;
  stored_resource_generated_at timestamptz;
  broad_runtime_count integer;
  phase_index integer;
  route_phase jsonb;
  resource_phase jsonb;
begin
  if not public.is_valid_session_activity_progress(progress)
    or pg_catalog.jsonb_typeof(progress) is distinct from 'object'
    or progress ->> 'kind' is distinct from 'broad_recall'
    or requested_resource_generated_at is null then
    raise exception using
      errcode = '40001',
      message = 'broad_recall_progress_binding_conflict';
  end if;

  select
    session.committed_route_revision_id,
    route.route_payload,
    session.step_data -> 'generatedSession'
  into
    committed_route_revision_id,
    route_payload,
    generated_session
  from public.plan_sessions as session
  join public.study_routes as route
    on route.route_revision_id = session.committed_route_revision_id
    and route.plan_session_id = session.id
    and route.plan_id = session.plan_id
    and route.user_id = session.user_id
    and route.lifecycle = 'committed'
  where session.id = requested_session_id
    and session.user_id = requested_user_id;

  if not found
    or committed_route_revision_id is null
    or route_payload #>> '{approach,visibleSupportingTechniqueId}'
      is distinct from 'blurting_v1'
    or pg_catalog.jsonb_typeof(generated_session) is distinct from 'object'
    or generated_session ->> 'routeRevisionId'
      is distinct from committed_route_revision_id::text
    or generated_session #>> '{cacheContext,routeRevisionId}'
      is distinct from committed_route_revision_id::text then
    raise exception using
      errcode = '40001',
      message = 'broad_recall_progress_binding_conflict';
  end if;

  perform public.assert_study_route_blurting_recipe_v1(route_payload);

  begin
    activity_index := (progress ->> 'activityIndex')::integer;
    gap_count := (progress ->> 'gapCount')::integer;
    stored_resource_generated_at := (
      generated_session ->> 'generatedAt'
    )::timestamptz;
  exception when others then
    raise exception using
      errcode = '40001',
      message = 'broad_recall_progress_binding_conflict';
  end;

  if stored_resource_generated_at
      is distinct from requested_resource_generated_at then
    raise exception using
      errcode = '40001',
      message = 'broad_recall_progress_binding_conflict';
  end if;

  active_target_ids := public.study_route_active_topic_ids_v1(route_payload);
  select pg_catalog.jsonb_agg(
    binding.value ->> 'targetId'
    order by binding.ordinality
  )
  into binding_target_ids
  from pg_catalog.jsonb_array_elements(progress -> 'bindings')
    with ordinality as binding(value, ordinality);

  generated_activity := generated_session -> 'activities' -> activity_index;
  method_runtime := generated_activity -> 'methodRuntime';

  if pg_catalog.jsonb_typeof(generated_session -> 'activities') is distinct from 'array'
    or pg_catalog.jsonb_typeof(route_payload #> '{execution,orderedPhases}') is distinct from 'array'
    or pg_catalog.jsonb_array_length(generated_session -> 'activities') <> 3
    or pg_catalog.jsonb_array_length(route_payload #> '{execution,orderedPhases}') <> 3 then
    raise exception using
      errcode = '40001',
      message = 'broad_recall_progress_binding_conflict';
  end if;

  for phase_index in 0..2 loop
    route_phase := route_payload #> array[
      'execution',
      'orderedPhases',
      phase_index::text
    ];
    resource_phase := generated_session #> array[
      'activities',
      phase_index::text
    ];

    if pg_catalog.jsonb_typeof(resource_phase) is distinct from 'object'
      or pg_catalog.jsonb_typeof(resource_phase -> 'methodPhase')
        is distinct from 'string'
      or pg_catalog.jsonb_typeof(resource_phase -> 'estimatedMinutes')
        is distinct from 'number'
      or resource_phase -> 'requiredForCompletion'
        is distinct from 'true'::jsonb
      or resource_phase ->> 'methodPhase'
        is distinct from route_phase ->> 'methodPhase'
      or resource_phase ->> 'estimatedMinutes'
        is distinct from route_phase ->> 'activeMinutes'
      or (
        phase_index <> activity_index
        and resource_phase -> 'methodRuntime' is distinct from 'null'::jsonb
      ) then
      raise exception using
        errcode = '40001',
        message = 'broad_recall_progress_binding_conflict';
    end if;
  end loop;

  if pg_catalog.jsonb_typeof(method_runtime) is distinct from 'object'
    or not (method_runtime ?& array[
      'kind',
      'format',
      'sourceClosedReminder',
      'prompts',
      'comparisonInstructions',
      'gapChecklist',
      'correctionInstruction',
      'transferPrompt',
      'targetBindings'
    ]) then
    raise exception using
      errcode = '40001',
      message = 'broad_recall_progress_binding_conflict';
  end if;

  if exists (
      select 1
      from pg_catalog.jsonb_object_keys(method_runtime) as runtime_keys(runtime_key)
      where runtime_key not in (
        'kind',
        'format',
        'sourceClosedReminder',
        'prompts',
        'comparisonInstructions',
        'gapChecklist',
        'correctionInstruction',
        'transferPrompt',
        'targetBindings'
      )
    )
    or pg_catalog.octet_length(method_runtime::text) > 12000
    or pg_catalog.jsonb_typeof(method_runtime -> 'sourceClosedReminder')
      is distinct from 'string'
    or pg_catalog.length(pg_catalog.btrim(
      method_runtime ->> 'sourceClosedReminder'
    )) not between 10 and 200
    or pg_catalog.jsonb_typeof(method_runtime -> 'prompts') is distinct from 'array'
    or pg_catalog.jsonb_array_length(method_runtime -> 'prompts') <> 1
    or pg_catalog.jsonb_typeof(method_runtime #> '{prompts,0}')
      is distinct from 'object'
    or not ((method_runtime #> '{prompts,0}') ?& array[
      'prompt',
      'expectedAnswer',
      'hint'
    ])
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(
        method_runtime #> '{prompts,0}'
      ) as prompt_keys(prompt_key)
      where prompt_key not in ('prompt', 'expectedAnswer', 'hint')
    )
    or pg_catalog.jsonb_typeof(method_runtime #> '{prompts,0,prompt}')
      is distinct from 'string'
    or pg_catalog.length(pg_catalog.btrim(
      method_runtime #>> '{prompts,0,prompt}'
    )) not between 3 and 320
    or pg_catalog.jsonb_typeof(
      method_runtime #> '{prompts,0,expectedAnswer}'
    ) is distinct from 'string'
    or pg_catalog.length(pg_catalog.btrim(
      method_runtime #>> '{prompts,0,expectedAnswer}'
    )) not between 1 and 600
    or method_runtime #> '{prompts,0,hint}' is distinct from 'null'::jsonb
    or pg_catalog.jsonb_typeof(method_runtime -> 'comparisonInstructions')
      is distinct from 'string'
    or pg_catalog.length(pg_catalog.btrim(
      method_runtime ->> 'comparisonInstructions'
    )) not between 10 and 320
    or pg_catalog.jsonb_typeof(method_runtime -> 'correctionInstruction')
      is distinct from 'string'
    or pg_catalog.length(pg_catalog.btrim(
      method_runtime ->> 'correctionInstruction'
    )) not between 10 and 320
    or pg_catalog.jsonb_typeof(method_runtime -> 'transferPrompt')
      is distinct from 'object'
    or not ((method_runtime -> 'transferPrompt') ?& array[
      'sourceClosedReminder',
      'prompt',
      'expectedAnswer'
    ])
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(
        method_runtime -> 'transferPrompt'
      ) as transfer_keys(transfer_key)
      where transfer_key not in (
        'sourceClosedReminder',
        'prompt',
        'expectedAnswer'
      )
    )
    or pg_catalog.jsonb_typeof(
      method_runtime #> '{transferPrompt,sourceClosedReminder}'
    ) is distinct from 'string'
    or pg_catalog.length(pg_catalog.btrim(
      method_runtime #>> '{transferPrompt,sourceClosedReminder}'
    )) not between 10 and 200
    or pg_catalog.jsonb_typeof(method_runtime #> '{transferPrompt,prompt}')
      is distinct from 'string'
    or pg_catalog.length(pg_catalog.btrim(
      method_runtime #>> '{transferPrompt,prompt}'
    )) not between 3 and 320
    or pg_catalog.jsonb_typeof(
      method_runtime #> '{transferPrompt,expectedAnswer}'
    ) is distinct from 'string'
    or pg_catalog.length(pg_catalog.btrim(
      method_runtime #>> '{transferPrompt,expectedAnswer}'
    )) not between 1 and 600
    or pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.btrim(method_runtime #>> '{prompts,0,prompt}'),
      '[[:space:]]+',
      ' ',
      'g'
    )) = pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.btrim(method_runtime #>> '{transferPrompt,prompt}'),
      '[[:space:]]+',
      ' ',
      'g'
    )) then
    raise exception using
      errcode = '40001',
      message = 'broad_recall_progress_binding_conflict';
  end if;

  if pg_catalog.jsonb_typeof(method_runtime -> 'targetBindings')
      is distinct from 'array'
    or pg_catalog.jsonb_array_length(method_runtime -> 'targetBindings')
      not between 1 and 3 then
    raise exception using
      errcode = '40001',
      message = 'broad_recall_progress_binding_conflict';
  end if;

  for runtime_binding in
    select binding.value
    from pg_catalog.jsonb_array_elements(
      method_runtime -> 'targetBindings'
    ) as binding(value)
  loop
    if pg_catalog.jsonb_typeof(runtime_binding) is distinct from 'object'
      or not (runtime_binding ?& array[
        'targetId',
        'evidenceId',
        'concept',
        'comparisonCriterion',
        'transferSuccessCriterion'
      ])
      or exists (
        select 1
        from pg_catalog.jsonb_object_keys(runtime_binding)
          as binding_keys(binding_key)
        where binding_key not in (
          'targetId',
          'evidenceId',
          'concept',
          'comparisonCriterion',
          'transferSuccessCriterion'
        )
      )
      or pg_catalog.jsonb_typeof(runtime_binding -> 'targetId') is distinct from 'string'
      or pg_catalog.jsonb_typeof(runtime_binding -> 'evidenceId') is distinct from 'string'
      or pg_catalog.jsonb_typeof(runtime_binding -> 'concept') is distinct from 'string'
      or pg_catalog.jsonb_typeof(
        runtime_binding -> 'comparisonCriterion'
      ) is distinct from 'string'
      or pg_catalog.jsonb_typeof(
        runtime_binding -> 'transferSuccessCriterion'
      ) is distinct from 'string'
      or pg_catalog.length(pg_catalog.btrim(
        runtime_binding ->> 'concept'
      )) not between 2 and 120
      or pg_catalog.length(pg_catalog.btrim(
        runtime_binding ->> 'comparisonCriterion'
      )) not between 8 and 240
      or pg_catalog.length(pg_catalog.btrim(
        runtime_binding ->> 'transferSuccessCriterion'
      )) not between 8 and 240
      or runtime_binding ->> 'evidenceId'
        is distinct from 'blurting-final-check:' || (runtime_binding ->> 'targetId') then
      raise exception using
        errcode = '40001',
        message = 'broad_recall_progress_binding_conflict';
    end if;
  end loop;

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'targetId', binding.value ->> 'targetId',
      'evidenceId', binding.value ->> 'evidenceId'
    )
    order by binding.ordinality
  )
  into runtime_binding_identity
  from pg_catalog.jsonb_array_elements(
    method_runtime -> 'targetBindings'
  ) with ordinality as binding(value, ordinality);

  select pg_catalog.count(*)::integer
  into broad_runtime_count
  from pg_catalog.jsonb_array_elements(
    generated_session -> 'activities'
  ) as activity(value)
  where activity.value #>> '{methodRuntime,kind}' = 'retrieval_round'
    and activity.value #>> '{methodRuntime,format}' = 'broad_recall_v1';

  if binding_target_ids is distinct from active_target_ids
    or runtime_binding_identity is distinct from progress -> 'bindings'
    or generated_session -> 'topicIds' is distinct from active_target_ids
    or generated_session #>> '{methodBriefing,methodId}'
      is distinct from 'retrieval_practice'
    or generated_session #>> '{methodBriefing,learningMode}'
      is distinct from 'study'
    or generated_session #>> '{methodBriefing,name}'
      is distinct from 'Blurting'
    or broad_runtime_count <> 1
    or pg_catalog.jsonb_typeof(generated_activity) is distinct from 'object'
    or generated_activity ->> 'methodPhase' is distinct from 'retrieve'
    or generated_activity -> 'requiredForCompletion' is distinct from 'true'::jsonb
    or pg_catalog.jsonb_typeof(method_runtime) is distinct from 'object'
    or method_runtime ->> 'kind' is distinct from 'retrieval_round'
    or method_runtime ->> 'format' is distinct from 'broad_recall_v1'
    or pg_catalog.jsonb_typeof(method_runtime -> 'gapChecklist')
      is distinct from 'array'
    or pg_catalog.jsonb_array_length(method_runtime -> 'gapChecklist') <> gap_count
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(method_runtime -> 'gapChecklist') as gap(entry)
      where pg_catalog.jsonb_typeof(gap.entry) is distinct from 'string'
        or pg_catalog.length(pg_catalog.btrim(gap.entry #>> '{}')) not between 3 and 240
    )
    then
    raise exception using
      errcode = '40001',
      message = 'broad_recall_progress_binding_conflict';
  end if;
end;
$$;

-- Keep the established RPC name and old-client behavior. Absence of
-- activityProgress preserves same-step progress and strips the unknown field
-- from the response; an advancing content step intentionally clears it.
create or replace function public.save_active_session_checkpoint_with_completion_mode(
  payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_session_id uuid;
  stored_checkpoint jsonb;
  canonical_checkpoint jsonb;
  requested_completion_mode text;
  canonical_completion_mode text;
  requested_activity_progress jsonb := payload -> 'activityProgress';
  stored_activity_progress jsonb;
  canonical_activity_progress jsonb;
  requested_completed_steps integer;
  stored_completed_steps integer;
  caller_supports_activity_progress boolean := payload ? 'activityProgress';
begin
  if pg_catalog.jsonb_typeof(payload) <> 'object' then
    raise exception 'The active-session checkpoint shape is not valid.';
  end if;

  if payload ? 'completionMode' and (
    pg_catalog.jsonb_typeof(payload -> 'completionMode') <> 'string'
    or coalesce(payload ->> 'completionMode', '')
      not in ('guided', 'unguided_practice')
  ) then
    raise exception 'The active-session checkpoint completion mode is not valid.';
  end if;

  if not public.is_valid_session_activity_progress(requested_activity_progress)
    or (
      requested_activity_progress is not null
      and pg_catalog.jsonb_typeof(requested_activity_progress) <> 'null'
      and payload ->> 'status' <> 'working'
    ) then
    raise exception 'The active-session activity progress is not valid.';
  end if;

  requested_completion_mode := coalesce(
    payload ->> 'completionMode',
    'guided'
  );

  begin
    requested_session_id := nullif(
      payload ->> 'planSessionId',
      ''
    )::uuid;
    requested_completed_steps := (payload ->> 'completedSteps')::integer;
  exception when others then
    raise exception 'The active-session checkpoint values are not valid.';
  end;

  select session.step_data -> 'activeSessionCheckpoint'
  into stored_checkpoint
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.user_id = current_user_id
  for update;

  if pg_catalog.jsonb_typeof(stored_checkpoint) = 'object'
    and stored_checkpoint ->> 'runId' is not distinct from payload ->> 'runId'
    and stored_checkpoint ->> 'resourceFingerprint'
      is not distinct from payload ->> 'resourceFingerprint' then
    canonical_completion_mode := coalesce(
      stored_checkpoint ->> 'completionMode',
      'guided'
    );

    if canonical_completion_mode not in ('guided', 'unguided_practice')
      or requested_completion_mode is distinct from canonical_completion_mode then
      raise exception using
        errcode = '40001',
        message = 'active_session_checkpoint_conflict';
    end if;

    stored_activity_progress := stored_checkpoint -> 'activityProgress';
    if not public.is_valid_session_activity_progress(stored_activity_progress) then
      raise exception using
        errcode = '40001',
        message = 'active_session_checkpoint_conflict';
    end if;

    begin
      stored_completed_steps := (stored_checkpoint ->> 'completedSteps')::integer;
    exception when others then
      raise exception using
        errcode = '40001',
        message = 'active_session_checkpoint_conflict';
    end;

    if requested_completed_steps > stored_completed_steps then
      canonical_activity_progress := requested_activity_progress;
    elsif requested_completed_steps < stored_completed_steps then
      canonical_activity_progress := stored_activity_progress;
    else
      canonical_activity_progress := public.merge_session_activity_progress_v1(
        stored_activity_progress,
        requested_activity_progress
      );
    end if;
  else
    canonical_completion_mode := requested_completion_mode;
    canonical_activity_progress := requested_activity_progress;
  end if;

  canonical_checkpoint := public.save_active_session_checkpoint(
    payload - 'completionMode' - 'activityProgress'
  );

  if pg_catalog.jsonb_typeof(canonical_checkpoint) <> 'object' then
    raise exception using
      errcode = '40001',
      message = 'active_session_checkpoint_conflict';
  end if;

  if canonical_checkpoint ? 'completionMode'
    and canonical_checkpoint ->> 'completionMode'
      is distinct from canonical_completion_mode then
    raise exception using
      errcode = '40001',
      message = 'active_session_checkpoint_conflict';
  end if;

  canonical_checkpoint := canonical_checkpoint || pg_catalog.jsonb_build_object(
    'completionMode',
    canonical_completion_mode
  );
  if canonical_checkpoint ->> 'status' = 'working'
    and pg_catalog.jsonb_typeof(canonical_activity_progress) = 'object' then
    canonical_checkpoint := canonical_checkpoint || pg_catalog.jsonb_build_object(
      'activityProgress',
      canonical_activity_progress
    );
  else
    canonical_checkpoint := canonical_checkpoint - 'activityProgress';
  end if;

  update public.plan_sessions
  set step_data = pg_catalog.jsonb_set(
    step_data,
    '{activeSessionCheckpoint}',
    canonical_checkpoint,
    false
  )
  where id = (canonical_checkpoint ->> 'planSessionId')::uuid
    and user_id = current_user_id
    and step_data -> 'activeSessionCheckpoint' ->> 'runId'
      = canonical_checkpoint ->> 'runId'
    and step_data -> 'activeSessionCheckpoint' ->> 'resourceFingerprint'
      = canonical_checkpoint ->> 'resourceFingerprint';

  if not found then
    raise exception using
      errcode = '40001',
      message = 'active_session_checkpoint_conflict';
  end if;

  return case
    when caller_supports_activity_progress then canonical_checkpoint
    else canonical_checkpoint - 'activityProgress'
  end;
end;
$$;

-- Preserve the mature interruption writer and its established signature. A
-- terminal marker may be enriched once when legacy rows have no marker. After
-- either durable row contains progress, replay must match both the full mature
-- interruption projection and the exact immutable activity prefix.
create or replace function public.record_session_interruption_with_activity_progress(
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  interrupted_plan_id uuid;
  requested_attempt_id uuid;
  requested_session_id uuid;
  requested_activity_progress jsonb := payload -> 'activityProgress';
  stored_attempt_progress jsonb;
  stored_event_progress jsonb;
  canonical_activity_progress jsonb;
  stored_attempt_started_at timestamptz;
  stored_attempt_actual_minutes smallint;
  stored_attempt_result jsonb;
  stored_event_count integer;
  stored_event_data jsonb;
  stored_event_occurred_at timestamptz;
  expected_attempt_result jsonb;
  expected_event_data jsonb;
  requested_started_at timestamptz;
  requested_interrupted_at timestamptz;
  requested_actual_minutes smallint;
  requested_completed_steps smallint;
  requested_resume_step smallint;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.is_valid_session_activity_progress(requested_activity_progress) then
    raise exception 'The interrupted-session activity progress is not valid.';
  end if;

  -- Unlike a checkpoint, the established interruption payload has no resource
  -- fingerprint or generated timestamp. Its mature INSERT also clears the
  -- matching checkpoint before this wrapper attaches progress, so consulting
  -- only the current cache could bind a delayed exit to a replacement lesson.
  -- A later route-aware wrapper must capture and verify resource identity
  -- before the terminal delegate, then replace this fail-closed branch.
  if pg_catalog.jsonb_typeof(requested_activity_progress) = 'object'
    and requested_activity_progress ->> 'kind' = 'broad_recall' then
    raise exception using
      errcode = '55000',
      message = 'broad_recall_interruption_resource_identity_required';
  end if;

  begin
    requested_attempt_id := nullif(payload ->> 'attemptId', '')::uuid;
    requested_session_id := nullif(payload ->> 'planSessionId', '')::uuid;
    requested_started_at := (payload ->> 'startedAt')::timestamptz;
    requested_interrupted_at := (payload ->> 'interruptedAt')::timestamptz;
    requested_actual_minutes := (payload ->> 'actualMinutes')::smallint;
    requested_completed_steps := (payload ->> 'completedSteps')::smallint;
    requested_resume_step := coalesce(
      (payload ->> 'resumeStep')::smallint,
      requested_completed_steps
    );
  exception when others then
    raise exception 'Session identifiers are not valid.';
  end;

  interrupted_plan_id := public.record_session_interruption(
    payload - 'activityProgress'
  );

  expected_attempt_result := pg_catalog.jsonb_build_object(
    'status', 'interrupted',
    'interruptedAt', requested_interrupted_at,
    'plannedMinutes', (payload ->> 'plannedMinutes')::smallint,
    'completedSteps', requested_completed_steps,
    'totalSteps', (payload ->> 'totalSteps')::smallint,
    'resumeStep', requested_resume_step,
    'evidence', coalesce(payload -> 'evidence', '{}'::jsonb),
    'pendingRepair', payload -> 'pendingRepair',
    'sessionAdjustment', payload -> 'sessionAdjustment'
  );
  expected_event_data := pg_catalog.jsonb_build_object(
    'attemptId', requested_attempt_id::text,
    'startedAt', requested_started_at,
    'plannedMinutes', (payload ->> 'plannedMinutes')::smallint,
    'actualMinutes', requested_actual_minutes,
    'completedSteps', requested_completed_steps,
    'totalSteps', (payload ->> 'totalSteps')::smallint,
    'resumeStep', requested_resume_step,
    'evidence', coalesce(payload -> 'evidence', '{}'::jsonb),
    'pendingRepair', payload -> 'pendingRepair',
    'sessionAdjustment', payload -> 'sessionAdjustment'
  );

  select
    attempt.started_at,
    attempt.actual_minutes,
    attempt.result_data,
    attempt.result_data -> 'activityProgress'
  into
    stored_attempt_started_at,
    stored_attempt_actual_minutes,
    stored_attempt_result,
    stored_attempt_progress
  from public.session_attempts as attempt
  where attempt.id = requested_attempt_id
    and attempt.user_id = current_user_id
    and attempt.plan_session_id = requested_session_id
  for update;

  if not found then
    raise exception 'The interrupted session could not preserve its activity progress.';
  end if;

  select
    pg_catalog.count(*)::integer,
    (pg_catalog.jsonb_agg(event.event_data order by event.id) -> 0),
    pg_catalog.min(event.occurred_at)
  into
    stored_event_count,
    stored_event_data,
    stored_event_occurred_at
  from public.learning_events as event
  where event.user_id = current_user_id
    and event.plan_session_id = requested_session_id
    and event.event_type = 'session_interrupted'
    and event.event_data ->> 'attemptId' = requested_attempt_id::text;

  if stored_event_count <> 1 then
    raise exception 'The interrupted session could not preserve its recovery event.';
  end if;
  stored_event_progress := stored_event_data -> 'activityProgress';

  if stored_attempt_started_at is distinct from requested_started_at
    or stored_attempt_actual_minutes is distinct from requested_actual_minutes
    or stored_attempt_result - 'activityProgress' - 'routeRevisionId'
      is distinct from expected_attempt_result
    or stored_event_occurred_at is distinct from requested_interrupted_at
    or stored_event_data - 'activityProgress' - 'routeRevisionId'
      is distinct from expected_event_data then
    raise exception using
      errcode = '40001',
      message = 'session_interruption_activity_progress_conflict';
  end if;

  if not public.is_valid_session_activity_progress(stored_attempt_progress)
    or not public.is_valid_session_activity_progress(stored_event_progress) then
    raise exception using
      errcode = '40001',
      message = 'session_interruption_activity_progress_conflict';
  end if;

  if pg_catalog.jsonb_typeof(stored_attempt_progress) = 'object'
    and pg_catalog.jsonb_typeof(stored_event_progress) = 'object'
    and stored_attempt_progress is distinct from stored_event_progress then
    raise exception using
      errcode = '40001',
      message = 'session_interruption_activity_progress_conflict';
  end if;

  canonical_activity_progress := case
    when pg_catalog.jsonb_typeof(stored_attempt_progress) = 'object'
      then stored_attempt_progress
    when pg_catalog.jsonb_typeof(stored_event_progress) = 'object'
      then stored_event_progress
    else requested_activity_progress
  end;

  if pg_catalog.jsonb_typeof(requested_activity_progress) = 'object'
    and pg_catalog.jsonb_typeof(canonical_activity_progress) = 'object'
    and requested_activity_progress is distinct from canonical_activity_progress then
    raise exception using
      errcode = '40001',
      message = 'session_interruption_activity_progress_conflict';
  end if;

  if pg_catalog.jsonb_typeof(canonical_activity_progress) = 'object' then
    update public.session_attempts as attempt
    set result_data = attempt.result_data || pg_catalog.jsonb_build_object(
      'activityProgress',
      canonical_activity_progress
    )
    where attempt.id = requested_attempt_id
      and attempt.user_id = current_user_id
      and attempt.plan_session_id = requested_session_id;

    if not found then
      raise exception 'The interrupted session could not preserve its activity progress.';
    end if;

    update public.learning_events as event
    set event_data = event.event_data || pg_catalog.jsonb_build_object(
      'activityProgress',
      canonical_activity_progress
    )
    where event.user_id = current_user_id
      and event.plan_session_id = requested_session_id
      and event.event_type = 'session_interrupted'
      and event.event_data ->> 'attemptId' = requested_attempt_id::text;

    if not found then
      raise exception 'The interrupted session could not preserve its recovery event.';
    end if;
  end if;

  return interrupted_plan_id;
end;
$$;

-- Enforce route/resource binding below the checkpoint wrappers. The existing
-- route-aware RPC writes an intermediate legacy checkpoint and stamps route
-- identity afterward; this guard validates only the broad marker, so that
-- established two-update sequence and every retrieval-round write remain
-- unchanged. Terminal guards independently keep interruption fail closed until
-- a wrapper can carry the resource identity missing from today's payload.
create or replace function public.guard_broad_recall_checkpoint_binding_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  checkpoint jsonb := new.step_data -> 'activeSessionCheckpoint';
  progress jsonb := checkpoint -> 'activityProgress';
  completed_steps integer;
  resource_generated_at timestamptz;
begin
  if checkpoint is not distinct from old.step_data -> 'activeSessionCheckpoint'
    or pg_catalog.jsonb_typeof(progress) <> 'object'
    or progress ->> 'kind' <> 'broad_recall' then
    return new;
  end if;

  begin
    completed_steps := (checkpoint ->> 'completedSteps')::integer;
    resource_generated_at := (
      checkpoint ->> 'resourceGeneratedAt'
    )::timestamptz;
  exception when others then
    raise exception using
      errcode = '40001',
      message = 'broad_recall_progress_binding_conflict';
  end;

  if progress ->> 'activityIndex' is distinct from completed_steps::text then
    raise exception using
      errcode = '40001',
      message = 'broad_recall_progress_binding_conflict';
  end if;

  if checkpoint -> 'pendingRepair' is not null
    or checkpoint -> 'evidence' is not null then
    raise exception using
      errcode = '40001',
      message = 'broad_recall_unverified_evidence_forbidden';
  end if;

  perform public.assert_broad_recall_progress_binding_v1(
    new.user_id,
    new.id,
    progress,
    resource_generated_at
  );
  return new;
end;
$$;

create or replace function public.guard_broad_recall_attempt_binding_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  progress jsonb := new.result_data -> 'activityProgress';
begin
  if pg_catalog.jsonb_typeof(progress) <> 'object'
    or progress ->> 'kind' <> 'broad_recall' then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'broad_recall_interruption_resource_identity_required';
end;
$$;

create or replace function public.guard_broad_recall_event_binding_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  progress jsonb := new.event_data -> 'activityProgress';
begin
  if new.event_type <> 'session_interrupted'
    or pg_catalog.jsonb_typeof(progress) <> 'object'
    or progress ->> 'kind' <> 'broad_recall' then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'broad_recall_interruption_resource_identity_required';
end;
$$;

drop trigger if exists plan_sessions_guard_broad_recall_checkpoint_v1
on public.plan_sessions;
create trigger plan_sessions_guard_broad_recall_checkpoint_v1
before update of step_data on public.plan_sessions
for each row execute function public.guard_broad_recall_checkpoint_binding_v1();

drop trigger if exists session_attempts_guard_broad_recall_progress_v1
on public.session_attempts;
create trigger session_attempts_guard_broad_recall_progress_v1
before insert or update of result_data on public.session_attempts
for each row execute function public.guard_broad_recall_attempt_binding_v1();

drop trigger if exists learning_events_guard_broad_recall_progress_v1
on public.learning_events;
create trigger learning_events_guard_broad_recall_progress_v1
before insert or update of event_type, event_data on public.learning_events
for each row execute function public.guard_broad_recall_event_binding_v1();

-- Preserve the final ordered ACL: validation remains readable by the signed-in
-- client, mature delegates and all new helpers stay private, and the already
-- exposed route-aware checkpoint/interruption signatures remain untouched.
revoke all on function public.is_valid_session_activity_progress(jsonb)
from public, anon;
grant execute on function public.is_valid_session_activity_progress(jsonb)
to authenticated;

revoke all on function public.merge_session_activity_progress_v1(jsonb, jsonb)
from public, anon, authenticated;
revoke all on function public.assert_broad_recall_progress_binding_v1(
  uuid, uuid, jsonb, timestamptz
) from public, anon, authenticated;
revoke all on function public.guard_broad_recall_checkpoint_binding_v1()
from public, anon, authenticated;
revoke all on function public.guard_broad_recall_attempt_binding_v1()
from public, anon, authenticated;
revoke all on function public.guard_broad_recall_event_binding_v1()
from public, anon, authenticated;

revoke all on function public.save_active_session_checkpoint_with_completion_mode(jsonb)
from public, anon, authenticated;
revoke all on function public.record_session_interruption_with_activity_progress(jsonb)
from public, anon, authenticated;

comment on function public.assert_broad_recall_progress_binding_v1(
  uuid, uuid, jsonb, timestamptz
) is
  'Dormant checkpoint boundary: accepts broad-recall progress only for the exact committed Blurting route, generated timestamp, and route-stamped cached broad-recall activity; interruption remains fail closed pending a resource-aware wrapper.';

commit;
