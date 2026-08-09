-- Keep topic ids and the plan knowledge map intact when unfinished work is
-- rebuilt. This replaces the prior adjustment function atomically.

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
  replacement_count integer := coalesce(jsonb_array_length(payload -> 'sessions'), 0);
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

  update public.learning_items
  set deadline = next_deadline, study_mode = next_study_mode
  where id = requested_plan.learning_item_id and user_id = current_user_id;

  delete from public.plan_sessions
  where plan_id = requested_plan.id and user_id = current_user_id
    and status in ('ready', 'upcoming');

  for replacement in select value from jsonb_array_elements(payload -> 'sessions') loop
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
      'sessionCount', replacement_count
    ),
    now()
  );

  return jsonb_build_object(
    'planId', requested_plan.id,
    'deadline', next_deadline,
    'studyMode', next_study_mode,
    'sessions', payload -> 'sessions'
  );
end;
$$;

revoke all on function public.adjust_learning_plan(jsonb) from public;
grant execute on function public.adjust_learning_plan(jsonb) to authenticated;
