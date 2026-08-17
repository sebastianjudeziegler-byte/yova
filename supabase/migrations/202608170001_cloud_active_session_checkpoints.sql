-- Preserve an in-progress guided session across signed-in devices without
-- storing the learner's unfinished answer or generated tutor prose. The
-- checkpoint lives beside the private generated-session cache and is replaced
-- only by monotonic writes for the exact same run and lesson fingerprint.

create or replace function public.save_active_session_checkpoint(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_session public.plan_sessions%rowtype;
  existing_checkpoint jsonb;
  canonical_checkpoint jsonb;
  requested_run_id uuid;
  requested_resource_generated_at timestamptz;
  stored_resource_generated_at timestamptz;
  requested_started_at timestamptz;
  requested_saved_at timestamptz;
  requested_completed_at timestamptz;
  requested_active_seconds numeric;
  requested_planned_minutes numeric;
  requested_completed_steps numeric;
  requested_total_steps numeric;
  requested_resume_step numeric;
  evidence jsonb := payload -> 'evidence';
  pending_repair jsonb := payload -> 'pendingRepair';
  evidence_correct_answers numeric;
  evidence_total_answers numeric;
  evidence_completed_repairs numeric;
  existing_started_at timestamptz;
  existing_saved_at timestamptz;
  existing_active_seconds numeric;
  existing_planned_minutes numeric;
  existing_completed_steps numeric;
  existing_resume_step numeric;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if jsonb_typeof(payload) <> 'object' then
    raise exception 'The active-session checkpoint shape is not valid.';
  end if;

  if not (payload ? 'resourceGeneratedAt')
    or jsonb_typeof(payload -> 'resourceGeneratedAt') <> 'string'
    or coalesce(payload ->> 'resourceGeneratedAt', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    raise exception using
      errcode = '40001',
      message = 'active_session_checkpoint_conflict';
  end if;

  begin
    requested_resource_generated_at := (payload ->> 'resourceGeneratedAt')::timestamptz;
  exception when others then
    raise exception using
      errcode = '40001',
      message = 'active_session_checkpoint_conflict';
  end;

  if not (payload ?& array[
      'version',
      'runId',
      'planSessionId',
      'status',
      'startedAt',
      'savedAt',
      'activeSeconds',
      'plannedMinutes',
      'completedSteps',
      'totalSteps',
      'resumeStep',
      'resourceFingerprint',
      'resourceGeneratedAt'
    ]) or exists (
      select 1
      from jsonb_object_keys(payload) as root_keys(root_key)
      where root_key not in (
        'version',
        'runId',
        'planSessionId',
        'status',
        'startedAt',
        'savedAt',
        'activeSeconds',
        'plannedMinutes',
        'completedSteps',
        'totalSteps',
        'resumeStep',
        'resourceFingerprint',
        'resourceGeneratedAt',
        'evidence',
        'pendingRepair',
        'completedAt',
        'completionFeedback'
      )
    ) then
    raise exception 'The active-session checkpoint shape is not valid.';
  end if;

  if payload -> 'version' <> '1'::jsonb
    or jsonb_typeof(payload -> 'runId') <> 'string'
    or jsonb_typeof(payload -> 'planSessionId') <> 'string'
    or jsonb_typeof(payload -> 'status') <> 'string'
    or jsonb_typeof(payload -> 'startedAt') <> 'string'
    or jsonb_typeof(payload -> 'savedAt') <> 'string'
    or jsonb_typeof(payload -> 'activeSeconds') <> 'number'
    or jsonb_typeof(payload -> 'plannedMinutes') <> 'number'
    or jsonb_typeof(payload -> 'completedSteps') <> 'number'
    or jsonb_typeof(payload -> 'totalSteps') <> 'number'
    or jsonb_typeof(payload -> 'resumeStep') <> 'number'
    or jsonb_typeof(payload -> 'resourceFingerprint') <> 'string'
    or jsonb_typeof(payload -> 'resourceGeneratedAt') <> 'string'
    or coalesce(payload ->> 'status', '') not in ('working', 'awaiting_finish')
    or coalesce(payload ->> 'resourceFingerprint', '') !~ '^sr1:[0-9a-f]{16}$'
    or coalesce(payload ->> 'startedAt', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
    or coalesce(payload ->> 'savedAt', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    raise exception 'The active-session checkpoint values are not valid.';
  end if;

  begin
    requested_run_id := (payload ->> 'runId')::uuid;
    requested_session.id := (payload ->> 'planSessionId')::uuid;
    requested_started_at := (payload ->> 'startedAt')::timestamptz;
    requested_saved_at := (payload ->> 'savedAt')::timestamptz;
    requested_active_seconds := (payload ->> 'activeSeconds')::numeric;
    requested_planned_minutes := (payload ->> 'plannedMinutes')::numeric;
    requested_completed_steps := (payload ->> 'completedSteps')::numeric;
    requested_total_steps := (payload ->> 'totalSteps')::numeric;
    requested_resume_step := (payload ->> 'resumeStep')::numeric;
  exception when others then
    raise exception 'The active-session checkpoint values are not valid.';
  end;

  if requested_active_seconds <> trunc(requested_active_seconds)
    or requested_active_seconds not between 0 and 21600
    or requested_planned_minutes <> trunc(requested_planned_minutes)
    or requested_planned_minutes not between 5 and 180
    or requested_completed_steps <> trunc(requested_completed_steps)
    or requested_completed_steps not between 0 and 24
    or requested_total_steps <> trunc(requested_total_steps)
    or requested_total_steps not between 1 and 24
    or requested_resume_step <> trunc(requested_resume_step)
    or requested_resume_step not between 0 and 24
    or requested_completed_steps > requested_total_steps
    or requested_resume_step > requested_completed_steps
    or requested_started_at > requested_saved_at
    or requested_started_at < requested_saved_at - interval '7 days'
    or requested_saved_at < now() - interval '7 days'
    or requested_saved_at > now() + interval '5 minutes' then
    raise exception 'The active-session checkpoint progress is not valid.';
  end if;

  if payload ->> 'status' = 'working' then
    if requested_completed_steps >= requested_total_steps
      or payload ? 'completedAt'
      or payload ? 'completionFeedback' then
      raise exception 'A working checkpoint must describe unfinished work.';
    end if;
  else
    if not (payload ?& array['completedAt', 'completionFeedback', 'evidence'])
      or payload ? 'pendingRepair'
      or jsonb_typeof(payload -> 'completedAt') <> 'string'
      or jsonb_typeof(payload -> 'completionFeedback') <> 'string'
      or coalesce(payload ->> 'completedAt', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(payload ->> 'completionFeedback', '') not in ('too_easy', 'about_right', 'too_difficult')
      or requested_completed_steps <> requested_total_steps then
      raise exception 'An awaiting-finish checkpoint is not valid.';
    end if;

    begin
      requested_completed_at := (payload ->> 'completedAt')::timestamptz;
    exception when others then
      raise exception 'The checkpoint completion time is not valid.';
    end;

    if requested_completed_at < requested_started_at
      or requested_completed_at > requested_saved_at + interval '5 minutes' then
      raise exception 'The checkpoint completion time is not valid.';
    end if;
  end if;

  if payload ? 'evidence' then
    if jsonb_typeof(evidence) <> 'object' then
      raise exception 'Checkpoint evidence is not valid.';
    end if;

    if not (evidence ?& array[
        'correctAnswers',
        'totalAnswers',
        'conceptEvidence',
        'confidenceEvidence',
        'observedGap',
        'completedImmediateRepairs'
      ]) or exists (
        select 1
        from jsonb_object_keys(evidence) as evidence_keys(evidence_key)
        where evidence_key not in (
          'correctAnswers',
          'totalAnswers',
          'conceptEvidence',
          'confidenceEvidence',
          'observedGap',
          'completedImmediateRepairs'
        )
      ) then
      raise exception 'Checkpoint evidence is not valid.';
    end if;

    if jsonb_typeof(evidence -> 'correctAnswers') <> 'number'
      or jsonb_typeof(evidence -> 'totalAnswers') <> 'number'
      or jsonb_typeof(evidence -> 'completedImmediateRepairs') <> 'number'
      or jsonb_typeof(evidence -> 'conceptEvidence') <> 'array'
      or jsonb_typeof(evidence -> 'confidenceEvidence') <> 'array'
      or jsonb_typeof(evidence -> 'observedGap') <> 'string' then
      raise exception 'Checkpoint evidence is not valid.';
    end if;

    begin
      evidence_correct_answers := (evidence ->> 'correctAnswers')::numeric;
      evidence_total_answers := (evidence ->> 'totalAnswers')::numeric;
      evidence_completed_repairs := (evidence ->> 'completedImmediateRepairs')::numeric;
    exception when others then
      raise exception 'Checkpoint evidence is not valid.';
    end;

    if evidence_correct_answers <> trunc(evidence_correct_answers)
      or evidence_correct_answers not between 0 and 24
      or evidence_total_answers <> trunc(evidence_total_answers)
      or evidence_total_answers not between 0 and 24
      or evidence_correct_answers > evidence_total_answers
      or evidence_completed_repairs <> trunc(evidence_completed_repairs)
      or evidence_completed_repairs not between 0 and 4
      or length(btrim(evidence ->> 'observedGap')) not between 1 and 1000
      or jsonb_array_length(evidence -> 'conceptEvidence') > 24
      or jsonb_array_length(evidence -> 'confidenceEvidence') > 24
      or octet_length(evidence::text) > 20000 then
      raise exception 'Checkpoint evidence is outside its privacy bounds.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(evidence -> 'conceptEvidence') as concept_entries(concept_entry)
      where jsonb_typeof(concept_entry) <> 'object'
    ) or exists (
      select 1
      from jsonb_array_elements(evidence -> 'confidenceEvidence') as confidence_entries(confidence_entry)
      where jsonb_typeof(confidence_entry) <> 'object'
    ) then
      raise exception 'Checkpoint evidence contains an invalid entry.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(evidence -> 'conceptEvidence') as concept_entries(concept_entry)
      where not (concept_entry ?& array['concept', 'outcome', 'activityType'])
        or exists (
          select 1
          from jsonb_object_keys(concept_entry) as concept_keys(concept_key)
          where concept_key not in (
            'topicId',
            'concept',
            'outcome',
            'activityType',
            'methodPhase',
            'attempt',
            'misconceptionSummary'
          )
        )
        or jsonb_typeof(concept_entry -> 'concept') <> 'string'
        or jsonb_typeof(concept_entry -> 'outcome') <> 'string'
        or jsonb_typeof(concept_entry -> 'activityType') <> 'string'
        or length(btrim(concept_entry ->> 'concept')) not between 2 and 120
        or coalesce(concept_entry ->> 'outcome', '') not in ('secure', 'needs_review')
        or coalesce(concept_entry ->> 'activityType', '') not in ('multiple_choice', 'free_response')
        or (
          concept_entry ? 'topicId'
          and (
            jsonb_typeof(concept_entry -> 'topicId') <> 'string'
            or coalesce(concept_entry ->> 'topicId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
        )
        or (
          concept_entry ? 'methodPhase'
          and (
            jsonb_typeof(concept_entry -> 'methodPhase') <> 'string'
            or coalesce(concept_entry ->> 'methodPhase', '') not in (
              'orient',
              'model',
              'read_source',
              'retrieve',
              'explain',
              'guided_practice',
              'independent_practice',
              'discriminate',
              'repair',
              'evidence_match',
              'code_trace',
              'transfer',
              'schedule_return',
              'reflect'
            )
          )
        )
        or (
          concept_entry ? 'attempt'
          and (
            jsonb_typeof(concept_entry -> 'attempt') <> 'number'
            or concept_entry -> 'attempt' not in ('1'::jsonb, '2'::jsonb)
          )
        )
        or (
          concept_entry ? 'misconceptionSummary'
          and (
            jsonb_typeof(concept_entry -> 'misconceptionSummary') <> 'string'
            or length(btrim(concept_entry ->> 'misconceptionSummary')) not between 8 and 300
          )
        )
    ) then
      raise exception 'Checkpoint concept evidence is not valid.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(evidence -> 'confidenceEvidence') as confidence_entries(confidence_entry)
      where not (confidence_entry ?& array['concept', 'confidence', 'correct', 'activityType'])
        or exists (
          select 1
          from jsonb_object_keys(confidence_entry) as confidence_keys(confidence_key)
          where confidence_key not in (
            'topicId',
            'concept',
            'confidence',
            'correct',
            'activityType',
            'misconceptionSummary'
          )
        )
        or jsonb_typeof(confidence_entry -> 'concept') <> 'string'
        or jsonb_typeof(confidence_entry -> 'confidence') <> 'string'
        or jsonb_typeof(confidence_entry -> 'correct') <> 'boolean'
        or jsonb_typeof(confidence_entry -> 'activityType') <> 'string'
        or length(btrim(confidence_entry ->> 'concept')) not between 2 and 120
        or coalesce(confidence_entry ->> 'confidence', '') not in ('guessing', 'somewhat_sure', 'very_sure')
        or coalesce(confidence_entry ->> 'activityType', '') not in ('multiple_choice', 'free_response')
        or (
          confidence_entry ? 'topicId'
          and (
            jsonb_typeof(confidence_entry -> 'topicId') <> 'string'
            or coalesce(confidence_entry ->> 'topicId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
        )
        or (
          confidence_entry ? 'misconceptionSummary'
          and (
            jsonb_typeof(confidence_entry -> 'misconceptionSummary') <> 'string'
            or length(btrim(confidence_entry ->> 'misconceptionSummary')) not between 8 and 300
          )
        )
    ) then
      raise exception 'Checkpoint confidence evidence is not valid.';
    end if;
  end if;

  if payload ? 'pendingRepair' then
    if jsonb_typeof(pending_repair) <> 'object' then
      raise exception 'Checkpoint repair identity is not valid.';
    end if;

    if not (pending_repair ?& array['concept', 'correctAnswer'])
      or exists (
        select 1
        from jsonb_object_keys(pending_repair) as repair_keys(repair_key)
        where repair_key not in ('concept', 'correctAnswer')
      )
      or jsonb_typeof(pending_repair -> 'concept') <> 'string'
      or jsonb_typeof(pending_repair -> 'correctAnswer') <> 'string'
      or length(btrim(pending_repair ->> 'concept')) not between 2 and 120
      or length(btrim(pending_repair ->> 'correctAnswer')) not between 1 and 700
      or octet_length(pending_repair::text) > 1000 then
      raise exception 'Checkpoint repair identity is not valid.';
    end if;
  end if;

  select *
  into requested_session
  from public.plan_sessions
  where id = requested_session.id
    and user_id = current_user_id
  for update;

  if not found then
    raise exception 'The requested session was not found.';
  end if;

  if requested_session.status <> 'ready' then
    raise exception using
      errcode = '55000',
      message = 'active_session_checkpoint_terminal';
  end if;

  if jsonb_typeof(requested_session.step_data -> 'generatedSession') <> 'object' then
    raise exception using
      errcode = '40001',
      message = 'active_session_checkpoint_conflict';
  end if;

  if jsonb_typeof(requested_session.step_data -> 'generatedSession' -> 'generatedAt') <> 'string'
    or coalesce(requested_session.step_data -> 'generatedSession' ->> 'generatedAt', '')
      !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    raise exception using
      errcode = '40001',
      message = 'active_session_checkpoint_conflict';
  end if;

  begin
    stored_resource_generated_at := (
      requested_session.step_data -> 'generatedSession' ->> 'generatedAt'
    )::timestamptz;
  exception when others then
    raise exception using
      errcode = '40001',
      message = 'active_session_checkpoint_conflict';
  end;

  if stored_resource_generated_at <> requested_resource_generated_at then
    raise exception using
      errcode = '40001',
      message = 'active_session_checkpoint_conflict';
  end if;

  canonical_checkpoint := payload || jsonb_build_object(
    'accountId', current_user_id::text,
    'runId', requested_run_id::text,
    'planSessionId', requested_session.id::text,
    'planId', requested_session.plan_id::text,
    'savedAt', now()
  );

  if octet_length(canonical_checkpoint::text) > 30000 then
    raise exception 'The active-session checkpoint is too large.';
  end if;

  -- The interruption RPC leaves the lesson ready for a future retry, so its
  -- attempt/event identity is the durable terminal marker for this exact run.
  -- Check both records while holding the session row lock: a delayed network
  -- save must never recreate a checkpoint after interruption cleanup.
  if exists (
    select 1
    from public.session_attempts
    where id = requested_run_id
      and user_id = current_user_id
      and plan_session_id = requested_session.id
  ) or exists (
    select 1
    from public.learning_events
    where user_id = current_user_id
      and plan_session_id = requested_session.id
      and event_type = 'session_interrupted'
      and event_data ->> 'attemptId' = requested_run_id::text
  ) then
    raise exception using
      errcode = '55000',
      message = 'active_session_checkpoint_terminal';
  end if;

  existing_checkpoint := requested_session.step_data -> 'activeSessionCheckpoint';
  if existing_checkpoint is not null and jsonb_typeof(existing_checkpoint) <> 'null' then
    if jsonb_typeof(existing_checkpoint) <> 'object' then
      raise exception 'The stored active-session checkpoint is not valid.';
    end if;

    begin
      existing_started_at := (existing_checkpoint ->> 'startedAt')::timestamptz;
      existing_saved_at := (existing_checkpoint ->> 'savedAt')::timestamptz;
      existing_active_seconds := (existing_checkpoint ->> 'activeSeconds')::numeric;
      existing_planned_minutes := (existing_checkpoint ->> 'plannedMinutes')::numeric;
      existing_completed_steps := (existing_checkpoint ->> 'completedSteps')::numeric;
      existing_resume_step := (existing_checkpoint ->> 'resumeStep')::numeric;
    exception when others then
      raise exception 'The stored active-session checkpoint is not valid.';
    end;

    if existing_saved_at < now() - interval '7 days' then
      existing_checkpoint := null;
    elsif coalesce(existing_checkpoint ->> 'runId', '') <> requested_run_id::text
      or coalesce(existing_checkpoint ->> 'resourceFingerprint', '') <> payload ->> 'resourceFingerprint' then
      raise exception using
        errcode = '40001',
        message = 'active_session_checkpoint_conflict';
    elsif existing_planned_minutes <> requested_planned_minutes then
      raise exception 'The active-session run identity changed.';
    elsif (
      (existing_checkpoint ->> 'status' = 'awaiting_finish' and payload ->> 'status' = 'working')
      or requested_completed_steps < existing_completed_steps
      or requested_resume_step < existing_resume_step
      or requested_active_seconds < existing_active_seconds
    ) then
      return existing_checkpoint;
    elsif requested_completed_steps = existing_completed_steps
      and requested_resume_step = existing_resume_step
      and requested_active_seconds = existing_active_seconds
      and requested_saved_at <= existing_saved_at
      and payload ->> 'status' = existing_checkpoint ->> 'status' then
      return existing_checkpoint;
    end if;

    if existing_checkpoint is not null then
      -- Active time deliberately excludes time spent backgrounded, so the
      -- browser's derived startedAt can move forward after a resume. Preserve
      -- the first server-accepted timestamp as the stable run identity.
      canonical_checkpoint := jsonb_set(
        canonical_checkpoint,
        '{startedAt}',
        existing_checkpoint -> 'startedAt'
      );
    end if;
  end if;

  update public.plan_sessions
  set step_data = (
    case
      when jsonb_typeof(step_data) = 'object' then step_data
      else '{}'::jsonb
    end
  ) || jsonb_build_object('activeSessionCheckpoint', canonical_checkpoint)
  where id = requested_session.id
    and user_id = current_user_id;

  return canonical_checkpoint;
end;
$$;

create or replace function public.delete_active_session_checkpoint(
  requested_plan_session_id uuid,
  requested_run_id uuid default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_session public.plan_sessions%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  select *
  into requested_session
  from public.plan_sessions
  where id = requested_plan_session_id
    and user_id = current_user_id
  for update;

  if not found then
    raise exception 'The requested session was not found.';
  end if;

  if not (requested_session.step_data ? 'activeSessionCheckpoint')
    or (
      requested_run_id is not null
      and requested_session.step_data -> 'activeSessionCheckpoint' ->> 'runId'
        is distinct from requested_run_id::text
    ) then
    return false;
  end if;

  update public.plan_sessions
  set step_data = (
    case
      when jsonb_typeof(step_data) = 'object' then step_data
      else '{}'::jsonb
    end
  ) - 'activeSessionCheckpoint'
  where id = requested_session.id
    and user_id = current_user_id;

  return true;
end;
$$;

-- Any operation that ends the ready state, or replaces the generated lesson,
-- invalidates the recovery proof in the same transaction. In particular, the
-- existing complete_plan_session RPC clears its checkpoint atomically when it
-- changes status to complete.
create or replace function public.clear_invalid_active_session_checkpoint()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status <> 'ready'
    or (old.step_data -> 'generatedSession') is distinct from (new.step_data -> 'generatedSession') then
    new.step_data := (
      case
        when jsonb_typeof(new.step_data) = 'object' then new.step_data
        else '{}'::jsonb
      end
    ) - 'activeSessionCheckpoint';
  end if;
  return new;
end;
$$;

drop trigger if exists plan_sessions_clear_invalid_active_session_checkpoint
on public.plan_sessions;
create trigger plan_sessions_clear_invalid_active_session_checkpoint
before update on public.plan_sessions
for each row execute function public.clear_invalid_active_session_checkpoint();

-- Explicit interruption is a terminal handoff from live recovery to the
-- durable interruption record. Match the run/attempt id so a delayed event
-- from an older run cannot erase a newer device's checkpoint.
create or replace function public.clear_interrupted_active_session_checkpoint()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.plan_sessions
  set step_data = (
    case
      when jsonb_typeof(step_data) = 'object' then step_data
      else '{}'::jsonb
    end
  ) - 'activeSessionCheckpoint'
  where id = new.plan_session_id
    and user_id = new.user_id
    and step_data -> 'activeSessionCheckpoint' ->> 'runId' = new.event_data ->> 'attemptId';
  return new;
end;
$$;

drop trigger if exists learning_events_clear_interrupted_active_session_checkpoint
on public.learning_events;
create trigger learning_events_clear_interrupted_active_session_checkpoint
after insert on public.learning_events
for each row
when (new.event_type = 'session_interrupted')
execute function public.clear_interrupted_active_session_checkpoint();

revoke all on function public.save_active_session_checkpoint(jsonb) from public;
revoke all on function public.delete_active_session_checkpoint(uuid, uuid) from public;
revoke all on function public.clear_invalid_active_session_checkpoint() from public;
revoke all on function public.clear_interrupted_active_session_checkpoint() from public;
grant execute on function public.save_active_session_checkpoint(jsonb) to authenticated;
grant execute on function public.delete_active_session_checkpoint(uuid, uuid) to authenticated;
