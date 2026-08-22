-- PHASE 3 ONLY: apply after the application release that stages both uploaded
-- files and external links through create_material_upload(jsonb). Migration
-- 007 intentionally keeps compatibility policies so old Vercel instances can
-- run during the database-first rollout window.

-- Authenticated staging creation and cancellation now go through the
-- advisory-locked, receipt-aware RPCs. Removing direct row writes prevents a
-- client from bypassing Reset ordering or exact-path cleanup.
drop policy if exists "material_uploads_owner_insert" on public.material_uploads;
drop policy if exists "material_uploads_owner_delete" on public.material_uploads;

-- A normal authenticated JWT can mint/upload only for one active exact
-- staging record. Previously the owner-prefix policy allowed arbitrary orphan
-- objects. Signed capabilities already minted before cancellation remain
-- covered by the retained 007 receipt and post-TTL final sweep.
drop policy if exists "learning_material_objects_owner_insert" on storage.objects;
drop policy if exists "learning_material_objects_owner_update" on storage.objects;
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
        and upload.expires_at > pg_catalog.clock_timestamp()
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

create policy "learning_material_objects_owner_insert" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'learning-materials'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.material_uploads as upload
    where upload.user_id = (select auth.uid())
      and upload.storage_path = name
      and upload.expires_at > pg_catalog.clock_timestamp()
      and upload.cleanup_claimed_at is null
  )
);

create policy "learning_material_objects_owner_update" on storage.objects
for update to authenticated
using (
  bucket_id = 'learning-materials'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.material_uploads as upload
    where upload.user_id = (select auth.uid())
      and upload.storage_path = name
      and upload.expires_at > pg_catalog.clock_timestamp()
      and upload.cleanup_claimed_at is null
  )
)
with check (
  bucket_id = 'learning-materials'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.material_uploads as upload
    where upload.user_id = (select auth.uid())
      and upload.storage_path = name
      and upload.expires_at > pg_catalog.clock_timestamp()
      and upload.cleanup_claimed_at is null
  )
);

-- The policy change is transactional, but a capability minted immediately
-- before commit can remain usable for two hours. Persist a conservative
-- closure boundary (including a ten-minute rollout/commit cushion), extend
-- every existing orphan receipt through the drain, and inventory again.
-- The 007 worker repeats discovery on every run, so an object materialized by
-- a late token after this migration is also quarantined and swept twice.
insert into public.private_storage_capability_boundaries (
  bucket_id,
  issuance_closed_at,
  discovery_required_until
) values (
  'learning-materials',
  pg_catalog.clock_timestamp() + interval '10 minutes',
  pg_catalog.clock_timestamp() + interval '2 hours 20 minutes'
)
on conflict (bucket_id) do update
set
  issuance_closed_at = greatest(
    public.private_storage_capability_boundaries.issuance_closed_at,
    excluded.issuance_closed_at
  ),
  discovery_required_until = greatest(
    public.private_storage_capability_boundaries.discovery_required_until,
    excluded.discovery_required_until
  );

update public.private_storage_cleanup_receipts as receipt
set
  final_sweep_after = greatest(
    receipt.final_sweep_after,
    (
      select boundary.discovery_required_until
      from public.private_storage_capability_boundaries as boundary
      where boundary.bucket_id = 'learning-materials'
    )
  ),
  initial_swept_at = null,
  cleanup_claimed_at = null,
  cleanup_token = null
where receipt.bucket_id = 'learning-materials';

select public.discover_orphaned_learning_material_objects(10000);
