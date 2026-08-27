-- Bind recoverable and terminal learning records to the exact committed
-- StudyRoute revision that authorized the work. Mature checkpoint,
-- completion, continuation, verification, and interruption writers remain the
-- owners of their existing validation; these wrappers add only route identity
-- validation and provenance stamping around those transactions.

create or replace function public.assert_study_route_binding(
  requested_session_id uuid,
  requested_route_revision_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  committed_revision_id uuid;
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'study_route_authentication_required';
  end if;

  select session.committed_route_revision_id
  into committed_revision_id
  from public.plan_sessions as session
  where session.id = requested_session_id
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
      and route.user_id = current_user_id
      and route.lifecycle = 'committed'
  ) then
    raise exception using
      errcode = '40001',
      message = 'study_route_revision_conflict';
  end if;
end;
$$;

create or replace function public.save_active_session_checkpoint_with_route(
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_session_id uuid;
  requested_route_revision_id uuid;
  requested_version integer;
  stored_checkpoint jsonb;
  canonical_checkpoint jsonb;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'The active-session checkpoint shape is not valid.';
  end if;

  begin
    requested_session_id := nullif(payload ->> 'planSessionId', '')::uuid;
    requested_version := nullif(payload ->> 'version', '')::integer;
    requested_route_revision_id := case
      when payload ? 'routeRevisionId'
        then nullif(payload ->> 'routeRevisionId', '')::uuid
      else null
    end;
  exception when others then
    raise exception 'The active-session checkpoint values are not valid.';
  end;

  if requested_version not in (1, 2)
    or (requested_version = 1 and payload ? 'routeRevisionId')
    or (requested_version = 2 and requested_route_revision_id is null) then
    raise exception 'The active-session checkpoint route is not valid.';
  end if;

  perform public.assert_study_route_binding(
    requested_session_id,
    requested_route_revision_id
  );

  select session.step_data -> 'activeSessionCheckpoint'
  into stored_checkpoint
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.user_id = current_user_id;

  if jsonb_typeof(stored_checkpoint) = 'object' and (
    stored_checkpoint ->> 'version' is distinct from requested_version::text
    or (
      requested_version = 2
      and stored_checkpoint ->> 'routeRevisionId'
        is distinct from requested_route_revision_id::text
    )
    or (
      requested_version = 1
      and stored_checkpoint ? 'routeRevisionId'
    )
  ) then
    raise exception using
      errcode = '40001',
      message = 'active_session_checkpoint_conflict';
  end if;

  canonical_checkpoint := public.save_active_session_checkpoint_with_completion_mode(
    (payload - 'routeRevisionId') || jsonb_build_object('version', 1)
  );

  if requested_version = 1 then
    return canonical_checkpoint;
  end if;

  canonical_checkpoint := canonical_checkpoint || jsonb_build_object(
    'version', 2,
    'routeRevisionId', requested_route_revision_id
  );

  update public.plan_sessions as session
  set step_data = jsonb_set(
    session.step_data,
    '{activeSessionCheckpoint}',
    canonical_checkpoint,
    false
  )
  where session.id = requested_session_id
    and session.user_id = current_user_id
    and session.committed_route_revision_id = requested_route_revision_id
    and session.step_data -> 'activeSessionCheckpoint' ->> 'runId'
      = canonical_checkpoint ->> 'runId'
    and session.step_data -> 'activeSessionCheckpoint' ->> 'resourceFingerprint'
      = canonical_checkpoint ->> 'resourceFingerprint';

  if not found then
    raise exception using
      errcode = '40001',
      message = 'active_session_checkpoint_conflict';
  end if;

  return canonical_checkpoint;
end;
$$;

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
  concept_evidence jsonb := coalesce(payload -> 'conceptEvidence', '[]'::jsonb);
  confidence_evidence jsonb := coalesce(payload -> 'confidenceEvidence', '[]'::jsonb);
  completed_plan_id uuid;
  stored_route_revision_id text;
begin
  if jsonb_typeof(payload) is distinct from 'object'
    or requested_variant not in ('guided', 'unguided_practice', 'guided_continuation') then
    raise exception 'The route-bound session completion shape is not valid.';
  end if;

  begin
    requested_attempt_id := nullif(payload ->> 'attemptId', '')::uuid;
    requested_session_id := nullif(payload ->> 'planSessionId', '')::uuid;
    requested_route_revision_id := case
      when payload ? 'routeRevisionId'
        then nullif(payload ->> 'routeRevisionId', '')::uuid
      else null
    end;
  exception when others then
    raise exception 'The route-bound session completion values are not valid.';
  end;

  perform public.assert_study_route_binding(
    requested_session_id,
    requested_route_revision_id
  );

  if jsonb_typeof(concept_evidence) is distinct from 'array'
    or jsonb_typeof(confidence_evidence) is distinct from 'array'
    or exists (
      select 1
      from jsonb_array_elements(concept_evidence) as evidence(entry)
      where (
        requested_route_revision_id is null
        and entry ? 'routeRevisionId'
      ) or (
        requested_route_revision_id is not null
        and entry ->> 'routeRevisionId'
          is distinct from requested_route_revision_id::text
      )
    )
    or exists (
      select 1
      from jsonb_array_elements(confidence_evidence) as evidence(entry)
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

  completed_plan_id := case requested_variant
    when 'guided' then public.complete_plan_session(
      payload - 'completionVariant' - 'routeRevisionId'
    )
    when 'unguided_practice' then public.complete_unguided_plan_session(
      payload - 'completionVariant' - 'routeRevisionId'
    )
    when 'guided_continuation' then public.complete_guided_plan_session_with_continuation(
      payload - 'completionVariant' - 'routeRevisionId'
    )
  end;

  select attempt.result_data ->> 'routeRevisionId'
  into stored_route_revision_id
  from public.session_attempts as attempt
  where attempt.id = requested_attempt_id
    and attempt.plan_session_id = requested_session_id
    and attempt.user_id = current_user_id
  for update;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'study_route_completion_conflict';
  end if;

  if stored_route_revision_id is not null
    and stored_route_revision_id is distinct from requested_route_revision_id::text then
    raise exception using
      errcode = '40001',
      message = 'study_route_completion_conflict';
  end if;

  if requested_route_revision_id is not null then
    update public.session_attempts as attempt
    set result_data = jsonb_set(
      coalesce(attempt.result_data, '{}'::jsonb),
      '{routeRevisionId}',
      to_jsonb(requested_route_revision_id::text),
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
    set event_data = jsonb_set(
      event.event_data,
      '{routeRevisionId}',
      to_jsonb(requested_route_revision_id::text),
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

  return completed_plan_id;
end;
$$;

create or replace function public.record_session_interruption_with_route(payload jsonb)
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
  declared_evidence jsonb := payload -> 'evidence';
  interrupted_plan_id uuid;
  stored_route_revision_id text;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'The route-bound session interruption shape is not valid.';
  end if;

  begin
    requested_attempt_id := nullif(payload ->> 'attemptId', '')::uuid;
    requested_session_id := nullif(payload ->> 'planSessionId', '')::uuid;
    requested_route_revision_id := case
      when payload ? 'routeRevisionId'
        then nullif(payload ->> 'routeRevisionId', '')::uuid
      else null
    end;
  exception when others then
    raise exception 'The route-bound session interruption values are not valid.';
  end;

  perform public.assert_study_route_binding(
    requested_session_id,
    requested_route_revision_id
  );

  if jsonb_typeof(declared_evidence) = 'object' and (
    exists (
      select 1
      from jsonb_array_elements(
        coalesce(declared_evidence -> 'conceptEvidence', '[]'::jsonb)
      ) as evidence(entry)
      where (
        requested_route_revision_id is null
        and entry ? 'routeRevisionId'
      ) or (
        requested_route_revision_id is not null
        and entry ->> 'routeRevisionId'
          is distinct from requested_route_revision_id::text
      )
    )
    or exists (
      select 1
      from jsonb_array_elements(
        coalesce(declared_evidence -> 'confidenceEvidence', '[]'::jsonb)
      ) as evidence(entry)
      where (
        requested_route_revision_id is null
        and entry ? 'routeRevisionId'
      ) or (
        requested_route_revision_id is not null
        and entry ->> 'routeRevisionId'
          is distinct from requested_route_revision_id::text
      )
    )
  ) then
    raise exception using
      errcode = '40001',
      message = 'study_route_evidence_conflict';
  end if;

  interrupted_plan_id := case
    when payload ? 'activityProgress' then
      public.record_session_interruption_with_activity_progress(
        payload - 'routeRevisionId'
      )
    else public.record_session_interruption(
      payload - 'routeRevisionId'
    )
  end;

  select attempt.result_data ->> 'routeRevisionId'
  into stored_route_revision_id
  from public.session_attempts as attempt
  where attempt.id = requested_attempt_id
    and attempt.plan_session_id = requested_session_id
    and attempt.user_id = current_user_id
  for update;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'study_route_interruption_conflict';
  end if;

  if stored_route_revision_id is not null
    and stored_route_revision_id is distinct from requested_route_revision_id::text then
    raise exception using
      errcode = '40001',
      message = 'study_route_interruption_conflict';
  end if;

  if requested_route_revision_id is not null then
    update public.session_attempts as attempt
    set result_data = jsonb_set(
      coalesce(attempt.result_data, '{}'::jsonb),
      '{routeRevisionId}',
      to_jsonb(requested_route_revision_id::text),
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
        message = 'study_route_interruption_conflict';
    end if;

    update public.learning_events as event
    set event_data = jsonb_set(
      event.event_data,
      '{routeRevisionId}',
      to_jsonb(requested_route_revision_id::text),
      true
    )
    where event.user_id = current_user_id
      and event.plan_session_id = requested_session_id
      and event.event_type = 'session_interrupted'
      and event.event_data ->> 'attemptId' = requested_attempt_id::text
      and (
        not (event.event_data ? 'routeRevisionId')
        or event.event_data ->> 'routeRevisionId'
          = requested_route_revision_id::text
      );

    if not found then
      raise exception using
        errcode = '40001',
        message = 'study_route_interruption_event_conflict';
    end if;
  elsif exists (
    select 1
    from public.learning_events as event
    where event.user_id = current_user_id
      and event.plan_session_id = requested_session_id
      and event.event_type = 'session_interrupted'
      and event.event_data ->> 'attemptId' = requested_attempt_id::text
      and event.event_data ? 'routeRevisionId'
  ) then
    raise exception using
      errcode = '40001',
      message = 'study_route_interruption_event_conflict';
  end if;

  return interrupted_plan_id;
end;
$$;

revoke all on function public.assert_study_route_binding(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.save_active_session_checkpoint_with_route(jsonb)
from public, anon, authenticated;
revoke all on function public.complete_plan_session_with_route(jsonb)
from public, anon, authenticated;
revoke all on function public.record_session_interruption_with_route(jsonb)
from public, anon, authenticated;

grant execute on function public.save_active_session_checkpoint_with_route(jsonb)
to authenticated;
grant execute on function public.complete_plan_session_with_route(jsonb)
to authenticated;
grant execute on function public.record_session_interruption_with_route(jsonb)
to authenticated;
