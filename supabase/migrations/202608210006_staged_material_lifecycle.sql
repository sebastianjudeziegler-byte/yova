-- Give staged private materials a complete lifecycle. Expiration is a hard
-- promotion/mapping boundary, while Storage deletion remains leased and
-- retryable until the exact object, chunks, and staging row are all gone.

alter table public.material_uploads
add column if not exists cleanup_claimed_at timestamptz,
add column if not exists cleanup_token uuid;

alter table public.material_uploads
drop constraint if exists material_uploads_cleanup_lease_check;

alter table public.material_uploads
add constraint material_uploads_cleanup_lease_check check (
  (cleanup_claimed_at is null and cleanup_token is null)
  or (cleanup_claimed_at is not null and cleanup_token is not null)
);

create index if not exists material_uploads_cleanup_idx
on public.material_uploads(expires_at, cleanup_claimed_at);

-- A mapper can start shortly before expiry and finish afterwards. Refuse its
-- final mutation so chunks, Ready state, and observations roll back together.
create or replace function public.guard_expired_material_upload_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.expires_at <= pg_catalog.clock_timestamp() or old.cleanup_claimed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'material_staging_expired';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_expired_material_upload_update
on public.material_uploads;

create trigger guard_expired_material_upload_update
before update of processing_status, extracted_text, metadata
on public.material_uploads
for each row execute function public.guard_expired_material_upload_update();

-- Both plan activation and active-plan attachment promote a staging row by
-- inserting the same id into materials. This trigger is the database fence for
-- every promotion path, including a request that crossed expiry after its
-- initial route read.
create or replace function public.guard_expired_material_promotion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  staged_expires_at timestamptz;
  staged_cleanup_claimed_at timestamptz;
begin
  -- Lock the staging row through the surrounding promotion transaction. This
  -- closes the insert/delete window in which cleanup could otherwise claim
  -- and remove Storage while a durable insert was still uncommitted.
  select upload.expires_at, upload.cleanup_claimed_at
  into staged_expires_at, staged_cleanup_claimed_at
  from public.material_uploads as upload
  where upload.id = new.id
    and upload.user_id = new.user_id
  for update;

  -- Every runtime material insert is a promotion from material_uploads. A
  -- concurrent cleanup may have selected the row before this trigger and then
  -- deleted it while the insert waited. Missing must therefore fail closed;
  -- otherwise the durable row can point at an object cleanup already removed.
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'material_staging_expired';
  end if;

  if staged_expires_at <= pg_catalog.clock_timestamp()
    or staged_cleanup_claimed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'material_staging_expired';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_expired_material_promotion
on public.materials;

create trigger guard_expired_material_promotion
before insert on public.materials
for each row execute function public.guard_expired_material_promotion();

-- Keep the source statements fail-fast as well as relying on the trigger's
-- final locked check. Recreate the latest deployed functions in place by
-- hardening their exact promotion SELECTs. pg_get_functiondef preserves each
-- function body, so this also avoids copying hundreds of unrelated attachment
-- invariants into this lifecycle migration. Abort the migration if a prior
-- function changed instead of silently deploying an incomplete fence.
do $migration$
declare
  function_definition text;
  hardened_definition text;
  promotion_source text;
  hardened_source text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.save_generated_plan(jsonb)'::pg_catalog.regprocedure
  ) into function_definition;

  promotion_source := $source$
    from public.material_uploads as upload
    where upload.id = (material ->> 'id')::uuid and upload.user_id = current_user_id
      and upload.processing_status = 'ready';
$source$;
  hardened_source := $source$
    from public.material_uploads as upload
    where upload.id = (material ->> 'id')::uuid and upload.user_id = current_user_id
      and upload.processing_status = 'ready'
      and upload.expires_at > pg_catalog.clock_timestamp()
      and upload.cleanup_claimed_at is null;
$source$;

  hardened_definition := pg_catalog.replace(
    function_definition,
    promotion_source,
    hardened_source
  );
  if hardened_definition is not distinct from function_definition then
    raise exception 'save_generated_plan promotion source changed; staged expiry fence was not installed';
  end if;
  execute hardened_definition;

  select pg_catalog.pg_get_functiondef(
    'public.attach_materials_to_plan(jsonb)'::pg_catalog.regprocedure
  ) into function_definition;

  promotion_source := $source$
    from public.material_uploads as upload
    where upload.id = requested_material_id
      and upload.user_id = current_user_id
      and upload.processing_status = 'ready'
      and upload.metadata ->> 'mappingStatus' = 'ready';
$source$;
  hardened_source := $source$
    from public.material_uploads as upload
    where upload.id = requested_material_id
      and upload.user_id = current_user_id
      and upload.processing_status = 'ready'
      and upload.metadata ->> 'mappingStatus' = 'ready'
      and upload.expires_at > pg_catalog.clock_timestamp()
      and upload.cleanup_claimed_at is null;
$source$;

  hardened_definition := pg_catalog.replace(
    function_definition,
    promotion_source,
    hardened_source
  );
  if hardened_definition is not distinct from function_definition then
    raise exception 'attach_materials_to_plan promotion source changed; staged expiry fence was not installed';
  end if;
  execute hardened_definition;
end;
$migration$;

-- Explicit cancellation first expires and leases the row. Once this commits,
-- the source can no longer be mapped or attached even if Storage is briefly
-- unavailable; the cron can safely resume cleanup after the lease expires.
create or replace function public.claim_material_upload_cleanup(
  requested_material_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  upload public.material_uploads%rowtype;
  next_cleanup_token uuid;
begin
  if current_user_id is null or requested_material_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  select * into upload
  from public.material_uploads
  where id = requested_material_id
    and user_id = current_user_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('status', 'missing');
  end if;

  if exists (
    select 1 from public.materials as material
    where material.id = upload.id
      and material.user_id = current_user_id
  ) then
    return pg_catalog.jsonb_build_object('status', 'durable');
  end if;

  update public.material_uploads
  set expires_at = least(expires_at, now())
  where id = upload.id;

  if upload.cleanup_claimed_at is not null
    and upload.cleanup_claimed_at > now() - interval '10 minutes' then
    return pg_catalog.jsonb_build_object('status', 'cleanup_pending');
  end if;

  next_cleanup_token := extensions.gen_random_uuid();
  update public.material_uploads
  set
    cleanup_claimed_at = now(),
    cleanup_token = next_cleanup_token
  where id = upload.id;

  return pg_catalog.jsonb_build_object(
    'status', 'claimed',
    'materialId', upload.id,
    'userId', current_user_id,
    'storagePath', upload.storage_path,
    'mimeType', upload.mime_type,
    'cleanupToken', next_cleanup_token
  );
end;
$$;

create or replace function public.claim_expired_material_uploads(
  requested_limit integer default 250
)
returns table (
  material_id uuid,
  user_id uuid,
  storage_path text,
  mime_type text,
  cleanup_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role is required.';
  end if;
  if requested_limit is null or requested_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'material_cleanup_limit_invalid';
  end if;

  return query
  with cleanup_candidates as (
    select upload.id
    from public.material_uploads as upload
    where upload.expires_at <= now()
      and not exists (
        select 1 from public.materials as material
        where material.id = upload.id
      )
      and (
        upload.cleanup_claimed_at is null
        or upload.cleanup_claimed_at <= now() - interval '10 minutes'
      )
    order by upload.expires_at, upload.created_at, upload.id
    for update skip locked
    limit requested_limit
  ), claimed as (
    update public.material_uploads as upload
    set
      cleanup_claimed_at = now(),
      cleanup_token = extensions.gen_random_uuid()
    from cleanup_candidates
    where upload.id = cleanup_candidates.id
    returning
      upload.id,
      upload.user_id,
      upload.storage_path,
      upload.mime_type,
      upload.cleanup_token,
      upload.expires_at,
      upload.created_at
  )
  select
    claimed.id,
    claimed.user_id,
    claimed.storage_path,
    claimed.mime_type,
    claimed.cleanup_token
  from claimed
  order by claimed.expires_at, claimed.created_at, claimed.id;
end;
$$;

create or replace function public.confirm_material_upload_cleanup(
  requested_material_id uuid,
  requested_cleanup_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  upload_owner_id uuid;
  changed_count integer := 0;
begin
  if requested_material_id is null or requested_cleanup_token is null then
    return false;
  end if;

  select upload.user_id into upload_owner_id
  from public.material_uploads as upload
  where upload.id = requested_material_id
    and upload.cleanup_token = requested_cleanup_token
    and upload.cleanup_claimed_at is not null
    and upload.expires_at <= now()
  for update;

  if not found then return false; end if;
  if auth.role() <> 'service_role' and current_user_id is distinct from upload_owner_id then
    return false;
  end if;
  if exists (
    select 1 from public.materials as material
    where material.id = requested_material_id
  ) then
    return false;
  end if;

  delete from public.material_chunks
  where material_id = requested_material_id
    and user_id = upload_owner_id;

  delete from public.material_uploads
  where id = requested_material_id
    and user_id = upload_owner_id
    and cleanup_token = requested_cleanup_token;

  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

create or replace function public.release_material_upload_cleanup(
  requested_material_id uuid,
  requested_cleanup_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  upload_owner_id uuid;
  changed_count integer := 0;
begin
  if requested_material_id is null or requested_cleanup_token is null then
    return false;
  end if;

  select upload.user_id into upload_owner_id
  from public.material_uploads as upload
  where upload.id = requested_material_id
    and upload.cleanup_token = requested_cleanup_token;

  if not found then return false; end if;
  if auth.role() <> 'service_role' and current_user_id is distinct from upload_owner_id then
    return false;
  end if;

  update public.material_uploads
  set cleanup_claimed_at = null, cleanup_token = null
  where id = requested_material_id
    and cleanup_token = requested_cleanup_token
    and expires_at <= now();

  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

revoke all on function public.guard_expired_material_upload_update() from public, anon, authenticated;
revoke all on function public.guard_expired_material_promotion() from public, anon, authenticated;
revoke all on function public.claim_material_upload_cleanup(uuid) from public, anon;
revoke all on function public.claim_expired_material_uploads(integer) from public, anon, authenticated;
revoke all on function public.confirm_material_upload_cleanup(uuid, uuid) from public, anon;
revoke all on function public.release_material_upload_cleanup(uuid, uuid) from public, anon;

grant execute on function public.claim_material_upload_cleanup(uuid) to authenticated;
grant execute on function public.claim_expired_material_uploads(integer) to service_role;
grant execute on function public.confirm_material_upload_cleanup(uuid, uuid) to authenticated, service_role;
grant execute on function public.release_material_upload_cleanup(uuid, uuid) to authenticated, service_role;
