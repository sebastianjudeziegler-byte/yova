-- Make post-session curriculum changes and their canonical StudyRoute writes
-- one transaction. All route-aware writers use the account -> plan -> ordered
-- sessions lock order already shared by Reset, scheduling, and route commits.

create or replace function public.lock_study_route_binding_v2(
  requested_session_id uuid,
  requested_route_revision_id uuid,
  lock_all_plan_sessions boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_plan_id uuid;
  committed_revision_id uuid;
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'study_route_authentication_required';
  end if;

  -- This first read owns no row lock. Association changes are already rejected
  -- by the plan-session guard; deletion is re-checked after the account lock.
  select session.plan_id
  into requested_plan_id
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.user_id = current_user_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'study_route_session_not_found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  perform plan.id
  from public.plans as plan
  where plan.id = requested_plan_id
    and plan.user_id = current_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'study_route_plan_not_found';
  end if;

  if lock_all_plan_sessions then
    perform session.id
    from public.plan_sessions as session
    where session.plan_id = requested_plan_id
      and session.user_id = current_user_id
    order by session.sequence, session.id
    for update;
  end if;

  select session.committed_route_revision_id
  into committed_revision_id
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.plan_id = requested_plan_id
    and session.user_id = current_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'study_route_session_not_found';
  end if;

  if committed_revision_id is distinct from requested_route_revision_id then
    raise exception using
      errcode = '40001',
      message = 'study_route_revision_conflict';
  end if;

  if committed_revision_id is not null and not exists (
    select 1
    from public.study_routes as route
    where route.route_revision_id = committed_revision_id
      and route.plan_session_id = requested_session_id
      and route.plan_id = requested_plan_id
      and route.user_id = current_user_id
      and route.lifecycle = 'committed'
  ) then
    raise exception using
      errcode = '40001',
      message = 'study_route_revision_conflict';
  end if;

  return requested_plan_id;
end;
$$;

-- Keep the established private helper signature for checkpoint and
-- interruption callers, but repair its old session-first lock order.
create or replace function public.assert_study_route_binding(
  requested_session_id uuid,
  requested_route_revision_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.lock_study_route_binding_v2(
    requested_session_id,
    requested_route_revision_id,
    false
  );
end;
$$;

create or replace function public.validate_study_route_write_identity(
  requested_route jsonb,
  requested_plan_id uuid,
  requested_session_id uuid,
  requested_predecessor_id uuid,
  expected_initial_revision boolean
)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  identity jsonb := requested_route -> 'identity';
  route_revision_id uuid;
  predecessor_id uuid;
  revision_number numeric;
begin
  if pg_catalog.jsonb_typeof(requested_route) is distinct from 'object'
    or pg_catalog.jsonb_typeof(identity) is distinct from 'object'
    or identity ->> 'lifecycleStatus' is distinct from 'committed'
    or identity ->> 'planId' is distinct from requested_plan_id::text
    or identity ->> 'sessionId' is distinct from requested_session_id::text then
    raise exception using
      errcode = '22023',
      message = 'post_session_study_route_identity_invalid';
  end if;

  begin
    route_revision_id := (identity ->> 'routeRevisionId')::uuid;
    revision_number := (identity ->> 'revisionNumber')::numeric;
    predecessor_id := case
      when identity ? 'supersedesRevisionId'
        then (identity ->> 'supersedesRevisionId')::uuid
      else null
    end;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'post_session_study_route_identity_invalid';
  end;

  if expected_initial_revision then
    if revision_number <> 1 or predecessor_id is not null then
      raise exception using
        errcode = '22023',
        message = 'post_session_study_route_identity_invalid';
    end if;
  elsif revision_number <= 1
    or predecessor_id is distinct from requested_predecessor_id then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_predecessor_conflict';
  end if;

  return route_revision_id;
end;
$$;

-- Every post-session route must name the exact committed route whose evidence
-- caused it. Completion uses the executed route; concept-review activation
-- receives the scheduler-selected evidence route as an explicit identity.
create or replace function public.assert_study_route_origin_reference(
  requested_route jsonb,
  requested_plan_id uuid,
  expected_origin_revision_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  evidence_refs jsonb := requested_route #> '{provenance,evidenceRefs}';
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'study_route_authentication_required';
  end if;

  if pg_catalog.jsonb_typeof(evidence_refs) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'post_session_study_route_origin_invalid';
  end if;

  if expected_origin_revision_id is null
    or not evidence_refs @> pg_catalog.jsonb_build_array(
      'route-revision:' || expected_origin_revision_id::text
    )
    or not exists (
      select 1
      from public.study_routes as origin
      where origin.route_revision_id = expected_origin_revision_id
        and origin.plan_id = requested_plan_id
        and origin.user_id = current_user_id
        and origin.lifecycle = 'committed'
    ) then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_origin_conflict';
  end if;
end;
$$;

create or replace function public.assert_study_route_successor_material_change(
  requested_route jsonb,
  requested_plan_id uuid,
  requested_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_predecessor_revision_id uuid;
  predecessor_payload jsonb;
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'study_route_authentication_required';
  end if;

  begin
    requested_predecessor_revision_id := (
      requested_route #>> '{identity,supersedesRevisionId}'
    )::uuid;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'post_session_study_route_identity_invalid';
  end;

  select route.route_payload
  into predecessor_payload
  from public.study_routes as route
  where route.route_revision_id = requested_predecessor_revision_id
    and route.plan_id = requested_plan_id
    and route.plan_session_id = requested_session_id
    and route.user_id = current_user_id;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_predecessor_conflict';
  end if;

  -- Revision identity and the audit trail can change without changing what the
  -- learner will do. At least one executable/visible route section must differ.
  if requested_route - 'identity' - 'provenance'
      is not distinct from predecessor_payload - 'provenance' then
    raise exception using
      errcode = '22023',
      message = 'post_session_study_route_no_material_change';
  end if;
end;
$$;

-- The route is authoritative for the legacy session scalars it projects.
-- Persist that bounded projection before committing/verifying the revision so
-- wider historical column limits (method 180, rationale/objective 900) cannot
-- leave the visible session and its canonical route disagreeing.
create or replace function public.persist_study_route_scalar_projection(
  requested_plan_id uuid,
  requested_session_id uuid,
  requested_route jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_route_revision_id uuid;
  requested_predecessor_revision_id uuid;
  requested_active_minutes integer;
  requested_learning_mode text;
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'study_route_authentication_required';
  end if;

  begin
    requested_route_revision_id := (
      requested_route #>> '{identity,routeRevisionId}'
    )::uuid;
    requested_predecessor_revision_id := case
      when (requested_route #> '{identity}') ? 'supersedesRevisionId'
        then (requested_route #>> '{identity,supersedesRevisionId}')::uuid
      else null
    end;
    requested_active_minutes := (
      requested_route #>> '{timing,activeMinutes}'
    )::integer;
    requested_learning_mode := case requested_route #>> '{approach,mode}'
      when 'learn' then 'learn'
      when 'practice' then 'study'
      else null
    end;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'post_session_study_route_projection_invalid';
  end;

  if requested_route #>> '{identity,planId}'
      is distinct from requested_plan_id::text
    or requested_route #>> '{identity,sessionId}'
      is distinct from requested_session_id::text
    or requested_route #>> '{identity,lifecycleStatus}'
      is distinct from 'committed'
    or pg_catalog.length(
      pg_catalog.btrim(coalesce(
        requested_route #>> '{target,desiredOutcome}',
        ''
      ))
    ) not between 5 and 500
    or pg_catalog.length(
      pg_catalog.btrim(coalesce(
        requested_route #>> '{approach,visibleMethodName}',
        ''
      ))
    ) not between 2 and 100
    or pg_catalog.length(
      pg_catalog.btrim(coalesce(
        requested_route #>> '{explanation,shortReason}',
        ''
      ))
    ) not between 8 and 300
    or requested_active_minutes not between 1 and 180
    or requested_learning_mode is null then
    raise exception using
      errcode = '22023',
      message = 'post_session_study_route_projection_invalid';
  end if;

  if exists (
    select 1
    from public.plan_sessions as session
    where session.id = requested_session_id
      and session.plan_id = requested_plan_id
      and session.user_id = current_user_id
      and (
        session.committed_route_revision_id is null
        or session.committed_route_revision_id = requested_route_revision_id
        or session.committed_route_revision_id = requested_predecessor_revision_id
      )
      and session.objective
        is not distinct from requested_route #>> '{target,desiredOutcome}'
      and session.method
        is not distinct from requested_route #>> '{approach,visibleMethodName}'
      and session.method_rationale
        is not distinct from requested_route #>> '{explanation,shortReason}'
      and session.estimated_minutes is not distinct from requested_active_minutes
      and session.step_data ->> 'learningMode'
        is not distinct from requested_learning_mode
  ) then
    return;
  end if;

  update public.plan_sessions as session
  set
    objective = requested_route #>> '{target,desiredOutcome}',
    method = requested_route #>> '{approach,visibleMethodName}',
    method_rationale = requested_route #>> '{explanation,shortReason}',
    estimated_minutes = requested_active_minutes,
    step_data = pg_catalog.jsonb_set(
      coalesce(session.step_data, '{}'::jsonb),
      '{learningMode}',
      pg_catalog.to_jsonb(requested_learning_mode),
      true
    )
  where session.id = requested_session_id
    and session.plan_id = requested_plan_id
    and session.user_id = current_user_id
    and (
      session.committed_route_revision_id is null
      or session.committed_route_revision_id = requested_route_revision_id
      or session.committed_route_revision_id = requested_predecessor_revision_id
    );

  if not found then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_projection_conflict';
  end if;
end;
$$;

-- The mature guided follow-up and concept-review writers predate
-- contentTargets/completionEvidence persistence. Repair only those freshly
-- written review rows, using arrays that are already bound to the immutable
-- route projection. Unguided verification and guided continuation keep their
-- own stricter canonicalizers and do not call this helper.
create or replace function public.persist_route_session_arrays(
  requested_plan_id uuid,
  requested_session_id uuid,
  requested_session jsonb,
  requested_route jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_route_revision_id uuid;
  requested_topic_ids jsonb := requested_session -> 'topicIds';
  requested_content_targets jsonb := requested_session -> 'contentTargets';
  requested_completion_evidence jsonb := requested_session -> 'completionEvidence';
  projected_topic_ids jsonb;
  projected_completion_evidence jsonb;
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'study_route_authentication_required';
  end if;

  begin
    requested_route_revision_id := (
      requested_route #>> '{identity,routeRevisionId}'
    )::uuid;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'post_session_study_route_projection_invalid';
  end;

  if pg_catalog.jsonb_typeof(requested_topic_ids) is distinct from 'array'
    or pg_catalog.jsonb_array_length(requested_topic_ids) not between 1 and 6
    or pg_catalog.jsonb_typeof(requested_content_targets) is distinct from 'array'
    or pg_catalog.jsonb_array_length(requested_content_targets) not between 1 and 6
    or pg_catalog.jsonb_typeof(requested_completion_evidence) is distinct from 'array'
    or pg_catalog.jsonb_array_length(requested_completion_evidence) not between 1 and 4
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(requested_topic_ids) as item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'string'
        or (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(requested_content_targets) as item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'string'
        or pg_catalog.length(pg_catalog.btrim(item.value #>> '{}')) not between 1 and 180
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(requested_completion_evidence) as item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'string'
        or pg_catalog.length(pg_catalog.btrim(item.value #>> '{}')) not between 1 and 220
    ) then
    raise exception using
      errcode = '22023',
      message = 'post_session_route_arrays_invalid';
  end if;

  if pg_catalog.jsonb_typeof(requested_route #> '{target,targetStates}')
      is distinct from 'array'
    or pg_catalog.jsonb_typeof(
      requested_route #> '{execution,completionEvidence}'
    ) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'post_session_study_route_projection_invalid';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(target.value ->> 'targetId') order by target.ordinality
    ),
    '[]'::jsonb
  )
  into projected_topic_ids
  from pg_catalog.jsonb_array_elements(
    requested_route #> '{target,targetStates}'
  ) with ordinality as target(value, ordinality);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(evidence.value ->> 'description')
      order by evidence.ordinality
    ),
    '[]'::jsonb
  )
  into projected_completion_evidence
  from pg_catalog.jsonb_array_elements(
    requested_route #> '{execution,completionEvidence}'
  ) with ordinality as evidence(value, ordinality);

  if requested_topic_ids is distinct from projected_topic_ids
    or requested_completion_evidence
      is distinct from projected_completion_evidence then
    raise exception using
      errcode = '40001',
      message = 'post_session_route_array_projection_conflict';
  end if;

  if exists (
    select 1
    from public.plan_sessions as session
    where session.id = requested_session_id
      and session.plan_id = requested_plan_id
      and session.user_id = current_user_id
      and (
        session.committed_route_revision_id is null
        or session.committed_route_revision_id = requested_route_revision_id
      )
      and session.step_data -> 'topicIds' is not distinct from requested_topic_ids
      and session.step_data -> 'contentTargets'
        is not distinct from requested_content_targets
      and session.step_data -> 'completionEvidence'
        is not distinct from requested_completion_evidence
  ) then
    return;
  end if;

  update public.plan_sessions as session
  set step_data = pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        coalesce(session.step_data, '{}'::jsonb),
        '{topicIds}',
        requested_topic_ids,
        true
      ),
      '{contentTargets}',
      requested_content_targets,
      true
    ),
    '{completionEvidence}',
    requested_completion_evidence,
    true
  )
  where session.id = requested_session_id
    and session.plan_id = requested_plan_id
    and session.user_id = current_user_id
    and (
      session.committed_route_revision_id is null
      or session.committed_route_revision_id = requested_route_revision_id
    );

  if not found then
    raise exception using
      errcode = '40001',
      message = 'post_session_route_array_projection_conflict';
  end if;
end;
$$;

create or replace function public.assert_persisted_session_request(
  requested_plan_id uuid,
  requested_session_id uuid,
  requested_session jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  stored_session public.plan_sessions%rowtype;
  requested_scheduled_for timestamptz;
  requested_route jsonb := requested_session -> 'studyRoute';
  requested_projection jsonb := requested_session - 'studyRoute';
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'study_route_authentication_required';
  end if;

  if pg_catalog.jsonb_typeof(requested_session) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'post_session_request_invalid';
  end if;

  if pg_catalog.jsonb_typeof(requested_route) = 'object' then
    requested_projection := requested_projection || pg_catalog.jsonb_build_object(
      'objective', requested_route #>> '{target,desiredOutcome}',
      'method', requested_route #>> '{approach,visibleMethodName}',
      'methodReason', requested_route #>> '{explanation,shortReason}',
      'estimatedMinutes', requested_route #>> '{timing,activeMinutes}',
      'learningMode', case requested_route #>> '{approach,mode}'
        when 'learn' then 'learn'
        when 'practice' then 'study'
        else null
      end
    );
  elsif coalesce(pg_catalog.jsonb_typeof(requested_route), 'null') <> 'null' then
    raise exception using
      errcode = '22023',
      message = 'post_session_request_invalid';
  end if;

  begin
    requested_scheduled_for := case
      when nullif(requested_projection ->> 'scheduledFor', '') is null then null
      else (requested_projection ->> 'scheduledFor')::timestamptz
    end;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'post_session_request_invalid';
  end;

  select session.*
  into stored_session
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.plan_id = requested_plan_id
    and session.user_id = current_user_id;

  if not found
    or stored_session.title is distinct from requested_projection ->> 'title'
    or stored_session.objective is distinct from requested_projection ->> 'objective'
    or stored_session.method is distinct from requested_projection ->> 'method'
    or stored_session.method_rationale is distinct from requested_projection ->> 'methodReason'
    or stored_session.estimated_minutes::text
      is distinct from requested_projection ->> 'estimatedMinutes'
    or stored_session.step_data ->> 'amountLabel'
      is distinct from requested_projection ->> 'amountLabel'
    or stored_session.step_data ->> 'learningMode'
      is distinct from requested_projection ->> 'learningMode'
    or (
      requested_scheduled_for is not null
      and stored_session.scheduled_for is distinct from requested_scheduled_for
    )
    or (
      requested_projection ? 'reviewConcept'
      and stored_session.step_data ->> 'reviewConcept'
        is distinct from requested_projection ->> 'reviewConcept'
    )
    or (
      requested_projection ? 'reviewType'
      and stored_session.step_data ->> 'reviewType'
        is distinct from requested_projection ->> 'reviewType'
    )
    or (
      pg_catalog.jsonb_typeof(requested_projection -> 'topicIds') = 'array'
      and pg_catalog.jsonb_array_length(requested_projection -> 'topicIds') > 0
      and stored_session.step_data -> 'topicIds'
        is distinct from requested_projection -> 'topicIds'
    ) then
    raise exception using
      errcode = '40001',
      message = 'post_session_persisted_session_conflict';
  end if;
end;
$$;

create or replace function public.assert_committed_study_route_projection(
  requested_route jsonb,
  requested_plan_id uuid,
  requested_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_route_revision_id uuid;
  requested_active_minutes integer;
  expected_learning_mode text;
  expected_desired_outcome text;
  stored_study_mode text;
  stored_session public.plan_sessions%rowtype;
  stored_route public.study_routes%rowtype;
  projected_topic_ids jsonb;
  projected_completion_evidence jsonb;
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'study_route_authentication_required';
  end if;

  begin
    requested_route_revision_id := (
      requested_route #>> '{identity,routeRevisionId}'
    )::uuid;
    requested_active_minutes := (
      requested_route #>> '{timing,activeMinutes}'
    )::integer;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'post_session_study_route_projection_invalid';
  end;

  if requested_route #>> '{identity,planId}'
      is distinct from requested_plan_id::text
    or requested_route #>> '{identity,sessionId}'
      is distinct from requested_session_id::text
    or requested_route #>> '{identity,lifecycleStatus}'
      is distinct from 'committed' then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_projection_conflict';
  end if;

  expected_learning_mode := case requested_route #>> '{approach,mode}'
    when 'learn' then 'learn'
    when 'practice' then 'study'
    else null
  end;

  select session.*
  into stored_session
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.plan_id = requested_plan_id
    and session.user_id = current_user_id;

  if found then
    expected_desired_outcome := coalesce(
      nullif(pg_catalog.btrim(stored_session.objective), ''),
      nullif(pg_catalog.btrim(stored_session.title), ''),
      'Complete this session'
    );
    expected_desired_outcome := case
      when pg_catalog.length(expected_desired_outcome) >= 5
        then pg_catalog.left(expected_desired_outcome, 500)
      else pg_catalog.left('Learn ' || expected_desired_outcome, 500)
    end;

    select item.study_mode
    into stored_study_mode
    from public.plans as plan
    join public.learning_items as item
      on item.id = plan.learning_item_id
      and item.user_id = plan.user_id
    where plan.id = requested_plan_id
      and plan.user_id = current_user_id;
  end if;

  if not found
    or stored_session.committed_route_revision_id
      is distinct from requested_route_revision_id
    or stored_session.method
      is distinct from requested_route #>> '{approach,visibleMethodName}'
    or stored_session.method_rationale
      is distinct from requested_route #>> '{explanation,shortReason}'
    or stored_session.estimated_minutes is distinct from requested_active_minutes
    or stored_session.step_data ->> 'learningMode'
      is distinct from expected_learning_mode
    or requested_route #>> '{target,desiredOutcome}'
      is distinct from expected_desired_outcome
    or requested_route #>> '{approach,executionEnvironment}'
      is distinct from stored_study_mode then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_projection_conflict';
  end if;

  select route.*
  into stored_route
  from public.study_routes as route
  where route.route_revision_id = requested_route_revision_id
    and route.plan_session_id = requested_session_id
    and route.plan_id = requested_plan_id
    and route.user_id = current_user_id;

  if not found
    or stored_route.lifecycle <> 'committed'
    or stored_route.route_payload is distinct from requested_route - 'identity' then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_projection_conflict';
  end if;

  if pg_catalog.jsonb_typeof(requested_route #> '{target,targetStates}')
      is distinct from 'array'
    or pg_catalog.jsonb_typeof(stored_session.step_data -> 'topicIds')
      is distinct from 'array'
    or pg_catalog.jsonb_typeof(
      requested_route #> '{execution,completionEvidence}'
    ) is distinct from 'array'
    or pg_catalog.jsonb_typeof(
      stored_session.step_data -> 'completionEvidence'
    ) is distinct from 'array' then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_projection_conflict';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(target.value ->> 'targetId') order by target.ordinality
    ),
    '[]'::jsonb
  )
  into projected_topic_ids
  from pg_catalog.jsonb_array_elements(
    requested_route #> '{target,targetStates}'
  ) with ordinality as target(value, ordinality);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(evidence.value ->> 'description')
      order by evidence.ordinality
    ),
    '[]'::jsonb
  )
  into projected_completion_evidence
  from pg_catalog.jsonb_array_elements(
    requested_route #> '{execution,completionEvidence}'
  ) with ordinality as evidence(value, ordinality);

  if projected_topic_ids is distinct from stored_session.step_data -> 'topicIds'
    or projected_completion_evidence
      is distinct from stored_session.step_data -> 'completionEvidence' then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_projection_conflict';
  end if;
end;
$$;

-- The pointer is writable on a historically owner-all table. Enforce the
-- only two transitions the commit RPC can produce from route state itself,
-- without trusting a caller-settable session variable.
create or replace function public.guard_study_route_pointer_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_route public.study_routes%rowtype;
  new_route public.study_routes%rowtype;
begin
  if new.committed_route_revision_id
    is not distinct from old.committed_route_revision_id then
    return new;
  end if;

  if new.committed_route_revision_id is null then
    raise exception using
      errcode = '42501',
      message = 'study_route_pointer_rpc_required';
  end if;

  select route.*
  into new_route
  from public.study_routes as route
  where route.route_revision_id = new.committed_route_revision_id
    and route.plan_session_id = new.id
    and route.plan_id = new.plan_id
    and route.user_id = new.user_id;

  if not found or new_route.lifecycle <> 'committed' then
    raise exception using
      errcode = '42501',
      message = 'study_route_pointer_rpc_required';
  end if;

  if old.committed_route_revision_id is null then
    if new_route.revision_number <> 1
      or new_route.predecessor_revision_id is not null then
      raise exception using
        errcode = '42501',
        message = 'study_route_pointer_rpc_required';
    end if;
    return new;
  end if;

  select route.*
  into old_route
  from public.study_routes as route
  where route.route_revision_id = old.committed_route_revision_id
    and route.plan_session_id = old.id
    and route.plan_id = old.plan_id
    and route.user_id = old.user_id;

  if not found
    or old_route.lifecycle <> 'superseded'
    or new_route.predecessor_revision_id
      is distinct from old_route.route_revision_id
    or new_route.route_lineage_id is distinct from old_route.route_lineage_id
    or new_route.revision_number <> old_route.revision_number + 1 then
    raise exception using
      errcode = '42501',
      message = 'study_route_pointer_rpc_required';
  end if;

  return new;
end;
$$;

drop trigger if exists plan_sessions_guard_study_route_pointer
on public.plan_sessions;
create trigger plan_sessions_guard_study_route_pointer
before update of committed_route_revision_id on public.plan_sessions
for each row execute function public.guard_study_route_pointer_transition();

create or replace function public.complete_plan_session_with_route(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_attempt_id uuid;
  requested_session_id uuid;
  requested_route_revision_id uuid;
  requested_variant text := payload ->> 'completionVariant';
  requested_started_at timestamptz;
  requested_completed_at timestamptz;
  requested_actual_minutes integer;
  requested_planned_minutes integer;
  requested_correct_answers integer;
  requested_total_answers integer;
  concept_evidence jsonb := coalesce(payload -> 'conceptEvidence', '[]'::jsonb);
  confidence_evidence jsonb := coalesce(payload -> 'confidenceEvidence', '[]'::jsonb);
  adjustment jsonb := payload -> 'nextSessionAdjustment';
  successor_route jsonb := payload -> 'nextSessionStudyRoute';
  follow_up jsonb := payload -> 'followUpSession';
  continuation jsonb := payload -> 'continuationSession';
  follow_up_route jsonb;
  continuation_route jsonb;
  sanitized_payload jsonb;
  requested_plan_id uuid;
  current_session public.plan_sessions%rowtype;
  adapted_session public.plan_sessions%rowtype;
  existing_attempt public.session_attempts%rowtype;
  existing_attempt_found boolean := false;
  adaptation_session_id uuid;
  follow_up_session_id uuid;
  continuation_session_id uuid;
  successor_route_revision_id uuid;
  follow_up_route_revision_id uuid;
  continuation_route_revision_id uuid;
  completed_plan_id uuid;
  stored_route_revision_id text;
  total_plan_session_count integer;
  routed_plan_session_count integer;
  routed_origin boolean;
  adjustment_present boolean;
  successor_present boolean;
  follow_up_present boolean;
  follow_up_route_present boolean;
  continuation_present boolean;
  continuation_route_present boolean;
begin
  if pg_catalog.jsonb_typeof(payload) is distinct from 'object'
    or requested_variant is null
    or requested_variant not in (
      'guided',
      'unguided_practice',
      'guided_continuation'
    ) then
    raise exception using
      errcode = '22023',
      message = 'route_bound_completion_shape_invalid';
  end if;

  begin
    requested_attempt_id := nullif(payload ->> 'attemptId', '')::uuid;
    requested_session_id := nullif(payload ->> 'planSessionId', '')::uuid;
    requested_route_revision_id := case
      when payload ? 'routeRevisionId'
        then nullif(payload ->> 'routeRevisionId', '')::uuid
      else null
    end;
    requested_started_at := nullif(payload ->> 'startedAt', '')::timestamptz;
    requested_completed_at := nullif(payload ->> 'completedAt', '')::timestamptz;
    requested_actual_minutes := nullif(payload ->> 'actualMinutes', '')::integer;
    requested_planned_minutes := nullif(payload ->> 'plannedMinutes', '')::integer;
    requested_correct_answers := nullif(payload ->> 'correctAnswers', '')::integer;
    requested_total_answers := nullif(payload ->> 'totalAnswers', '')::integer;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'route_bound_completion_values_invalid';
  end;

  if requested_attempt_id is null
    or requested_session_id is null
    or requested_started_at is null
    or requested_completed_at is null
    or requested_actual_minutes is null
    or requested_planned_minutes is null
    or requested_correct_answers is null
    or requested_total_answers is null then
    raise exception using
      errcode = '22023',
      message = 'route_bound_completion_values_invalid';
  end if;

  if pg_catalog.jsonb_typeof(concept_evidence) is distinct from 'array'
    or pg_catalog.jsonb_typeof(confidence_evidence) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'study_route_evidence_invalid';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(concept_evidence) as evidence(entry)
    where (
      requested_route_revision_id is null
      and entry ? 'routeRevisionId'
    ) or (
      requested_route_revision_id is not null
      and entry ->> 'routeRevisionId'
        is distinct from requested_route_revision_id::text
    )
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(confidence_evidence) as evidence(entry)
    where (
      requested_route_revision_id is null
      and entry ? 'routeRevisionId'
    ) or (
      requested_route_revision_id is not null
      and entry ->> 'routeRevisionId'
        is distinct from requested_route_revision_id::text
    )
  ) then
    raise exception using
      errcode = '40001',
      message = 'study_route_evidence_conflict';
  end if;

  if coalesce(pg_catalog.jsonb_typeof(adjustment), 'null')
      not in ('object', 'null')
    or coalesce(pg_catalog.jsonb_typeof(successor_route), 'null')
      not in ('object', 'null')
    or coalesce(pg_catalog.jsonb_typeof(follow_up), 'null')
      not in ('object', 'null')
    or coalesce(pg_catalog.jsonb_typeof(continuation), 'null')
      not in ('object', 'null') then
    raise exception using
      errcode = '22023',
      message = 'post_session_route_write_shape_invalid';
  end if;

  adjustment_present := coalesce(
    pg_catalog.jsonb_typeof(adjustment) = 'object',
    false
  );
  successor_present := coalesce(
    pg_catalog.jsonb_typeof(successor_route) = 'object',
    false
  );
  follow_up_present := coalesce(
    pg_catalog.jsonb_typeof(follow_up) = 'object',
    false
  );
  continuation_present := coalesce(
    pg_catalog.jsonb_typeof(continuation) = 'object',
    false
  );
  follow_up_route := case
    when follow_up_present then follow_up -> 'studyRoute'
    else null
  end;
  continuation_route := case
    when continuation_present then continuation -> 'studyRoute'
    else null
  end;

  if coalesce(pg_catalog.jsonb_typeof(follow_up_route), 'null')
      not in ('object', 'null')
    or coalesce(pg_catalog.jsonb_typeof(continuation_route), 'null')
      not in ('object', 'null') then
    raise exception using
      errcode = '22023',
      message = 'post_session_route_write_shape_invalid';
  end if;

  follow_up_route_present := coalesce(
    pg_catalog.jsonb_typeof(follow_up_route) = 'object',
    false
  );
  continuation_route_present := coalesce(
    pg_catalog.jsonb_typeof(continuation_route) = 'object',
    false
  );
  routed_origin := requested_route_revision_id is not null;

  if (routed_origin and (
      adjustment_present is distinct from successor_present
      or follow_up_present is distinct from follow_up_route_present
      or continuation_present is distinct from continuation_route_present
    )) or (not routed_origin and (
      successor_present
      or follow_up_route_present
      or continuation_route_present
    )) then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_coverage_conflict';
  end if;

  if (requested_variant = 'guided_continuation' and (
      not continuation_present or adjustment_present or follow_up_present
    )) or (requested_variant = 'unguided_practice' and (
      not follow_up_present or adjustment_present or continuation_present
    )) or (requested_variant = 'guided' and continuation_present) then
    raise exception using
      errcode = '22023',
      message = 'post_session_variant_conflict';
  end if;

  requested_plan_id := public.lock_study_route_binding_v2(
    requested_session_id,
    requested_route_revision_id,
    true
  );

  select session.*
  into current_session
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.plan_id = requested_plan_id
    and session.user_id = current_user_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'study_route_session_not_found';
  end if;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(session.committed_route_revision_id)::integer
  into total_plan_session_count, routed_plan_session_count
  from public.plan_sessions as session
  where session.plan_id = requested_plan_id
    and session.user_id = current_user_id;

  if total_plan_session_count < 1
    or routed_plan_session_count not in (0, total_plan_session_count)
    or routed_origin is distinct from (
      routed_plan_session_count = total_plan_session_count
    ) then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_coverage_conflict';
  end if;

  select attempt.*
  into existing_attempt
  from public.session_attempts as attempt
  where attempt.id = requested_attempt_id
    and attempt.user_id = current_user_id
  for update;
  existing_attempt_found := found;

  if not existing_attempt_found and current_session.status <> 'ready' then
    raise exception using
      errcode = '40001',
      message = 'study_route_completion_session_not_ready';
  end if;

  if adjustment_present then
    begin
      adaptation_session_id := nullif(adjustment ->> 'planSessionId', '')::uuid;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'post_session_adaptation_identity_invalid';
    end;

    select session.*
    into adapted_session
    from public.plan_sessions as session
    where session.id = adaptation_session_id
      and session.plan_id = requested_plan_id
      and session.user_id = current_user_id
      and session.sequence = current_session.sequence + 1;

    if not found
      or adapted_session.status not in ('ready', 'upcoming')
      or (
        not existing_attempt_found
        and adapted_session.status <> 'upcoming'
      ) then
      raise exception using
        errcode = '40001',
        message = 'post_session_adaptation_target_conflict';
    end if;

    -- The generated-session invalidation trigger would otherwise clear this
    -- evidence before the route commit can reject the rewrite.
    if not existing_attempt_found
      and adapted_session.step_data ? 'activeSessionCheckpoint' then
      raise exception using
        errcode = '55000',
        message = 'study_route_active_checkpoint';
    end if;

    if successor_present then
      if existing_attempt_found then
        begin
          successor_route_revision_id := (
            successor_route #>> '{identity,routeRevisionId}'
          )::uuid;
        exception when others then
          raise exception using
            errcode = '22023',
            message = 'post_session_study_route_identity_invalid';
        end;
      else
        successor_route_revision_id := public.validate_study_route_write_identity(
          successor_route,
          requested_plan_id,
          adaptation_session_id,
          adapted_session.committed_route_revision_id,
          false
        );
      end if;
      perform public.assert_study_route_origin_reference(
        successor_route,
        requested_plan_id,
        requested_route_revision_id
      );
      perform public.assert_study_route_successor_material_change(
        successor_route,
        requested_plan_id,
        adaptation_session_id
      );
    end if;
  end if;

  if follow_up_present then
    begin
      follow_up_session_id := nullif(follow_up ->> 'id', '')::uuid;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'post_session_child_identity_invalid';
    end;
    if follow_up_route_present then
      follow_up_route_revision_id := public.validate_study_route_write_identity(
        follow_up_route,
        requested_plan_id,
        follow_up_session_id,
        null,
        true
      );
      perform public.assert_study_route_origin_reference(
        follow_up_route,
        requested_plan_id,
        requested_route_revision_id
      );
    end if;
  end if;

  if continuation_present then
    begin
      continuation_session_id := nullif(continuation ->> 'id', '')::uuid;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'post_session_child_identity_invalid';
    end;
    if continuation_route_present then
      continuation_route_revision_id := public.validate_study_route_write_identity(
        continuation_route,
        requested_plan_id,
        continuation_session_id,
        null,
        true
      );
      perform public.assert_study_route_origin_reference(
        continuation_route,
        requested_plan_id,
        requested_route_revision_id
      );
    end if;
  end if;

  sanitized_payload := payload
    - 'completionVariant'
    - 'routeRevisionId'
    - 'nextSessionStudyRoute';
  if follow_up_present then
    sanitized_payload := pg_catalog.jsonb_set(
      sanitized_payload,
      '{followUpSession}',
      follow_up - 'studyRoute',
      true
    );
  end if;
  if continuation_present then
    sanitized_payload := pg_catalog.jsonb_set(
      sanitized_payload,
      '{continuationSession}',
      continuation - 'studyRoute',
      true
    );
  end if;

  -- The mature guided writer has no exact replay branch and can fail after its
  -- first call completes the parent plan. Validate its durable receipt instead
  -- of invoking it again.
  if requested_variant = 'guided' and existing_attempt_found then
    if current_session.status <> 'complete'
      or existing_attempt.plan_session_id is distinct from requested_session_id
      or existing_attempt.started_at is distinct from requested_started_at
      or existing_attempt.completed_at is distinct from requested_completed_at
      or existing_attempt.actual_minutes is distinct from requested_actual_minutes
      or existing_attempt.correct_answers is distinct from requested_correct_answers
      or existing_attempt.total_answers is distinct from requested_total_answers
      or existing_attempt.user_feedback is distinct from payload ->> 'feedback'
      or existing_attempt.result_data ->> 'observedGap'
        is distinct from payload ->> 'observedGap'
      or existing_attempt.result_data -> 'conceptEvidence'
        is distinct from concept_evidence
      or existing_attempt.result_data -> 'confidenceEvidence'
        is distinct from confidence_evidence
      or existing_attempt.result_data ->> 'plannedMinutes'
        is distinct from requested_planned_minutes::text
      or existing_attempt.result_data -> 'nextSessionAdjustment'
        is distinct from adjustment
      or existing_attempt.result_data -> 'followUpSession'
        is distinct from case
          when follow_up_present then follow_up - 'studyRoute'
          else follow_up
        end
      or (
        requested_route_revision_id is null
        and existing_attempt.result_data ? 'routeRevisionId'
      )
      or (
        requested_route_revision_id is not null
        and existing_attempt.result_data ->> 'routeRevisionId'
          is distinct from requested_route_revision_id::text
      ) then
      raise exception using
        errcode = '40001',
        message = 'study_route_completion_retry_conflict';
    end if;

    if not exists (
      select 1
      from public.learning_events as event
      where event.user_id = current_user_id
        and event.plan_session_id = requested_session_id
        and event.event_type = 'session_completed'
        and event.event_data ->> 'attemptId' = requested_attempt_id::text
        and (
          (
            requested_route_revision_id is null
            and not (event.event_data ? 'routeRevisionId')
          ) or event.event_data ->> 'routeRevisionId'
            = requested_route_revision_id::text
        )
    ) then
      raise exception using
        errcode = '40001',
        message = 'study_route_completion_retry_conflict';
    end if;

    if adjustment_present then
      if successor_present then
        perform public.persist_study_route_scalar_projection(
          requested_plan_id,
          adaptation_session_id,
          successor_route
        );
      end if;
      perform public.assert_persisted_session_request(
        requested_plan_id,
        adaptation_session_id,
        case
          when successor_present then adjustment || pg_catalog.jsonb_build_object(
            'studyRoute',
            successor_route
          )
          else adjustment
        end
      );
      if successor_present then
        perform public.commit_study_route_revision(successor_route);
        perform public.assert_committed_study_route_projection(
          successor_route,
          requested_plan_id,
          adaptation_session_id
        );
      end if;
    end if;

    if follow_up_present then
      if follow_up_route_present then
        perform public.persist_study_route_scalar_projection(
          requested_plan_id,
          follow_up_session_id,
          follow_up_route
        );
        perform public.persist_route_session_arrays(
          requested_plan_id,
          follow_up_session_id,
          follow_up - 'studyRoute',
          follow_up_route
        );
      end if;
      perform public.assert_persisted_session_request(
        requested_plan_id,
        follow_up_session_id,
        follow_up
      );
      if follow_up_route_present then
        perform public.commit_study_route_revision(follow_up_route);
        perform public.assert_committed_study_route_projection(
          follow_up_route,
          requested_plan_id,
          follow_up_session_id
        );
      end if;
    end if;

    return requested_plan_id;
  end if;

  completed_plan_id := case requested_variant
    when 'guided' then public.complete_plan_session(sanitized_payload)
    when 'unguided_practice' then
      public.complete_unguided_plan_session(sanitized_payload)
    when 'guided_continuation' then
      public.complete_guided_plan_session_with_continuation(sanitized_payload)
  end;

  select attempt.result_data ->> 'routeRevisionId'
  into stored_route_revision_id
  from public.session_attempts as attempt
  where attempt.id = requested_attempt_id
    and attempt.plan_session_id = requested_session_id
    and attempt.user_id = current_user_id
  for update;

  if not found
    or (
      stored_route_revision_id is not null
      and stored_route_revision_id
        is distinct from requested_route_revision_id::text
    ) then
    raise exception using
      errcode = '40001',
      message = 'study_route_completion_conflict';
  end if;

  if requested_route_revision_id is not null then
    update public.session_attempts as attempt
    set result_data = pg_catalog.jsonb_set(
      coalesce(attempt.result_data, '{}'::jsonb),
      '{routeRevisionId}',
      pg_catalog.to_jsonb(requested_route_revision_id::text),
      true
    )
    where attempt.id = requested_attempt_id
      and attempt.plan_session_id = requested_session_id
      and attempt.user_id = current_user_id
      and (
        not (coalesce(attempt.result_data, '{}'::jsonb) ? 'routeRevisionId')
        or attempt.result_data ->> 'routeRevisionId'
          = requested_route_revision_id::text
      );

    if not found then
      raise exception using
        errcode = '40001',
        message = 'study_route_completion_conflict';
    end if;

    update public.learning_events as event
    set event_data = pg_catalog.jsonb_set(
      event.event_data,
      '{routeRevisionId}',
      pg_catalog.to_jsonb(requested_route_revision_id::text),
      true
    )
    where event.user_id = current_user_id
      and event.plan_session_id = requested_session_id
      and event.event_type = 'session_completed'
      and event.event_data ->> 'attemptId' = requested_attempt_id::text
      and (
        not (event.event_data ? 'routeRevisionId')
        or event.event_data ->> 'routeRevisionId'
          = requested_route_revision_id::text
      );

    if not found then
      raise exception using
        errcode = '40001',
        message = 'study_route_completion_event_conflict';
    end if;
  elsif exists (
    select 1
    from public.learning_events as event
    where event.user_id = current_user_id
      and event.plan_session_id = requested_session_id
      and event.event_type = 'session_completed'
      and event.event_data ->> 'attemptId' = requested_attempt_id::text
      and event.event_data ? 'routeRevisionId'
  ) then
    raise exception using
      errcode = '40001',
      message = 'study_route_completion_event_conflict';
  end if;

  if adjustment_present then
    if successor_present then
      perform public.persist_study_route_scalar_projection(
        requested_plan_id,
        adaptation_session_id,
        successor_route
      );
    end if;
    perform public.assert_persisted_session_request(
      requested_plan_id,
      adaptation_session_id,
      case
        when successor_present then adjustment || pg_catalog.jsonb_build_object(
          'studyRoute',
          successor_route
        )
        else adjustment
      end
    );
    if successor_present then
      perform public.commit_study_route_revision(successor_route);
      perform public.assert_committed_study_route_projection(
        successor_route,
        requested_plan_id,
        adaptation_session_id
      );
    end if;
  end if;

  if follow_up_present then
    if follow_up_route_present then
      perform public.persist_study_route_scalar_projection(
        requested_plan_id,
        follow_up_session_id,
        follow_up_route
      );
    end if;
    if requested_variant = 'guided' and follow_up_route_present then
      perform public.persist_route_session_arrays(
        requested_plan_id,
        follow_up_session_id,
        follow_up - 'studyRoute',
        follow_up_route
      );
    end if;
    perform public.assert_persisted_session_request(
      requested_plan_id,
      follow_up_session_id,
      follow_up
    );
    if follow_up_route_present then
      perform public.commit_study_route_revision(follow_up_route);
      perform public.assert_committed_study_route_projection(
        follow_up_route,
        requested_plan_id,
        follow_up_session_id
      );
    end if;
  end if;

  if continuation_present then
    if continuation_route_present then
      perform public.persist_study_route_scalar_projection(
        requested_plan_id,
        continuation_session_id,
        continuation_route
      );
    end if;
    perform public.assert_persisted_session_request(
      requested_plan_id,
      continuation_session_id,
      continuation
    );
    if continuation_route_present then
      perform public.commit_study_route_revision(continuation_route);
      perform public.assert_committed_study_route_projection(
        continuation_route,
        requested_plan_id,
        continuation_session_id
      );
    end if;
  end if;

  return completed_plan_id;
end;
$$;

create or replace function public.activate_concept_review_with_route(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_plan_id uuid;
  requested_session_id uuid;
  requested_origin_route_revision_id uuid;
  review_session jsonb := payload -> 'session';
  requested_route jsonb;
  sanitized_payload jsonb;
  requested_route_revision_id uuid;
  requested_plan public.plans%rowtype;
  stored_session public.plan_sessions%rowtype;
  total_session_count integer;
  routed_session_count integer;
  route_present boolean;
  activated_session_id uuid;
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'study_route_authentication_required';
  end if;

  if pg_catalog.jsonb_typeof(payload) is distinct from 'object'
    or pg_catalog.jsonb_typeof(review_session) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'concept_review_route_shape_invalid';
  end if;

  requested_route := review_session -> 'studyRoute';
  if coalesce(pg_catalog.jsonb_typeof(requested_route), 'null')
    not in ('object', 'null') then
    raise exception using
      errcode = '22023',
      message = 'concept_review_route_shape_invalid';
  end if;
  route_present := coalesce(
    pg_catalog.jsonb_typeof(requested_route) = 'object',
    false
  );

  begin
    requested_plan_id := nullif(payload ->> 'planId', '')::uuid;
    requested_session_id := nullif(review_session ->> 'id', '')::uuid;
    requested_origin_route_revision_id := case
      when payload ? 'originRouteRevisionId'
        then nullif(payload ->> 'originRouteRevisionId', '')::uuid
      else null
    end;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'concept_review_route_identity_invalid';
  end;

  if requested_plan_id is null
    or requested_session_id is null
    or (route_present and requested_origin_route_revision_id is null)
    or (
      not route_present
      and payload ? 'originRouteRevisionId'
    ) then
    raise exception using
      errcode = '22023',
      message = 'concept_review_route_identity_invalid';
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
      message = 'study_route_plan_not_found';
  end if;

  perform session.id
  from public.plan_sessions as session
  where session.plan_id = requested_plan_id
    and session.user_id = current_user_id
  order by session.sequence, session.id
  for update;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(session.committed_route_revision_id)::integer
  into total_session_count, routed_session_count
  from public.plan_sessions as session
  where session.plan_id = requested_plan_id
    and session.user_id = current_user_id;

  if total_session_count < 1
    or routed_session_count not in (0, total_session_count)
    or (routed_session_count = total_session_count and not route_present)
    or (routed_session_count = 0 and route_present) then
    raise exception using
      errcode = '40001',
      message = 'concept_review_study_route_coverage_conflict';
  end if;

  if route_present then
    requested_route_revision_id := public.validate_study_route_write_identity(
      requested_route,
      requested_plan_id,
      requested_session_id,
      null,
      true
    );
    perform public.assert_study_route_origin_reference(
      requested_route,
      requested_plan_id,
      requested_origin_route_revision_id
    );
  end if;

  sanitized_payload := pg_catalog.jsonb_set(
    payload - 'originRouteRevisionId',
    '{session}',
    review_session - 'studyRoute',
    true
  );

  select session.*
  into stored_session
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.user_id = current_user_id;

  if found then
    if stored_session.plan_id is distinct from requested_plan_id then
      raise exception using
        errcode = '40001',
        message = 'concept_review_activation_retry_conflict';
    end if;

    if route_present then
      perform public.persist_study_route_scalar_projection(
        requested_plan_id,
        requested_session_id,
        requested_route
      );
      perform public.persist_route_session_arrays(
        requested_plan_id,
        requested_session_id,
        review_session - 'studyRoute',
        requested_route
      );
    end if;

    perform public.assert_persisted_session_request(
      requested_plan_id,
      requested_session_id,
      review_session
    );

    if route_present then
      perform public.commit_study_route_revision(requested_route);
      perform public.assert_committed_study_route_projection(
        requested_route,
        requested_plan_id,
        requested_session_id
      );
    elsif stored_session.committed_route_revision_id is not null then
      raise exception using
        errcode = '40001',
        message = 'concept_review_activation_retry_conflict';
    end if;

    if not exists (
      select 1
      from public.learning_events as event
      where event.user_id = current_user_id
        and event.plan_session_id = requested_session_id
        and event.event_type = 'concept_review_activated'
        and event.event_data ->> 'concept'
          is not distinct from review_session ->> 'reviewConcept'
        and event.event_data ->> 'reviewType'
          is not distinct from review_session ->> 'reviewType'
        and event.event_data ->> 'estimatedMinutes'
          is not distinct from review_session ->> 'estimatedMinutes'
        and (
          (
            not route_present
            and not (event.event_data ? 'routeRevisionId')
          ) or event.event_data ->> 'routeRevisionId'
            = requested_route_revision_id::text
        )
    ) then
      raise exception using
        errcode = '40001',
        message = 'concept_review_activation_retry_conflict';
    end if;

    return requested_session_id;
  end if;

  if requested_plan.status <> 'completed' then
    raise exception using
      errcode = '55000',
      message = 'concept_review_plan_not_completed';
  end if;

  activated_session_id := public.activate_concept_review(sanitized_payload);
  if activated_session_id is distinct from requested_session_id then
    raise exception using
      errcode = '55000',
      message = 'concept_review_activation_identity_mismatch';
  end if;

  if route_present then
    perform public.persist_study_route_scalar_projection(
      requested_plan_id,
      requested_session_id,
      requested_route
    );
    perform public.persist_route_session_arrays(
      requested_plan_id,
      requested_session_id,
      review_session - 'studyRoute',
      requested_route
    );
  end if;

  perform public.assert_persisted_session_request(
    requested_plan_id,
    requested_session_id,
    review_session
  );

  if route_present then
    perform public.commit_study_route_revision(requested_route);
    perform public.assert_committed_study_route_projection(
      requested_route,
      requested_plan_id,
      requested_session_id
    );

    update public.learning_events as event
    set event_data = pg_catalog.jsonb_set(
      event.event_data,
      '{routeRevisionId}',
      pg_catalog.to_jsonb(requested_route_revision_id::text),
      true
    )
    where event.user_id = current_user_id
      and event.plan_session_id = requested_session_id
      and event.event_type = 'concept_review_activated'
      and (
        not (event.event_data ? 'routeRevisionId')
        or event.event_data ->> 'routeRevisionId'
          = requested_route_revision_id::text
      );

    if not found then
      raise exception using
        errcode = '40001',
        message = 'concept_review_activation_event_conflict';
    end if;
  elsif exists (
    select 1
    from public.learning_events as event
    where event.user_id = current_user_id
      and event.plan_session_id = requested_session_id
      and event.event_type = 'concept_review_activated'
      and event.event_data ? 'routeRevisionId'
  ) then
    raise exception using
      errcode = '40001',
      message = 'concept_review_activation_event_conflict';
  end if;

  return activated_session_id;
end;
$$;

-- Legacy null-pointer sessions remain supported by the route-aware wrappers,
-- so route-agnostic entry points no longer need to stay client-callable.
revoke all on function public.save_active_session_checkpoint(jsonb)
from public, anon, authenticated;
revoke all on function public.save_active_session_checkpoint_with_completion_mode(jsonb)
from public, anon, authenticated;
revoke all on function public.complete_plan_session(jsonb)
from public, anon, authenticated;
revoke all on function public.complete_unguided_plan_session(jsonb)
from public, anon, authenticated;
revoke all on function public.complete_guided_plan_session_with_continuation(jsonb)
from public, anon, authenticated;
revoke all on function public.record_session_interruption(jsonb)
from public, anon, authenticated;
revoke all on function public.record_session_interruption_with_activity_progress(jsonb)
from public, anon, authenticated;
revoke all on function public.activate_concept_review(jsonb)
from public, anon, authenticated;

revoke all on function public.lock_study_route_binding_v2(uuid, uuid, boolean)
from public, anon, authenticated;
revoke all on function public.assert_study_route_binding(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.validate_study_route_write_identity(
  jsonb, uuid, uuid, uuid, boolean
) from public, anon, authenticated;
revoke all on function public.assert_study_route_origin_reference(
  jsonb, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.assert_study_route_successor_material_change(
  jsonb, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.persist_study_route_scalar_projection(
  uuid, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.persist_route_session_arrays(
  uuid, uuid, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.assert_persisted_session_request(uuid, uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.assert_committed_study_route_projection(jsonb, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.guard_study_route_pointer_transition()
from public, anon, authenticated;

revoke all on function public.complete_plan_session_with_route(jsonb)
from public, anon, authenticated;
grant execute on function public.complete_plan_session_with_route(jsonb)
to authenticated;

revoke all on function public.activate_concept_review_with_route(jsonb)
from public, anon, authenticated;
grant execute on function public.activate_concept_review_with_route(jsonb)
to authenticated;
