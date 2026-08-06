-- Preserve the content contract for every newly generated session. Session time
-- limits the amount assigned to a session; it does not define completion.

create or replace function public.save_generated_plan(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  learning_item_id uuid := (payload ->> 'learningItemId')::uuid;
  generated_plan_id uuid := (payload ->> 'id')::uuid;
  session jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  insert into public.learning_items (
    id, user_id, title, kind, topic, deadline, status, source_mode, study_mode
  ) values (
    learning_item_id, current_user_id, payload ->> 'title', payload ->> 'kind',
    payload ->> 'topic', nullif(payload ->> 'deadline', '')::timestamptz,
    'active', payload ->> 'sourceMode', payload ->> 'studyMode'
  );

  insert into public.plans (
    id, user_id, learning_item_id, status, rationale, generation_inputs
  ) values (
    generated_plan_id, current_user_id, learning_item_id, payload ->> 'status',
    payload ->> 'rationale', coalesce(payload -> 'generationInputs', '{}'::jsonb)
  );

  for session in select value from jsonb_array_elements(payload -> 'sessions')
  loop
    insert into public.plan_sessions (
      id, user_id, plan_id, sequence, title, objective, method,
      method_rationale, scheduled_for, estimated_minutes, status, step_data
    ) values (
      (session ->> 'id')::uuid, current_user_id, generated_plan_id,
      (session ->> 'sequence')::smallint, session ->> 'title',
      session ->> 'objective', session ->> 'method', session ->> 'methodReason',
      (session ->> 'scheduledFor')::timestamptz,
      (session ->> 'estimatedMinutes')::smallint, session ->> 'status',
      jsonb_build_object(
        'amountLabel', session ->> 'amountLabel',
        'learningMode', session ->> 'learningMode',
        'contentTargets', coalesce(session -> 'contentTargets', '[]'::jsonb),
        'completionEvidence', coalesce(session -> 'completionEvidence', '[]'::jsonb)
      )
    );
  end loop;

  return generated_plan_id;
end;
$$;

revoke all on function public.save_generated_plan(jsonb) from public;
grant execute on function public.save_generated_plan(jsonb) to authenticated;
