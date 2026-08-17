-- Complete the learner-controlled reset after deadline milestones and durable
-- material chunks were added. The reset intentionally keeps the Auth identity
-- plus limited operational records such as support requests, usage windows,
-- founder access, and tester invitations.

create or replace function public.persist_material_mapping_result(
  requested_material_table text,
  requested_material_id uuid,
  requested_metadata_patch jsonb,
  requested_chunks jsonb,
  requested_observation jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  material_exists boolean := false;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if requested_material_table not in ('material_uploads', 'materials') then
    raise exception 'The material table is not valid.';
  end if;
  if jsonb_typeof(requested_metadata_patch) is distinct from 'object'
    or jsonb_typeof(requested_chunks) is distinct from 'array'
    or jsonb_typeof(requested_observation) is distinct from 'object' then
    raise exception 'The material mapping result is not valid.';
  end if;

  -- Reset and mapping persistence are serialized for this learner. Locking
  -- before checking the source row covers both possible commit orders.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  if requested_material_table = 'material_uploads' then
    select true into material_exists
    from public.material_uploads
    where id = requested_material_id
      and user_id = current_user_id
    for update;
  else
    select true into material_exists
    from public.materials
    where id = requested_material_id
      and user_id = current_user_id
    for update;
  end if;

  -- An in-flight mapper may finish after Reset removed its source. In that
  -- case no extracted chunks, metadata, or analytics may be recreated.
  if material_exists is not true then
    return false;
  end if;

  if requested_material_table = 'material_uploads' then
    update public.material_uploads
    set metadata = metadata || requested_metadata_patch
    where id = requested_material_id
      and user_id = current_user_id;
  else
    update public.materials
    set metadata = metadata || requested_metadata_patch
    where id = requested_material_id
      and user_id = current_user_id;
  end if;

  insert into public.material_chunks (
    id,
    user_id,
    material_id,
    chunk_index,
    char_start,
    char_end,
    location_label,
    section_role,
    chunk_text
  )
  select
    (chunk ->> 'id')::uuid,
    current_user_id,
    requested_material_id,
    (chunk ->> 'chunkIndex')::smallint,
    (chunk ->> 'charStart')::integer,
    (chunk ->> 'charEnd')::integer,
    chunk ->> 'locationLabel',
    chunk ->> 'sectionRole',
    chunk ->> 'chunkText'
  from jsonb_array_elements(requested_chunks) as chunk
  on conflict (material_id, chunk_index) do update set
    id = excluded.id,
    user_id = excluded.user_id,
    char_start = excluded.char_start,
    char_end = excluded.char_end,
    location_label = excluded.location_label,
    section_role = excluded.section_role,
    chunk_text = excluded.chunk_text;

  insert into public.product_events (user_id, event_name, event_data)
  values (current_user_id, 'generation_observed', requested_observation);

  return true;
end;
$$;

revoke all on function public.persist_material_mapping_result(text, uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.persist_material_mapping_result(text, uuid, jsonb, jsonb, jsonb) to authenticated;

create or replace function public.reset_yova_learning_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  -- Chunks have no material foreign key because their material id moves from
  -- the staging table to the durable materials table during plan activation.
  delete from public.material_chunks
  where user_id = current_user_id;

  -- Delete every milestone explicitly so standalone deadlines are removed as
  -- well as milestones linked to a learning item.
  delete from public.deadline_milestones
  where user_id = current_user_id;

  -- Learning events usually point to an item or session and cascade, but both
  -- links are nullable, so clear the user's complete evidence history first.
  delete from public.learning_events
  where user_id = current_user_id;

  -- Cascades remove plans, sessions, attached materials, attempts, learning
  -- events that were linked, and learning-item tutor threads.
  delete from public.learning_items
  where user_id = current_user_id;

  -- A tutor thread may not be attached to a learning item.
  delete from public.tutor_threads
  where user_id = current_user_id;

  delete from public.material_uploads
  where user_id = current_user_id;

  delete from public.learner_profiles
  where user_id = current_user_id;

  delete from public.product_events
  where user_id = current_user_id;

  delete from public.error_reports
  where user_id = current_user_id;

  update public.profiles
  set onboarding_completed_at = null
  where id = current_user_id;
end;
$$;

revoke all on function public.reset_yova_learning_data() from public;
grant execute on function public.reset_yova_learning_data() to authenticated;
