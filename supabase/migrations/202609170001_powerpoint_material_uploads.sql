-- Enable native PowerPoint uploads at every database admission boundary.
-- Keep the bucket private, retain its 10 MiB limit, and preserve the existing
-- quota and receipt-aware upload lifecycle. Deploy before the application that
-- advertises PPTX support; older application versions remain compatible.

do $migration_lock$
begin
  lock table public.material_uploads, storage.buckets
  in access exclusive mode nowait;
end;
$migration_lock$;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]
where id = 'learning-materials';

alter table public.material_uploads
  drop constraint material_uploads_mime_type_check,
  add constraint material_uploads_mime_type_check check (
    mime_type in (
      'application/pdf',
      'text/plain',
      'text/markdown',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )
  );

-- This is the existing quota wrapper with only the MIME allowlist extended.
-- Its private delegate still issues the one-use RPC marker and records the
-- exact storage path for cancellation, reset, and late signed-upload cleanup.
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
    or coalesce(payload ->> 'mimeType', '') not in ('application/pdf', 'text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
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
