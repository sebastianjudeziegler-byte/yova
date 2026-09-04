-- Bound authenticated database and Storage growth at the database boundary.
-- Application rate limits remain useful for friendly errors, but they are not
-- an authorization boundary: a signed-in client can call Supabase directly.

-- This migration changes several relations that live writers access in
-- different orders. Acquire the complete DDL set before the first schema
-- change, and never wait while holding only a subset: under traffic a partial
-- acquisition can deadlock a session/cache writer that already holds
-- plan_sessions and next needs plans (or a signup holding auth.users whose
-- profile trigger next needs profiles). NOWAIT makes a busy deploy fail fast
-- with lock_not_available; retrying during a quiet/drained window is safe and
-- cannot strand either the migration or an application transaction.
begin;

lock table
  public.plan_sessions,
  public.plans,
  public.learning_items,
  public.study_routes,
  public.session_attempts,
  public.learning_events,
  public.material_uploads,
  public.materials,
  public.material_chunks,
  public.profiles,
  public.learner_profiles,
  public.deadline_milestones,
  public.tutor_threads,
  public.tutor_messages,
  public.product_events,
  public.error_reports,
  public.support_requests,
  storage.objects,
  auth.users
in access exclusive mode nowait;

create table private.account_daily_write_usage_v1 (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_day date not null,
  write_kind text not null check (write_kind in (
    'material_upload',
    'material_mapping',
    'product_event',
    'error_report',
    'support_request',
    'tutor_exchange',
    'profile_save',
    'learning_state_growth',
    'plan_map_update',
    'deadline_milestone',
    'material_extraction'
  )),
  rows_used integer not null default 0 check (rows_used >= 0),
  bytes_used bigint not null default 0 check (bytes_used >= 0),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (user_id, usage_day, write_kind)
);

alter table private.account_daily_write_usage_v1 enable row level security;
revoke all on table private.account_daily_write_usage_v1
from public, anon, authenticated, service_role;

create or replace function private.consume_account_daily_write_quota_v1(
  requested_user_id uuid,
  requested_write_kind text,
  requested_rows integer,
  requested_bytes bigint,
  requested_row_limit integer,
  requested_byte_limit bigint
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  quota_consumed boolean := false;
begin
  if requested_user_id is null
    or requested_write_kind is null
    or requested_write_kind not in (
      'material_upload',
      'material_mapping',
      'product_event',
      'error_report',
      'support_request',
      'tutor_exchange',
      'profile_save',
      'learning_state_growth',
      'plan_map_update',
      'deadline_milestone',
      'material_extraction'
    )
    or requested_rows is null
    or requested_rows < 0
    or requested_bytes is null
    or requested_bytes < 0
    or (requested_rows = 0 and requested_bytes = 0)
    or requested_row_limit is null
    or requested_row_limit < 1
    or requested_byte_limit is null
    or requested_byte_limit < 1
    or requested_rows > requested_row_limit
    or requested_bytes > requested_byte_limit then
    raise exception using
      errcode = '22023',
      message = 'account_daily_write_quota_arguments_invalid';
  end if;

  if auth.role() = 'authenticated'
    and auth.uid() is distinct from requested_user_id then
    raise exception using
      errcode = '42501',
      message = 'account_daily_write_quota_identity_mismatch';
  end if;

  -- Eleven bounded categories need at most 88 rows per active account. Prune on
  -- the next write so a long-lived account never accumulates one ledger row
  -- per category for every day of its lifetime.
  delete from private.account_daily_write_usage_v1 as expired
  where expired.user_id = requested_user_id
    and expired.usage_day < (
      (pg_catalog.clock_timestamp() at time zone 'UTC')::date - 7
    );

  insert into private.account_daily_write_usage_v1 as usage (
    user_id,
    usage_day,
    write_kind,
    rows_used,
    bytes_used,
    updated_at
  ) values (
    requested_user_id,
    (pg_catalog.clock_timestamp() at time zone 'UTC')::date,
    requested_write_kind,
    requested_rows,
    requested_bytes,
    pg_catalog.clock_timestamp()
  )
  on conflict (user_id, usage_day, write_kind) do update
  set
    rows_used = usage.rows_used + excluded.rows_used,
    bytes_used = usage.bytes_used + excluded.bytes_used,
    updated_at = pg_catalog.clock_timestamp()
  where usage.rows_used <= requested_row_limit - excluded.rows_used
    and usage.bytes_used <= requested_byte_limit - excluded.bytes_used
  returning true into quota_consumed;

  if quota_consumed is not true then
    raise exception using
      errcode = '54000',
      message = requested_write_kind || '_daily_quota_exceeded';
  end if;
end;
$$;

revoke all on function private.consume_account_daily_write_quota_v1(
  uuid, text, integer, bigint, integer, bigint
) from public, anon, authenticated, service_role;

-- Keep staged-material creation behind its existing receipt-aware reset
-- boundary, then add serialized active, total-account and daily quotas. Renaming
-- preserves the independently audited implementation and makes rollout
-- fail closed if the expected function is not present.
alter function public.create_material_upload(jsonb) security definer;
alter function public.create_material_upload(jsonb)
rename to create_material_upload_without_account_quotas_v1;

revoke all on function public.create_material_upload_without_account_quotas_v1(jsonb)
from public, anon, authenticated, service_role;

create or replace function public.create_material_upload(payload jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_material_id uuid;
  requested_byte_size bigint;
  staged_rows integer;
  staged_bytes bigint;
  total_material_rows integer;
  total_material_bytes bigint;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if pg_catalog.jsonb_typeof(payload) is distinct from 'object'
    or pg_catalog.octet_length(payload::text) > 1500000
    or coalesce(payload ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or pg_catalog.char_length(coalesce(payload ->> 'filename', '')) not between 1 and 180
    or coalesce(payload ->> 'filename', '') ~ '[[:cntrl:]]'
    or coalesce(payload ->> 'storagePath', '') = ''
    or coalesce(payload ->> 'mimeType', '') not in ('application/pdf', 'text/plain', 'text/markdown')
    or coalesce(payload ->> 'byteSize', '') !~ '^[0-9]{1,8}$'
    or coalesce(payload ->> 'processingStatus', 'processing') <> 'processing'
    or pg_catalog.jsonb_typeof(coalesce(payload -> 'metadata', '{}'::jsonb)) is distinct from 'object'
    or pg_catalog.octet_length(coalesce(payload -> 'metadata', '{}'::jsonb)::text) > 16384
    or (
      payload ->> 'extractedText' is not null
      and (
        pg_catalog.char_length(payload ->> 'extractedText') > 288000
        or pg_catalog.octet_length(payload ->> 'extractedText') > 1152000
      )
    ) then
    raise exception using errcode = '22023', message = 'material_upload_payload_invalid';
  end if;

  requested_material_id := (payload ->> 'id')::uuid;
  requested_byte_size := (payload ->> 'byteSize')::bigint;
  if requested_byte_size not between 1 and 10485760 then
    raise exception using errcode = '22023', message = 'material_upload_payload_invalid';
  end if;
  if payload ->> 'storagePath' !~ (
      '^' || current_user_id::text || '/' || requested_material_id::text || '/[^/]{1,255}$'
    )
    or payload ->> 'storagePath' ~ '/\.{1,2}$'
    or payload ->> 'storagePath' ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'material_upload_path_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  select pg_catalog.count(*)::integer, coalesce(pg_catalog.sum(upload.byte_size), 0)::bigint
  into staged_rows, staged_bytes
  from public.material_uploads as upload
  where upload.user_id = current_user_id;

  if staged_rows >= 20
    or staged_bytes > 104857600 - requested_byte_size then
    raise exception using errcode = '54000', message = 'material_upload_active_quota_exceeded';
  end if;

  select pg_catalog.count(*)::integer, coalesce(pg_catalog.sum(material.byte_size), 0)::bigint
  into total_material_rows, total_material_bytes
  from (
    select upload.byte_size
    from public.material_uploads as upload
    where upload.user_id = current_user_id
    union all
    select durable.byte_size
    from public.materials as durable
    where durable.user_id = current_user_id
  ) as material;

  if total_material_rows >= 250
    or total_material_bytes > 1073741824 - requested_byte_size then
    raise exception using errcode = '54000', message = 'material_account_storage_quota_exceeded';
  end if;

  perform private.consume_account_daily_write_quota_v1(
    current_user_id,
    'material_upload',
    1,
    requested_byte_size,
    40,
    209715200
  );

  return public.create_material_upload_without_account_quotas_v1(payload);
end;
$$;

revoke all on function public.create_material_upload(jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.create_material_upload(jsonb) to authenticated;

-- These NOT VALID constraints preserve a safe additive rollout if historical
-- alpha data needs separate cleanup. PostgreSQL still enforces them for every
-- new row and every future update.
alter table public.material_uploads
  add constraint material_uploads_filename_bounded_v1
    check (pg_catalog.char_length(filename) between 1 and 180 and filename !~ '[[:cntrl:]]') not valid,
  add constraint material_uploads_metadata_bounded_v1
    check (
      pg_catalog.jsonb_typeof(metadata) = 'object'
      and pg_catalog.octet_length(metadata::text) <= 524288
    ) not valid,
  add constraint material_uploads_extracted_bytes_bounded_v1
    check (extracted_text is null or pg_catalog.octet_length(extracted_text) <= 1152000) not valid;

alter table public.materials
  add constraint materials_filename_bounded_v1
    check (pg_catalog.char_length(filename) between 1 and 180 and filename !~ '[[:cntrl:]]') not valid,
  add constraint materials_byte_size_bounded_v1
    check (byte_size between 1 and 10485760) not valid,
  add constraint materials_metadata_bounded_v1
    check (
      pg_catalog.jsonb_typeof(metadata) = 'object'
      and pg_catalog.octet_length(metadata::text) <= 524288
    ) not valid,
  add constraint materials_extracted_bytes_bounded_v1
    check (extracted_text is null or pg_catalog.octet_length(extracted_text) <= 1152000) not valid;

-- The mapper is the only supported chunk writer. Make its established,
-- ownership-checking body privileged before closing direct table DML, then
-- put strict JSON/chunk and daily-write bounds in a stable public wrapper.
alter function public.persist_material_mapping_result(text, uuid, jsonb, jsonb, jsonb)
security definer;
alter function public.persist_material_mapping_result(text, uuid, jsonb, jsonb, jsonb)
rename to persist_material_mapping_result_without_bounds_v1;

revoke all on function public.persist_material_mapping_result_without_bounds_v1(
  text, uuid, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.persist_material_mapping_result(
  requested_material_table text,
  requested_material_id uuid,
  requested_metadata_patch jsonb,
  requested_chunks jsonb,
  requested_observation jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_chunk_count integer;
  requested_payload_bytes bigint;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;
  if requested_material_id is null
    or requested_material_table not in ('material_uploads', 'materials')
    or pg_catalog.jsonb_typeof(requested_metadata_patch) is distinct from 'object'
    or pg_catalog.jsonb_typeof(requested_chunks) is distinct from 'array'
    or pg_catalog.jsonb_typeof(requested_observation) is distinct from 'object'
    or coalesce(requested_metadata_patch ->> 'mappingStatus', '') not in ('ready', 'failed')
    or pg_catalog.octet_length(requested_metadata_patch::text) > 262144
    or pg_catalog.octet_length(requested_chunks::text) > 1500000
    or pg_catalog.octet_length(requested_observation::text) > 2048 then
    raise exception using errcode = '22023', message = 'material_mapping_payload_invalid';
  end if;

  requested_chunk_count := pg_catalog.jsonb_array_length(requested_chunks);
  if requested_chunk_count > 48
    or (requested_metadata_patch ->> 'mappingStatus' = 'ready' and requested_chunk_count < 1)
    or (requested_metadata_patch ->> 'mappingStatus' = 'failed' and requested_chunk_count <> 0)
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(requested_chunks) as chunk(value)
      where pg_catalog.jsonb_typeof(chunk.value) is distinct from 'object'
        or coalesce(chunk.value ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(chunk.value ->> 'chunkIndex', '') !~ '^(0|[1-9]|[1-3][0-9]|4[0-7])$'
        or coalesce(chunk.value ->> 'charStart', '') !~ '^(0|[1-9][0-9]{0,5})$'
        or coalesce(chunk.value ->> 'charEnd', '') !~ '^[1-9][0-9]{0,5}$'
        or (chunk.value ->> 'charEnd')::integer > 288000
        or (chunk.value ->> 'charEnd')::integer <= (chunk.value ->> 'charStart')::integer
        or pg_catalog.char_length(coalesce(chunk.value ->> 'locationLabel', '')) not between 1 and 120
        or coalesce(chunk.value ->> 'sectionRole', '') not in ('content_source', 'scope_outline')
        or pg_catalog.char_length(coalesce(chunk.value ->> 'chunkText', '')) not between 1 and 7000
        or pg_catalog.octet_length(coalesce(chunk.value ->> 'chunkText', '')) > 28000
    )
    or (
      select pg_catalog.count(distinct chunk.value ->> 'id')
      from pg_catalog.jsonb_array_elements(requested_chunks) as chunk(value)
    ) <> requested_chunk_count
    or (
      select pg_catalog.count(distinct (chunk.value ->> 'chunkIndex')::integer)
      from pg_catalog.jsonb_array_elements(requested_chunks) as chunk(value)
    ) <> requested_chunk_count then
    raise exception using errcode = '22023', message = 'material_mapping_chunks_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  requested_payload_bytes :=
    pg_catalog.octet_length(requested_metadata_patch::text)::bigint
    + pg_catalog.octet_length(requested_chunks::text)::bigint
    + pg_catalog.octet_length(requested_observation::text)::bigint;
  perform private.consume_account_daily_write_quota_v1(
    current_user_id,
    'material_mapping',
    1,
    requested_payload_bytes,
    120,
    67108864
  );

  return public.persist_material_mapping_result_without_bounds_v1(
    requested_material_table,
    requested_material_id,
    requested_metadata_patch,
    requested_chunks,
    requested_observation
  );
end;
$$;

revoke all on function public.persist_material_mapping_result(
  text, uuid, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.persist_material_mapping_result(
  text, uuid, jsonb, jsonb, jsonb
) to authenticated;

drop policy if exists "material_chunks_owner_all" on public.material_chunks;
drop policy if exists "material_chunks_owner_select" on public.material_chunks;
create policy "material_chunks_owner_select" on public.material_chunks
for select to authenticated
using ((select auth.uid()) = user_id);

revoke insert, update, delete on table public.material_chunks
from public, anon, authenticated;
grant select on table public.material_chunks to authenticated;

-- Durable materials are promotions performed by audited SECURITY DEFINER
-- transactions. Direct writes could otherwise mint a large fake durable row
-- from a tiny staging reservation.
drop policy if exists "materials_owner_all" on public.materials;
drop policy if exists "materials_owner_select" on public.materials;
create policy "materials_owner_select" on public.materials
for select to authenticated
using ((select auth.uid()) = user_id);

revoke insert, update, delete on table public.materials
from public, anon, authenticated;
grant select on table public.materials to authenticated;

-- The extraction route still needs to save bounded text before mapping. Keep
-- only those two owner-scoped columns writable; staging creation, lifecycle,
-- status changes and deletion remain RPC-only.
revoke insert, update, delete on table public.material_uploads
from public, anon, authenticated;
grant select on table public.material_uploads to authenticated;
grant update (extracted_text, metadata) on table public.material_uploads
to authenticated;

create or replace function public.guard_material_upload_extraction_update_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_bytes bigint;
begin
  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;
  if current_user_id is null
    or old.user_id is distinct from current_user_id
    or new.user_id is distinct from old.user_id
    or new.id is distinct from old.id then
    raise exception using errcode = '42501', message = 'material_extraction_identity_mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );
  requested_bytes :=
    pg_catalog.octet_length(coalesce(new.extracted_text, ''))::bigint
    + pg_catalog.octet_length(new.metadata::text)::bigint;
  perform private.consume_account_daily_write_quota_v1(
    current_user_id,
    'material_extraction',
    1,
    requested_bytes,
    40,
    50331648
  );
  return new;
end;
$$;

revoke all on function public.guard_material_upload_extraction_update_v1()
from public, anon, authenticated, service_role;

drop trigger if exists guard_material_upload_extraction_update_v1
on public.material_uploads;
create trigger guard_material_upload_extraction_update_v1
before update of extracted_text, metadata on public.material_uploads
for each row execute function public.guard_material_upload_extraction_update_v1();

-- Same-origin partial replacement and cancellation now use the service role
-- only after an owner-scoped staging lookup. Browser credentials retain the
-- exact, non-upsert INSERT and never receive replayable overwrite/delete DML.
drop policy if exists "learning_material_objects_owner_update" on storage.objects;
drop policy if exists "learning_material_objects_owner_delete" on storage.objects;

-- A learner performs the immediate sweep after cancellation, but only the
-- service worker can attest the final post-signed-capability sweep. Never let
-- an authenticated caller erase the durable receipt after final_sweep_after:
-- they could retain the object and permanently hide it from cleanup.
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
  effective_now timestamptz := pg_catalog.clock_timestamp();
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then
    return false;
  end if;

  select * into receipt
  from public.private_storage_cleanup_receipts
  where source_material_id = requested_material_id
    and cleanup_token = requested_cleanup_token
    and cleanup_claimed_at is not null
  for update;
  if not found then return false; end if;
  if auth.role() = 'authenticated'
    and current_user_id is distinct from receipt.user_id then
    return false;
  end if;

  if receipt.final_sweep_after <= effective_now then
    if auth.role() is distinct from 'service_role' then
      return false;
    end if;
    delete from public.private_storage_cleanup_receipts
    where id = receipt.id and cleanup_token = requested_cleanup_token;
  else
    update public.private_storage_cleanup_receipts
    set
      initial_swept_at = effective_now,
      cleanup_claimed_at = null,
      cleanup_token = null
    where id = receipt.id and cleanup_token = requested_cleanup_token;
  end if;
  return found;
end;
$$;

revoke all on function public.confirm_material_upload_cleanup(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.confirm_material_upload_cleanup(uuid, uuid)
to authenticated, service_role;

-- Profiles and plans were still protected only by owner RLS. RLS prevented
-- cross-account access, but any signed-in client could bypass the application
-- writers and submit arbitrarily large text/JSON or mint unlimited plan rows.
-- Preserve reads, move writes behind the established SECURITY DEFINER RPCs,
-- and enforce storage bounds at the tables as a final backstop.
alter table public.profiles
  add constraint profiles_display_name_bounded_v1
    check (
      pg_catalog.char_length(display_name) <= 80
      and pg_catalog.octet_length(display_name) <= 320
      and display_name !~ '[[:cntrl:]]'
    ) not valid;

alter table public.learner_profiles
  add constraint learner_profiles_text_bounded_v1
    check (
      pg_catalog.char_length(coalesce(common_blocker, '')) <= 240
      and pg_catalog.char_length(coalesce(guidance_preference, '')) <= 240
      and pg_catalog.char_length(coalesce(explanation_preference, '')) <= 240
      and pg_catalog.char_length(coalesce(focus_frequency, '')) <= 240
      and pg_catalog.char_length(coalesce(starting_pattern, '')) <= 240
      and pg_catalog.char_length(coalesce(energy_window, '')) <= 240
      and pg_catalog.char_length(coalesce(primary_improvement_goal, '')) <= 240
      and pg_catalog.octet_length(coalesce(additional_context, '')) <= 65536
    ) not valid;

alter table public.learning_items
  add constraint learning_items_text_bounded_v1
    check (
      pg_catalog.char_length(title) between 1 and 180
      and pg_catalog.octet_length(title) <= 720
      and pg_catalog.char_length(topic) between 1 and 600
      and pg_catalog.octet_length(topic) <= 2400
    ) not valid;

alter table public.plans
  add constraint plans_payload_bounded_v1
    check (
      pg_catalog.char_length(rationale) between 1 and 4000
      and pg_catalog.octet_length(rationale) <= 16000
      and pg_catalog.jsonb_typeof(generation_inputs) = 'object'
      and pg_catalog.octet_length(generation_inputs::text) <= 1048576
      and pg_catalog.jsonb_typeof(knowledge_map) = 'object'
      and pg_catalog.octet_length(knowledge_map::text) <= 2097152
    ) not valid;

-- Retain the mature learner-profile transaction, but put exact payload and
-- daily limits outside it. The renamed body already validates account
-- identity and serializes with reset; the outer lock also makes quota order
-- deterministic before that body touches profile and session rows.
alter function public.save_learner_profile(jsonb) security definer;
alter function public.save_learner_profile(jsonb)
rename to save_learner_profile_without_write_quotas_v1;

revoke all on function public.save_learner_profile_without_write_quotas_v1(jsonb)
from public, anon, authenticated, service_role;

create or replace function public.save_learner_profile(payload jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  expected_account_id uuid;
  requested_bytes bigint;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;
  if pg_catalog.jsonb_typeof(payload) is distinct from 'object'
    or pg_catalog.octet_length(payload::text) > 65536
    or coalesce(payload ->> 'expectedAccountId', '')
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or pg_catalog.char_length(coalesce(payload ->> 'displayName', '')) > 80
    or pg_catalog.octet_length(coalesce(payload ->> 'displayName', '')) > 320
    or coalesce(payload ->> 'displayName', '') ~ '[[:cntrl:]]'
    or pg_catalog.char_length(coalesce(payload ->> 'commonBlocker', '')) > 240
    or pg_catalog.char_length(coalesce(payload ->> 'guidancePreference', '')) > 240
    or pg_catalog.char_length(coalesce(payload ->> 'explanationPreference', '')) > 240
    or pg_catalog.char_length(coalesce(payload ->> 'focusFrequency', '')) > 240
    or pg_catalog.char_length(coalesce(payload ->> 'startingPattern', '')) > 240
    or pg_catalog.char_length(coalesce(payload ->> 'energyWindow', '')) > 240
    or pg_catalog.char_length(coalesce(payload ->> 'primaryImprovementGoal', '')) > 240
    or pg_catalog.octet_length(coalesce(payload ->> 'additionalContext', '')) > 65536
    or (
      payload ->> 'preferredSessionMin' is not null
      and coalesce(payload ->> 'preferredSessionMin', '') !~ '^[0-9]{1,3}$'
    )
    or (
      payload ->> 'preferredSessionMax' is not null
      and coalesce(payload ->> 'preferredSessionMax', '') !~ '^[0-9]{1,3}$'
    ) then
    raise exception using errcode = '22023', message = 'learner_profile_payload_invalid';
  end if;

  expected_account_id := (payload ->> 'expectedAccountId')::uuid;
  if expected_account_id is distinct from current_user_id
    or (
      ((payload ->> 'preferredSessionMin') is null)
      <> ((payload ->> 'preferredSessionMax') is null)
    )
    or (
      payload ->> 'preferredSessionMin' is not null
      and (payload ->> 'preferredSessionMin')::integer not between 5 and 180
    )
    or (
      payload ->> 'preferredSessionMax' is not null
      and (payload ->> 'preferredSessionMax')::integer not between 5 and 180
    )
    or (
      payload ->> 'preferredSessionMin' is not null
      and payload ->> 'preferredSessionMax' is not null
      and
      (payload ->> 'preferredSessionMin')::integer
      > (payload ->> 'preferredSessionMax')::integer
    ) then
    raise exception using errcode = '22023', message = 'learner_profile_payload_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );
  requested_bytes := pg_catalog.octet_length(payload::text)::bigint;
  perform private.consume_account_daily_write_quota_v1(
    current_user_id,
    'profile_save',
    1,
    requested_bytes,
    50,
    2097152
  );

  perform public.save_learner_profile_without_write_quotas_v1(payload);
end;
$$;

revoke all on function public.save_learner_profile(jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_learner_profile(jsonb) to authenticated;

-- Core learning RPCs are ownership checked and individually shape bounded,
-- but several intentionally append evidence, attempts, replacement sessions
-- or route revisions. These triggers add a hard lifetime row/byte ceiling and
-- one transactional daily growth ceiling underneath every such entry point.
create or replace function public.guard_bounded_learning_record_insert_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_bytes bigint;
  existing_rows integer;
  existing_bytes bigint;
begin
  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;
  if current_user_id is null or new.user_id is distinct from current_user_id then
    raise exception using errcode = '42501', message = 'learning_record_identity_mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );
  requested_bytes := pg_catalog.octet_length(pg_catalog.to_jsonb(new)::text)::bigint;

  if tg_table_schema = 'public' and tg_table_name = 'learning_items' then
    select
      pg_catalog.count(*)::integer,
      coalesce(pg_catalog.sum(
        pg_catalog.octet_length(pg_catalog.to_jsonb(item)::text)
      ), 0)::bigint
    into existing_rows, existing_bytes
    from public.learning_items as item
    where item.user_id = current_user_id;
    if existing_rows >= 100 or existing_bytes > 8388608 - requested_bytes then
      raise exception using errcode = '54000', message = 'learning_items_account_quota_exceeded';
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'plans' then
    select
      pg_catalog.count(*)::integer,
      coalesce(pg_catalog.sum(
        pg_catalog.octet_length(pg_catalog.to_jsonb(plan)::text)
      ), 0)::bigint
    into existing_rows, existing_bytes
    from public.plans as plan
    where plan.user_id = current_user_id;
    if existing_rows >= 100 or existing_bytes > 134217728 - requested_bytes then
      raise exception using errcode = '54000', message = 'plans_account_quota_exceeded';
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'plan_sessions' then
    select
      pg_catalog.count(*)::integer,
      coalesce(pg_catalog.sum(
        pg_catalog.octet_length(pg_catalog.to_jsonb(session)::text)
      ), 0)::bigint
    into existing_rows, existing_bytes
    from public.plan_sessions as session
    where session.user_id = current_user_id;
    if existing_rows >= 3000 or existing_bytes > 134217728 - requested_bytes then
      raise exception using errcode = '54000', message = 'plan_sessions_account_quota_exceeded';
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'study_routes' then
    select
      pg_catalog.count(*)::integer,
      coalesce(pg_catalog.sum(
        pg_catalog.octet_length(pg_catalog.to_jsonb(route)::text)
      ), 0)::bigint
    into existing_rows, existing_bytes
    from public.study_routes as route
    where route.user_id = current_user_id;
    if existing_rows >= 6000 or existing_bytes > 268435456 - requested_bytes then
      raise exception using errcode = '54000', message = 'study_routes_account_quota_exceeded';
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'session_attempts' then
    select
      pg_catalog.count(*)::integer,
      coalesce(pg_catalog.sum(
        pg_catalog.octet_length(pg_catalog.to_jsonb(attempt)::text)
      ), 0)::bigint
    into existing_rows, existing_bytes
    from public.session_attempts as attempt
    where attempt.user_id = current_user_id;
    if existing_rows >= 5000 or existing_bytes > 134217728 - requested_bytes then
      raise exception using errcode = '54000', message = 'session_attempts_account_quota_exceeded';
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'learning_events' then
    select
      pg_catalog.count(*)::integer,
      coalesce(pg_catalog.sum(
        pg_catalog.octet_length(pg_catalog.to_jsonb(event)::text)
      ), 0)::bigint
    into existing_rows, existing_bytes
    from public.learning_events as event
    where event.user_id = current_user_id;
    if existing_rows >= 10000 or existing_bytes > 67108864 - requested_bytes then
      raise exception using errcode = '54000', message = 'learning_events_account_quota_exceeded';
    end if;
  else
    raise exception using errcode = '55000', message = 'learning_record_trigger_table_invalid';
  end if;

  perform private.consume_account_daily_write_quota_v1(
    current_user_id,
    'learning_state_growth',
    1,
    requested_bytes,
    500,
    67108864
  );
  return new;
end;
$$;

revoke all on function public.guard_bounded_learning_record_insert_v1()
from public, anon, authenticated, service_role;

drop trigger if exists guard_bounded_learning_item_insert_v1 on public.learning_items;
create trigger guard_bounded_learning_item_insert_v1
before insert on public.learning_items
for each row execute function public.guard_bounded_learning_record_insert_v1();

drop trigger if exists guard_bounded_plan_insert_v1 on public.plans;
create trigger guard_bounded_plan_insert_v1
before insert on public.plans
for each row execute function public.guard_bounded_learning_record_insert_v1();

drop trigger if exists guard_bounded_plan_session_insert_v1 on public.plan_sessions;
create trigger guard_bounded_plan_session_insert_v1
before insert on public.plan_sessions
for each row execute function public.guard_bounded_learning_record_insert_v1();

drop trigger if exists guard_bounded_study_route_insert_v1 on public.study_routes;
create trigger guard_bounded_study_route_insert_v1
before insert on public.study_routes
for each row execute function public.guard_bounded_learning_record_insert_v1();

drop trigger if exists guard_bounded_session_attempt_insert_v1 on public.session_attempts;
create trigger guard_bounded_session_attempt_insert_v1
before insert on public.session_attempts
for each row execute function public.guard_bounded_learning_record_insert_v1();

drop trigger if exists guard_bounded_learning_event_insert_v1 on public.learning_events;
create trigger guard_bounded_learning_event_insert_v1
before insert on public.learning_events
for each row execute function public.guard_bounded_learning_record_insert_v1();

-- Placement evidence is the one current route that updated plans directly.
-- Preserve that feature through a narrow owner-checked JSON writer before
-- revoking the broad table UPDATE privilege.
create or replace function public.update_plan_diagnostic_knowledge_map_v1(
  requested_plan_id uuid,
  requested_knowledge_map jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_topic_count integer;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;
  if requested_plan_id is null
    or pg_catalog.jsonb_typeof(requested_knowledge_map) is distinct from 'object'
    or pg_catalog.octet_length(requested_knowledge_map::text) > 2097152
    or requested_knowledge_map -> 'version' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(requested_knowledge_map -> 'scopeJudgment')
      is distinct from 'object'
    or pg_catalog.jsonb_typeof(requested_knowledge_map -> 'topics')
      is distinct from 'array'
    or pg_catalog.jsonb_typeof(requested_knowledge_map -> 'placementCheck')
      is distinct from 'object' then
    raise exception using errcode = '22023', message = 'plan_diagnostic_map_invalid';
  end if;

  requested_topic_count := pg_catalog.jsonb_array_length(
    requested_knowledge_map -> 'topics'
  );
  if requested_topic_count not between 1 and 40
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        requested_knowledge_map -> 'topics'
      ) as topic(value)
      where pg_catalog.jsonb_typeof(topic.value) is distinct from 'object'
        or coalesce(topic.value ->> 'id', '')
          !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or pg_catalog.char_length(coalesce(topic.value ->> 'title', ''))
          not between 2 and 140
        or pg_catalog.char_length(coalesce(topic.value ->> 'description', ''))
          not between 8 and 400
        or coalesce(topic.value ->> 'status', '')
          not in ('not_started', 'taught', 'evidenced', 'secure')
        or coalesce(topic.value ->> 'origin', '')
          not in ('material', 'ai_generated')
        or case
          when pg_catalog.jsonb_typeof(topic.value -> 'subtopics') = 'array'
            then pg_catalog.jsonb_array_length(topic.value -> 'subtopics') > 12
          else true
        end
        or case
          when pg_catalog.jsonb_typeof(topic.value -> 'prerequisiteTopicIds') = 'array'
            then pg_catalog.jsonb_array_length(topic.value -> 'prerequisiteTopicIds') > 12
          else true
        end
        or case
          when pg_catalog.jsonb_typeof(topic.value -> 'sourceReferences') = 'array'
            then pg_catalog.jsonb_array_length(topic.value -> 'sourceReferences') > 40
          else true
        end
    ) then
    raise exception using errcode = '22023', message = 'plan_diagnostic_map_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );
  perform plan.id
  from public.plans as plan
  where plan.id = requested_plan_id
    and plan.user_id = current_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'plan_diagnostic_plan_not_found';
  end if;

  update public.plans as plan
  set knowledge_map = requested_knowledge_map
  where plan.id = requested_plan_id
    and plan.user_id = current_user_id;
  return true;
end;
$$;

revoke all on function public.update_plan_diagnostic_knowledge_map_v1(uuid, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.update_plan_diagnostic_knowledge_map_v1(uuid, jsonb)
to authenticated;

create or replace function public.guard_plan_knowledge_map_update_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_bytes bigint;
begin
  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;
  if current_user_id is null
    or old.user_id is distinct from current_user_id
    or new.user_id is distinct from old.user_id
    or new.id is distinct from old.id then
    raise exception using errcode = '42501', message = 'plan_map_update_identity_mismatch';
  end if;
  if pg_catalog.jsonb_typeof(new.knowledge_map) is distinct from 'object'
    or pg_catalog.octet_length(new.knowledge_map::text) > 2097152
    or new.knowledge_map -> 'version' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(new.knowledge_map -> 'topics')
      is distinct from 'array' then
    raise exception using errcode = '22023', message = 'plan_map_update_invalid';
  end if;
  if pg_catalog.jsonb_array_length(new.knowledge_map -> 'topics') > 40 then
    raise exception using errcode = '22023', message = 'plan_map_update_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );
  requested_bytes := pg_catalog.octet_length(new.knowledge_map::text)::bigint;
  perform private.consume_account_daily_write_quota_v1(
    current_user_id,
    'plan_map_update',
    1,
    requested_bytes,
    200,
    67108864
  );
  return new;
end;
$$;

revoke all on function public.guard_plan_knowledge_map_update_v1()
from public, anon, authenticated, service_role;

drop trigger if exists guard_plan_knowledge_map_update_v1 on public.plans;
create trigger guard_plan_knowledge_map_update_v1
before update of knowledge_map on public.plans
for each row execute function public.guard_plan_knowledge_map_update_v1();

drop policy if exists "profiles_owner_all" on public.profiles;
drop policy if exists "profiles_owner_select" on public.profiles;
create policy "profiles_owner_select" on public.profiles
for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "learner_profiles_owner_all" on public.learner_profiles;
drop policy if exists "learner_profiles_owner_select" on public.learner_profiles;
create policy "learner_profiles_owner_select" on public.learner_profiles
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "learning_items_owner_all" on public.learning_items;
drop policy if exists "learning_items_owner_select" on public.learning_items;
create policy "learning_items_owner_select" on public.learning_items
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "plans_owner_all" on public.plans;
drop policy if exists "plans_owner_select" on public.plans;
create policy "plans_owner_select" on public.plans
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "plans_owner_knowledge_map_update" on public.plans;
create policy "plans_owner_knowledge_map_update" on public.plans
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke insert, update, delete on table
  public.profiles,
  public.learner_profiles,
  public.learning_items,
  public.plans
from public, anon, authenticated;
grant select on table
  public.profiles,
  public.learner_profiles,
  public.learning_items,
  public.plans
to authenticated;

-- One bounded column remains during the coordinated DB-first rollout so the
-- previously deployed diagnostic route keeps working until the new RPC caller
-- is live. Every old or new write still passes the trigger above.
grant update (knowledge_map) on table public.plans to authenticated;

-- Milestones intentionally remain direct PostgREST CRUD for the small
-- Calendar route. A per-row trigger makes that surface safe: immutable owner
-- fields, an account cap, and an atomic mutation/byte allowance apply to
-- growth-capable INSERT/UPDATE calls. Owner DELETE stays unmetered so privacy
-- reset and account-deletion RPCs cannot be blocked by a spent daily quota.
create or replace function public.guard_deadline_milestone_write_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_user_id uuid;
  requested_bytes bigint;
  existing_rows integer;
begin
  if auth.role() is distinct from 'authenticated' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  requested_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  if current_user_id is null or requested_user_id is distinct from current_user_id then
    raise exception using errcode = '42501', message = 'deadline_milestone_identity_mismatch';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  if tg_op = 'INSERT' then
    select pg_catalog.count(*)::integer
    into existing_rows
    from public.deadline_milestones as milestone
    where milestone.user_id = current_user_id;
    if existing_rows >= 100 then
      raise exception using errcode = '54000', message = 'deadline_milestone_account_quota_exceeded';
    end if;
    new.created_at := pg_catalog.clock_timestamp();
    new.updated_at := new.created_at;
    requested_bytes := pg_catalog.octet_length(pg_catalog.to_jsonb(new)::text)::bigint;
  elsif tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id then
      raise exception using errcode = '42501', message = 'deadline_milestone_identity_mismatch';
    end if;
    new.created_at := old.created_at;
    requested_bytes := pg_catalog.octet_length(pg_catalog.to_jsonb(new)::text)::bigint;
  else
    raise exception using errcode = '55000', message = 'deadline_milestone_trigger_operation_invalid';
  end if;

  perform private.consume_account_daily_write_quota_v1(
    current_user_id,
    'deadline_milestone',
    1,
    requested_bytes,
    100,
    2097152
  );
  return new;
end;
$$;

revoke all on function public.guard_deadline_milestone_write_v1()
from public, anon, authenticated, service_role;

drop trigger if exists guard_bounded_deadline_milestone_write_v1
on public.deadline_milestones;
create trigger guard_bounded_deadline_milestone_write_v1
before insert or update or delete on public.deadline_milestones
for each row execute function public.guard_deadline_milestone_write_v1();

grant select, insert, update, delete on table public.deadline_milestones
to authenticated;

-- Ask YOVA already has one atomic persistence RPC. Elevate that established
-- ownership-checked body, close direct writes, and add account/day/lifetime
-- bounds without changing the application call contract.
alter function public.save_tutor_exchange(jsonb) security definer;
alter function public.save_tutor_exchange(jsonb)
rename to save_tutor_exchange_without_account_quotas_v1;

revoke all on function public.save_tutor_exchange_without_account_quotas_v1(jsonb)
from public, anon, authenticated, service_role;

create or replace function public.save_tutor_exchange(payload jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_thread_id uuid;
  requested_user_message_id uuid;
  requested_assistant_message_id uuid;
  new_thread_count integer := 0;
  new_message_count integer := 0;
  new_message_bytes bigint := 0;
  existing_thread_count integer;
  existing_message_count integer;
  existing_message_bytes bigint;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;
  if pg_catalog.jsonb_typeof(payload) is distinct from 'object'
    or pg_catalog.octet_length(payload::text) > 100000
    or coalesce(payload ->> 'threadId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(payload ->> 'userMessageId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(payload ->> 'assistantMessageId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (
      nullif(payload ->> 'learningItemId', '') is not null
      and payload ->> 'learningItemId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    or pg_catalog.char_length(coalesce(payload ->> 'title', 'Ask YOVA')) not between 1 and 500
    or pg_catalog.char_length(coalesce(payload ->> 'userMessage', '')) not between 1 and 12000
    or pg_catalog.char_length(coalesce(payload ->> 'assistantMessage', '')) not between 1 and 12000
    or pg_catalog.char_length(coalesce(payload ->> 'model', '')) > 120
    or pg_catalog.char_length(coalesce(payload ->> 'responseId', '')) > 255 then
    raise exception using errcode = '22023', message = 'tutor_exchange_payload_invalid';
  end if;

  requested_thread_id := (payload ->> 'threadId')::uuid;
  requested_user_message_id := (payload ->> 'userMessageId')::uuid;
  requested_assistant_message_id := (payload ->> 'assistantMessageId')::uuid;
  if requested_user_message_id = requested_assistant_message_id then
    raise exception using errcode = '22023', message = 'tutor_exchange_message_identity_conflict';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  if not exists (
    select 1 from public.tutor_threads as thread
    where thread.id = requested_thread_id and thread.user_id = current_user_id
  ) then
    new_thread_count := 1;
  end if;
  if not exists (
    select 1 from public.tutor_messages as message
    where message.id = requested_user_message_id and message.user_id = current_user_id
  ) then
    new_message_count := new_message_count + 1;
    new_message_bytes := new_message_bytes + pg_catalog.octet_length(payload ->> 'userMessage');
  end if;
  if not exists (
    select 1 from public.tutor_messages as message
    where message.id = requested_assistant_message_id and message.user_id = current_user_id
  ) then
    new_message_count := new_message_count + 1;
    new_message_bytes := new_message_bytes + pg_catalog.octet_length(payload ->> 'assistantMessage');
  end if;

  select pg_catalog.count(*)::integer
  into existing_thread_count
  from public.tutor_threads as thread
  where thread.user_id = current_user_id;

  select
    pg_catalog.count(*)::integer,
    coalesce(pg_catalog.sum(pg_catalog.octet_length(message.content)), 0)::bigint
  into existing_message_count, existing_message_bytes
  from public.tutor_messages as message
  where message.user_id = current_user_id;

  if existing_thread_count + new_thread_count > 100
    or existing_message_count + new_message_count > 5000
    or existing_message_bytes > 33554432 - new_message_bytes then
    raise exception using errcode = '54000', message = 'tutor_account_storage_quota_exceeded';
  end if;

  perform private.consume_account_daily_write_quota_v1(
    current_user_id,
    'tutor_exchange',
    1,
    new_message_bytes,
    100,
    4194304
  );

  return public.save_tutor_exchange_without_account_quotas_v1(payload);
end;
$$;

revoke all on function public.save_tutor_exchange(jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_tutor_exchange(jsonb) to authenticated;

drop policy if exists "tutor_threads_owner_all" on public.tutor_threads;
drop policy if exists "tutor_threads_owner_select" on public.tutor_threads;
create policy "tutor_threads_owner_select" on public.tutor_threads
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "tutor_messages_owner_all" on public.tutor_messages;
drop policy if exists "tutor_messages_owner_select" on public.tutor_messages;
create policy "tutor_messages_owner_select" on public.tutor_messages
for select to authenticated
using ((select auth.uid()) = user_id);

revoke insert, update, delete on table public.tutor_threads, public.tutor_messages
from public, anon, authenticated;
grant select on table public.tutor_threads, public.tutor_messages to authenticated;

-- Telemetry and support endpoints deliberately use narrow direct inserts. A
-- database trigger keeps that behavior compatible while making timestamps,
-- initial workflow state, row volume, and stored bytes non-bypassable.
create or replace function public.guard_bounded_authenticated_insert_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_bytes bigint;
  existing_rows integer;
  existing_bytes bigint;
begin
  -- Migrations, maintenance and service-role jobs are trusted writers. Normal
  -- signed-in PostgREST calls are the boundary this trigger constrains.
  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;
  if current_user_id is null or new.user_id is distinct from current_user_id then
    raise exception using errcode = '42501', message = 'bounded_insert_identity_mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  if tg_table_schema = 'public' and tg_table_name = 'product_events' then
    new.occurred_at := pg_catalog.clock_timestamp();
    requested_bytes := pg_catalog.octet_length(pg_catalog.to_jsonb(new)::text);
    select
      pg_catalog.count(*)::integer,
      coalesce(pg_catalog.sum(
        pg_catalog.octet_length(pg_catalog.to_jsonb(event)::text)
      ), 0)::bigint
    into existing_rows, existing_bytes
    from public.product_events as event
    where event.user_id = current_user_id;
    if existing_rows >= 10000 or existing_bytes > 33554432 - requested_bytes then
      raise exception using errcode = '54000', message = 'product_event_account_quota_exceeded';
    end if;
    perform private.consume_account_daily_write_quota_v1(
      current_user_id, 'product_event', 1, requested_bytes, 500, 1048576
    );
  elsif tg_table_schema = 'public' and tg_table_name = 'error_reports' then
    new.occurred_at := pg_catalog.clock_timestamp();
    new.status := 'open';
    requested_bytes := pg_catalog.octet_length(pg_catalog.to_jsonb(new)::text);
    select
      pg_catalog.count(*)::integer,
      coalesce(pg_catalog.sum(
        pg_catalog.octet_length(pg_catalog.to_jsonb(report)::text)
      ), 0)::bigint
    into existing_rows, existing_bytes
    from public.error_reports as report
    where report.user_id = current_user_id;
    if existing_rows >= 2000 or existing_bytes > 8388608 - requested_bytes then
      raise exception using errcode = '54000', message = 'error_report_account_quota_exceeded';
    end if;
    perform private.consume_account_daily_write_quota_v1(
      current_user_id, 'error_report', 1, requested_bytes, 100, 262144
    );
  elsif tg_table_schema = 'public' and tg_table_name = 'support_requests' then
    new.created_at := pg_catalog.clock_timestamp();
    new.status := 'open';
    requested_bytes := pg_catalog.octet_length(pg_catalog.to_jsonb(new)::text);
    select
      pg_catalog.count(*)::integer,
      coalesce(pg_catalog.sum(
        pg_catalog.octet_length(pg_catalog.to_jsonb(request)::text)
      ), 0)::bigint
    into existing_rows, existing_bytes
    from public.support_requests as request
    where request.user_id = current_user_id;
    if existing_rows >= 200 or existing_bytes > 2097152 - requested_bytes then
      raise exception using errcode = '54000', message = 'support_request_account_quota_exceeded';
    end if;
    perform private.consume_account_daily_write_quota_v1(
      current_user_id, 'support_request', 1, requested_bytes, 10, 65536
    );
  else
    raise exception using errcode = '55000', message = 'bounded_insert_trigger_table_invalid';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_bounded_authenticated_insert_v1()
from public, anon, authenticated, service_role;

drop trigger if exists guard_bounded_product_event_insert_v1 on public.product_events;
create trigger guard_bounded_product_event_insert_v1
before insert on public.product_events
for each row execute function public.guard_bounded_authenticated_insert_v1();

drop trigger if exists guard_bounded_error_report_insert_v1 on public.error_reports;
create trigger guard_bounded_error_report_insert_v1
before insert on public.error_reports
for each row execute function public.guard_bounded_authenticated_insert_v1();

drop trigger if exists guard_bounded_support_request_insert_v1 on public.support_requests;
create trigger guard_bounded_support_request_insert_v1
before insert on public.support_requests
for each row execute function public.guard_bounded_authenticated_insert_v1();

-- One service-only contract blocks an application release from getting ahead
-- of either the preceding AI-cost migration or this storage/write boundary.
create or replace function public.public_launch_abuse_readiness_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ai_actions_covered boolean;
  material_upload_quota_ready boolean;
  material_chunk_write_boundary_ready boolean;
  untrusted_insert_quotas_ready boolean;
  tutor_write_boundary_ready boolean;
  result_ready boolean;
  required_action text;
  constraint_definition text;
  limits_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.ai_usage_limits_v1(text,boolean)')
  ), '');
  reserve_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.reserve_ai_request(text,integer,integer,uuid,uuid,integer)')
  ), '');
  release_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.release_ai_request_reservation(text,uuid,uuid)')
  ), '');
  release_claim_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.release_ai_request_claim(uuid)')
  ), '');
  legacy_claim_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.claim_ai_request(text,integer,integer)')
  ), '');
  reclaim_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.reclaim_expired_ai_usage_reservations(uuid,text,timestamptz)')
  ), '');
  locked_release_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.release_ai_usage_reservation_locked(uuid,timestamptz)')
  ), '');
  internal_reserve_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.reserve_ai_request_for_user_internal_v1(uuid,text,uuid,uuid,boolean)')
  ), '');
  create_upload_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.create_material_upload(jsonb)')
  ), '');
  mapping_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.persist_material_mapping_result(text,uuid,jsonb,jsonb,jsonb)')
  ), '');
  cleanup_confirmation_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.confirm_material_upload_cleanup(uuid,uuid)')
  ), '');
  profile_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.save_learner_profile(jsonb)')
  ), '');
  diagnostic_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.update_plan_diagnostic_knowledge_map_v1(uuid,jsonb)')
  ), '');
  plan_map_guard_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.guard_plan_knowledge_map_update_v1()')
  ), '');
  learning_growth_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.guard_bounded_learning_record_insert_v1()')
  ), '');
  milestone_guard_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.guard_deadline_milestone_write_v1()')
  ), '');
  extraction_guard_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.guard_material_upload_extraction_update_v1()')
  ), '');
  telemetry_guard_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.guard_bounded_authenticated_insert_v1()')
  ), '');
  tutor_definition text := coalesce(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.save_tutor_exchange(jsonb)')
  ), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'public_launch_abuse_readiness_service_role_required';
  end if;

  ai_actions_covered := true;
  foreach required_action in array array[
    'plan_generation',
    'plan_adjustment',
    'intake_interpretation',
    'material_processing',
    'session_generation',
    'lesson_generation',
    'answer_evaluation',
    'tutor_message',
    'teaching_visual'
  ]
  loop
    if pg_catalog.strpos(limits_definition, pg_catalog.quote_literal(required_action)) = 0 then
      ai_actions_covered := false;
    end if;
    for constraint_definition in
      select pg_catalog.pg_get_constraintdef(constraint_row.oid)
      from pg_catalog.pg_constraint as constraint_row
      where constraint_row.conname in (
        'ai_usage_windows_action_check',
        'ai_usage_claims_action_check'
      )
    loop
      if pg_catalog.strpos(constraint_definition, pg_catalog.quote_literal(required_action)) = 0 then
        ai_actions_covered := false;
      end if;
    end loop;
  end loop;
  ai_actions_covered := ai_actions_covered and (
    select pg_catalog.count(*) = 2
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conname in (
      'ai_usage_windows_action_check',
      'ai_usage_claims_action_check'
    )
  )
  and pg_catalog.strpos(limits_definition, 'case when request_public_accounts') > 0
  and pg_catalog.strpos(internal_reserve_definition, 'ai_usage_limits_v1') > 0
  and pg_catalog.strpos(internal_reserve_definition, 'interval ''180 seconds''') > 0
  and pg_catalog.strpos(reserve_definition, 'reserve_ai_request_for_user_internal_v1') > 0
  and pg_catalog.strpos(reserve_definition, 'request_recovery_key,') > 0
  and pg_catalog.strpos(release_definition, 'consume_ai_request_claim_for_user_internal_v1') > 0
  and pg_catalog.strpos(release_claim_definition, 'consume_ai_request_claim_for_user_internal_v1') > 0
  and pg_catalog.strpos(legacy_claim_definition, 'legacy_ai_claim_disabled') > 0
  and pg_catalog.strpos(reclaim_definition, 'state = ''consumed''') > 0
  and pg_catalog.strpos(reclaim_definition, 'release_ai_usage_reservation_locked') = 0
  and pg_catalog.strpos(locked_release_definition, 'delete from public.ai_usage_claims') > 0
  and not coalesce(pg_catalog.has_function_privilege(
    'authenticated', 'public.ai_usage_limits_v1(text,boolean)', 'execute'
  ), false)
  and not coalesce(pg_catalog.has_function_privilege(
    'service_role', 'public.ai_usage_limits_v1(text,boolean)', 'execute'
  ), false)
  and not coalesce(pg_catalog.has_function_privilege(
    'authenticated',
    'public.reserve_ai_request_for_user_internal_v1(uuid,text,uuid,uuid,boolean)',
    'execute'
  ), false)
  and not coalesce(pg_catalog.has_function_privilege(
    'service_role',
    'public.reserve_ai_request_for_user_internal_v1(uuid,text,uuid,uuid,boolean)',
    'execute'
  ), false)
  and not coalesce(pg_catalog.has_function_privilege(
    'authenticated', 'public.claim_ai_request(text,integer,integer)', 'execute'
  ), false)
  and coalesce(pg_catalog.has_function_privilege(
    'authenticated',
    'public.reserve_ai_request(text,integer,integer,uuid,uuid,integer)',
    'execute'
  ), false)
  and coalesce(pg_catalog.has_function_privilege(
    'authenticated', 'public.consume_ai_request_claim(uuid)', 'execute'
  ), false)
  and coalesce(pg_catalog.has_function_privilege(
    'authenticated', 'public.release_ai_request_claim(uuid)', 'execute'
  ), false)
  and coalesce(pg_catalog.has_function_privilege(
    'authenticated',
    'public.release_ai_request_reservation(text,uuid,uuid)',
    'execute'
  ), false)
  and not coalesce(pg_catalog.has_function_privilege(
    'authenticated',
    'public.reserve_ai_request_for_user(uuid,text,uuid,uuid,boolean)',
    'execute'
  ), false)
  and coalesce(pg_catalog.has_function_privilege(
    'service_role',
    'public.reserve_ai_request_for_user(uuid,text,uuid,uuid,boolean)',
    'execute'
  ), false)
  and not coalesce(pg_catalog.has_function_privilege(
    'authenticated', 'public.consume_ai_request_claim_for_user(uuid,uuid)', 'execute'
  ), false)
  and coalesce(pg_catalog.has_function_privilege(
    'service_role', 'public.consume_ai_request_claim_for_user(uuid,uuid)', 'execute'
  ), false)
  and not coalesce(pg_catalog.has_function_privilege(
    'authenticated', 'public.release_ai_request_claim_for_user(uuid,uuid)', 'execute'
  ), false)
  and coalesce(pg_catalog.has_function_privilege(
    'service_role', 'public.release_ai_request_claim_for_user(uuid,uuid)', 'execute'
  ), false)
  and not coalesce(pg_catalog.has_function_privilege(
    'authenticated',
    'public.release_ai_request_reservation_for_user(uuid,text,uuid,uuid)',
    'execute'
  ), false)
  and coalesce(pg_catalog.has_function_privilege(
    'service_role',
    'public.release_ai_request_reservation_for_user(uuid,text,uuid,uuid)',
    'execute'
  ), false)
  and (
    select pg_catalog.count(*) = 4
    from pg_catalog.pg_proc as routine
    where routine.oid in (
      pg_catalog.to_regprocedure('public.reserve_ai_request_for_user(uuid,text,uuid,uuid,boolean)'),
      pg_catalog.to_regprocedure('public.consume_ai_request_claim_for_user(uuid,uuid)'),
      pg_catalog.to_regprocedure('public.release_ai_request_claim_for_user(uuid,uuid)'),
      pg_catalog.to_regprocedure('public.release_ai_request_reservation_for_user(uuid,text,uuid,uuid)')
    )
      and routine.prosecdef
  );

  material_upload_quota_ready :=
    pg_catalog.to_regclass('private.account_daily_write_usage_v1') is not null
    and pg_catalog.strpos(create_upload_definition, 'material_upload_active_quota_exceeded') > 0
    and pg_catalog.strpos(create_upload_definition, 'material_account_storage_quota_exceeded') > 0
    and pg_catalog.strpos(create_upload_definition, 'consume_account_daily_write_quota_v1') > 0
    and coalesce(pg_catalog.has_function_privilege(
      'authenticated', 'public.create_material_upload(jsonb)', 'execute'
    ), false)
    and not coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      'public.create_material_upload_without_account_quotas_v1(jsonb)',
      'execute'
    ), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.material_uploads', 'insert'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.material_uploads', 'delete'), false)
    and coalesce(pg_catalog.has_column_privilege('authenticated', 'public.material_uploads', 'extracted_text', 'update'), false)
    and not coalesce(pg_catalog.has_column_privilege('authenticated', 'public.material_uploads', 'processing_status', 'update'), false)
    and not exists (
      select 1
      from pg_catalog.pg_attribute as column_row
      where column_row.attrelid = pg_catalog.to_regclass('public.material_uploads')
        and column_row.attnum > 0
        and not column_row.attisdropped
        and column_row.attname not in ('extracted_text', 'metadata')
        and coalesce(pg_catalog.has_column_privilege(
          'authenticated',
          column_row.attrelid,
          column_row.attname,
          'update'
        ), false)
    )
    and pg_catalog.strpos(extraction_guard_definition, '''material_extraction''') > 0
    and pg_catalog.strpos(extraction_guard_definition, 'consume_account_daily_write_quota_v1') > 0
    and exists (
      select 1 from pg_catalog.pg_trigger as trigger_row
      where trigger_row.tgname = 'guard_material_upload_extraction_update_v1'
        and not trigger_row.tgisinternal
    )
    and exists (
      select 1 from pg_catalog.pg_policies as policy
      where policy.schemaname = 'storage'
        and policy.tablename = 'objects'
        and policy.policyname = 'learning_material_objects_owner_insert'
        and policy.with_check like '%material_uploads%'
        and policy.with_check like '%storage_path%'
    )
    and not exists (
      select 1 from pg_catalog.pg_policies as policy
      where policy.schemaname = 'storage'
        and policy.tablename = 'objects'
        and (
          'authenticated'::name = any(policy.roles)
          or 'public'::name = any(policy.roles)
        )
        and policy.cmd in ('ALL', 'UPDATE', 'DELETE')
    )
    and not exists (
      select 1 from pg_catalog.pg_policies as policy
      where policy.schemaname = 'storage'
        and policy.tablename = 'objects'
        and (
          'authenticated'::name = any(policy.roles)
          or 'public'::name = any(policy.roles)
        )
        and policy.cmd in ('ALL', 'INSERT')
        and policy.policyname <> 'learning_material_objects_owner_insert'
    )
    and coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      'public.confirm_material_upload_cleanup(uuid,uuid)',
      'execute'
    ), false)
    and coalesce(pg_catalog.has_function_privilege(
      'service_role',
      'public.confirm_material_upload_cleanup(uuid,uuid)',
      'execute'
    ), false)
    and pg_catalog.strpos(
      cleanup_confirmation_definition,
      'if auth.role() is distinct from ''service_role'' then'
    ) > 0
    and pg_catalog.strpos(
      cleanup_confirmation_definition,
      'delete from public.private_storage_cleanup_receipts'
    ) > pg_catalog.strpos(
      cleanup_confirmation_definition,
      'if auth.role() is distinct from ''service_role'' then'
    );

  material_chunk_write_boundary_ready :=
    pg_catalog.strpos(mapping_definition, 'requested_chunk_count > 48') > 0
    and pg_catalog.strpos(mapping_definition, 'consume_account_daily_write_quota_v1') > 0
    and coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      'public.persist_material_mapping_result(text,uuid,jsonb,jsonb,jsonb)',
      'execute'
    ), false)
    and not coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      'public.persist_material_mapping_result_without_bounds_v1(text,uuid,jsonb,jsonb,jsonb)',
      'execute'
    ), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.material_chunks', 'insert'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.material_chunks', 'update'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.material_chunks', 'delete'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.materials', 'insert'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.materials', 'update'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.materials', 'delete'), false);

  untrusted_insert_quotas_ready :=
    (select pg_catalog.count(*) = 3
      from pg_catalog.pg_trigger as trigger_row
      where trigger_row.tgname in (
        'guard_bounded_product_event_insert_v1',
        'guard_bounded_error_report_insert_v1',
        'guard_bounded_support_request_insert_v1'
      )
        and not trigger_row.tgisinternal)
    and (select pg_catalog.count(*) = 6
      from pg_catalog.pg_trigger as trigger_row
      where trigger_row.tgname in (
        'guard_bounded_learning_item_insert_v1',
        'guard_bounded_plan_insert_v1',
        'guard_bounded_plan_session_insert_v1',
        'guard_bounded_study_route_insert_v1',
        'guard_bounded_session_attempt_insert_v1',
        'guard_bounded_learning_event_insert_v1'
      )
        and not trigger_row.tgisinternal)
    and exists (
      select 1
      from pg_catalog.pg_trigger as trigger_row
      where trigger_row.tgname = 'guard_bounded_deadline_milestone_write_v1'
        and (trigger_row.tgtype::integer & 31) = 31
        and not trigger_row.tgisinternal
    )
    and exists (
      select 1
      from pg_catalog.pg_trigger as trigger_row
      where trigger_row.tgname = 'guard_plan_knowledge_map_update_v1'
        and not trigger_row.tgisinternal
    )
    and pg_catalog.strpos(profile_definition, '''profile_save''') > 0
    and pg_catalog.strpos(profile_definition, 'learner_profile_payload_invalid') > 0
    and pg_catalog.strpos(learning_growth_definition, '''learning_state_growth''') > 0
    and pg_catalog.strpos(learning_growth_definition, 'study_routes_account_quota_exceeded') > 0
    and pg_catalog.strpos(diagnostic_definition, 'plan_diagnostic_map_invalid') > 0
    and pg_catalog.strpos(plan_map_guard_definition, '''plan_map_update''') > 0
    and pg_catalog.strpos(milestone_guard_definition, '''deadline_milestone''') > 0
    and pg_catalog.strpos(milestone_guard_definition, 'deadline_milestone_account_quota_exceeded') > 0
    and pg_catalog.strpos(telemetry_guard_definition, '''product_event''') > 0
    and pg_catalog.strpos(telemetry_guard_definition, 'product_event_account_quota_exceeded') > 0
    and pg_catalog.strpos(telemetry_guard_definition, '''error_report''') > 0
    and pg_catalog.strpos(telemetry_guard_definition, 'error_report_account_quota_exceeded') > 0
    and pg_catalog.strpos(telemetry_guard_definition, '''support_request''') > 0
    and pg_catalog.strpos(telemetry_guard_definition, 'support_request_account_quota_exceeded') > 0
    and coalesce(pg_catalog.has_table_privilege(
      'authenticated', 'public.product_events', 'insert'
    ), false)
    and not coalesce(pg_catalog.has_any_column_privilege(
      'authenticated', 'public.product_events', 'update'
    ), false)
    and not coalesce(pg_catalog.has_table_privilege(
      'authenticated', 'public.product_events', 'delete'
    ), false)
    and coalesce(pg_catalog.has_table_privilege(
      'authenticated', 'public.error_reports', 'insert'
    ), false)
    and not coalesce(pg_catalog.has_any_column_privilege(
      'authenticated', 'public.error_reports', 'update'
    ), false)
    and not coalesce(pg_catalog.has_table_privilege(
      'authenticated', 'public.error_reports', 'delete'
    ), false)
    and coalesce(pg_catalog.has_table_privilege(
      'authenticated', 'public.support_requests', 'insert'
    ), false)
    and not coalesce(pg_catalog.has_any_column_privilege(
      'authenticated', 'public.support_requests', 'update'
    ), false)
    and not coalesce(pg_catalog.has_table_privilege(
      'authenticated', 'public.support_requests', 'delete'
    ), false)
    and coalesce(pg_catalog.has_table_privilege(
      'authenticated', 'public.deadline_milestones', 'insert'
    ), false)
    and coalesce(pg_catalog.has_table_privilege(
      'authenticated', 'public.deadline_milestones', 'update'
    ), false)
    and coalesce(pg_catalog.has_table_privilege(
      'authenticated', 'public.deadline_milestones', 'delete'
    ), false)
    and coalesce(pg_catalog.has_function_privilege(
      'authenticated', 'public.save_learner_profile(jsonb)', 'execute'
    ), false)
    and not coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      'public.save_learner_profile_without_write_quotas_v1(jsonb)',
      'execute'
    ), false)
    and coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      'public.update_plan_diagnostic_knowledge_map_v1(uuid,jsonb)',
      'execute'
    ), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'insert'), false)
    and not coalesce(pg_catalog.has_any_column_privilege('authenticated', 'public.profiles', 'update'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'delete'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.learner_profiles', 'insert'), false)
    and not coalesce(pg_catalog.has_any_column_privilege('authenticated', 'public.learner_profiles', 'update'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.learner_profiles', 'delete'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.learning_items', 'insert'), false)
    and not coalesce(pg_catalog.has_any_column_privilege('authenticated', 'public.learning_items', 'update'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.learning_items', 'delete'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.plans', 'insert'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.plans', 'update'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.plans', 'delete'), false)
    and coalesce(pg_catalog.has_column_privilege(
      'authenticated', 'public.plans', 'knowledge_map', 'update'
    ), false)
    and not coalesce(pg_catalog.has_column_privilege(
      'authenticated', 'public.plans', 'rationale', 'update'
    ), false)
    and not exists (
      select 1
      from pg_catalog.pg_attribute as column_row
      where column_row.attrelid = pg_catalog.to_regclass('public.plans')
        and column_row.attnum > 0
        and not column_row.attisdropped
        and column_row.attname <> 'knowledge_map'
        and coalesce(pg_catalog.has_column_privilege(
          'authenticated',
          column_row.attrelid,
          column_row.attname,
          'update'
        ), false)
    )
    and (select pg_catalog.count(*) = 4
      from pg_catalog.pg_constraint as constraint_row
      where constraint_row.conname in (
        'profiles_display_name_bounded_v1',
        'learner_profiles_text_bounded_v1',
        'learning_items_text_bounded_v1',
        'plans_payload_bounded_v1'
      ))
    and not exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relkind in ('r', 'p')
        and (
          coalesce(pg_catalog.has_table_privilege(
            'authenticated', relation.oid, 'insert'
          ), false)
          or coalesce(pg_catalog.has_any_column_privilege(
            'authenticated', relation.oid, 'insert'
          ), false)
          or coalesce(pg_catalog.has_table_privilege(
            'authenticated', relation.oid, 'update'
          ), false)
          or coalesce(pg_catalog.has_any_column_privilege(
            'authenticated', relation.oid, 'update'
          ), false)
          or coalesce(pg_catalog.has_table_privilege(
            'authenticated', relation.oid, 'delete'
          ), false)
        )
        and relation.relname not in (
          'product_events',
          'error_reports',
          'support_requests',
          'deadline_milestones',
          'material_uploads',
          'plans'
        )
    )
    and not coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      'private.consume_account_daily_write_quota_v1(uuid,text,integer,bigint,integer,bigint)',
      'execute'
    ), false);

  tutor_write_boundary_ready :=
    pg_catalog.to_regprocedure('public.save_tutor_exchange(jsonb)') is not null
    and coalesce((
      select routine.prosecdef
      from pg_catalog.pg_proc as routine
      where routine.oid = pg_catalog.to_regprocedure('public.save_tutor_exchange(jsonb)')
    ), false)
    and pg_catalog.strpos(tutor_definition, 'existing_thread_count + new_thread_count > 100') > 0
    and pg_catalog.strpos(tutor_definition, 'existing_message_count + new_message_count > 5000') > 0
    and pg_catalog.strpos(tutor_definition, 'consume_account_daily_write_quota_v1') > 0
    and coalesce(pg_catalog.has_function_privilege(
      'authenticated', 'public.save_tutor_exchange(jsonb)', 'execute'
    ), false)
    and not coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      'public.save_tutor_exchange_without_account_quotas_v1(jsonb)',
      'execute'
    ), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.tutor_threads', 'insert'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.tutor_threads', 'update'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.tutor_threads', 'delete'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.tutor_messages', 'insert'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.tutor_messages', 'update'), false)
    and not coalesce(pg_catalog.has_table_privilege('authenticated', 'public.tutor_messages', 'delete'), false);

  result_ready := ai_actions_covered
    and material_upload_quota_ready
    and material_chunk_write_boundary_ready
    and untrusted_insert_quotas_ready
    and tutor_write_boundary_ready;

  return pg_catalog.jsonb_build_object(
    'contractVersion', '202609040002',
    'ready', result_ready,
    'aiActionsCovered', ai_actions_covered,
    'materialUploadQuota', material_upload_quota_ready,
    'materialChunkWriteBoundary', material_chunk_write_boundary_ready,
    'untrustedInsertQuotas', untrusted_insert_quotas_ready,
    'tutorWriteBoundary', tutor_write_boundary_ready
  );
end;
$$;

revoke all on function public.public_launch_abuse_readiness_v1()
from public, anon, authenticated, service_role;
grant execute on function public.public_launch_abuse_readiness_v1() to service_role;

comment on function public.public_launch_abuse_readiness_v1() is
  'Read-only release gate for public-launch AI, material, Storage and untrusted-write abuse boundaries.';

notify pgrst, 'reload schema';

commit;
