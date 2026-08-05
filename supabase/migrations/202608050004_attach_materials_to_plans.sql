create or replace function public.attach_materials_to_plan(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_plan public.plans%rowtype;
  material_id_value jsonb;
  attached_count integer := 0;
  existing_count integer := 0;
  attached_materials jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if jsonb_typeof(payload -> 'materialIds') <> 'array'
    or jsonb_array_length(payload -> 'materialIds') < 1
    or jsonb_array_length(payload -> 'materialIds') > 5 then
    raise exception 'Choose between one and five materials.';
  end if;

  select *
  into requested_plan
  from public.plans
  where id = (payload ->> 'planId')::uuid
    and user_id = current_user_id
  for update;

  if not found then
    raise exception 'The requested plan was not found.';
  end if;

  if requested_plan.status <> 'active' then
    raise exception 'Materials can only be added to an active plan.';
  end if;

  select count(*)
  into existing_count
  from public.materials
  where learning_item_id = requested_plan.learning_item_id
    and user_id = current_user_id;

  if existing_count + jsonb_array_length(payload -> 'materialIds') > 5 then
    raise exception 'A learning goal can use up to five materials.';
  end if;

  for material_id_value in select value from jsonb_array_elements(payload -> 'materialIds')
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
      requested_plan.learning_item_id,
      upload.filename,
      upload.storage_path,
      upload.mime_type,
      upload.byte_size,
      'ready',
      upload.extracted_text,
      upload.metadata || jsonb_build_object('stagedAt', upload.created_at, 'attachedAt', now())
    from public.material_uploads as upload
    where upload.id = trim(both '"' from material_id_value::text)::uuid
      and upload.user_id = current_user_id
      and upload.processing_status = 'ready';

    if not found then
      raise exception 'A requested learning material is missing or not ready.';
    end if;

    delete from public.material_uploads
    where id = trim(both '"' from material_id_value::text)::uuid
      and user_id = current_user_id;

    attached_count := attached_count + 1;
  end loop;

  update public.learning_items
  set source_mode = 'user_materials'
  where id = requested_plan.learning_item_id
    and user_id = current_user_id;

  update public.plan_sessions
  set step_data = coalesce(step_data, '{}'::jsonb) - 'generatedSession'
  where plan_id = requested_plan.id
    and user_id = current_user_id
    and status in ('ready', 'upcoming');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'name', filename,
    'mimeType', mime_type,
    'sizeBytes', byte_size,
    'textContent', null,
    'processingStatus', 'ready'
  ) order by created_at), '[]'::jsonb)
  into attached_materials
  from public.materials
  where learning_item_id = requested_plan.learning_item_id
    and user_id = current_user_id;

  insert into public.learning_events (
    user_id,
    learning_item_id,
    event_type,
    event_data,
    occurred_at
  ) values (
    current_user_id,
    requested_plan.learning_item_id,
    'materials_attached',
    jsonb_build_object(
      'planId', requested_plan.id,
      'attachedCount', attached_count,
      'materialIds', payload -> 'materialIds'
    ),
    now()
  );

  return jsonb_build_object(
    'planId', requested_plan.id,
    'sourceMode', 'user_materials',
    'materials', attached_materials
  );
end;
$$;

revoke all on function public.attach_materials_to_plan(jsonb) from public;
grant execute on function public.attach_materials_to_plan(jsonb) to authenticated;
