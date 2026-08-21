-- Preserve scheduled reviews during plan adjustment, refuse destructive
-- rewrites of saved learner work at the API boundary, and repair the legacy
-- lifecycle contradiction where a completed plan still contains runnable work.

create or replace function public.adjust_learning_plan(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_plan public.plans%rowtype;
  next_deadline timestamptz := nullif(payload ->> 'deadline', '')::timestamptz;
  next_study_mode text := payload ->> 'studyMode';
  next_minutes smallint := (payload ->> 'futureSessionMinutes')::smallint;
  replacement jsonb;
  authoritative_sessions jsonb := '[]'::jsonb;
  replacement_count integer := case
    when jsonb_typeof(payload -> 'sessions') = 'array'
      then jsonb_array_length(payload -> 'sessions')
    else 0
  end;
  protected_count integer := 0;
  stored_protected_count integer := 0;
begin
  if current_user_id is null then raise exception 'Authentication is required.'; end if;
  if next_study_mode not in ('inside_yova', 'outside_yova') then raise exception 'The requested study mode is not supported.'; end if;
  if next_minutes < 10 or next_minutes > 90 then raise exception 'The requested session length is outside the allowed range.'; end if;
  if replacement_count < 1 or replacement_count > 14 then raise exception 'The replacement plan must contain between one and fourteen unfinished sessions.'; end if;
  if next_deadline is not null
    and (next_deadline < now() - interval '1 hour' or next_deadline > now() + interval '5 years') then
    raise exception 'The requested deadline is outside the allowed range.';
  end if;

  select * into requested_plan
  from public.plans
  where id = (payload ->> 'planId')::uuid and user_id = current_user_id
  for update;

  if not found then raise exception 'The requested plan was not found.'; end if;
  if requested_plan.status <> 'active' then raise exception 'Only an active plan can be adjusted.'; end if;

  -- Lock the complete rewrite set before inspecting any saved-work markers.
  -- A checkpoint or generated-session writer that already owns one of these
  -- rows must finish before the protection check; one that starts later cannot
  -- add work between that check and the DELETE below.
  perform session.id
  from public.plan_sessions as session
  where session.plan_id = requested_plan.id
    and session.user_id = current_user_id
    and session.status in ('ready', 'upcoming')
  order by session.sequence
  for update;

  if exists (
    select 1
    from jsonb_array_elements(payload -> 'sessions') with ordinality as candidate(value, ordinality)
    where nullif(candidate.value ->> 'id', '') is null
      or nullif(candidate.value ->> 'sequence', '') is null
      or (candidate.value ->> 'sequence')::integer < 1
      or (candidate.value ->> 'sequence')::integer > 14
      or candidate.value ->> 'status' not in ('ready', 'upcoming')
      or (
        not coalesce((candidate.value ->> 'protected')::boolean, false)
        and case
          when coalesce(jsonb_typeof(candidate.value -> 'estimatedMinutes'), 'null') <> 'number' then true
          when (candidate.value ->> 'estimatedMinutes') !~ '^[0-9]+$' then true
          else (candidate.value ->> 'estimatedMinutes')::integer not between 10 and 90
        end
      )
  ) then
    raise exception 'The replacement session identity or state is not valid.';
  end if;

  if (
    select count(distinct candidate.value ->> 'id')
    from jsonb_array_elements(payload -> 'sessions') as candidate(value)
  ) <> replacement_count
  or (
    select count(distinct candidate.value ->> 'sequence')
    from jsonb_array_elements(payload -> 'sessions') as candidate(value)
  ) <> replacement_count then
    raise exception 'Replacement session ids and sequences must be unique.';
  end if;

  select count(*) into protected_count
  from jsonb_array_elements(payload -> 'sessions') as candidate(value)
  where coalesce((candidate.value ->> 'protected')::boolean, false);

  select count(*) into stored_protected_count
  from public.plan_sessions as session
  where session.plan_id = requested_plan.id
    and session.user_id = current_user_id
    and session.status in ('ready', 'upcoming')
    and jsonb_typeof(session.step_data) = 'object'
    and session.step_data ->> 'reviewType' in ('repair_and_retrieve', 'verify', 'maintenance_transfer');

  if protected_count <> stored_protected_count then
    raise exception 'Every scheduled review must be preserved by the adjustment.';
  end if;

  if exists (
    select 1
    from public.plan_sessions as session
    where session.plan_id = requested_plan.id
      and session.user_id = current_user_id
      and session.status in ('ready', 'upcoming')
      and jsonb_typeof(session.step_data) = 'object'
      and session.step_data ->> 'reviewType' in ('repair_and_retrieve', 'verify', 'maintenance_transfer')
      and not exists (
        select 1
        from jsonb_array_elements(payload -> 'sessions') as candidate(value)
        where coalesce((candidate.value ->> 'protected')::boolean, false)
          and (candidate.value ->> 'id')::uuid = session.id
      )
  ) or exists (
    select 1
    from jsonb_array_elements(payload -> 'sessions') as candidate(value)
    left join public.plan_sessions as session
      on session.id = (candidate.value ->> 'id')::uuid
      and session.plan_id = requested_plan.id
      and session.user_id = current_user_id
      and session.status in ('ready', 'upcoming')
      and jsonb_typeof(session.step_data) = 'object'
      and session.step_data ->> 'reviewType' in ('repair_and_retrieve', 'verify', 'maintenance_transfer')
    where coalesce((candidate.value ->> 'protected')::boolean, false)
      and session.id is null
  ) then
    raise exception 'A protected review did not match the stored plan.';
  end if;

  -- This boundary is authoritative even when a client bypasses the HTTP
  -- route. Ordinary content with generated material or learner progress may
  -- only be changed through an explicit migration workflow; a plan adjustment
  -- must never delete it or reuse its id for different lesson semantics.
  if exists (
    select 1
    from public.plan_sessions as session
    where session.plan_id = requested_plan.id
      and session.user_id = current_user_id
      and session.status in ('ready', 'upcoming')
      and not (
        jsonb_typeof(session.step_data) = 'object'
        and session.step_data ->> 'reviewType' in ('repair_and_retrieve', 'verify', 'maintenance_transfer')
      )
      and (
        (
          jsonb_typeof(session.step_data) = 'object'
          and (
            session.step_data ? 'generatedSession'
            or session.step_data ? 'activeSessionCheckpoint'
          )
        )
        or exists (
          select 1
          from public.learning_events as event
          where event.user_id = current_user_id
            and event.plan_session_id = session.id
            and event.event_type = 'session_interrupted'
        )
      )
  ) then
    raise exception 'plan_adjustment_saved_work_protected';
  end if;

  update public.learning_items
  set deadline = next_deadline, study_mode = next_study_mode
  where id = requested_plan.learning_item_id and user_id = current_user_id;

  -- Move protected rows out of the constrained sequence range temporarily.
  -- Their complete row, including generated material, checkpoint and review
  -- metadata, remains untouched throughout the transaction.
  update public.plan_sessions as session
  set sequence = session.sequence + 1000
  where session.plan_id = requested_plan.id
    and session.user_id = current_user_id
    and session.status in ('ready', 'upcoming')
    and jsonb_typeof(session.step_data) = 'object'
    and session.step_data ->> 'reviewType' in ('repair_and_retrieve', 'verify', 'maintenance_transfer');

  delete from public.plan_sessions as session
  where session.plan_id = requested_plan.id
    and session.user_id = current_user_id
    and session.status in ('ready', 'upcoming')
    and not (
      jsonb_typeof(session.step_data) = 'object'
      and session.step_data ->> 'reviewType' in ('repair_and_retrieve', 'verify', 'maintenance_transfer')
    );

  for replacement in select value from jsonb_array_elements(payload -> 'sessions') loop
    if coalesce((replacement ->> 'protected')::boolean, false) then
      update public.plan_sessions
      set sequence = (replacement ->> 'sequence')::smallint
      where id = (replacement ->> 'id')::uuid
        and plan_id = requested_plan.id
        and user_id = current_user_id
        and status in ('ready', 'upcoming')
        and jsonb_typeof(step_data) = 'object'
        and step_data ->> 'reviewType' in ('repair_and_retrieve', 'verify', 'maintenance_transfer');
      if not found then raise exception 'A protected review could not be preserved.'; end if;
      continue;
    end if;

    insert into public.plan_sessions (
      id, user_id, plan_id, sequence, title, objective, method, method_rationale,
      scheduled_for, estimated_minutes, status, step_data
    ) values (
      (replacement ->> 'id')::uuid, current_user_id, requested_plan.id,
      (replacement ->> 'sequence')::smallint, replacement ->> 'title',
      replacement ->> 'objective', replacement ->> 'method', replacement ->> 'methodReason',
      (replacement ->> 'scheduledFor')::timestamptz,
      (replacement ->> 'estimatedMinutes')::smallint, replacement ->> 'status',
      jsonb_build_object(
        'amountLabel', replacement ->> 'amountLabel',
        'learningMode', replacement ->> 'learningMode',
        'topicIds', coalesce(replacement -> 'topicIds', '[]'::jsonb),
        'contentTargets', coalesce(replacement -> 'contentTargets', '[]'::jsonb),
        'completionEvidence', coalesce(replacement -> 'completionEvidence', '[]'::jsonb),
        'originSessionId', replacement ->> 'originSessionId',
        'originalContentMinutes', (replacement ->> 'originalContentMinutes')::smallint,
        'segmentIndex', (replacement ->> 'segmentIndex')::smallint,
        'segmentCount', (replacement ->> 'segmentCount')::smallint
      )
    );
  end loop;

  update public.plans
  set
    knowledge_map = coalesce(payload -> 'knowledgeMap', knowledge_map),
    generation_inputs = jsonb_set(
      coalesce(generation_inputs, '{}'::jsonb),
      '{lastAdjustment}',
      jsonb_build_object(
        'deadline', next_deadline,
        'studyMode', next_study_mode,
        'futureSessionMinutes', next_minutes,
        'contentBased', true,
        'includeDeferred', coalesce((payload ->> 'includeDeferred')::boolean, false),
        'sessionCount', replacement_count,
        'protectedReviewCount', protected_count,
        'adjustedAt', now()
      ),
      true
    )
  where id = requested_plan.id and user_id = current_user_id;

  insert into public.learning_events (
    user_id, learning_item_id, event_type, event_data, occurred_at
  ) values (
    current_user_id, requested_plan.learning_item_id, 'plan_adjusted',
    jsonb_build_object(
      'planId', requested_plan.id,
      'deadline', next_deadline,
      'studyMode', next_study_mode,
      'futureSessionMinutes', next_minutes,
      'contentBased', true,
      'includeDeferred', coalesce((payload ->> 'includeDeferred')::boolean, false),
      'sessionCount', replacement_count,
      'protectedReviewCount', protected_count
    ),
    now()
  );

  -- Return the rows that actually committed, rather than echoing protected
  -- client metadata that the transaction deliberately ignored. In particular,
  -- a review rescheduled just before this plan lock was acquired must keep its
  -- authoritative database time in the response and in the caller's local
  -- state.
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
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
        'topicIds', case
          when jsonb_typeof(session.step_data -> 'topicIds') = 'array'
            then session.step_data -> 'topicIds'
          else '[]'::jsonb
        end,
        'contentTargets', case
          when jsonb_typeof(session.step_data -> 'contentTargets') = 'array'
            then session.step_data -> 'contentTargets'
          else '[]'::jsonb
        end,
        'completionEvidence', case
          when jsonb_typeof(session.step_data -> 'completionEvidence') = 'array'
            then session.step_data -> 'completionEvidence'
          else '[]'::jsonb
        end,
        'originSessionId', session.step_data ->> 'originSessionId',
        'originalContentMinutes', session.step_data -> 'originalContentMinutes',
        'segmentIndex', session.step_data -> 'segmentIndex',
        'segmentCount', session.step_data -> 'segmentCount',
        'reviewConcept', session.step_data ->> 'reviewConcept',
        'reviewType', session.step_data ->> 'reviewType',
        'protected', case
          when session.step_data ->> 'reviewType' in ('repair_and_retrieve', 'verify', 'maintenance_transfer')
            then true
          else null
        end,
        'status', session.status
      ))
      order by session.sequence
    ),
    '[]'::jsonb
  ) into authoritative_sessions
  from jsonb_array_elements(payload -> 'sessions') as candidate(value)
  join public.plan_sessions as session
    on session.id = (candidate.value ->> 'id')::uuid
    and session.plan_id = requested_plan.id
    and session.user_id = current_user_id;

  if jsonb_array_length(authoritative_sessions) <> replacement_count then
    raise exception 'The adjusted sessions could not be read back authoritatively.';
  end if;

  return jsonb_build_object(
    'planId', requested_plan.id,
    'deadline', next_deadline,
    'studyMode', next_study_mode,
    'sessions', authoritative_sessions
  );
end;
$$;

revoke all on function public.adjust_learning_plan(jsonb) from public, anon;
grant execute on function public.adjust_learning_plan(jsonb) to authenticated;

-- Keep the older single-session duration endpoint inside the same rewrite
-- safety boundary. It is not the current Agenda split implementation, but it
-- remains callable and must not invalidate a generated lesson, recovery point,
-- interruption, or scheduled-review contract.
create or replace function public.adjust_plan_session_duration(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_session public.plan_sessions%rowtype;
  requested_plan public.plans%rowtype;
  next_minutes smallint := (payload ->> 'estimatedMinutes')::smallint;
  next_amount_label text;
begin
  if current_user_id is null then raise exception 'Authentication is required.'; end if;
  if next_minutes < 10 or next_minutes > 90 then
    raise exception 'The requested session length is outside the allowed range.';
  end if;

  select * into requested_session
  from public.plan_sessions
  where id = (payload ->> 'planSessionId')::uuid
    and user_id = current_user_id
  for update;

  if not found then raise exception 'The requested session was not found.'; end if;
  if requested_session.status not in ('ready', 'upcoming') then
    raise exception 'A finished session cannot be changed.';
  end if;
  if (
    jsonb_typeof(requested_session.step_data) = 'object'
    and (
      requested_session.step_data ->> 'reviewType' in ('repair_and_retrieve', 'verify', 'maintenance_transfer')
      or requested_session.step_data ? 'generatedSession'
      or requested_session.step_data ? 'activeSessionCheckpoint'
    )
  ) or exists (
    select 1
    from public.learning_events as event
    where event.user_id = current_user_id
      and event.plan_session_id = requested_session.id
      and event.event_type = 'session_interrupted'
  ) then
    raise exception 'plan_session_rewrite_protected';
  end if;

  select * into requested_plan
  from public.plans
  where id = requested_session.plan_id
    and user_id = current_user_id;

  if not found or requested_plan.status <> 'active' then
    raise exception 'Only a session in an active plan can be changed.';
  end if;

  next_amount_label := coalesce(
    nullif(split_part(requested_session.step_data ->> 'amountLabel', ' · about', 1), ''),
    'Focused work'
  ) || ' · about ' || next_minutes || ' min';

  update public.plan_sessions
  set estimated_minutes = next_minutes,
      step_data = jsonb_set(
        case when jsonb_typeof(step_data) = 'object' then step_data else '{}'::jsonb end,
        '{amountLabel}',
        to_jsonb(next_amount_label),
        true
      )
  where id = requested_session.id
    and user_id = current_user_id;

  insert into public.learning_events (
    user_id, learning_item_id, plan_session_id, event_type, event_data, occurred_at
  ) values (
    current_user_id, requested_plan.learning_item_id, requested_session.id,
    'session_duration_adjusted',
    jsonb_build_object(
      'previousEstimatedMinutes', requested_session.estimated_minutes,
      'estimatedMinutes', next_minutes,
      'source', 'tutor_approval'
    ),
    now()
  );

  return jsonb_build_object(
    'planId', requested_plan.id,
    'planSessionId', requested_session.id,
    'estimatedMinutes', next_minutes,
    'amountLabel', next_amount_label
  );
end;
$$;

revoke all on function public.adjust_plan_session_duration(jsonb) from public, anon;
grant execute on function public.adjust_plan_session_duration(jsonb) to authenticated;

-- Repair legacy rows created by the old split/start race. A plan cannot be
-- completed while it still has runnable work. Stamp the repair so the
-- dependent item and undersized legacy parts can be reconciled in subsequent,
-- trigger-safe statements.
update public.plans as plan
set
  status = 'active',
  generation_inputs = jsonb_set(
    coalesce(plan.generation_inputs, '{}'::jsonb),
    '{legacyLifecycleRecoveredAt}',
    to_jsonb(now()),
    true
  )
where plan.status = 'completed'
  and exists (
    select 1
    from public.plan_sessions as session
    where session.plan_id = plan.id
      and session.user_id = plan.user_id
      and session.status in ('ready', 'upcoming')
  );

update public.learning_items as item
set status = 'active'
where item.status = 'completed'
  and exists (
    select 1
    from public.plans as plan
    where plan.learning_item_id = item.id
      and plan.user_id = item.user_id
      and plan.status = 'active'
      and plan.generation_inputs ? 'legacyLifecycleRecoveredAt'
  );

-- The obsolete halving implementation produced 8/7-minute ordinary parts,
-- below YOVA's ten-minute runnable floor. Fingerprint those rows by their
-- persisted split provenance so both already-active plans and plans reopened
-- above are repaired without widening this rewrite to unrelated short work.
-- Five-minute scheduled reviews and any saved learner work remain untouched.
update public.plan_sessions as session
set
  estimated_minutes = 10,
  step_data = jsonb_set(
    case when jsonb_typeof(session.step_data) = 'object' then session.step_data else '{}'::jsonb end,
    '{amountLabel}',
    to_jsonb(
      case
        when coalesce(session.step_data ->> 'amountLabel', '') = ''
          then 'One focused target + evidence check · about 10 min'
        when session.step_data ->> 'amountLabel' ~* 'about\s+[0-9]+\s+min'
          then regexp_replace(session.step_data ->> 'amountLabel', 'about\s+[0-9]+\s+min', 'about 10 min', 'gi')
        else (session.step_data ->> 'amountLabel') || ' · about 10 min'
      end
    ),
    true
  )
where session.status in ('ready', 'upcoming')
  and session.estimated_minutes < 10
  and jsonb_typeof(session.step_data) = 'object'
  and session.step_data ->> 'reviewType' is null
  and jsonb_typeof(session.step_data -> 'originSessionId') = 'string'
  and nullif(btrim(session.step_data ->> 'originSessionId'), '') is not null
  and case
    when jsonb_typeof(session.step_data -> 'originalContentMinutes') = 'number'
      and jsonb_typeof(session.step_data -> 'segmentIndex') = 'number'
      and jsonb_typeof(session.step_data -> 'segmentCount') = 'number'
      and (session.step_data ->> 'originalContentMinutes') ~ '^[0-9]+$'
      and (session.step_data ->> 'segmentIndex') ~ '^[0-9]+$'
      and (session.step_data ->> 'segmentCount') ~ '^[0-9]+$'
      then (session.step_data ->> 'originalContentMinutes')::integer > 0
        and (session.step_data ->> 'segmentCount')::integer > 1
        and (session.step_data ->> 'segmentIndex')::integer between 1
          and (session.step_data ->> 'segmentCount')::integer
    else false
  end
  and not (session.step_data ? 'generatedSession')
  and not (session.step_data ? 'activeSessionCheckpoint')
  and not exists (
    select 1
    from public.learning_events as event
    where event.user_id = session.user_id
      and event.plan_session_id = session.id
      and event.event_type = 'session_interrupted'
  )
  and exists (
    select 1
    from public.plans as plan
    where plan.id = session.plan_id
      and plan.user_id = session.user_id
      and plan.status = 'active'
  );

create or replace function public.guard_completed_plan_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and exists (
    select 1
    from public.plan_sessions as session
    where session.plan_id = new.id
      and session.user_id = new.user_id
      and session.status in ('ready', 'upcoming')
  ) then
    raise exception using
      errcode = '23514',
      message = 'completed_plan_has_unfinished_sessions';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_completed_plan_lifecycle()
from public, anon, authenticated;

drop trigger if exists plans_guard_completed_lifecycle on public.plans;
create trigger plans_guard_completed_lifecycle
before insert or update of status on public.plans
for each row execute function public.guard_completed_plan_lifecycle();

create or replace function public.reopen_completed_plan_for_new_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('ready', 'upcoming') then
    -- Lock even an already-active parent. Without this serialization point, a
    -- concurrent last-session completion can inspect before this insert is
    -- visible, then commit "completed" after this trigger has already decided
    -- there is nothing to reopen.
    perform 1
    from public.plans as plan
    where plan.id = new.plan_id
      and plan.user_id = new.user_id
    for update;

    if not found then
      raise exception using
        errcode = '23503',
        message = 'plan_session_parent_missing';
    end if;

    update public.plans
    set status = 'active'
    where id = new.plan_id
      and user_id = new.user_id
      and status = 'completed';

    update public.learning_items as item
    set status = 'active'
    from public.plans as plan
    where plan.id = new.plan_id
      and plan.user_id = new.user_id
      and item.id = plan.learning_item_id
      and item.user_id = plan.user_id
      and plan.status = 'active'
      and item.status = 'completed';
  end if;
  return new;
end;
$$;

revoke all on function public.reopen_completed_plan_for_new_work()
from public, anon, authenticated;

drop trigger if exists plan_sessions_reopen_completed_parent on public.plan_sessions;
create trigger plan_sessions_reopen_completed_parent
after insert on public.plan_sessions
for each row execute function public.reopen_completed_plan_for_new_work();
