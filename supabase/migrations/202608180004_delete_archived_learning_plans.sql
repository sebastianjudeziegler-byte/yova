-- Permanently remove one archived learning goal while handing exact private
-- material paths to the durable Storage cleanup worker. The receipt is written
-- before database deletion so a Storage outage can never strand untracked files.

create or replace function public.delete_archived_learning_plan(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_plan_id uuid;
  requested_plan public.plans%rowtype;
  material_ids uuid[] := '{}'::uuid[];
  learning_paths text[] := '{}'::text[];
  cleanup_job_id uuid := extensions.gen_random_uuid();
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'plan_deletion_authentication_required';
  end if;

  if jsonb_typeof(coalesce(payload, 'null'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'plan_deletion_request_invalid';
  end if;

  begin
    requested_plan_id := nullif(payload ->> 'planId', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'plan_deletion_request_invalid';
  end;

  if requested_plan_id is null
    or (select array_agg(root_key order by root_key) from jsonb_object_keys(payload) as root_keys(root_key))
       is distinct from array['planId']::text[] then
    raise exception using errcode = '22023', message = 'plan_deletion_request_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  select *
  into requested_plan
  from public.plans
  where id = requested_plan_id
    and user_id = current_user_id
  for update;

  if not found then
    raise exception using errcode = 'PDP01', message = 'plan_deletion_not_found';
  end if;
  if requested_plan.status <> 'archived' then
    raise exception using errcode = '55000', message = 'plan_deletion_requires_archived';
  end if;

  -- The current product creates one plan per learning item. Fail closed if a
  -- future workflow shares an item so deleting this plan cannot erase siblings.
  if exists (
    select 1
    from public.plans as sibling
    where sibling.learning_item_id = requested_plan.learning_item_id
      and sibling.user_id = current_user_id
      and sibling.id <> requested_plan.id
  ) then
    raise exception using errcode = '21000', message = 'plan_deletion_shared_learning_item';
  end if;

  select
    coalesce(array_agg(material.id order by material.id), '{}'::uuid[]),
    coalesce(array_agg(distinct material.storage_path order by material.storage_path), '{}'::text[])
  into material_ids, learning_paths
  from public.materials as material
  where material.learning_item_id = requested_plan.learning_item_id
    and material.user_id = current_user_id;

  if cardinality(learning_paths) > 10000 then
    raise exception using errcode = '54000', message = 'plan_deletion_cleanup_limit_exceeded';
  end if;
  if exists (
    select 1
    from public.materials as sibling_material
    where sibling_material.user_id = current_user_id
      and sibling_material.learning_item_id <> requested_plan.learning_item_id
      and sibling_material.storage_path = any(learning_paths)
  ) then
    raise exception using errcode = '21000', message = 'plan_deletion_shared_material_path';
  end if;
  if exists (
    select 1
    from unnest(learning_paths) as path(value)
    where path.value not like current_user_id::text || '/%'
      or char_length(path.value) > 1024
      or path.value like '%/../%'
      or path.value like '%//%'
  ) then
    raise exception using errcode = '22023', message = 'plan_deletion_cleanup_path_invalid';
  end if;

  insert into public.account_deletion_cleanup_jobs (
    id,
    user_id,
    learning_material_paths,
    account_export_paths
  ) values (
    cleanup_job_id,
    current_user_id,
    learning_paths,
    '{}'::text[]
  );

  -- material_chunks intentionally have no FK because chunks can move from a
  -- staged upload into a durable material. Attached material ids are now exact.
  delete from public.material_chunks
  where user_id = current_user_id
    and material_id = any(material_ids);

  -- FKs cascade from the learning item through the plan, sessions, attempts,
  -- events, tutor conversation, linked deadlines, and attached material rows.
  delete from public.learning_items
  where id = requested_plan.learning_item_id
    and user_id = current_user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'plan_deletion_not_completed';
  end if;

  return pg_catalog.jsonb_build_object(
    'deletedPlanId', requested_plan.id,
    'deletedLearningItemId', requested_plan.learning_item_id,
    'cleanupJobId', cleanup_job_id
  );
end;
$$;

revoke all on function public.delete_archived_learning_plan(jsonb) from public, anon;
grant execute on function public.delete_archived_learning_plan(jsonb) to authenticated;
