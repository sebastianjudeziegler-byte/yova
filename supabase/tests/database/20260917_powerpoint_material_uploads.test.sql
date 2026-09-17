begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(20);

select extensions.is(
  (select allowed_mime_types from storage.buckets where id = 'learning-materials'),
  array[
    'application/pdf', 'text/plain', 'text/markdown',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ],
  'Storage accepts PPTX alongside the existing document formats'
);

select extensions.ok(
  (select not public and file_size_limit = 10485760
   from storage.buckets where id = 'learning-materials'),
  'PowerPoint support retains private storage and the 10 MiB upload limit'
);

select extensions.ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.material_uploads'::regclass)
  and not pg_catalog.has_table_privilege('authenticated', 'public.material_uploads', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'public.material_uploads', 'delete')
  and pg_catalog.has_function_privilege('authenticated', 'public.create_material_upload(jsonb)', 'execute')
  and not pg_catalog.has_function_privilege('anon', 'public.create_material_upload(jsonb)', 'execute')
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.create_material_upload_without_account_quotas_v1(jsonb)', 'execute'
  ),
  'PPTX uploads retain RLS and use only the authenticated quota wrapper'
);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  ('91700000-0000-4000-8000-000000000001', 'pptx-owner@yova.invalid', '{}'::jsonb, '{}'::jsonb),
  ('91700000-0000-4000-8000-000000000002', 'pptx-other@yova.invalid', '{}'::jsonb, '{}'::jsonb);

create function pg_temp.pptx_upload_payload(material_id uuid)
returns jsonb language sql immutable as $$
  select pg_catalog.jsonb_build_object(
    'id', material_id,
    'filename', 'Class 1B.pptx',
    'storagePath', '91700000-0000-4000-8000-000000000001/' || material_id::text || '/Class-1B.pptx',
    'mimeType', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'byteSize', 1024,
    'processingStatus', 'processing',
    'metadata', '{}'::jsonb
  );
$$;

do $claims$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', '91700000-0000-4000-8000-000000000001', true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$claims$;
set local role authenticated;

select extensions.lives_ok(
  $$select public.create_material_upload(pg_temp.pptx_upload_payload('91700000-0000-4000-8000-000000000010'))$$,
  'an authenticated learner can stage a native PowerPoint presentation'
);

select extensions.is(
  (select mime_type from public.material_uploads where id = '91700000-0000-4000-8000-000000000010'),
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'the staged row preserves the actual PowerPoint MIME type'
);

do $claims$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', '91700000-0000-4000-8000-000000000002', true);
end;
$claims$;

select extensions.is(
  (select pg_catalog.count(*) from public.material_uploads where id = '91700000-0000-4000-8000-000000000010'),
  0::bigint,
  'another learner cannot read the PowerPoint staging row'
);

select extensions.throws_ok(
  $$select public.create_material_upload(pg_temp.pptx_upload_payload('91700000-0000-4000-8000-000000000011'))$$,
  '22023', 'material_upload_path_invalid',
  'another learner cannot create a PowerPoint upload under the owner path'
);

do $claims$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', '91700000-0000-4000-8000-000000000001', true);
end;
$claims$;

select extensions.throws_ok(
  $$select public.create_material_upload(pg_temp.pptx_upload_payload('91700000-0000-4000-8000-000000000012') || '{"mimeType":"application/vnd.ms-powerpoint"}'::jsonb)$$,
  '22023', 'material_upload_payload_invalid',
  'legacy binary PPT is not admitted without a supported extractor'
);

select extensions.throws_ok(
  $$select public.create_material_upload(pg_temp.pptx_upload_payload('91700000-0000-4000-8000-000000000013') || '{"mimeType":"application/zip"}'::jsonb)$$,
  '22023', 'material_upload_payload_invalid',
  'generic ZIP uploads do not gain admission with PowerPoint support'
);

select extensions.throws_ok(
  $$select public.create_material_upload(pg_temp.pptx_upload_payload('91700000-0000-4000-8000-000000000014') || '{"byteSize":10485761}'::jsonb)$$,
  '22023', 'material_upload_payload_invalid',
  'oversized PowerPoint uploads are rejected before staging'
);

select extensions.is(
  public.claim_material_upload_cleanup('91700000-0000-4000-8000-000000000010') ->> 'status',
  'claimed',
  'PowerPoint cancellation uses the retained cleanup receipt lifecycle'
);

select extensions.is(
  (select pg_catalog.count(*) from public.material_uploads where id = '91700000-0000-4000-8000-000000000010'),
  0::bigint,
  'cancellation removes the PowerPoint staging row atomically'
);

reset role;

select extensions.ok(
  exists (
    select 1 from public.private_storage_cleanup_receipts
    where source_material_id = '91700000-0000-4000-8000-000000000010'
      and user_id = '91700000-0000-4000-8000-000000000001'
      and bucket_id = 'learning-materials'
      and storage_path = '91700000-0000-4000-8000-000000000001/91700000-0000-4000-8000-000000000010/Class-1B.pptx'
      and final_sweep_after > pg_catalog.clock_timestamp() + interval '2 hours'
  ),
  'cancelled PowerPoint storage paths remain protected through late upload expiry'
);

select extensions.is(
  (select rows_used from private.account_daily_write_usage_v1
   where user_id = '91700000-0000-4000-8000-000000000001' and write_kind = 'material_upload'),
  1,
  'only the admitted PowerPoint consumes daily quota and cancellation does not refund it'
);

select extensions.is(
  (select bytes_used from private.account_daily_write_usage_v1
   where user_id = '91700000-0000-4000-8000-000000000001' and write_kind = 'material_upload'),
  1024::bigint,
  'rejected PowerPoint requests do not consume quota bytes'
);

update private.account_daily_write_usage_v1 set rows_used = 39
where user_id = '91700000-0000-4000-8000-000000000001' and write_kind = 'material_upload';
set local role authenticated;

select extensions.lives_ok(
  $$select public.create_material_upload(pg_temp.pptx_upload_payload('91700000-0000-4000-8000-000000000015'))$$,
  'the final PowerPoint within the daily quota succeeds'
);

select extensions.throws_ok(
  $$select public.create_material_upload(pg_temp.pptx_upload_payload('91700000-0000-4000-8000-000000000016'))$$,
  '54000', 'material_upload_daily_quota_exceeded',
  'PowerPoint cannot bypass the daily upload quota'
);

select extensions.is(
  (select pg_catalog.count(*) from public.material_uploads where id = '91700000-0000-4000-8000-000000000016'),
  0::bigint,
  'quota rejection leaves no partial PowerPoint staging row'
);

reset role;

select extensions.is(
  (select rows_used from private.account_daily_write_usage_v1
   where user_id = '91700000-0000-4000-8000-000000000001' and write_kind = 'material_upload'),
  40,
  'the daily upload counter remains at its limit after rejection'
);

select extensions.is(
  (select bytes_used from private.account_daily_write_usage_v1
   where user_id = '91700000-0000-4000-8000-000000000001' and write_kind = 'material_upload'),
  2048::bigint,
  'the daily byte counter includes exactly the two successful presentations'
);

select * from extensions.finish();
rollback;
