begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(16);

select extensions.is(
  (
    select pg_catalog.count(*)
    from supabase_migrations.schema_migrations as migration
    where migration.version = '202609070004'
  ),
  1::bigint,
  'the founder analytics dashboard migration committed'
);

select extensions.is(
  (
    select pg_catalog.count(*)
    from information_schema.columns as column_definition
    where column_definition.table_schema = 'public'
      and column_definition.table_name in (
        'product_events',
        'study_profile_events'
      )
      and column_definition.column_name = 'device_type'
      and column_definition.is_nullable = 'NO'
      and column_definition.column_default like '%unknown%'
  ),
  2::bigint,
  'both event streams store a non-null device category with an unknown default'
);

select extensions.is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint as constraint_definition
    where constraint_definition.conname in (
      'product_events_device_type_check',
      'study_profile_events_device_type_check'
    )
      and constraint_definition.contype = 'c'
      and constraint_definition.convalidated
  ),
  2::bigint,
  'both broad device category checks are validated'
);

select extensions.is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_class as relation
    where relation.oid in (
      pg_catalog.to_regclass('public.product_events_device_time_idx'),
      pg_catalog.to_regclass('public.study_profile_events_device_time_idx'),
      pg_catalog.to_regclass(
        'public.study_profile_waitlist_confirmations_requested_time_idx'
      ),
      pg_catalog.to_regclass(
        'public.study_profile_waitlist_confirmations_confirmed_time_idx'
      )
    )
      and relation.relkind = 'i'
  ),
  4::bigint,
  'the dashboard time and device indexes exist'
);

select extensions.is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc as routine
    where routine.oid in (
      pg_catalog.to_regprocedure('public.founder_product_analytics(integer)'),
      pg_catalog.to_regprocedure(
        'public.founder_study_profile_analytics(integer)'
      )
    )
      and routine.prosecdef
      and routine.provolatile = 's'
      and routine.proconfig @> array['search_path=""']
  ),
  2::bigint,
  'both dashboard RPCs are stable security-definer functions with an empty search path'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.founder_product_analytics(integer)',
    'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.founder_study_profile_analytics(integer)',
    'execute'
  ),
  'authenticated founders can execute both dashboard RPCs'
);

select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.founder_product_analytics(integer)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.founder_study_profile_analytics(integer)',
    'execute'
  ),
  'anonymous visitors cannot execute either dashboard RPC'
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
) values
  (
    '97000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'founder-analytics-pgtap@yova.invalid',
    '',
    pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  ),
  (
    '97000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-8000-000000000000',
    'authenticated',
    'authenticated',
    'dashboard-learner-pgtap@yova.invalid',
    '',
    pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  );

update public.profiles
set onboarding_completed_at = pg_catalog.clock_timestamp()
where id in (
  '97000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000002'
);

insert into public.product_events (
  user_id,
  event_name,
  event_data,
  device_type
) values
  (
    '97000000-0000-4000-8000-000000000001',
    'alpha_entered',
    '{}'::jsonb,
    'desktop'
  ),
  (
    '97000000-0000-4000-8000-000000000002',
    'alpha_entered',
    '{}'::jsonb,
    'mobile'
  );

insert into public.study_profile_leads (email_normalized)
values ('private-dashboard-marker@example.test');

insert into public.study_profile_events (
  visitor_id,
  event_name,
  event_data,
  profile_model_version,
  traffic_source,
  utm_source,
  utm_medium,
  utm_campaign,
  device_type
) values
  (
    '97000000-0000-4000-8000-000000000010',
    'study_profile_page_viewed',
    '{}'::jsonb,
    'profile_model_v1',
    'direct',
    'private-attribution-marker@example.test',
    null,
    null,
    'mobile'
  ),
  (
    '97000000-0000-4000-8000-000000000010',
    'study_profile_started',
    '{}'::jsonb,
    'profile_model_v1',
    'direct',
    null,
    null,
    null,
    'mobile'
  ),
  (
    '97000000-0000-4000-8000-000000000010',
    'study_profile_question_answered',
    '{"questionNumber":1}'::jsonb,
    'profile_model_v1',
    'direct',
    null,
    null,
    null,
    'mobile'
  ),
  (
    '97000000-0000-4000-8000-000000000010',
    'study_profile_question_answered',
    '{"questionNumber":"malformed"}'::jsonb,
    'profile_model_v1',
    'direct',
    null,
    null,
    null,
    'mobile'
  );

do $block$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    '97000000-0000-4000-8000-000000000001',
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$block$;

select extensions.throws_ok(
  $statement$
    select public.founder_product_analytics(30)
  $statement$,
  'P0001',
  'Founder access is required.',
  'a signed-in non-founder cannot read product aggregates'
);

insert into public.founder_accounts (user_id)
values ('97000000-0000-4000-8000-000000000001');

create temporary table founder_analytics_results (
  product jsonb not null,
  study_profile jsonb not null
) on commit drop;

insert into founder_analytics_results (product, study_profile)
select
  public.founder_product_analytics(30),
  public.founder_study_profile_analytics(30);

select extensions.is(
  (
    select pg_catalog.array_agg(key order by key)
    from founder_analytics_results as result,
      lateral pg_catalog.jsonb_object_keys(result.product) as key
  ),
  array[
    'cohortFunnel',
    'daily',
    'deviceBreakdown',
    'eventBreakdown',
    'generatedAt',
    'summary',
    'windowDays'
  ]::text[],
  'the product RPC returns only the documented top-level contract'
);

select extensions.is(
  (
    select pg_catalog.array_agg(key order by key)
    from founder_analytics_results as result,
      lateral pg_catalog.jsonb_object_keys(result.study_profile) as key
  ),
  array[
    'acquisition',
    'audience',
    'daily',
    'delivery',
    'deviceBreakdown',
    'generatedAt',
    'questionReach',
    'rates',
    'summary',
    'windowDays'
  ]::text[],
  'the Study Profile RPC returns only the documented top-level contract'
);

select extensions.ok(
  (
    select
      (result.product #>> '{summary,totalAccounts}')::integer = 1
      and (result.product #>> '{summary,engagedUsers}')::integer = 1
      and (result.product #>> '{summary,onboardingRate}')::numeric = 100.0
    from founder_analytics_results as result
  ),
  'product totals exclude the founder account everywhere'
);

select extensions.is(
  (
    select pg_catalog.jsonb_array_length(result.product -> 'deviceBreakdown')
    from founder_analytics_results as result
  ),
  4,
  'the product device breakdown is zero-filled across all categories'
);

select extensions.ok(
  (
    select
      (result.study_profile #>> '{summary,pageViews}')::integer = 1
      and (result.study_profile #>> '{summary,trackedVisits}')::integer = 1
      and (result.study_profile #>> '{summary,started}')::integer = 1
      and (result.study_profile #>> '{summary,reportWaitlist}')::integer = 0
      and pg_catalog.jsonb_array_length(
        result.study_profile -> 'questionReach'
      ) = 14
      and (
        result.study_profile #>> '{questionReach,0,answeredJourneys}'
      )::integer = 1
    from founder_analytics_results as result
  ),
  'the Study Profile RPC deduplicates journeys and returns all questions'
);

select extensions.ok(
  (
    select
      pg_catalog.jsonb_array_length(
        result.study_profile -> 'deviceBreakdown'
      ) = 4
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          result.study_profile -> 'deviceBreakdown'
        ) as device
        where device ->> 'device' = 'mobile'
          and (device ->> 'count')::integer = 1
      )
    from founder_analytics_results as result
  ),
  'Study Profile device counts use page-view journeys and include zero categories'
);

select extensions.ok(
  (
    select pg_catalog.strpos(
      pg_catalog.lower(result.product::text || result.study_profile::text),
      'private-dashboard-marker@example.test'
    ) = 0
    and pg_catalog.strpos(
      pg_catalog.lower(result.study_profile::text),
      'private-attribution-marker@example.test'
    ) = 0
    and exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        result.study_profile -> 'acquisition'
      ) as acquisition
      where acquisition ->> 'source' = 'redacted'
    )
    from founder_analytics_results as result
  ),
  'aggregate RPC output redacts stored lead and attribution identifiers'
);

select extensions.ok(
  public.founder_product_analytics(0) ->> 'windowDays' = '1'
  and public.founder_product_analytics(365) ->> 'windowDays' = '90'
  and public.founder_study_profile_analytics(null) ->> 'windowDays' = '30',
  'both RPCs clamp invalid and null date windows'
);

select * from extensions.finish();
rollback;
