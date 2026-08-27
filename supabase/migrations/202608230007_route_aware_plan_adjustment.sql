-- Route-aware plan adjustment keeps immutable decision history attached to its
-- original session rows. The first split part deliberately reuses its original
-- session id and therefore receives a same-lineage successor; only additional
-- split/deferred ids receive independent revision-one lineages.

-- Retired routed sessions remain as skipped tombstones. Excluding skipped rows
-- from the scheduling key lets their original sequence remain available to the
-- active replacement without deleting the route-owning row.
alter table public.plan_sessions
drop constraint plan_sessions_plan_id_sequence_key;

create unique index plan_sessions_active_sequence_key
on public.plan_sessions(plan_id, sequence)
where status <> 'skipped';

-- The mature completion writer names the old full uniqueness constraint in an
-- ON CONFLICT inference clause. Once skipped history is excluded from the
-- scheduling key, that clause must name the identical predicate or PostgreSQL
-- rejects guided follow-up insertion before it can degrade to DO NOTHING.
do $$
declare
  completion_definition text;
  patched_completion_definition text;
begin
  completion_definition := pg_catalog.pg_get_functiondef(
    'public.complete_plan_session(jsonb)'::pg_catalog.regprocedure
  );
  patched_completion_definition := pg_catalog.replace(
    completion_definition,
    E'and sequence = completed_session.sequence + 1\n        and id <> (follow_up ->> ''id'')::uuid',
    E'and sequence = completed_session.sequence + 1\n        and status <> ''skipped''\n        and id <> (follow_up ->> ''id'')::uuid'
  );
  patched_completion_definition := pg_catalog.replace(
    patched_completion_definition,
    'on conflict (plan_id, sequence) do nothing;',
    'on conflict (plan_id, sequence) where status <> ''skipped'' do nothing;'
  );

  if patched_completion_definition is not distinct from completion_definition
    or pg_catalog.strpos(
      patched_completion_definition,
      E'and sequence = completed_session.sequence + 1\n        and status <> ''skipped'''
    ) = 0
    or pg_catalog.strpos(
      patched_completion_definition,
      'on conflict (plan_id, sequence) where status <> ''skipped'' do nothing;'
    ) = 0 then
    raise exception using
      errcode = '55000',
      message = 'route_adjustment_completion_conflict_patch_missing';
  end if;

  execute patched_completion_definition;
end;
$$;

-- Keep revision history meaningful at the database boundary too. Identity,
-- learner-control metadata, prose, confidence labels, and provenance can
-- explain a decision but cannot alone justify a new route revision.
create or replace function public.route_adjustment_material_projection_v1(
  route_payload jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'target', route_payload -> 'target',
    'approach', pg_catalog.jsonb_build_object(
      'mode', route_payload #> '{approach,mode}',
      'executionEnvironment',
        route_payload #> '{approach,executionEnvironment}',
      'primaryMethodId', route_payload #> '{approach,primaryMethodId}'
    ),
    'timing', (route_payload -> 'timing') - 'durationSource',
    'execution', route_payload -> 'execution'
  );
$$;

revoke all on function public.route_adjustment_material_projection_v1(jsonb)
from public, anon, authenticated;

-- Preserve the mature destructive implementation solely for plans that have
-- no StudyRoute coverage. It is not an authenticated boundary after cutover.
alter function public.adjust_learning_plan(jsonb)
rename to adjust_learning_plan_without_study_routes;

revoke all on function public.adjust_learning_plan_without_study_routes(jsonb)
from public, anon, authenticated;

create or replace function public.adjust_learning_plan_with_routes(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_plan_id uuid;
  requested_plan public.plans%rowtype;
  current_study_mode text;
  current_source_mode text;
  next_deadline timestamptz;
  next_study_mode text;
  next_minutes smallint;
  replacement_count integer;
  payload_route_count integer;
  current_session_count integer;
  current_route_count integer;
  protected_count integer;
  stored_protected_count integer;
  replacement jsonb;
  requested_session_id uuid;
  requested_route jsonb;
  requested_route_revision_id uuid;
  existing_session public.plan_sessions%rowtype;
  existing_route_revision_id uuid;
  explicit_origin_session_id uuid;
  expected_origin_revision_id uuid;
  origin_reference_count integer;
  origin_reference_revision_id uuid;
  predecessor_route_payload jsonb;
  authoritative_sessions jsonb := '[]'::jsonb;
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'Authentication is required.';
  end if;

  if pg_catalog.jsonb_typeof(payload) is distinct from 'object'
    or pg_catalog.jsonb_typeof(payload -> 'sessions') is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'plan_adjustment_shape_invalid';
  end if;

  begin
    requested_plan_id := (payload ->> 'planId')::uuid;
    next_deadline := nullif(payload ->> 'deadline', '')::timestamptz;
    next_study_mode := payload ->> 'studyMode';
    next_minutes := (payload ->> 'futureSessionMinutes')::smallint;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'plan_adjustment_values_invalid';
  end;

  replacement_count := pg_catalog.jsonb_array_length(payload -> 'sessions');
  if next_study_mode is null
    or next_study_mode not in ('inside_yova', 'outside_yova')
    or next_minutes not between 10 and 90
    or replacement_count not between 1 and 14
    or (
      next_deadline is not null
      and (
        next_deadline < now() - interval '1 hour'
        or next_deadline > now() + interval '5 years'
      )
    ) then
    raise exception using
      errcode = '22023',
      message = 'plan_adjustment_values_invalid';
  end if;

  -- Canonical writer order shared with Reset and post-session route writes.
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

  if not found or requested_plan.status <> 'active' then
    raise exception using
      errcode = '55000',
      message = 'plan_adjustment_plan_not_active';
  end if;

  select item.study_mode, item.source_mode
  into current_study_mode, current_source_mode
  from public.learning_items as item
  where item.id = requested_plan.learning_item_id
    and item.user_id = current_user_id;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'plan_adjustment_learning_item_missing';
  end if;

  perform session.id
  from public.plan_sessions as session
  where session.plan_id = requested_plan.id
    and session.user_id = current_user_id
  order by session.sequence, session.id
  for update;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(session.committed_route_revision_id)::integer
  into current_session_count, current_route_count
  from public.plan_sessions as session
  where session.plan_id = requested_plan.id
    and session.user_id = current_user_id;

  if current_route_count <> 0 and current_route_count <> current_session_count then
    raise exception using
      errcode = '40001',
      message = 'plan_adjustment_partial_route_coverage';
  end if;

  select pg_catalog.count(*)::integer
  into payload_route_count
  from pg_catalog.jsonb_array_elements(payload -> 'sessions') as candidate(value)
  where pg_catalog.jsonb_typeof(candidate.value -> 'studyRoute') = 'object';

  if (current_route_count = 0 and payload_route_count <> 0)
    or (current_route_count > 0 and payload_route_count <> replacement_count)
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(payload -> 'sessions') as candidate(value)
      where candidate.value ? 'studyRoute'
        and pg_catalog.jsonb_typeof(candidate.value -> 'studyRoute') <> 'object'
    ) then
    raise exception using
      errcode = '40001',
      message = 'plan_adjustment_route_coverage_conflict';
  end if;

  -- The private mature implementation remains the exact legacy behavior. The
  -- account, plan, and ordered session locks above are already held when it
  -- reacquires its narrower locks.
  if current_route_count = 0 then
    return public.adjust_learning_plan_without_study_routes(payload);
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(payload -> 'sessions') as candidate(value)
    where pg_catalog.jsonb_typeof(candidate.value) <> 'object'
      or nullif(candidate.value ->> 'id', '') is null
      or nullif(candidate.value ->> 'sequence', '') is null
      or (candidate.value ->> 'sequence')::integer not between 1 and 14
      or candidate.value ->> 'status' not in ('ready', 'upcoming')
      or (
        not coalesce((candidate.value ->> 'protected')::boolean, false)
        and (
          pg_catalog.jsonb_typeof(candidate.value -> 'estimatedMinutes')
            is distinct from 'number'
          or (candidate.value ->> 'estimatedMinutes')::integer not between 10 and 90
        )
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'plan_adjustment_session_invalid';
  end if;

  begin
    if (
      select pg_catalog.count(distinct (candidate.value ->> 'id')::uuid)
      from pg_catalog.jsonb_array_elements(payload -> 'sessions') as candidate(value)
    ) <> replacement_count
    or (
      select pg_catalog.count(
        distinct (candidate.value ->> 'sequence')::integer
      )
      from pg_catalog.jsonb_array_elements(payload -> 'sessions') as candidate(value)
    ) <> replacement_count
    or (
      select pg_catalog.count(distinct (
        candidate.value #>> '{studyRoute,identity,routeRevisionId}'
      )::uuid)
      from pg_catalog.jsonb_array_elements(payload -> 'sessions') as candidate(value)
    ) <> replacement_count then
      raise exception using
        errcode = '22023',
        message = 'plan_adjustment_session_identity_duplicate';
    end if;
  exception
    when sqlstate '22023' then raise;
    when others then
      raise exception using
        errcode = '22023',
        message = 'plan_adjustment_route_identity_invalid';
  end;

  select pg_catalog.count(*)::integer
  into protected_count
  from pg_catalog.jsonb_array_elements(payload -> 'sessions') as candidate(value)
  where coalesce((candidate.value ->> 'protected')::boolean, false);

  select pg_catalog.count(*)::integer
  into stored_protected_count
  from public.plan_sessions as session
  where session.plan_id = requested_plan.id
    and session.user_id = current_user_id
    and session.status in ('ready', 'upcoming')
    and pg_catalog.jsonb_typeof(session.step_data) = 'object'
    and session.step_data ->> 'reviewType' in (
      'repair_and_retrieve',
      'verify',
      'maintenance_transfer'
    );

  if protected_count <> stored_protected_count
    or exists (
      select 1
      from public.plan_sessions as session
      where session.plan_id = requested_plan.id
        and session.user_id = current_user_id
        and session.status in ('ready', 'upcoming')
        and session.step_data ->> 'reviewType' in (
          'repair_and_retrieve',
          'verify',
          'maintenance_transfer'
        )
        and not exists (
          select 1
          from pg_catalog.jsonb_array_elements(payload -> 'sessions') as candidate(value)
          where coalesce((candidate.value ->> 'protected')::boolean, false)
            and (candidate.value ->> 'id')::uuid = session.id
        )
    ) or exists (
      select 1
      from pg_catalog.jsonb_array_elements(payload -> 'sessions') as candidate(value)
      left join public.plan_sessions as session
        on session.id = (candidate.value ->> 'id')::uuid
        and session.plan_id = requested_plan.id
        and session.user_id = current_user_id
        and session.status in ('ready', 'upcoming')
        and session.step_data ->> 'reviewType' in (
          'repair_and_retrieve',
          'verify',
          'maintenance_transfer'
        )
      where coalesce((candidate.value ->> 'protected')::boolean, false)
        and session.id is null
    ) then
    raise exception using
      errcode = '40001',
      message = 'plan_adjustment_protected_review_conflict';
  end if;

  -- Session generation still treats a protected review's committed route as
  -- authoritative. Do not let the plan-level environment diverge from that
  -- immutable review route during the same adjustment.
  if stored_protected_count > 0
    and current_study_mode is distinct from next_study_mode then
    raise exception using
      errcode = '40001',
      message = 'plan_adjustment_protected_environment_conflict';
  end if;

  if exists (
    select 1
    from public.plan_sessions as session
    where session.plan_id = requested_plan.id
      and session.user_id = current_user_id
      and session.status in ('ready', 'upcoming')
      and not coalesce((
        session.step_data ->> 'reviewType' in (
          'repair_and_retrieve',
          'verify',
          'maintenance_transfer'
        )
      ), false)
      and (
        session.step_data ? 'generatedSession'
        or session.step_data ? 'activeSessionCheckpoint'
        or exists (
          select 1
          from public.learning_events as event
          where event.user_id = current_user_id
            and event.plan_session_id = session.id
            and event.event_type = 'session_interrupted'
        )
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'plan_adjustment_saved_work_protected';
  end if;

  -- Validate every route identity and every new-session origin against the
  -- locked pre-adjustment pointer set before the first mutation.
  for replacement in
    select candidate.value
    from pg_catalog.jsonb_array_elements(payload -> 'sessions') as candidate(value)
    order by (candidate.value ->> 'sequence')::integer,
      (candidate.value ->> 'id')::uuid
  loop
    begin
      requested_session_id := (replacement ->> 'id')::uuid;
      requested_route := replacement -> 'studyRoute';
      requested_route_revision_id := (
        requested_route #>> '{identity,routeRevisionId}'
      )::uuid;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'plan_adjustment_route_identity_invalid';
    end;

    if coalesce(
        requested_route #>> '{approach,primaryMethodId}',
        ''
      ) not in (
        'retrieval_practice',
        'spaced_retrieval',
        'self_explanation',
        'worked_example_fading',
        'interleaved_practice',
        'read_recall_review',
        'retrieval_based_outlining',
        'scaffolded_coding',
        'practice_test_error_repair'
      )
      or (
        case requested_route #>> '{target,sourceRequirements,sourceType}'
          when 'user_materials' then 'user_materials'
          when 'yova_generated' then 'yova_generated'
          when 'trusted_external_source' then 'yova_generated'
          else null
        end
      ) is distinct from current_source_mode then
      raise exception using
        errcode = '40001',
        message = 'plan_adjustment_route_projection_conflict';
    end if;

    select session.*
    into existing_session
    from public.plan_sessions as session
    where session.id = requested_session_id
      and session.plan_id = requested_plan.id
      and session.user_id = current_user_id;

    if found then
      if existing_session.status not in ('ready', 'upcoming') then
        raise exception using
          errcode = '40001',
          message = 'plan_adjustment_reused_session_terminal';
      end if;
      existing_route_revision_id := existing_session.committed_route_revision_id;

      if coalesce((replacement ->> 'protected')::boolean, false) then
        if requested_route_revision_id
          is distinct from existing_route_revision_id then
          raise exception using
            errcode = '40001',
            message = 'plan_adjustment_protected_route_conflict';
        end if;
      elsif requested_route_revision_id
          is distinct from existing_route_revision_id then
        perform public.validate_study_route_write_identity(
          requested_route,
          requested_plan.id,
          requested_session_id,
          existing_route_revision_id,
          false
        );

        select route.route_payload
        into predecessor_route_payload
        from public.study_routes as route
        where route.route_revision_id = existing_route_revision_id
          and route.plan_session_id = requested_session_id
          and route.plan_id = requested_plan.id
          and route.user_id = current_user_id
          and route.lifecycle = 'committed';

        if not found
          or public.route_adjustment_material_projection_v1(
            requested_route - 'identity'
          ) is not distinct from
            public.route_adjustment_material_projection_v1(
              predecessor_route_payload
            ) then
          raise exception using
            errcode = '40001',
            message = 'plan_adjustment_route_revision_not_material';
        end if;
      end if;

      if not coalesce((replacement ->> 'protected')::boolean, false)
        and requested_route #>> '{approach,executionEnvironment}'
          is distinct from next_study_mode then
        raise exception using
          errcode = '40001',
          message = 'plan_adjustment_route_projection_conflict';
      end if;
    else
      if exists (
        select 1
        from public.plan_sessions as session
        where session.id = requested_session_id
      ) then
        raise exception using
          errcode = '40001',
          message = 'plan_adjustment_session_identity_conflict';
      end if;

      perform public.validate_study_route_write_identity(
        requested_route,
        requested_plan.id,
        requested_session_id,
        null,
        true
      );
      if requested_route #>> '{approach,executionEnvironment}'
          is distinct from next_study_mode then
        raise exception using
          errcode = '40001',
          message = 'plan_adjustment_route_projection_conflict';
      end if;

      if pg_catalog.jsonb_typeof(
          requested_route #> '{provenance,evidenceRefs}'
        ) is distinct from 'array' then
        raise exception using
          errcode = '22023',
          message = 'plan_adjustment_origin_invalid';
      end if;

      select pg_catalog.count(*)::integer
      into origin_reference_count
      from pg_catalog.jsonb_array_elements_text(
        requested_route #> '{provenance,evidenceRefs}'
      ) as reference(value)
      where reference.value like 'route-revision:%';

      if origin_reference_count <> 1 then
        raise exception using
          errcode = '40001',
          message = 'plan_adjustment_origin_invalid';
      end if;

      begin
        select pg_catalog.substr(reference.value, 16)::uuid
        into strict origin_reference_revision_id
        from pg_catalog.jsonb_array_elements_text(
          requested_route #> '{provenance,evidenceRefs}'
        ) as reference(value)
        where reference.value like 'route-revision:%'
        limit 1;
      exception when others then
        raise exception using
          errcode = '22023',
          message = 'plan_adjustment_origin_invalid';
      end;

      begin
        explicit_origin_session_id := case
          when nullif(replacement ->> 'originSessionId', '') is null then null
          else (replacement ->> 'originSessionId')::uuid
        end;
      exception when others then
        raise exception using
          errcode = '22023',
          message = 'plan_adjustment_origin_invalid';
      end;

      if explicit_origin_session_id is not null then
        select session.committed_route_revision_id
        into expected_origin_revision_id
        from public.plan_sessions as session
        where session.id = explicit_origin_session_id
          and session.plan_id = requested_plan.id
          and session.user_id = current_user_id;

        if not found
          or expected_origin_revision_id
            is distinct from origin_reference_revision_id then
          raise exception using
            errcode = '40001',
            message = 'plan_adjustment_origin_conflict';
        end if;
      elsif not exists (
        select 1
        from public.plan_sessions as session
        where session.plan_id = requested_plan.id
          and session.user_id = current_user_id
          and session.committed_route_revision_id
            = origin_reference_revision_id
      ) then
        raise exception using
          errcode = '40001',
          message = 'plan_adjustment_origin_conflict';
      end if;
    end if;
  end loop;

  update public.learning_items as item
  set
    deadline = next_deadline,
    study_mode = next_study_mode
  where item.id = requested_plan.learning_item_id
    and item.user_id = current_user_id;

  -- Move only unfinished rows out of the non-deferrable scheduling range. A
  -- short-lived marker restores removed rows as skipped tombstones at their
  -- original sequence; reused rows replace step_data and remove the marker.
  update public.plan_sessions as session
  set
    sequence = session.sequence + 1000,
    step_data = session.step_data || pg_catalog.jsonb_build_object(
      'routeAdjustmentOriginalSequence',
      session.sequence
    )
  where session.plan_id = requested_plan.id
    and session.user_id = current_user_id
    and session.status in ('ready', 'upcoming');

  for replacement in
    select candidate.value
    from pg_catalog.jsonb_array_elements(payload -> 'sessions') as candidate(value)
    order by (candidate.value ->> 'sequence')::integer,
      (candidate.value ->> 'id')::uuid
  loop
    requested_session_id := (replacement ->> 'id')::uuid;
    requested_route := replacement -> 'studyRoute';

    select session.*
    into existing_session
    from public.plan_sessions as session
    where session.id = requested_session_id
      and session.plan_id = requested_plan.id
      and session.user_id = current_user_id;

    if found and coalesce((replacement ->> 'protected')::boolean, false) then
      update public.plan_sessions as session
      set
        sequence = (replacement ->> 'sequence')::smallint,
        step_data = session.step_data - 'routeAdjustmentOriginalSequence'
      where session.id = requested_session_id
        and session.plan_id = requested_plan.id
        and session.user_id = current_user_id;
    elsif found then
      update public.plan_sessions as session
      set
        sequence = (replacement ->> 'sequence')::smallint,
        title = replacement ->> 'title',
        objective = replacement ->> 'objective',
        method = replacement ->> 'method',
        method_rationale = replacement ->> 'methodReason',
        scheduled_for = (replacement ->> 'scheduledFor')::timestamptz,
        estimated_minutes = (replacement ->> 'estimatedMinutes')::smallint,
        status = replacement ->> 'status',
        step_data = pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'amountLabel', replacement ->> 'amountLabel',
          'learningMode', replacement ->> 'learningMode',
          'topicIds', coalesce(replacement -> 'topicIds', '[]'::jsonb),
          'contentTargets', coalesce(replacement -> 'contentTargets', '[]'::jsonb),
          'completionEvidence', coalesce(
            replacement -> 'completionEvidence',
            '[]'::jsonb
          ),
          'originSessionId', replacement ->> 'originSessionId',
          'originalContentMinutes', replacement -> 'originalContentMinutes',
          'segmentIndex', replacement -> 'segmentIndex',
          'segmentCount', replacement -> 'segmentCount',
          'reviewConcept', replacement ->> 'reviewConcept',
          'reviewType', replacement ->> 'reviewType'
        ))
      where session.id = requested_session_id
        and session.plan_id = requested_plan.id
        and session.user_id = current_user_id;
    else
      insert into public.plan_sessions (
        id,
        user_id,
        plan_id,
        sequence,
        title,
        objective,
        method,
        method_rationale,
        scheduled_for,
        estimated_minutes,
        status,
        step_data
      ) values (
        requested_session_id,
        current_user_id,
        requested_plan.id,
        (replacement ->> 'sequence')::smallint,
        replacement ->> 'title',
        replacement ->> 'objective',
        replacement ->> 'method',
        replacement ->> 'methodReason',
        (replacement ->> 'scheduledFor')::timestamptz,
        (replacement ->> 'estimatedMinutes')::smallint,
        replacement ->> 'status',
        pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'amountLabel', replacement ->> 'amountLabel',
          'learningMode', replacement ->> 'learningMode',
          'topicIds', coalesce(replacement -> 'topicIds', '[]'::jsonb),
          'contentTargets', coalesce(replacement -> 'contentTargets', '[]'::jsonb),
          'completionEvidence', coalesce(
            replacement -> 'completionEvidence',
            '[]'::jsonb
          ),
          'originSessionId', replacement ->> 'originSessionId',
          'originalContentMinutes', replacement -> 'originalContentMinutes',
          'segmentIndex', replacement -> 'segmentIndex',
          'segmentCount', replacement -> 'segmentCount',
          'reviewConcept', replacement ->> 'reviewConcept',
          'reviewType', replacement ->> 'reviewType'
        ))
      );
    end if;

    perform public.assert_persisted_session_request(
      requested_plan.id,
      requested_session_id,
      replacement
    );
    perform public.commit_study_route_revision(requested_route);
    perform public.assert_committed_study_route_projection(
      requested_route,
      requested_plan.id,
      requested_session_id
    );
  end loop;

  -- Every routed row omitted by the replacement becomes a skipped tombstone;
  -- its session id, exact committed pointer, and complete route ledger remain.
  update public.plan_sessions as session
  set
    sequence = (session.step_data ->> 'routeAdjustmentOriginalSequence')::smallint,
    status = 'skipped',
    step_data = (
      session.step_data - 'routeAdjustmentOriginalSequence'
    ) || pg_catalog.jsonb_build_object(
      'routeAdjustmentRetiredAt', now(),
      'routeAdjustmentRetiredBy', 'route_aware_plan_adjustment'
    )
  where session.plan_id = requested_plan.id
    and session.user_id = current_user_id
    and session.status in ('ready', 'upcoming')
    and session.step_data ? 'routeAdjustmentOriginalSequence';

  update public.plans as plan
  set
    knowledge_map = coalesce(payload -> 'knowledgeMap', plan.knowledge_map),
    generation_inputs = pg_catalog.jsonb_set(
      coalesce(plan.generation_inputs, '{}'::jsonb),
      '{lastAdjustment}',
      pg_catalog.jsonb_build_object(
        'deadline', next_deadline,
        'studyMode', next_study_mode,
        'futureSessionMinutes', next_minutes,
        'contentBased', true,
        'includeDeferred', coalesce(
          (payload ->> 'includeDeferred')::boolean,
          false
        ),
        'sessionCount', replacement_count,
        'protectedReviewCount', protected_count,
        'routeAware', true,
        'adjustedAt', now()
      ),
      true
    )
  where plan.id = requested_plan.id
    and plan.user_id = current_user_id;

  insert into public.learning_events (
    user_id,
    learning_item_id,
    event_type,
    event_data,
    occurred_at
  ) values (
    current_user_id,
    requested_plan.learning_item_id,
    'plan_adjusted',
    pg_catalog.jsonb_build_object(
      'planId', requested_plan.id,
      'deadline', next_deadline,
      'studyMode', next_study_mode,
      'futureSessionMinutes', next_minutes,
      'contentBased', true,
      'includeDeferred', coalesce(
        (payload ->> 'includeDeferred')::boolean,
        false
      ),
      'sessionCount', replacement_count,
      'protectedReviewCount', protected_count,
      'routeAware', true
    ),
    now()
  );

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'id', session.id,
      'sequence', session.sequence,
      'title', session.title,
      'objective', session.objective,
      'method', session.method,
      'methodReason', session.method_rationale,
      'scheduledFor', session.scheduled_for,
      'estimatedMinutes', session.estimated_minutes,
      'amountLabel', session.step_data ->> 'amountLabel',
      'learningMode', session.step_data ->> 'learningMode',
      'topicIds', coalesce(session.step_data -> 'topicIds', '[]'::jsonb),
      'contentTargets', coalesce(
        session.step_data -> 'contentTargets',
        '[]'::jsonb
      ),
      'completionEvidence', coalesce(
        session.step_data -> 'completionEvidence',
        '[]'::jsonb
      ),
      'originSessionId', session.step_data ->> 'originSessionId',
      'originalContentMinutes', session.step_data -> 'originalContentMinutes',
      'segmentIndex', session.step_data -> 'segmentIndex',
      'segmentCount', session.step_data -> 'segmentCount',
      'reviewConcept', session.step_data ->> 'reviewConcept',
      'reviewType', session.step_data ->> 'reviewType',
      'protected', case
        when session.step_data ->> 'reviewType' in (
          'repair_and_retrieve',
          'verify',
          'maintenance_transfer'
        ) then true
        else null
      end,
      'status', session.status,
      'studyRoute', pg_catalog.jsonb_build_object(
        'identity',
        pg_catalog.jsonb_build_object(
          'routeLineageId', route.route_lineage_id,
          'routeRevisionId', route.route_revision_id,
          'revisionNumber', route.revision_number,
          'schemaVersion', route.schema_version,
          'lifecycleStatus', route.lifecycle,
          'planId', route.plan_id,
          'sessionId', route.plan_session_id,
          'createdAt', route.created_at,
          'committedAt', route.committed_at
        ) || case
          when route.predecessor_revision_id is null then '{}'::jsonb
          else pg_catalog.jsonb_build_object(
            'supersedesRevisionId',
            route.predecessor_revision_id
          )
        end
      ) || route.route_payload
    )) order by session.sequence, session.id
  ), '[]'::jsonb)
  into authoritative_sessions
  from pg_catalog.jsonb_array_elements(payload -> 'sessions') as candidate(value)
  join public.plan_sessions as session
    on session.id = (candidate.value ->> 'id')::uuid
    and session.plan_id = requested_plan.id
    and session.user_id = current_user_id
  join public.study_routes as route
    on route.route_revision_id = session.committed_route_revision_id
    and route.plan_session_id = session.id
    and route.plan_id = requested_plan.id
    and route.user_id = current_user_id
    and route.lifecycle = 'committed';

  if pg_catalog.jsonb_array_length(authoritative_sessions)
      <> replacement_count then
    raise exception using
      errcode = '55000',
      message = 'plan_adjustment_authoritative_readback_failed';
  end if;

  return pg_catalog.jsonb_build_object(
    'planId', requested_plan.id,
    'deadline', next_deadline,
    'studyMode', next_study_mode,
    'sessions', authoritative_sessions
  );
end;
$$;

revoke all on function public.adjust_learning_plan_with_routes(jsonb)
from public, anon, authenticated;
grant execute on function public.adjust_learning_plan_with_routes(jsonb)
to authenticated;
