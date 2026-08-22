-- A signed Storage upload capability remains usable for two hours even after
-- its material_uploads row is cancelled. Logical deletion therefore cannot
-- be the final privacy boundary. This migration records only the exact path
-- and a conservative capability deadline, sweeps immediately, and retains an
-- ownerless receipt until a second successful sweep after that deadline.

create table public.private_storage_cleanup_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  -- Deliberately no Auth foreign key: reset and account deletion must not
  -- destroy the only durable record of a still-usable upload capability.
  user_id uuid not null,
  bucket_id text not null check (bucket_id in ('learning-materials', 'account-exports')),
  storage_path text not null,
  -- Historical owner-prefix policies admitted keys that are not valid new
  -- staging paths. This flag is set only by revoked, database-inventory
  -- helpers so those exact opaque keys can still be removed without ever
  -- accepting a caller-supplied cross-owner path.
  legacy_opaque_path boolean not null default false,
  source_material_id uuid,
  final_sweep_after timestamptz not null,
  initial_swept_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  cleanup_claimed_at timestamptz,
  cleanup_token uuid,
  constraint private_storage_cleanup_receipts_path_unique unique (bucket_id, storage_path),
  constraint private_storage_cleanup_receipts_path_check check (
    char_length(storage_path) between 38 and 1024
    and storage_path like user_id::text || '/%'
    and (
      legacy_opaque_path
      or (
        storage_path !~ '(^|/)\.{1,2}(/|$)'
        and storage_path not like '%//%'
        and storage_path !~ '[[:cntrl:]]'
      )
    )
  ),
  constraint private_storage_cleanup_receipts_deadline_check check (
    final_sweep_after >= created_at
  ),
  constraint private_storage_cleanup_receipts_lease_check check (
    (cleanup_claimed_at is null and cleanup_token is null)
    or (cleanup_claimed_at is not null and cleanup_token is not null)
  )
);

create index private_storage_cleanup_receipts_claim_idx
on public.private_storage_cleanup_receipts(
  initial_swept_at,
  final_sweep_after,
  cleanup_claimed_at,
  created_at
);

create index private_storage_cleanup_receipts_material_idx
on public.private_storage_cleanup_receipts(source_material_id)
where source_material_id is not null;

-- 010 records when the broad owner-prefix INSERT capability is finally
-- closed. The discovery worker uses the persisted drain deadline when it
-- quarantines objects created by capabilities minted before enforcement.
create table public.private_storage_capability_boundaries (
  bucket_id text primary key check (bucket_id = 'learning-materials'),
  issuance_closed_at timestamptz not null,
  discovery_required_until timestamptz not null,
  constraint private_storage_capability_boundaries_deadline_check check (
    discovery_required_until >= issuance_closed_at + interval '2 hours'
  )
);

-- Reset must also fence an old link-import request that uploaded Storage
-- before taking the database lifecycle lock. For one capability TTL after a
-- completed reset, only the advisory-locked staging RPC may create a row;
-- compatibility direct INSERTs fail closed and orphan discovery owns cleanup.
create table public.private_learning_data_reset_boundaries (
  user_id uuid primary key,
  reset_completed_at timestamptz not null,
  compatibility_writes_blocked_until timestamptz not null,
  constraint private_learning_data_reset_boundaries_deadline_check check (
    compatibility_writes_blocked_until >= reset_completed_at + interval '2 hours'
  )
);

-- One-use proof that a staging INSERT came through create_material_upload
-- after it acquired the learner lock. Browser SQL roles cannot create this
-- marker; the BEFORE INSERT trigger consumes it in the same transaction.
create table public.private_material_upload_rpc_transactions (
  transaction_id bigint not null,
  user_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (transaction_id, user_id)
);

alter table public.private_storage_cleanup_receipts enable row level security;
alter table public.private_storage_capability_boundaries enable row level security;
alter table public.private_learning_data_reset_boundaries enable row level security;
alter table public.private_material_upload_rpc_transactions enable row level security;
revoke all on table public.private_storage_cleanup_receipts
from public, anon, authenticated, service_role;
revoke all on table public.private_storage_capability_boundaries
from public, anon, authenticated, service_role;
revoke all on table public.private_learning_data_reset_boundaries
from public, anon, authenticated, service_role;
revoke all on table public.private_material_upload_rpc_transactions
from public, anon, authenticated, service_role;

create or replace function public.enqueue_private_storage_cleanup_receipt(
  requested_user_id uuid,
  requested_bucket_id text,
  requested_storage_path text,
  requested_final_sweep_after timestamptz,
  requested_source_material_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  receipt_id uuid;
  effective_created_at timestamptz := pg_catalog.clock_timestamp();
begin
  if requested_user_id is null
    or requested_bucket_id not in ('learning-materials', 'account-exports')
    or requested_storage_path is null
    or char_length(requested_storage_path) not between 38 and 1024
    or requested_storage_path not like requested_user_id::text || '/%'
    or requested_storage_path ~ '(^|/)\.{1,2}(/|$)'
    or requested_storage_path like '%//%'
    or requested_storage_path ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'private_storage_cleanup_path_invalid';
  end if;

  insert into public.private_storage_cleanup_receipts (
    user_id,
    bucket_id,
    storage_path,
    source_material_id,
    final_sweep_after,
    created_at
  ) values (
    requested_user_id,
    requested_bucket_id,
    requested_storage_path,
    requested_source_material_id,
    greatest(coalesce(requested_final_sweep_after, effective_created_at), effective_created_at),
    effective_created_at
  )
  on conflict (bucket_id, storage_path) do update
  set
    final_sweep_after = greatest(
      public.private_storage_cleanup_receipts.final_sweep_after,
      excluded.final_sweep_after
    ),
    source_material_id = coalesce(
      public.private_storage_cleanup_receipts.source_material_id,
      excluded.source_material_id
    ),
    -- A newly recorded capability/object requires a fresh initial sweep. The
    -- exact path is unique and all callers serialize the learner lifecycle.
    initial_swept_at = null,
    cleanup_claimed_at = null,
    cleanup_token = null
  returning id into receipt_id;

  return receipt_id;
end;
$$;

revoke all on function public.enqueue_private_storage_cleanup_receipt(uuid, text, text, timestamptz, uuid)
from public, anon, authenticated, service_role;

-- Internal-only bridge for database-inventoried legacy keys. It deliberately
-- permits dot segments, repeated slashes, and control characters because the
-- Storage remove API receives an exact JSON key, not a URL path. Ownership is
-- still bounded to one UUID prefix and the function is never executable by a
-- browser or service-role client. New staging always uses the strict helper.
create or replace function public.enqueue_legacy_private_storage_cleanup_receipt(
  requested_user_id uuid,
  requested_bucket_id text,
  requested_storage_path text,
  requested_final_sweep_after timestamptz,
  requested_source_material_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  receipt_id uuid;
  effective_created_at timestamptz := pg_catalog.clock_timestamp();
  is_opaque boolean;
begin
  if requested_user_id is null
    or requested_bucket_id not in ('learning-materials', 'account-exports')
    or requested_storage_path is null
    or char_length(requested_storage_path) not between 38 and 1024
    or requested_storage_path not like requested_user_id::text || '/%' then
    raise exception using errcode = '22023', message = 'legacy_private_storage_cleanup_path_invalid';
  end if;

  is_opaque := requested_storage_path ~ '(^|/)\.{1,2}(/|$)'
    or requested_storage_path like '%//%'
    or requested_storage_path ~ '[[:cntrl:]]';

  insert into public.private_storage_cleanup_receipts (
    user_id,
    bucket_id,
    storage_path,
    legacy_opaque_path,
    source_material_id,
    final_sweep_after,
    created_at
  ) values (
    requested_user_id,
    requested_bucket_id,
    requested_storage_path,
    is_opaque,
    requested_source_material_id,
    greatest(coalesce(requested_final_sweep_after, effective_created_at), effective_created_at),
    effective_created_at
  )
  on conflict (bucket_id, storage_path) do update
  set
    final_sweep_after = greatest(
      public.private_storage_cleanup_receipts.final_sweep_after,
      excluded.final_sweep_after
    ),
    legacy_opaque_path = (
      public.private_storage_cleanup_receipts.legacy_opaque_path
      or excluded.legacy_opaque_path
    ),
    source_material_id = coalesce(
      public.private_storage_cleanup_receipts.source_material_id,
      excluded.source_material_id
    ),
    initial_swept_at = null,
    cleanup_claimed_at = null,
    cleanup_token = null
  returning id into receipt_id;

  return receipt_id;
end;
$$;

revoke all on function public.enqueue_legacy_private_storage_cleanup_receipt(uuid, text, text, timestamptz, uuid)
from public, anon, authenticated, service_role;

-- Discover both pre-migration orphans and objects materialized later by a
-- still-live pre-enforcement upload token. The per-user lifecycle lock closes
-- the race with new staging, and the retained receipt blocks UUID/path reuse.
create or replace function public.discover_orphaned_learning_material_objects(
  requested_limit integer default 1000
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  object_record record;
  owner_id uuid;
  parsed_material_id uuid;
  discovered_count integer := 0;
  receipt_deadline timestamptz;
begin
  if requested_limit is null or requested_limit not between 1 and 10000 then
    raise exception using errcode = '22023', message = 'orphan_storage_discovery_limit_invalid';
  end if;

  receipt_deadline := greatest(
    pg_catalog.clock_timestamp() + interval '2 hours 10 minutes',
    coalesce(
      (
        select boundary.discovery_required_until
        from public.private_storage_capability_boundaries as boundary
        where boundary.bucket_id = 'learning-materials'
      ),
      pg_catalog.clock_timestamp()
    )
  );

  for object_record in
    select object.id, object.name
    from storage.objects as object
    where object.bucket_id = 'learning-materials'
      and char_length(object.name) between 38 and 1024
      and pg_catalog.split_part(object.name, '/', 1) ~* (
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
      and not exists (
        select 1 from public.materials as material
        where material.storage_path = object.name
      )
      and not exists (
        select 1 from public.material_uploads as upload
        where upload.storage_path = object.name
      )
      and not exists (
        select 1 from public.private_storage_cleanup_receipts as receipt
        where receipt.bucket_id = 'learning-materials'
          and receipt.storage_path = object.name
      )
    order by object.created_at, object.id
    limit requested_limit
  loop
    owner_id := pg_catalog.split_part(object_record.name, '/', 1)::uuid;
    if not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtext('yova_learning_data'),
      pg_catalog.hashtext(owner_id::text)
    ) then
      continue;
    end if;

    -- Recheck under the same lock used by stage creation/promotion/reset.
    if not exists (
        select 1 from storage.objects as object
        where object.id = object_record.id
          and object.bucket_id = 'learning-materials'
          and object.name = object_record.name
      )
      or exists (
        select 1 from public.materials as material
        where material.storage_path = object_record.name
      )
      or exists (
        select 1 from public.material_uploads as upload
        where upload.storage_path = object_record.name
      ) then
      continue;
    end if;

    parsed_material_id := case
      when pg_catalog.split_part(object_record.name, '/', 2) ~* (
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) then pg_catalog.split_part(object_record.name, '/', 2)::uuid
      else null
    end;

    perform public.enqueue_legacy_private_storage_cleanup_receipt(
      owner_id,
      'learning-materials',
      object_record.name,
      receipt_deadline,
      parsed_material_id
    );
    discovered_count := discovered_count + 1;
  end loop;

  return discovered_count;
end;
$$;

revoke all on function public.discover_orphaned_learning_material_objects(integer)
from public, anon, authenticated, service_role;

-- Backfill objects that already lost both their staging and durable rows.
-- The same discovery is repeated by every cleanup claim so a pre-010 signed
-- token used after this transaction cannot escape the boundary.
select public.discover_orphaned_learning_material_objects(10000);

-- Convert any in-progress 006 cleanup lease before changing the worker
-- contract. Also remove malformed legacy staging records so one hostile row
-- cannot poison the ordered cleanup queue. Safe owner-prefixed paths still get
-- a receipt; foreign/traversal paths are never allowed to target Storage.
do $$
declare
  upload record;
begin
  if exists (
    select 1
    from public.material_uploads as staged
    join public.materials as durable
      on durable.id = staged.id and durable.user_id = staged.user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'material_upload_cleanup_durable_collision_requires_review';
  end if;

  for upload in
    select staged.*
    from public.material_uploads as staged
    where (
        staged.cleanup_claimed_at is not null
        or staged.storage_path !~ (
          '^' || staged.user_id::text || '/' || staged.id::text || '/[^/]{1,255}$'
        )
        or staged.storage_path ~ '/\.{1,2}$'
        or staged.storage_path ~ '[[:cntrl:]]'
        or staged.created_at > pg_catalog.clock_timestamp() + interval '5 minutes'
        or staged.expires_at < staged.created_at
        or staged.expires_at > staged.created_at + interval '24 hours 1 minute'
      )
      and not exists (
        select 1 from public.materials as durable
        where durable.id = staged.id and durable.user_id = staged.user_id
      )
  loop
    if upload.storage_path like upload.user_id::text || '/%'
      and char_length(upload.storage_path) between 38 and 1024 then
      perform public.enqueue_legacy_private_storage_cleanup_receipt(
        upload.user_id,
        'learning-materials',
        upload.storage_path,
        pg_catalog.clock_timestamp() + interval '2 hours 10 minutes',
        upload.id
      );
    end if;

    delete from public.material_chunks
    where material_id = upload.id and user_id = upload.user_id;
    delete from public.material_uploads
    where id = upload.id and user_id = upload.user_id;
  end loop;
end;
$$;

-- Existing authenticated clients had owner-all writes. Normalize the bounded
-- lifetime before making lifecycle identity immutable.
update public.material_uploads
set expires_at = least(
  greatest(expires_at, created_at),
  created_at + interval '24 hours 1 minute'
);

alter table public.material_uploads
add constraint material_uploads_exact_storage_path_check check (
  storage_path ~ ('^' || user_id::text || '/' || id::text || '/[^/]{1,255}$')
  and storage_path !~ '/\.{1,2}$'
  and storage_path !~ '[[:cntrl:]]'
),
add constraint material_uploads_bounded_lifetime_check check (
  expires_at between created_at and created_at + interval '24 hours 1 minute'
);

create or replace function public.guard_material_upload_lifecycle_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_rpc_transaction boolean := false;
begin
  if tg_op = 'INSERT' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('yova_learning_data'),
      pg_catalog.hashtext(new.user_id::text)
    );

    delete from public.private_material_upload_rpc_transactions as marker
    where marker.transaction_id = pg_catalog.txid_current()
      and marker.user_id = new.user_id;
    trusted_rpc_transaction := found;

    if exists (
        select 1 from public.materials as material
        where material.id = new.id and material.user_id = new.user_id
      )
      or exists (
        select 1 from public.private_storage_cleanup_receipts as receipt
        where receipt.user_id = new.user_id
          and receipt.bucket_id = 'learning-materials'
          and (
            receipt.storage_path = new.storage_path
            or receipt.source_material_id = new.id
          )
      )
      or (
        auth.role() <> 'service_role'
        and not trusted_rpc_transaction
        and exists (
          select 1 from public.private_learning_data_reset_boundaries as boundary
          where boundary.user_id = new.user_id
            and boundary.compatibility_writes_blocked_until > pg_catalog.clock_timestamp()
        )
      )
      or new.storage_path !~ ('^' || new.user_id::text || '/' || new.id::text || '/[^/]{1,255}$')
      or new.storage_path ~ '/\.{1,2}$'
      or new.storage_path ~ '[[:cntrl:]]'
      or new.created_at < pg_catalog.clock_timestamp() - interval '5 minutes'
      or new.created_at > pg_catalog.clock_timestamp() + interval '5 minutes'
      or new.expires_at < new.created_at
      or new.expires_at > new.created_at + interval '24 hours 1 minute'
      or new.cleanup_claimed_at is not null
      or new.cleanup_token is not null then
      raise exception using errcode = '22023', message = 'material_upload_lifecycle_invalid';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.storage_path is distinct from old.storage_path
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at
    or new.cleanup_claimed_at is distinct from old.cleanup_claimed_at
    or new.cleanup_token is distinct from old.cleanup_token then
    raise exception using errcode = '22023', message = 'material_upload_lifecycle_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_material_upload_lifecycle_identity
on public.material_uploads;
create trigger guard_material_upload_lifecycle_identity
before insert or update on public.material_uploads
for each row execute function public.guard_material_upload_lifecycle_identity();

-- Compatibility safety for the short migration-first rollout window: older
-- application instances delete staging rows directly. Capture a minimal
-- receipt in the delete transaction unless this is a successful promotion.
create or replace function public.capture_material_upload_delete_receipt()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(old.user_id::text)
  );

  if exists (
    select 1 from public.materials as material
    where material.id = old.id
      and material.user_id = old.user_id
      and material.storage_path is distinct from old.storage_path
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'material_upload_cleanup_durable_collision_requires_review';
  elsif not exists (
    select 1 from public.materials as material
    where material.id = old.id
      and material.user_id = old.user_id
      and material.storage_path = old.storage_path
  ) then
    perform public.enqueue_private_storage_cleanup_receipt(
      old.user_id,
      'learning-materials',
      old.storage_path,
      pg_catalog.clock_timestamp() + interval '2 hours 10 minutes',
      old.id
    );
    delete from public.material_chunks
    where material_id = old.id and user_id = old.user_id;
  end if;
  return old;
end;
$$;

drop trigger if exists capture_material_upload_delete_receipt
on public.material_uploads;
create trigger capture_material_upload_delete_receipt
before delete on public.material_uploads
for each row execute function public.capture_material_upload_delete_receipt();

-- All staging creation shares the same advisory lock as reset, mapping,
-- promotion, and cancellation. Once 010 closes the short compatibility
-- policy, this becomes the sole authenticated creation boundary instead of
-- trusting clients to participate in transaction ordering.
create or replace function public.create_material_upload(payload jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;
  if pg_catalog.jsonb_typeof(payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'material_upload_payload_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  -- The trigger consumes this revoked one-use marker. A legacy direct INSERT
  -- cannot forge it, even if it began before Reset and waited on this lock.
  insert into public.private_material_upload_rpc_transactions (
    transaction_id,
    user_id
  ) values (
    pg_catalog.txid_current(),
    current_user_id
  );

  insert into public.material_uploads (
    id,
    user_id,
    filename,
    storage_path,
    mime_type,
    byte_size,
    processing_status,
    extracted_text,
    metadata
  ) values (
    (payload ->> 'id')::uuid,
    current_user_id,
    payload ->> 'filename',
    payload ->> 'storagePath',
    payload ->> 'mimeType',
    (payload ->> 'byteSize')::bigint,
    coalesce(payload ->> 'processingStatus', 'processing'),
    payload ->> 'extractedText',
    coalesce(payload -> 'metadata', '{}'::jsonb)
  );
  return true;
end;
$$;

-- Add the same learner lifecycle lock to both promotion transactions without
-- copying their large, separately audited function bodies into this migration.
do $migration$
declare
  function_signature text;
  function_definition text;
  locked_definition text;
  authentication_source text := $source$
  if current_user_id is null then raise exception 'Authentication is required.'; end if;
$source$;
  locked_source text := $source$
  if current_user_id is null then raise exception 'Authentication is required.'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );
$source$;
begin
  foreach function_signature in array array[
    'public.save_generated_plan(jsonb)',
    'public.attach_materials_to_plan(jsonb)'
  ]
  loop
    select pg_catalog.pg_get_functiondef(function_signature::pg_catalog.regprocedure)
    into function_definition;
    locked_definition := pg_catalog.replace(
      function_definition,
      authentication_source,
      locked_source
    );
    if locked_definition is not distinct from function_definition then
      raise exception '% authentication boundary changed; reset lock was not installed', function_signature;
    end if;
    execute locked_definition;
  end loop;
end;
$migration$;

drop policy if exists "material_uploads_owner_all" on public.material_uploads;
drop policy if exists "material_uploads_owner_select" on public.material_uploads;
drop policy if exists "material_uploads_owner_insert" on public.material_uploads;
drop policy if exists "material_uploads_owner_update" on public.material_uploads;

create policy "material_uploads_owner_select" on public.material_uploads
for select to authenticated
using ((select auth.uid()) = user_id);

-- Retained only through the 007 -> application -> 010 phased rollout. The
-- INSERT trigger above still serializes old direct inserts with Reset, and the
-- DELETE trigger guarantees old direct deletes cannot bypass receipts.
create policy "material_uploads_owner_insert" on public.material_uploads
for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and storage_path ~ ('^' || user_id::text || '/' || id::text || '/[^/]{1,255}$')
  and storage_path !~ '/\.{1,2}$'
  and storage_path !~ '[[:cntrl:]]'
  and cleanup_claimed_at is null
  and cleanup_token is null
);

create policy "material_uploads_owner_update" on public.material_uploads
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "material_uploads_owner_delete" on public.material_uploads
for delete to authenticated
using ((select auth.uid()) = user_id);

-- A cancelled row is deleted before this policy is evaluated, making its
-- object unreadable immediately. During the 007 compatibility window we do
-- not apply the expiry predicate yet: the old reset route must still be able
-- to remove an expired-but-unclaimed exact staging object before calling its
-- reset RPC. Migration 010 adds the final active-row predicate after deploy.
drop policy if exists "learning_material_objects_owner_select" on storage.objects;

create policy "learning_material_objects_owner_select" on storage.objects
for select to authenticated
using (
  bucket_id = 'learning-materials'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (
    exists (
      select 1
      from public.material_uploads as upload
      where upload.user_id = (select auth.uid())
        and upload.storage_path = name
        and upload.cleanup_claimed_at is null
    )
    or exists (
      select 1
      from public.materials as material
      where material.user_id = (select auth.uid())
        and material.storage_path = name
    )
  )
);

create or replace function public.claim_private_storage_cleanup_receipts(
  requested_limit integer default 250
)
returns table (
  cleanup_receipt_id uuid,
  user_id uuid,
  bucket_id text,
  storage_path text,
  legacy_opaque_path boolean,
  cleanup_token uuid,
  sweep_phase text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  if requested_limit is null or requested_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'private_storage_cleanup_limit_invalid';
  end if;

  delete from public.private_learning_data_reset_boundaries as boundary
  where boundary.compatibility_writes_blocked_until <= pg_catalog.clock_timestamp();

  -- This catches objects created after 007 by capabilities minted during the
  -- compatibility window, as well as any historical orphan missed by the
  -- migration-time backfill.
  perform public.discover_orphaned_learning_material_objects(requested_limit);

  return query
  with candidates as (
    select receipt.id
    from public.private_storage_cleanup_receipts as receipt
    where (
        receipt.initial_swept_at is null
        or receipt.final_sweep_after <= pg_catalog.clock_timestamp()
      )
      and not (
        receipt.bucket_id = 'learning-materials'
        and exists (
          select 1 from public.materials as material
          where material.storage_path = receipt.storage_path
        )
      )
      and not (
        receipt.bucket_id = 'learning-materials'
        and exists (
          select 1 from public.material_uploads as upload
          where upload.storage_path = receipt.storage_path
            and upload.expires_at > pg_catalog.clock_timestamp()
        )
      )
      and (
        receipt.cleanup_claimed_at is null
        or receipt.cleanup_claimed_at <= pg_catalog.clock_timestamp() - interval '10 minutes'
      )
    order by
      case when receipt.final_sweep_after <= pg_catalog.clock_timestamp() then 0 else 1 end,
      receipt.final_sweep_after,
      receipt.created_at,
      receipt.id
    for update skip locked
    limit requested_limit
  ), claimed as (
    update public.private_storage_cleanup_receipts as receipt
    set
      cleanup_claimed_at = pg_catalog.clock_timestamp(),
      cleanup_token = extensions.gen_random_uuid()
    from candidates
    where receipt.id = candidates.id
    returning receipt.*
  )
  select
    claimed.id,
    claimed.user_id,
    claimed.bucket_id,
    claimed.storage_path,
    claimed.legacy_opaque_path,
    claimed.cleanup_token,
    case
      when claimed.final_sweep_after <= pg_catalog.clock_timestamp() then 'final'
      else 'initial'
    end
  from claimed
  order by claimed.final_sweep_after, claimed.created_at, claimed.id;
end;
$$;

create or replace function public.confirm_private_storage_cleanup_receipt(
  requested_cleanup_receipt_id uuid,
  requested_cleanup_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  receipt public.private_storage_cleanup_receipts%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;

  select * into receipt
  from public.private_storage_cleanup_receipts
  where id = requested_cleanup_receipt_id
    and cleanup_token = requested_cleanup_token
    and cleanup_claimed_at is not null
  for update;
  if not found then return false; end if;

  if receipt.final_sweep_after <= pg_catalog.clock_timestamp() then
    delete from public.private_storage_cleanup_receipts
    where id = receipt.id and cleanup_token = requested_cleanup_token;
  else
    update public.private_storage_cleanup_receipts
    set
      initial_swept_at = pg_catalog.clock_timestamp(),
      cleanup_claimed_at = null,
      cleanup_token = null
    where id = receipt.id and cleanup_token = requested_cleanup_token;
  end if;
  return found;
end;
$$;

create or replace function public.release_private_storage_cleanup_receipt(
  requested_cleanup_receipt_id uuid,
  requested_cleanup_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;

  update public.private_storage_cleanup_receipts
  set cleanup_claimed_at = null, cleanup_token = null
  where id = requested_cleanup_receipt_id
    and cleanup_token = requested_cleanup_token;
  return found;
end;
$$;

-- Explicit cancellation is now one logical transaction: create the minimal
-- ownerless receipt, erase extracted chunks/content by deleting the staging
-- row, and only then return an exact-path claim for best-effort initial sweep.
create or replace function public.claim_material_upload_cleanup(
  requested_material_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  upload public.material_uploads%rowtype;
  receipt_id uuid;
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
  where id = requested_material_id and user_id = current_user_id
  for update;

  if not found then
    if exists (
      select 1 from public.materials as material
      where material.id = requested_material_id
        and material.user_id = current_user_id
    ) then
      return pg_catalog.jsonb_build_object('status', 'durable');
    end if;
    if exists (
      select 1 from public.private_storage_cleanup_receipts as receipt
      where receipt.user_id = current_user_id
        and receipt.source_material_id = requested_material_id
    ) then
      return pg_catalog.jsonb_build_object('status', 'cleanup_pending');
    end if;
    -- A pre-007 signed capability can materialize an orphan after this
    -- transaction, so absence of both rows is not proof of final removal.
    return pg_catalog.jsonb_build_object('status', 'missing_unconfirmed');
  end if;

  if exists (
    select 1 from public.materials as material
    where material.id = upload.id and material.user_id = current_user_id
  ) then
    if exists (
      select 1 from public.materials as material
      where material.id = upload.id
        and material.user_id = current_user_id
        and material.storage_path is distinct from upload.storage_path
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'material_upload_cleanup_durable_collision_requires_review';
    end if;
    return pg_catalog.jsonb_build_object('status', 'durable');
  end if;

  receipt_id := public.enqueue_private_storage_cleanup_receipt(
    current_user_id,
    'learning-materials',
    upload.storage_path,
    pg_catalog.clock_timestamp() + interval '2 hours 10 minutes',
    upload.id
  );

  delete from public.material_chunks
  where material_id = upload.id and user_id = current_user_id;
  delete from public.material_uploads
  where id = upload.id and user_id = current_user_id;

  next_cleanup_token := extensions.gen_random_uuid();
  update public.private_storage_cleanup_receipts
  set
    cleanup_claimed_at = pg_catalog.clock_timestamp(),
    cleanup_token = next_cleanup_token
  where id = receipt_id;

  return pg_catalog.jsonb_build_object(
    'status', 'claimed',
    'materialId', upload.id,
    'userId', current_user_id,
    'storagePath', upload.storage_path,
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
volatile
security definer
set search_path = ''
as $$
declare
  upload record;
  receipt_id uuid;
  next_cleanup_token uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role is required.';
  end if;
  if requested_limit is null or requested_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'material_cleanup_limit_invalid';
  end if;

  for upload in
    select staged.*
    from public.material_uploads as staged
    where staged.expires_at <= pg_catalog.clock_timestamp()
      and not exists (
        select 1 from public.materials as material where material.id = staged.id
      )
    order by staged.expires_at, staged.created_at, staged.id
    for update skip locked
    limit requested_limit
  loop
    receipt_id := public.enqueue_private_storage_cleanup_receipt(
      upload.user_id,
      'learning-materials',
      upload.storage_path,
      pg_catalog.clock_timestamp() + interval '2 hours 10 minutes',
      upload.id
    );

    delete from public.material_chunks
    where material_chunks.material_id = upload.id
      and material_chunks.user_id = upload.user_id;
    delete from public.material_uploads
    where id = upload.id and material_uploads.user_id = upload.user_id;

    next_cleanup_token := extensions.gen_random_uuid();
    update public.private_storage_cleanup_receipts
    set
      cleanup_claimed_at = pg_catalog.clock_timestamp(),
      cleanup_token = next_cleanup_token
    where id = receipt_id;

    material_id := upload.id;
    user_id := upload.user_id;
    storage_path := upload.storage_path;
    mime_type := upload.mime_type;
    cleanup_token := next_cleanup_token;
    return next;
  end loop;
end;
$$;

create or replace function public.confirm_material_upload_cleanup(
  requested_material_id uuid,
  requested_cleanup_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  receipt public.private_storage_cleanup_receipts%rowtype;
begin
  select * into receipt
  from public.private_storage_cleanup_receipts
  where source_material_id = requested_material_id
    and cleanup_token = requested_cleanup_token
    and cleanup_claimed_at is not null
  for update;
  if not found then return false; end if;
  if auth.role() <> 'service_role' and current_user_id is distinct from receipt.user_id then
    return false;
  end if;

  if receipt.final_sweep_after <= pg_catalog.clock_timestamp() then
    delete from public.private_storage_cleanup_receipts
    where id = receipt.id and cleanup_token = requested_cleanup_token;
  else
    update public.private_storage_cleanup_receipts
    set
      initial_swept_at = pg_catalog.clock_timestamp(),
      cleanup_claimed_at = null,
      cleanup_token = null
    where id = receipt.id and cleanup_token = requested_cleanup_token;
  end if;
  return found;
end;
$$;

create or replace function public.release_material_upload_cleanup(
  requested_material_id uuid,
  requested_cleanup_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  update public.private_storage_cleanup_receipts
  set cleanup_claimed_at = null, cleanup_token = null
  where source_material_id = requested_material_id
    and cleanup_token = requested_cleanup_token
    and (auth.role() = 'service_role' or user_id = current_user_id);
  return found;
end;
$$;

-- Reset is database-first and atomic. Every known exact path, including a
-- staged path whose object has not arrived yet, becomes a durable receipt in
-- the same transaction that erases all learner content.
create or replace function public.reset_yova_learning_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  reset_at timestamptz := pg_catalog.clock_timestamp();
  reset_completed_at timestamptz;
  learning_material_paths jsonb := '[]'::jsonb;
  account_export_paths jsonb := '[]'::jsonb;
  path_entry record;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  select coalesce(pg_catalog.jsonb_agg(path order by path), '[]'::jsonb)
  into learning_material_paths
  from (
    select object.name as path
    from storage.objects as object
    where object.bucket_id = 'learning-materials'
      and object.name like current_user_id::text || '/%'
    union
    select material.storage_path from public.materials as material
    where material.user_id = current_user_id
    union
    select upload.storage_path from public.material_uploads as upload
    where upload.user_id = current_user_id
  ) as paths
  where path is not null
    and char_length(path) between 38 and 1024
    and path like current_user_id::text || '/%';

  select coalesce(pg_catalog.jsonb_agg(path order by path), '[]'::jsonb)
  into account_export_paths
  from (
    select object.name as path
    from storage.objects as object
    where object.bucket_id = 'account-exports'
      and object.name like current_user_id::text || '/%'
    union
    select export_job.temp_storage_path from public.account_data_exports as export_job
    where export_job.user_id = current_user_id
    union
    select export_job.final_storage_path from public.account_data_exports as export_job
    where export_job.user_id = current_user_id
  ) as paths
  where path is not null
    and char_length(path) between 38 and 1024
    and path like current_user_id::text || '/%';

  if pg_catalog.jsonb_array_length(learning_material_paths) > 10000
    or pg_catalog.jsonb_array_length(account_export_paths) > 10000 then
    raise exception using errcode = '54000', message = 'learning_data_reset_cleanup_limit_exceeded';
  end if;

  for path_entry in
    select
      path,
      max(final_sweep_after) as final_sweep_after,
      min(source_material_id::text)::uuid as source_material_id
    from (
      select object.name as path,
        reset_at + interval '2 hours 10 minutes' as final_sweep_after,
        null::uuid as source_material_id
      from storage.objects as object
      where object.bucket_id = 'learning-materials'
        and object.name like current_user_id::text || '/%'
      union all
      select material.storage_path, reset_at + interval '2 hours 10 minutes', material.id
      from public.materials as material where material.user_id = current_user_id
      union all
      select upload.storage_path,
        reset_at + interval '2 hours 10 minutes', upload.id
      from public.material_uploads as upload where upload.user_id = current_user_id
    ) as candidate
    where path is not null
      and char_length(path) between 38 and 1024
      and path like current_user_id::text || '/%'
    group by path
  loop
    perform public.enqueue_legacy_private_storage_cleanup_receipt(
      current_user_id,
      'learning-materials',
      path_entry.path,
      path_entry.final_sweep_after,
      path_entry.source_material_id
    );
  end loop;

  for path_entry in
    select value as path
    from pg_catalog.jsonb_array_elements_text(account_export_paths) as export_path(value)
  loop
    perform public.enqueue_legacy_private_storage_cleanup_receipt(
      current_user_id, 'account-exports', path_entry.path, reset_at, null
    );
  end loop;

  update public.account_data_exports
  set
    status = 'cancelled',
    finalize_grant_digest = null,
    prepare_expires_at = least(prepare_expires_at, reset_at),
    artifact_expires_at = case
      when artifact_expires_at is null then null
      else least(artifact_expires_at, reset_at)
    end,
    updated_at = reset_at
  where user_id = current_user_id;

  delete from public.material_chunks where user_id = current_user_id;
  delete from public.deadline_milestones where user_id = current_user_id;
  delete from public.learning_events where user_id = current_user_id;
  delete from public.learning_items where user_id = current_user_id;
  delete from public.tutor_threads where user_id = current_user_id;
  delete from public.material_uploads where user_id = current_user_id;
  delete from public.learner_profiles where user_id = current_user_id;
  delete from public.product_events where user_id = current_user_id;
  delete from public.error_reports where user_id = current_user_id;
  update public.profiles set onboarding_completed_at = null where id = current_user_id;

  reset_completed_at := pg_catalog.clock_timestamp();
  insert into public.private_learning_data_reset_boundaries (
    user_id,
    reset_completed_at,
    compatibility_writes_blocked_until
  ) values (
    current_user_id,
    reset_completed_at,
    reset_completed_at + interval '2 hours 10 minutes'
  )
  on conflict (user_id) do update
  set
    reset_completed_at = excluded.reset_completed_at,
    compatibility_writes_blocked_until = excluded.compatibility_writes_blocked_until;

  return pg_catalog.jsonb_build_object(
    'learningMaterialPaths', learning_material_paths,
    'accountExportPaths', account_export_paths
  );
end;
$$;

-- New account deletions seed both the legacy immediate-cleanup job and the
-- retained final-sweep receipt. Staged database paths are included even when
-- no object exists yet, and the receipts deliberately outlive auth.users.
create or replace function public.delete_yova_account(expected_account_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  cleanup_job_id uuid := extensions.gen_random_uuid();
  learning_paths text[] := '{}'::text[];
  export_paths text[] := '{}'::text[];
  confirmed_at timestamptz;
  deletion_at timestamptz := pg_catalog.clock_timestamp();
  path_entry record;
begin
  if current_user_id is null
    or expected_account_id is null
    or current_user_id <> expected_account_id then
    raise exception using errcode = '42501', message = 'account_deletion_identity_mismatch';
  end if;
  if public.account_export_has_recent_human_amr() is not true then
    raise exception using errcode = 'PXD01', message = 'account_deletion_reauthentication_required';
  end if;

  select auth_user.email_confirmed_at into confirmed_at
  from auth.users as auth_user
  where auth_user.id = current_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'account_deletion_identity_missing';
  end if;
  if confirmed_at is null then
    raise exception using errcode = 'PXD02', message = 'account_deletion_email_unverified';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  select coalesce(array_agg(path order by path), '{}'::text[]) into learning_paths
  from (
    select object.name as path from storage.objects as object
    where object.bucket_id = 'learning-materials'
      and object.name like current_user_id::text || '/%'
    union
    select material.storage_path from public.materials as material
    where material.user_id = current_user_id
    union
    select upload.storage_path from public.material_uploads as upload
    where upload.user_id = current_user_id
  ) as inventory
  where path is not null
    and char_length(path) between 38 and 1024
    and path like current_user_id::text || '/%';

  select coalesce(array_agg(path order by path), '{}'::text[]) into export_paths
  from (
    select object.name as path from storage.objects as object
    where object.bucket_id = 'account-exports'
      and object.name like current_user_id::text || '/%'
    union
    select export_job.temp_storage_path from public.account_data_exports as export_job
    where export_job.user_id = current_user_id
    union
    select export_job.final_storage_path from public.account_data_exports as export_job
    where export_job.user_id = current_user_id
  ) as inventory
  where path is not null
    and char_length(path) between 38 and 1024
    and path like current_user_id::text || '/%';

  if cardinality(learning_paths) > 10000 or cardinality(export_paths) > 10000 then
    raise exception using errcode = '54000', message = 'account_deletion_cleanup_limit_exceeded';
  end if;

  for path_entry in
    select
      path,
      max(final_sweep_after) as final_sweep_after,
      min(source_material_id::text)::uuid as source_material_id
    from (
      select object.name as path,
        deletion_at + interval '2 hours 10 minutes' as final_sweep_after,
        null::uuid as source_material_id
      from storage.objects as object
      where object.bucket_id = 'learning-materials'
        and object.name like current_user_id::text || '/%'
      union all
      select material.storage_path, deletion_at + interval '2 hours 10 minutes', material.id
      from public.materials as material where material.user_id = current_user_id
      union all
      select upload.storage_path,
        deletion_at + interval '2 hours 10 minutes', upload.id
      from public.material_uploads as upload where upload.user_id = current_user_id
    ) as candidate
    where path is not null
      and char_length(path) between 38 and 1024
      and path like current_user_id::text || '/%'
    group by path
  loop
    perform public.enqueue_legacy_private_storage_cleanup_receipt(
      current_user_id, 'learning-materials', path_entry.path,
      path_entry.final_sweep_after, path_entry.source_material_id
    );
  end loop;

  for path_entry in select path from unnest(export_paths) as export_path(path)
  loop
    perform public.enqueue_legacy_private_storage_cleanup_receipt(
      current_user_id, 'account-exports', path_entry.path, deletion_at, null
    );
  end loop;

  update public.account_data_exports
  set
    status = 'cancelled',
    finalize_grant_digest = null,
    prepare_expires_at = least(prepare_expires_at, deletion_at),
    artifact_expires_at = case
      when artifact_expires_at is null then null
      else least(artifact_expires_at, deletion_at)
    end,
    updated_at = deletion_at
  where user_id = current_user_id;

  insert into public.account_deletion_cleanup_jobs (
    id, user_id, learning_material_paths, account_export_paths
  ) values (
    cleanup_job_id,
    current_user_id,
    array(
      select cleanup_path.value
      from unnest(learning_paths) as cleanup_path(value)
      where cleanup_path.value !~ '(^|/)\.{1,2}(/|$)'
        and cleanup_path.value not like '%//%'
        and cleanup_path.value !~ '[[:cntrl:]]'
    ),
    array(
      select cleanup_path.value
      from unnest(export_paths) as cleanup_path(value)
      where cleanup_path.value !~ '(^|/)\.{1,2}(/|$)'
        and cleanup_path.value not like '%//%'
        and cleanup_path.value !~ '[[:cntrl:]]'
    )
  );

  delete from public.private_learning_data_reset_boundaries
  where user_id = current_user_id;

  delete from public.account_data_exports where user_id = current_user_id;
  update public.tester_invites set invited_by = null where invited_by = current_user_id;
  delete from auth.users where id = current_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'account_deletion_not_completed';
  end if;

  return pg_catalog.jsonb_build_object(
    'deletedAccountId', current_user_id,
    'cleanupJobId', cleanup_job_id
  );
end;
$$;

-- Permanent archived-goal deletion also removes durable learning-material
-- paths. A token minted just before staging promotion can still target that
-- durable path, so seed retained receipts before the legacy immediate-cleanup
-- job and before the learning item cascades away.
do $migration$
declare
  function_definition text;
  hardened_definition text;
  legacy_receipt_source text := $source$
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
$source$;
  retained_receipt_source text := $source$
  perform public.enqueue_legacy_private_storage_cleanup_receipt(
    current_user_id,
    'learning-materials',
    cleanup_path.value,
    pg_catalog.clock_timestamp() + interval '2 hours 10 minutes',
    null
  )
  from unnest(learning_paths) as cleanup_path(value)
  where cleanup_path.value is not null
    and char_length(cleanup_path.value) between 38 and 1024
    and cleanup_path.value like current_user_id::text || '/%';

  insert into public.account_deletion_cleanup_jobs (
    id,
    user_id,
    learning_material_paths,
    account_export_paths
  ) values (
    cleanup_job_id,
    current_user_id,
    array(
      select cleanup_path.value
      from unnest(learning_paths) as cleanup_path(value)
      where cleanup_path.value !~ '(^|/)\.{1,2}(/|$)'
        and cleanup_path.value not like '%//%'
        and cleanup_path.value !~ '[[:cntrl:]]'
    ),
    '{}'::text[]
  );
$source$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.delete_archived_learning_plan(jsonb)'::pg_catalog.regprocedure
  ) into function_definition;
  hardened_definition := pg_catalog.replace(
    function_definition,
    legacy_receipt_source,
    retained_receipt_source
  );
  if hardened_definition is not distinct from function_definition then
    raise exception 'delete_archived_learning_plan receipt boundary changed; retained sweep was not installed';
  end if;
  execute hardened_definition;
end;
$migration$;

-- Pending deletion jobs created before this migration also receive retained
-- final-sweep receipts before their legacy worker can confirm/delete the job.
do $$
declare
  job record;
  path text;
begin
  for job in select * from public.account_deletion_cleanup_jobs
  loop
    foreach path in array job.learning_material_paths
    loop
      if path is not null
        and char_length(path) between 38 and 1024
        and path like job.user_id::text || '/%' then
        perform public.enqueue_legacy_private_storage_cleanup_receipt(
          job.user_id,
          'learning-materials',
          path,
          pg_catalog.clock_timestamp() + interval '2 hours 10 minutes',
          null
        );
      end if;
    end loop;
    foreach path in array job.account_export_paths
    loop
      if path is not null
        and char_length(path) between 38 and 1024
        and path like job.user_id::text || '/%' then
        perform public.enqueue_legacy_private_storage_cleanup_receipt(
          job.user_id,
          'account-exports',
          path,
          pg_catalog.clock_timestamp() + interval '2 hours 10 minutes',
          null
        );
      end if;
    end loop;

    -- The retained receipt owns opaque exact keys. Keep the legacy job
    -- consumable by its older strict parser instead of poisoning every cron
    -- run forever after one historical malformed path.
    update public.account_deletion_cleanup_jobs
    set
      learning_material_paths = array(
        select cleanup_path.value
        from unnest(job.learning_material_paths) as cleanup_path(value)
        where cleanup_path.value is not null
          and cleanup_path.value !~ '(^|/)\.{1,2}(/|$)'
          and cleanup_path.value not like '%//%'
          and cleanup_path.value !~ '[[:cntrl:]]'
      ),
      account_export_paths = array(
        select cleanup_path.value
        from unnest(job.account_export_paths) as cleanup_path(value)
        where cleanup_path.value is not null
          and cleanup_path.value !~ '(^|/)\.{1,2}(/|$)'
          and cleanup_path.value not like '%//%'
          and cleanup_path.value !~ '[[:cntrl:]]'
      )
    where id = job.id;
  end loop;
end;
$$;

revoke all on function public.guard_material_upload_lifecycle_identity() from public, anon, authenticated;
revoke all on function public.capture_material_upload_delete_receipt() from public, anon, authenticated;
revoke all on function public.create_material_upload(jsonb) from public, anon;
revoke all on function public.claim_private_storage_cleanup_receipts(integer) from public, anon, authenticated;
revoke all on function public.confirm_private_storage_cleanup_receipt(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_private_storage_cleanup_receipt(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_material_upload_cleanup(uuid) from public, anon;
revoke all on function public.claim_expired_material_uploads(integer) from public, anon, authenticated;
revoke all on function public.confirm_material_upload_cleanup(uuid, uuid) from public, anon;
revoke all on function public.release_material_upload_cleanup(uuid, uuid) from public, anon;
revoke all on function public.reset_yova_learning_data() from public, anon;
revoke all on function public.delete_yova_account(uuid) from public, anon;

grant execute on function public.claim_private_storage_cleanup_receipts(integer) to service_role;
grant execute on function public.create_material_upload(jsonb) to authenticated;
grant execute on function public.confirm_private_storage_cleanup_receipt(uuid, uuid) to service_role;
grant execute on function public.release_private_storage_cleanup_receipt(uuid, uuid) to service_role;
grant execute on function public.claim_material_upload_cleanup(uuid) to authenticated;
grant execute on function public.claim_expired_material_uploads(integer) to service_role;
grant execute on function public.confirm_material_upload_cleanup(uuid, uuid) to authenticated, service_role;
grant execute on function public.release_material_upload_cleanup(uuid, uuid) to authenticated, service_role;
grant execute on function public.reset_yova_learning_data() to authenticated;
grant execute on function public.delete_yova_account(uuid) to authenticated;
