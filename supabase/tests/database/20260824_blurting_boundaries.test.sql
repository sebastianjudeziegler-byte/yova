begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local timezone = 'UTC';

select extensions.plan(46);

select extensions.is(
  (
    select pg_catalog.count(*)
    from supabase_migrations.schema_migrations as migration
    where migration.version = any(array[
      '202608240001',
      '202608240002',
      '202608240003',
      '202608240004',
      '202608240005',
      '202608240006',
      '202608240007'
    ]::text[])
  ),
  7::bigint,
  'the complete 20260824 migration sequence committed'
);

select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_class as relation
      on relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'study_routes'
      and constraint_row.conname =
        'study_routes_committed_pointer_scope_key'
      and constraint_row.contype = 'u'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) =
        'UNIQUE (route_revision_id, plan_session_id, plan_id, user_id)'
  ),
  'the committed-route pointer has its exact PostgreSQL unique target key'
);

select extensions.ok(
  pg_catalog.to_regnamespace('private') is not null,
  'the private resource schema exists'
);

select extensions.is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relkind = 'r'
      and relation.relname = any(array[
        'blurting_resources_v18',
        'blurting_delivery_receipts_v18',
        'blurting_evaluation_receipts_v18'
      ]::text[])
  ),
  3::bigint,
  'all three private V18 table roots exist'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = any(array[
        'blurting_resources_v18',
        'blurting_delivery_receipts_v18',
        'blurting_evaluation_receipts_v18'
      ]::text[])
      and relation.relrowsecurity is not true
  ),
  'every private V18 table has row-level security enabled'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'private'
      and policy.tablename = any(array[
        'blurting_resources_v18',
        'blurting_delivery_receipts_v18',
        'blurting_evaluation_receipts_v18'
      ]::name[])
  ),
  'the private V18 tables expose no row-level policies'
);

select extensions.ok(
  not exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role'))
      as actor(role_name)
    cross join (values ('USAGE'), ('CREATE')) as requested(privilege_name)
    where pg_catalog.has_schema_privilege(
      actor.role_name,
      'private',
      requested.privilege_name
    )
  ),
  'no PostgREST role can use or create in the private schema'
);

select extensions.ok(
  not exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role'))
      as actor(role_name)
    cross join (values
      ('blurting_resources_v18'),
      ('blurting_delivery_receipts_v18'),
      ('blurting_evaluation_receipts_v18')
    ) as target(table_name)
    cross join (values
      ('SELECT'),
      ('INSERT'),
      ('UPDATE'),
      ('DELETE'),
      ('TRUNCATE'),
      ('REFERENCES'),
      ('TRIGGER'),
      ('MAINTAIN')
    ) as requested(privilege_name)
    where pg_catalog.has_table_privilege(
      actor.role_name,
      'private.' || target.table_name,
      requested.privilege_name
    )
  ),
  'no PostgREST role has a direct V18 table privilege'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as routine
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = routine.pronamespace
    cross join (values ('anon'), ('authenticated'), ('service_role'))
      as actor(role_name)
    where namespace.nspname = 'private'
      and pg_catalog.has_function_privilege(
        actor.role_name,
        routine.oid,
        'EXECUTE'
      )
  ),
  'no PostgREST role can execute a private Blurting helper'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.cleanup_blurting_resource_store_v18(integer)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.cleanup_blurting_resource_store_v18(integer)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.cleanup_blurting_resource_store_v18(integer)',
    'EXECUTE'
  ),
  'the deletion-only cleanup RPC is service-role-only'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.reset_yova_learning_data()',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.reset_yova_learning_data()',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.reset_yova_learning_data()',
    'EXECUTE'
  ),
  'learning-data Reset remains authenticated-only'
);

select extensions.ok(
  (select pg_catalog.count(*) from private.blurting_resources_v18) = 0
  and (
    select pg_catalog.count(*)
    from private.blurting_delivery_receipts_v18
  ) = 0
  and (
    select pg_catalog.count(*)
    from private.blurting_evaluation_receipts_v18
  ) = 0,
  'the dormant V18 store starts empty'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as routine
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.prokind in ('f', 'p')
      and pg_catalog.pg_get_functiondef(routine.oid)
        ~ 'private\.blurting_(resources|delivery_receipts|evaluation_receipts)_v18'
      and routine.oid is distinct from pg_catalog.to_regprocedure(
        'public.cleanup_blurting_resource_store_v18(integer)'
      )
      and routine.oid is distinct from pg_catalog.to_regprocedure(
        'public.reset_yova_learning_data()'
      )
  ),
  'no public routine beyond cleanup and Reset touches the private V18 store'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.change_plan_session_method_with_route(jsonb)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.change_plan_session_method_with_route(jsonb)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.change_plan_session_method_with_route(jsonb)',
    'EXECUTE'
  ),
  'the post-commit method-choice RPC is authenticated-only'
);

select extensions.ok(
  (
    select permit_table.relrowsecurity
    from pg_catalog.pg_class as permit_table
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = permit_table.relnamespace
    where namespace.nspname = 'public'
      and permit_table.relname = 'plan_activation_permits'
  )
  and not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'plan_activation_permits'
  )
  and not exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role'))
      as actor(role_name)
    cross join (values
      ('SELECT'),
      ('INSERT'),
      ('UPDATE'),
      ('DELETE'),
      ('TRUNCATE'),
      ('REFERENCES'),
      ('TRIGGER'),
      ('MAINTAIN')
    ) as requested(privilege_name)
    where pg_catalog.has_table_privilege(
      actor.role_name,
      'public.plan_activation_permits',
      requested.privilege_name
    )
  )
  and (select pg_catalog.count(*) from public.plan_activation_permits) = 0,
  'the activation-permit table is empty, RLS-enabled, and directly inaccessible'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.mint_plan_activation_permit_v1(jsonb,uuid,timestamptz)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.mint_plan_activation_permit_v1(jsonb,uuid,timestamptz)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.mint_plan_activation_permit_v1(jsonb,uuid,timestamptz)',
    'EXECUTE'
  ),
  'activation-permit minting is service-role-only'
);

select extensions.ok(
  pg_catalog.to_regprocedure(
    'public.save_generated_plan_with_routes(jsonb)'
  ) is null
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_generated_plan_with_routes(jsonb,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.save_generated_plan_with_routes(jsonb,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.save_generated_plan_with_routes(jsonb,uuid)',
    'EXECUTE'
  ),
  'the activation writer exposes only the authenticated permit-bound signature'
);

select extensions.ok(
  not exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role'))
      as actor(role_name)
    where pg_catalog.has_function_privilege(
      actor.role_name,
      'public.assert_study_route_blurting_recipe_v1(jsonb)',
      'EXECUTE'
    )
  ),
  'the Blurting recipe assertion helper is not client-executable'
);

select extensions.lives_ok(
  'select public.assert_study_route_blurting_recipe_v1(''{}''::jsonb)',
  'an ordinary route with no recipe signal remains compatible'
);

select extensions.is(
  private.canonical_json_v1('{"z":2,"a":["x",1]}'::jsonb),
  '{"a":["x",1],"z":2}',
  'canonical JSON uses deterministic object-key ordering'
);

select extensions.is(
  pg_catalog.encode(
    private.blurting_source_chunk_digest_v1(E'Blurting "A"\nB'),
    'hex'
  ),
  '86fd9b600999bd40b16fb5cdc84f34adcd344996a8ff5780369263273f6e8c2c',
  'the SQL source digest matches the pinned cross-runtime vector'
);

select extensions.ok(
  private.blurting_source_ids_valid_v1(array['source-a', 'source-b']),
  'ordered unique source identifiers are valid'
);

select extensions.ok(
  not private.blurting_source_ids_valid_v1(array['source-a', 'source-a']),
  'duplicate source identifiers are invalid'
);

select extensions.ok(
  not private.blurting_source_ids_valid_v1(
    pg_catalog.array_fill('source-a'::text, array[1], array[0])
  ),
  'noncanonical PostgreSQL array lower bounds are invalid'
);

select extensions.ok(
  private.jsonb_contains_any_key_v1(
    '{"wrapper":{"ExpectedAnswer":"secret"}}'::jsonb,
    array['expectedanswer']
  ),
  'nested secret-key detection is case-insensitive'
);

select extensions.ok(
  private.blurting_timestamp_text_matches_v18(
    '2026-08-25T08:00:00.000Z',
    '2026-08-25 08:00:00+00'::timestamptz
  ),
  'the V18 timestamp spelling is exact UTC with three millisecond digits'
);

select extensions.ok(
  not private.blurting_timestamp_text_matches_v18(
    '2026-08-25T09:00:00.000+01:00',
    '2026-08-25 08:00:00+00'::timestamptz
  )
  and not private.blurting_timestamp_text_matches_v18(
    '2026-08-25T08:00:00Z',
    '2026-08-25 08:00:00+00'::timestamptz
  )
  and not private.blurting_timestamp_text_matches_v18(
    '2026-08-25T08:00:00.000000Z',
    '2026-08-25 08:00:00+00'::timestamptz
  )
  and not private.blurting_timestamp_text_matches_v18(
    '0000-01-01T00:00:00.000Z',
    '0001-01-01 00:00:00+00'::timestamptz
  )
  and not private.blurting_timestamp_text_matches_v18(
    '2023-02-29T00:00:00.000Z',
    '2023-03-01 00:00:00+00'::timestamptz
  ),
  'offset, precision, year-zero, and impossible-calendar spellings are invalid'
);

select extensions.ok(
  private.blurting_timestamp_text_matches_v18(
    '0001-01-01T00:00:00.000Z',
    '0001-01-01 00:00:00+00'::timestamptz
  )
  and private.blurting_timestamp_text_matches_v18(
    '9999-12-31T23:59:59.999Z',
    '9999-12-31 23:59:59.999+00'::timestamptz
  ),
  'the exact four-digit timestamp year bounds are valid'
);

select extensions.ok(
  private.blurting_timestamp_value_valid_v18(
    '2026-08-25 08:00:00.123+00'::timestamptz
  )
  and not private.blurting_timestamp_value_valid_v18(
    '2026-08-25 08:00:00.123456+00'::timestamptz
  ),
  'stored V18 timestamps reject precision below one millisecond'
);

select extensions.ok(
  private.blurting_timestamp_value_valid_v18(
    private.blurting_statement_timestamp_ms_v18()
  )
  and private.blurting_timestamp_text_v18(
    private.blurting_statement_timestamp_ms_v18()
  ) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$',
  'the database-owned statement instant is millisecond-aligned and canonical'
);

select extensions.is(
  private.blurting_ecmascript_trim_v1(
    pg_catalog.chr(9)
      || pg_catalog.chr(10)
      || pg_catalog.chr(11)
      || pg_catalog.chr(12)
      || pg_catalog.chr(13)
      || pg_catalog.chr(32)
      || pg_catalog.chr(160)
      || pg_catalog.chr(5760)
      || pg_catalog.chr(8192)
      || pg_catalog.chr(8193)
      || pg_catalog.chr(8194)
      || pg_catalog.chr(8195)
      || pg_catalog.chr(8196)
      || pg_catalog.chr(8197)
      || pg_catalog.chr(8198)
      || pg_catalog.chr(8199)
      || pg_catalog.chr(8200)
      || pg_catalog.chr(8201)
      || pg_catalog.chr(8202)
      || pg_catalog.chr(8232)
      || pg_catalog.chr(8233)
      || pg_catalog.chr(8239)
      || pg_catalog.chr(8287)
      || pg_catalog.chr(12288)
      || pg_catalog.chr(65279)
      || 'canonical'
      || pg_catalog.chr(65279)
      || pg_catalog.chr(12288)
      || pg_catalog.chr(8287)
      || pg_catalog.chr(8239)
      || pg_catalog.chr(8233)
      || pg_catalog.chr(8232)
      || pg_catalog.chr(8202)
      || pg_catalog.chr(8192)
      || pg_catalog.chr(5760)
      || pg_catalog.chr(160)
      || pg_catalog.chr(32)
      || pg_catalog.chr(13)
      || pg_catalog.chr(10)
      || pg_catalog.chr(9)
  ),
  'canonical',
  'the complete pinned ECMAScript TrimString set is removed at both edges'
);

select extensions.is(
  private.blurting_ecmascript_trim_v1(
    pg_catalog.chr(133)
      || pg_catalog.chr(6158)
      || 'canonical'
      || pg_catalog.chr(8203)
  ),
  pg_catalog.chr(133)
    || pg_catalog.chr(6158)
    || 'canonical'
    || pg_catalog.chr(8203),
  'U+0085, U+180E, and U+200B are not ECMAScript trim characters'
);

select extensions.ok(
  private.blurting_bounded_text_valid_v18(
    pg_catalog.chr(128512),
    1,
    1
  )
  and not private.blurting_bounded_text_valid_v18(
    pg_catalog.chr(128512) || 'x',
    1,
    1
  ),
  'V18 string bounds count Unicode code points instead of UTF-8 bytes'
);

select extensions.ok(
  private.blurting_json_strings_canonical_v18(
    pg_catalog.jsonb_build_object('value', 'internal' || pg_catalog.chr(160) || 'space')
  )
  and not private.blurting_json_strings_canonical_v18(
    pg_catalog.jsonb_build_object('value', pg_catalog.chr(160) || 'edge')
  )
  and not private.blurting_json_strings_canonical_v18(
    pg_catalog.jsonb_build_object('value', 'edge' || pg_catalog.chr(8232))
  ),
  'recursive JSON validation allows internal but rejects ECMAScript edge whitespace'
);

select extensions.ok(
  (
    select pg_catalog.count(*) = 3
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_class as relation
      on relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and constraint_row.conname = any(array[
        'blurting_resources_v18_canonical_domains_check',
        'blurting_delivery_receipts_v18_canonical_domains_check',
        'blurting_evaluation_receipts_v18_canonical_domains_check'
      ]::text[])
      and constraint_row.convalidated is true
  )
  and (
    select pg_catalog.pg_get_expr(
      column_default.adbin,
      column_default.adrelid
    ) like '%blurting_statement_timestamp_ms_v18%'
    from pg_catalog.pg_attrdef as column_default
    join pg_catalog.pg_attribute as column_row
      on column_row.attrelid = column_default.adrelid
      and column_row.attnum = column_default.adnum
    where column_default.adrelid =
      'private.blurting_resources_v18'::pg_catalog.regclass
      and column_row.attname = 'created_at'
  )
  and not exists (
    select 1
    from (values
      ('private.guard_blurting_delivery_insert_v18()'),
      ('private.guard_blurting_delivery_transition_v18()'),
      ('private.guard_blurting_evaluation_insert_v18()'),
      ('private.guard_blurting_evaluation_transition_v18()')
    ) as guard(signature)
    where pg_catalog.pg_get_functiondef(
      guard.signature::pg_catalog.regprocedure
    ) like '%pg_catalog.statement_timestamp()%'
  ),
  'canonical constraints, default, and millisecond private guards are installed'
);

create temporary table blurting_v18_public_fixture on commit drop as
select $payload$
{
  "schemaVersion": 18,
  "boundaryStatus": "disabled_public_resource_template_only",
  "identity": {
    "planId": "71000000-0000-4000-8000-000000000001",
    "sessionId": "71000000-0000-4000-8000-000000000002",
    "routeRevisionId": "71000000-0000-4000-8000-000000000003",
    "resourceFingerprint": "sr1:0123456789abcdef",
    "resourceGeneratedAt": "2026-08-25T08:00:00.000Z"
  },
  "orderedTargets": [{
    "targetId": "71000000-0000-4000-8000-000000000004",
    "evidenceId": "blurting-final-check:71000000-0000-4000-8000-000000000004",
    "displayLabel": "Calculus derivatives"
  }],
  "phaseMetadata": [{
    "phaseId": "method-1-retrieve",
    "methodPhase": "retrieve",
    "activeMinutes": 5,
    "targetIds": ["71000000-0000-4000-8000-000000000004"]
  }, {
    "phaseId": "method-2-repair",
    "methodPhase": "repair",
    "activeMinutes": 5,
    "targetIds": ["71000000-0000-4000-8000-000000000004"]
  }, {
    "phaseId": "method-3-transfer",
    "methodPhase": "transfer",
    "activeMinutes": 5,
    "targetIds": ["71000000-0000-4000-8000-000000000004"]
  }],
  "gapCount": 1,
  "initialRecall": {
    "sourceClosedReminder": "Keep the saved source closed during recall.",
    "prompt": "Write everything you remember about the derivative rule."
  }
}
$payload$::jsonb as payload;

select extensions.ok(
  private.blurting_public_resource_payload_valid_v18(
    (select fixture.payload from blurting_v18_public_fixture as fixture)
  ),
  'the exact answer-free public resource payload is valid'
);

select extensions.ok(
  not private.blurting_public_resource_payload_valid_v18(
    (
      select fixture.payload || '{"answerKey":"secret"}'::jsonb
      from blurting_v18_public_fixture as fixture
    )
  ),
  'an extra root secret is invalid'
);

select extensions.ok(
  not private.blurting_public_resource_payload_valid_v18(
    (
      select pg_catalog.jsonb_set(
        fixture.payload,
        '{orderedTargets,0,ExpectedAnswer}',
        '"secret"'::jsonb,
        true
      )
      from blurting_v18_public_fixture as fixture
    )
  ),
  'a nested secret-bearing field is invalid'
);

select extensions.ok(
  not public.generated_session_has_broad_recall_v1(
    '{"schemaVersion":17,"activities":[]}'::jsonb
  ),
  'ordinary generated-session content remains outside broad containment'
);

select extensions.ok(
  public.generated_session_has_broad_recall_v1(
    '{"schemaVersion":18}'::jsonb
  ),
  'a V18 generated-session marker is contained'
);

create temporary table blurting_v18_progress_fixture on commit drop as
select $progress$
{
  "kind": "broad_recall",
  "format": "broad_recall_v1",
  "activityIndex": 0,
  "gapCount": 1,
  "bindings": [{
    "targetId": "71000000-0000-4000-8000-000000000004",
    "evidenceId": "blurting-final-check:71000000-0000-4000-8000-000000000004"
  }],
  "events": []
}
$progress$::jsonb as progress;

select extensions.ok(
  public.is_valid_session_activity_progress(
    (select fixture.progress from blurting_v18_progress_fixture as fixture)
  ),
  'transcript-free broad progress remains structurally valid'
);

select extensions.ok(
  not public.is_valid_session_activity_progress(
    (
      select fixture.progress || '{"learnerAnswer":"secret"}'::jsonb
      from blurting_v18_progress_fixture as fixture
    )
  ),
  'broad progress rejects learner transcript fields'
);

select extensions.is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger as trigger_row
    join pg_catalog.pg_class as relation
      on relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and trigger_row.tgname = any(array[
        'blurting_resources_v18_guard_route_source',
        'blurting_resources_v18_guard_immutability',
        'blurting_delivery_receipts_v18_guard_insert',
        'blurting_delivery_receipts_v18_guard_transition',
        'blurting_evaluation_receipts_v18_guard_insert',
        'blurting_evaluation_receipts_v18_guard_transition'
      ]::text[])
      and not trigger_row.tgisinternal
  ),
  6::bigint,
  'all six V18 route, immutability, and receipt guards are installed'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_class as relation
      on relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = any(array[
        'blurting_resources_v18',
        'blurting_delivery_receipts_v18',
        'blurting_evaluation_receipts_v18'
      ]::text[])
      and constraint_row.convalidated is not true
  ),
  'every V18 table constraint is validated'
);

do $block$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'service_role',
    true
  );
end;
$block$;

select extensions.is(
  public.cleanup_blurting_resource_store_v18(10),
  pg_catalog.jsonb_build_object(
    'deletedEvaluationReceipts', 0,
    'deletedDeliveryReceipts', 0,
    'deletedResources', 0
  ),
  'service cleanup is deletion-only and empty-store idempotent'
);

do $block$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'authenticated',
    true
  );
end;
$block$;

select extensions.throws_ok(
  'select public.cleanup_blurting_resource_store_v18(10)',
  '42501',
  'blurting_resource_store_cleanup_service_role_required',
  'authenticated callers cannot invoke V18 cleanup'
);

select * from extensions.finish();
rollback;
