-- Preserve whether an awaiting-finish recovery point came from guided work or
-- an ungraded method workpad. The existing checkpoint RPC remains the single
-- authority for identity, lesson fingerprints, timing, bounds, and monotonic
-- progress; this wrapper validates and appends only the provenance field.

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

  requested_completion_mode := coalesce(payload ->> 'completionMode', 'guided');

  begin
    requested_session_id := nullif(payload ->> 'planSessionId', '')::uuid;
  exception when others then
    raise exception 'The active-session checkpoint values are not valid.';
  end;

  -- Lock and read provenance before delegating. The mature RPC rewrites the
  -- canonical checkpoint, so an advancing save would otherwise erase the
  -- stored mode before this wrapper could make it authoritative.
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
  else
    canonical_completion_mode := requested_completion_mode;
  end if;

  canonical_checkpoint := public.save_active_session_checkpoint(
    payload - 'completionMode'
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

  return canonical_checkpoint;
end;
$$;

revoke all on function public.save_active_session_checkpoint_with_completion_mode(jsonb) from public, anon;
grant execute on function public.save_active_session_checkpoint_with_completion_mode(jsonb) to authenticated;
