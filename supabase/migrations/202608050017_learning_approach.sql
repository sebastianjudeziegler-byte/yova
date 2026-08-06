-- Preserve whether each generated session should teach first or practice first.
-- The plan-level approach already lives in plans.generation_inputs; the
-- session-level approach belongs beside the generated amount label in the
-- existing private step_data JSON.

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
  material jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  insert into public.learning_items (
    id, user_id, title, kind, topic, deadline, status, source_mode, study_mode
  ) values (
    learning_item_id,
    current_user_id,
    payload ->> 'title',
    payload ->> 'kind',
    payload ->> 'topic',
    nullif(payload ->> 'deadline', '')::timestamptz,
    'active',
    payload ->> 'sourceMode',
    payload ->> 'studyMode'
  );

  insert into public.plans (
    id, user_id, learning_item_id, status, rationale, generation_inputs
  ) values (
    generated_plan_id,
    current_user_id,
    learning_item_id,
    payload ->> 'status',
    payload ->> 'rationale',
    coalesce(payload -> 'generationInputs', '{}'::jsonb)
  );

  for session in select value from jsonb_array_elements(payload -> 'sessions')
  loop
    insert into public.plan_sessions (
      id, user_id, plan_id, sequence, title, objective, method,
      method_rationale, scheduled_for, estimated_minutes, status, step_data
    ) values (
      (session ->> 'id')::uuid,
      current_user_id,
      generated_plan_id,
      (session ->> 'sequence')::smallint,
      session ->> 'title',
      session ->> 'objective',
      session ->> 'method',
      session ->> 'methodReason',
      (session ->> 'scheduledFor')::timestamptz,
      (session ->> 'estimatedMinutes')::smallint,
      session ->> 'status',
      jsonb_build_object(
        'amountLabel', session ->> 'amountLabel',
        'learningMode', session ->> 'learningMode'
      )
    );
  end loop;

  for material in
    select value
    from jsonb_array_elements(coalesce(payload -> 'generationInputs' -> 'materials', '[]'::jsonb))
  loop
    insert into public.materials (
      id,
      user_id,
      learning_item_id,
      filename,
      storage_path,
      mime_type,
      byte_size,
      processing_status,
      extracted_text,
      metadata
    )
    select
      upload.id,
      current_user_id,
      learning_item_id,
      upload.filename,
      upload.storage_path,
      upload.mime_type,
      upload.byte_size,
      'ready',
      upload.extracted_text,
      upload.metadata || jsonb_build_object('stagedAt', upload.created_at)
    from public.material_uploads as upload
    where upload.id = (material ->> 'id')::uuid
      and upload.user_id = current_user_id
      and upload.processing_status = 'ready';

    if not found then
      raise exception 'A requested learning material is missing or not ready.';
    end if;

    delete from public.material_uploads
    where id = (material ->> 'id')::uuid
      and user_id = current_user_id;
  end loop;

  return generated_plan_id;
end;
$$;

revoke all on function public.save_generated_plan(jsonb) from public;
grant execute on function public.save_generated_plan(jsonb) to authenticated;

create or replace function public.set_plan_session_learning_mode(
  requested_session_id uuid,
  requested_learning_mode text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;
  if requested_learning_mode not in ('learn', 'study') then
    raise exception 'Learning mode is not valid.';
  end if;

  update public.plan_sessions
  set step_data = (
    case when jsonb_typeof(step_data) = 'object' then step_data else '{}'::jsonb end
  ) || jsonb_build_object('learningMode', requested_learning_mode)
  where id = requested_session_id
    and user_id = auth.uid()
    and status in ('ready', 'upcoming');

  if not found then
    raise exception 'The requested session was not found.';
  end if;
end;
$$;

revoke all on function public.set_plan_session_learning_mode(uuid, text) from public;
grant execute on function public.set_plan_session_learning_mode(uuid, text) to authenticated;
