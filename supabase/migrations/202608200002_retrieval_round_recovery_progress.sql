-- Preserve completed, ratings-only progress inside a generated retrieval
-- round. No learner answer, hint state, or generated reference text is stored.

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
begin
  if progress is null or jsonb_typeof(progress) = 'null' then
    return true;
  end if;

  if jsonb_typeof(progress) <> 'object'
    or not (progress ?& array['kind', 'activityIndex', 'promptCount', 'ratings'])
    or exists (
      select 1
      from jsonb_object_keys(progress) as progress_keys(progress_key)
      where progress_key not in ('kind', 'activityIndex', 'promptCount', 'ratings')
    )
    or progress ->> 'kind' <> 'retrieval_round'
    or jsonb_typeof(progress -> 'activityIndex') <> 'number'
    or jsonb_typeof(progress -> 'promptCount') <> 'number'
    or jsonb_typeof(progress -> 'ratings') <> 'array' then
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
    or jsonb_array_length(progress -> 'ratings') > prompt_count * 2
    or octet_length(progress::text) > 500
    or exists (
      select 1
      from jsonb_array_elements(progress -> 'ratings') as ratings(entry)
      where jsonb_typeof(entry) <> 'string'
        or entry #>> '{}' not in ('got_it', 'partly', 'missed')
    ) then
    return false;
  end if;

  retrieval_queue := array(select generate_series(0, prompt_count - 1));
  attempts := array_fill(0, array[prompt_count]);

  for rating in
    select entry from jsonb_array_elements(progress -> 'ratings') as ratings(entry)
  loop
    queue_length := coalesce(array_length(retrieval_queue, 1), 0);
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
      retrieval_queue := array_append(retrieval_queue, active_index);
    end if;
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

-- Keep the established RPC name so older clients continue to work. An older
-- client cannot erase same-step recall progress: absence means preserve it;
-- advancing to another completed content step intentionally clears it.
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
  requested_rating_count integer;
  stored_rating_count integer;
  shared_rating_count integer;
  ratings_have_common_prefix boolean := true;
  caller_supports_activity_progress boolean := payload ? 'activityProgress';
begin
  if jsonb_typeof(payload) <> 'object' then
    raise exception 'The active-session checkpoint shape is not valid.';
  end if;

  if payload ? 'completionMode' and (
    jsonb_typeof(payload -> 'completionMode') <> 'string'
    or coalesce(payload ->> 'completionMode', '') not in ('guided', 'unguided_practice')
  ) then
    raise exception 'The active-session checkpoint completion mode is not valid.';
  end if;

  if not public.is_valid_session_activity_progress(requested_activity_progress)
    or (
      requested_activity_progress is not null
      and jsonb_typeof(requested_activity_progress) <> 'null'
      and payload ->> 'status' <> 'working'
    ) then
    raise exception 'The active-session activity progress is not valid.';
  end if;

  requested_completion_mode := coalesce(payload ->> 'completionMode', 'guided');

  begin
    requested_session_id := nullif(payload ->> 'planSessionId', '')::uuid;
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

  if jsonb_typeof(stored_checkpoint) = 'object'
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
    elsif jsonb_typeof(stored_activity_progress) <> 'object' then
      canonical_activity_progress := requested_activity_progress;
    elsif jsonb_typeof(requested_activity_progress) <> 'object' then
      canonical_activity_progress := stored_activity_progress;
    else
      if stored_activity_progress ->> 'activityIndex'
          is distinct from requested_activity_progress ->> 'activityIndex'
        or stored_activity_progress ->> 'promptCount'
          is distinct from requested_activity_progress ->> 'promptCount' then
        raise exception using
          errcode = '40001',
          message = 'active_session_checkpoint_conflict';
      end if;

      stored_rating_count := jsonb_array_length(stored_activity_progress -> 'ratings');
      requested_rating_count := jsonb_array_length(requested_activity_progress -> 'ratings');
      shared_rating_count := least(stored_rating_count, requested_rating_count);
      if shared_rating_count > 0 then
        select bool_and(
          stored_activity_progress -> 'ratings' -> rating_index
          = requested_activity_progress -> 'ratings' -> rating_index
        )
        into ratings_have_common_prefix
        from generate_series(0, shared_rating_count - 1) as rating_indexes(rating_index);
      end if;

      if not coalesce(ratings_have_common_prefix, true) then
        raise exception using
          errcode = '40001',
          message = 'active_session_checkpoint_conflict';
      end if;

      canonical_activity_progress := case
        when requested_rating_count >= stored_rating_count then requested_activity_progress
        else stored_activity_progress
      end;
    end if;
  else
    canonical_completion_mode := requested_completion_mode;
    canonical_activity_progress := requested_activity_progress;
  end if;

  canonical_checkpoint := public.save_active_session_checkpoint(
    payload - 'completionMode' - 'activityProgress'
  );

  if jsonb_typeof(canonical_checkpoint) <> 'object' then
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

  canonical_checkpoint := canonical_checkpoint || jsonb_build_object(
    'completionMode',
    canonical_completion_mode
  );
  if canonical_checkpoint ->> 'status' = 'working'
    and jsonb_typeof(canonical_activity_progress) = 'object' then
    canonical_checkpoint := canonical_checkpoint || jsonb_build_object(
      'activityProgress',
      canonical_activity_progress
    );
  else
    canonical_checkpoint := canonical_checkpoint - 'activityProgress';
  end if;

  update public.plan_sessions
  set step_data = jsonb_set(
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

  -- A pre-migration client uses a strict checkpoint parser. Preserve the new
  -- field in storage, but do not add an unknown key to that client's response.
  return case
    when caller_supports_activity_progress then canonical_checkpoint
    else canonical_checkpoint - 'activityProgress'
  end;
end;
$$;

-- The existing interruption writer owns validation and terminal semantics.
-- This wrapper adds the same bounded activity marker to the two durable rows
-- only after that write succeeds.
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
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.is_valid_session_activity_progress(requested_activity_progress) then
    raise exception 'The interrupted-session activity progress is not valid.';
  end if;

  begin
    requested_attempt_id := nullif(payload ->> 'attemptId', '')::uuid;
    requested_session_id := nullif(payload ->> 'planSessionId', '')::uuid;
  exception when others then
    raise exception 'Session identifiers are not valid.';
  end;

  interrupted_plan_id := public.record_session_interruption(
    payload - 'activityProgress'
  );

  -- Lock both terminal records after the mature writer has created (or found)
  -- them. Once either record has a bounded marker it is immutable; a legacy
  -- record with no marker may be enriched once, but a stale retry can never
  -- shorten or replace progress already attached to the exit.
  select attempts.result_data -> 'activityProgress'
  into stored_attempt_progress
  from public.session_attempts as attempts
  where attempts.id = requested_attempt_id
    and attempts.user_id = current_user_id
    and attempts.plan_session_id = requested_session_id
  for update;

  if not found then
    raise exception 'The interrupted session could not preserve its activity progress.';
  end if;

  select events.event_data -> 'activityProgress'
  into stored_event_progress
  from public.learning_events as events
  where events.user_id = current_user_id
    and events.plan_session_id = requested_session_id
    and events.event_type = 'session_interrupted'
    and events.event_data ->> 'attemptId' = requested_attempt_id::text
  for update;

  if not found then
    raise exception 'The interrupted session could not preserve its recovery event.';
  end if;

  if not public.is_valid_session_activity_progress(stored_attempt_progress)
    or not public.is_valid_session_activity_progress(stored_event_progress) then
    raise exception using
      errcode = '40001',
      message = 'session_interruption_activity_progress_conflict';
  end if;

  if jsonb_typeof(stored_attempt_progress) = 'object'
    and jsonb_typeof(stored_event_progress) = 'object'
    and stored_attempt_progress is distinct from stored_event_progress then
    raise exception using
      errcode = '40001',
      message = 'session_interruption_activity_progress_conflict';
  end if;

  canonical_activity_progress := case
    when jsonb_typeof(stored_attempt_progress) = 'object' then stored_attempt_progress
    when jsonb_typeof(stored_event_progress) = 'object' then stored_event_progress
    else requested_activity_progress
  end;

  if jsonb_typeof(requested_activity_progress) = 'object'
    and jsonb_typeof(canonical_activity_progress) = 'object'
    and requested_activity_progress is distinct from canonical_activity_progress then
    raise exception using
      errcode = '40001',
      message = 'session_interruption_activity_progress_conflict';
  end if;

  if jsonb_typeof(canonical_activity_progress) = 'object' then
    update public.session_attempts
    set result_data = result_data || jsonb_build_object(
      'activityProgress',
      canonical_activity_progress
    )
    where id = requested_attempt_id
      and user_id = current_user_id
      and plan_session_id = requested_session_id;

    if not found then
      raise exception 'The interrupted session could not preserve its activity progress.';
    end if;

    update public.learning_events
    set event_data = event_data || jsonb_build_object(
      'activityProgress',
      canonical_activity_progress
    )
    where user_id = current_user_id
      and plan_session_id = requested_session_id
      and event_type = 'session_interrupted'
      and event_data ->> 'attemptId' = requested_attempt_id::text;

    if not found then
      raise exception 'The interrupted session could not preserve its recovery event.';
    end if;
  end if;

  return interrupted_plan_id;
end;
$$;

revoke all on function public.is_valid_session_activity_progress(jsonb) from public, anon;
grant execute on function public.is_valid_session_activity_progress(jsonb) to authenticated;

revoke all on function public.save_active_session_checkpoint_with_completion_mode(jsonb) from public, anon;
grant execute on function public.save_active_session_checkpoint_with_completion_mode(jsonb) to authenticated;

revoke all on function public.record_session_interruption_with_activity_progress(jsonb) from public, anon;
grant execute on function public.record_session_interruption_with_activity_progress(jsonb) to authenticated;
