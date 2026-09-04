begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(28);

select extensions.is(
  (
    select pg_catalog.count(*)
    from supabase_migrations.schema_migrations as migration
    where migration.version = '202609040002'
  ),
  1::bigint,
  'the storage and untrusted-write quota migration committed'
);

select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'private.account_daily_write_usage_v1', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'private.account_daily_write_usage_v1', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'private.account_daily_write_usage_v1', 'update')
  and not pg_catalog.has_table_privilege('authenticated', 'private.account_daily_write_usage_v1', 'delete')
  and not pg_catalog.has_table_privilege('service_role', 'private.account_daily_write_usage_v1', 'select')
  and not pg_catalog.has_table_privilege('service_role', 'private.account_daily_write_usage_v1', 'insert')
  and not pg_catalog.has_table_privilege('service_role', 'private.account_daily_write_usage_v1', 'update')
  and not pg_catalog.has_table_privilege('service_role', 'private.account_daily_write_usage_v1', 'delete'),
  'daily account quota counters are inaccessible to PostgREST roles'
);

select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'private.consume_account_daily_write_quota_v1(uuid,text,integer,bigint,integer,bigint)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'private.consume_account_daily_write_quota_v1(uuid,text,integer,bigint,integer,bigint)',
    'execute'
  ),
  'only vetted SECURITY DEFINER boundaries can consume a daily quota'
);

select extensions.ok(
  pg_catalog.has_table_privilege('authenticated', 'public.material_uploads', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.material_uploads', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'public.material_uploads', 'delete')
  and pg_catalog.has_column_privilege(
    'authenticated', 'public.material_uploads', 'extracted_text', 'update'
  )
  and pg_catalog.has_column_privilege(
    'authenticated', 'public.material_uploads', 'metadata', 'update'
  )
  and not pg_catalog.has_column_privilege(
    'authenticated', 'public.material_uploads', 'processing_status', 'update'
  ),
  'staging exposes reads and bounded extraction columns but no lifecycle writes'
);

select extensions.ok(
  pg_catalog.has_table_privilege('authenticated', 'public.material_chunks', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.material_chunks', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'public.material_chunks', 'update')
  and not pg_catalog.has_table_privilege('authenticated', 'public.material_chunks', 'delete')
  and pg_catalog.has_table_privilege('authenticated', 'public.materials', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.materials', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'public.materials', 'update')
  and not pg_catalog.has_table_privilege('authenticated', 'public.materials', 'delete')
  and not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname in (
        'learning_material_objects_owner_update',
        'learning_material_objects_owner_delete'
      )
  ),
  'durable material, chunk and Storage mutation writes are server-only'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.create_material_upload(jsonb)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_material_upload_without_account_quotas_v1(jsonb)',
    'execute'
  )
  and (
    select routine.prosecdef
    from pg_catalog.pg_proc as routine
    where routine.oid = pg_catalog.to_regprocedure(
      'public.create_material_upload(jsonb)'
    )
  ),
  'staging creation is available only through the quota wrapper'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.persist_material_mapping_result(text,uuid,jsonb,jsonb,jsonb)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.persist_material_mapping_result_without_bounds_v1(text,uuid,jsonb,jsonb,jsonb)',
    'execute'
  )
  and (
    select routine.prosecdef
    from pg_catalog.pg_proc as routine
    where routine.oid = pg_catalog.to_regprocedure(
      'public.persist_material_mapping_result(text,uuid,jsonb,jsonb,jsonb)'
    )
  ),
  'material mapping is available only through the bounded writer'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.save_tutor_exchange(jsonb)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_tutor_exchange_without_account_quotas_v1(jsonb)',
    'execute'
  )
  and not pg_catalog.has_table_privilege('authenticated', 'public.tutor_threads', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'public.tutor_threads', 'update')
  and not pg_catalog.has_table_privilege('authenticated', 'public.tutor_threads', 'delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.tutor_messages', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'public.tutor_messages', 'update')
  and not pg_catalog.has_table_privilege('authenticated', 'public.tutor_messages', 'delete'),
  'tutor history writes are bounded and RPC-only'
);

select extensions.is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger as trigger_row
    where trigger_row.tgname in (
      'guard_bounded_product_event_insert_v1',
      'guard_bounded_error_report_insert_v1',
      'guard_bounded_support_request_insert_v1'
    )
      and not trigger_row.tgisinternal
  ),
  3::bigint,
  'all retained direct-insert tables have a database quota trigger'
);

select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'insert')
  and not pg_catalog.has_any_column_privilege('authenticated', 'public.profiles', 'update')
  and not pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.learner_profiles', 'insert')
  and not pg_catalog.has_any_column_privilege('authenticated', 'public.learner_profiles', 'update')
  and not pg_catalog.has_table_privilege('authenticated', 'public.learning_items', 'insert')
  and not pg_catalog.has_any_column_privilege('authenticated', 'public.learning_items', 'update')
  and not pg_catalog.has_table_privilege('authenticated', 'public.plans', 'insert')
  and not pg_catalog.has_table_privilege('authenticated', 'public.plans', 'update')
  and pg_catalog.has_function_privilege(
    'authenticated', 'public.save_learner_profile(jsonb)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_learner_profile_without_write_quotas_v1(jsonb)',
    'execute'
  ),
  'profile and core plan tables expose reads but no broad authenticated DML'
);

select extensions.is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger as trigger_row
    where trigger_row.tgname in (
      'guard_bounded_learning_item_insert_v1',
      'guard_bounded_plan_insert_v1',
      'guard_bounded_plan_session_insert_v1',
      'guard_bounded_study_route_insert_v1',
      'guard_bounded_session_attempt_insert_v1',
      'guard_bounded_learning_event_insert_v1'
    )
      and not trigger_row.tgisinternal
  ),
  6::bigint,
  'every append-only core learning record has an account and daily quota trigger'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.update_plan_diagnostic_knowledge_map_v1(uuid,jsonb)',
    'execute'
  )
  and pg_catalog.has_column_privilege(
    'authenticated', 'public.plans', 'knowledge_map', 'update'
  )
  and not pg_catalog.has_column_privilege(
    'authenticated', 'public.plans', 'rationale', 'update'
  )
  and exists (
    select 1
    from pg_catalog.pg_trigger as trigger_row
    where trigger_row.tgname = 'guard_plan_knowledge_map_update_v1'
      and not trigger_row.tgisinternal
  ),
  'diagnostic map updates use one bounded RPC with quota-backed rollout compatibility'
);

select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger_row
    where trigger_row.tgname = 'guard_bounded_deadline_milestone_write_v1'
      and (trigger_row.tgtype::integer & 31) = 31
      and not trigger_row.tgisinternal
  ),
  'direct milestone inserts, updates and owner deletes all pass the bounded trigger'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.confirm_material_upload_cleanup(uuid,uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.confirm_material_upload_cleanup(uuid,uuid)', 'execute'
  ),
  'both immediate owner sweeps and final service sweeps retain their cleanup RPC'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.public_launch_abuse_readiness_v1()', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.public_launch_abuse_readiness_v1()', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'public.public_launch_abuse_readiness_v1()', 'execute'
  ),
  'the combined launch-abuse readiness probe is service-role-only'
);

select extensions.ok(
  (
    select routine.prosecdef and routine.provolatile = 's'
    from pg_catalog.pg_proc as routine
    where routine.oid = pg_catalog.to_regprocedure(
      'public.public_launch_abuse_readiness_v1()'
    )
  ),
  'the combined readiness probe is stable and SECURITY DEFINER'
);

do $block$
begin
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
end;
$block$;

select extensions.is(
  public.public_launch_abuse_readiness_v1(),
  pg_catalog.jsonb_build_object(
    'contractVersion', '202609040002',
    'ready', true,
    'aiActionsCovered', true,
    'materialUploadQuota', true,
    'materialChunkWriteBoundary', true,
    'untrustedInsertQuotas', true,
    'tutorWriteBoundary', true
  ),
  'the fully migrated database certifies the exact launch-abuse contract'
);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values (
  '94000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'storage-quota-pgtap@yova.invalid',
  '',
  pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp()
);

insert into private.account_daily_write_usage_v1 (
  user_id,
  usage_day,
  write_kind,
  rows_used,
  bytes_used
) values (
  '94000000-0000-4000-8000-000000000001',
  (pg_catalog.clock_timestamp() at time zone 'UTC')::date,
  'material_upload',
  39,
  0
);

do $block$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    '94000000-0000-4000-8000-000000000001',
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$block$;

select extensions.lives_ok(
  $statement$
    select public.create_material_upload(
      pg_catalog.jsonb_build_object(
        'id', '94000000-0000-4000-8000-000000000002',
        'filename', 'notes.txt',
        'storagePath',
          '94000000-0000-4000-8000-000000000001/94000000-0000-4000-8000-000000000002/notes.txt',
        'mimeType', 'text/plain',
        'byteSize', 1,
        'processingStatus', 'processing',
        'metadata', '{}'::jsonb
      )
    )
  $statement$,
  'the final upload inside the daily quota succeeds'
);

select extensions.is(
  (
    select usage.rows_used
    from private.account_daily_write_usage_v1 as usage
    where usage.user_id = '94000000-0000-4000-8000-000000000001'
      and usage.write_kind = 'material_upload'
  ),
  40,
  'the successful staging transaction consumes exactly one durable quota row'
);

select extensions.throws_ok(
  $statement$
    select public.create_material_upload(
      pg_catalog.jsonb_build_object(
        'id', '94000000-0000-4000-8000-000000000003',
        'filename', 'more-notes.txt',
        'storagePath',
          '94000000-0000-4000-8000-000000000001/94000000-0000-4000-8000-000000000003/more-notes.txt',
        'mimeType', 'text/plain',
        'byteSize', 1,
        'processingStatus', 'processing',
        'metadata', '{}'::jsonb
      )
    )
  $statement$,
  '54000',
  'material_upload_daily_quota_exceeded',
  'the next upload is rejected at the transactional database quota'
);

select extensions.is(
  (
    select pg_catalog.count(*)
    from public.material_uploads as upload
    where upload.user_id = '94000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'a rejected quota transaction creates no staging row'
);

insert into public.private_storage_cleanup_receipts (
  id,
  user_id,
  bucket_id,
  storage_path,
  source_material_id,
  created_at,
  final_sweep_after,
  cleanup_claimed_at,
  cleanup_token
) values (
  '94000000-0000-4000-8000-000000000005',
  '94000000-0000-4000-8000-000000000001',
  'learning-materials',
  '94000000-0000-4000-8000-000000000001/94000000-0000-4000-8000-000000000004/notes.txt',
  '94000000-0000-4000-8000-000000000004',
  pg_catalog.clock_timestamp() - interval '3 hours',
  pg_catalog.clock_timestamp() - interval '1 hour',
  pg_catalog.clock_timestamp(),
  '94000000-0000-4000-8000-000000000006'
);

select extensions.is(
  public.confirm_material_upload_cleanup(
    '94000000-0000-4000-8000-000000000004',
    '94000000-0000-4000-8000-000000000006'
  ),
  false,
  'an authenticated owner cannot confirm away a final-sweep receipt'
);

select extensions.is(
  (
    select pg_catalog.count(*)
    from public.private_storage_cleanup_receipts as receipt
    where receipt.id = '94000000-0000-4000-8000-000000000005'
  ),
  1::bigint,
  'the rejected owner confirmation leaves the exact cleanup receipt durable'
);

do $block$
begin
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
end;
$block$;

select extensions.is(
  public.confirm_material_upload_cleanup(
    '94000000-0000-4000-8000-000000000004',
    '94000000-0000-4000-8000-000000000006'
  ),
  true,
  'the service worker may confirm the final post-capability sweep'
);

select extensions.is(
  (
    select pg_catalog.count(*)
    from public.private_storage_cleanup_receipts as receipt
    where receipt.id = '94000000-0000-4000-8000-000000000005'
  ),
  0::bigint,
  'service confirmation deletes the completed cleanup receipt'
);

insert into public.deadline_milestones (
  id,
  user_id,
  title,
  description,
  due_at
) values (
  '94000000-0000-4000-8000-000000000007',
  '94000000-0000-4000-8000-000000000001',
  'Reset-safe deadline',
  '',
  pg_catalog.clock_timestamp() + interval '1 day'
);

insert into private.account_daily_write_usage_v1 (
  user_id,
  usage_day,
  write_kind,
  rows_used,
  bytes_used
) values (
  '94000000-0000-4000-8000-000000000001',
  (pg_catalog.clock_timestamp() at time zone 'UTC')::date,
  'deadline_milestone',
  100,
  0
);

do $block$
begin
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$block$;

select extensions.lives_ok(
  'select public.reset_yova_learning_data()',
  'privacy reset remains available after the milestone mutation quota is spent'
);

select extensions.is(
  (
    select pg_catalog.count(*)
    from public.deadline_milestones as milestone
    where milestone.user_id = '94000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'privacy reset deletes milestones even at the daily mutation cap'
);

do $block$
begin
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$block$;

select extensions.throws_ok(
  'select public.public_launch_abuse_readiness_v1()',
  '42501',
  'public_launch_abuse_readiness_service_role_required',
  'a learner cannot invoke the deployment capability probe'
);

select * from extensions.finish();
rollback;
