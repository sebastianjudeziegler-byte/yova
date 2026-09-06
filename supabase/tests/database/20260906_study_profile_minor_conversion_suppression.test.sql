begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(13);

select extensions.is(
  (
    select pg_catalog.count(*)
    from supabase_migrations.schema_migrations as migration
    where migration.version = '202609060003'
  ),
  1::bigint,
  'the minor conversion suppression migration committed'
);

select extensions.is(
  public.study_profile_public_readiness_v4() ->> 'contractVersion',
  '202609060003',
  'readiness exposes the minor conversion suppression contract'
);

select extensions.ok(
  (public.study_profile_public_readiness_v4() ->> 'ready')::boolean,
  'the public Study Profile database boundary is ready'
);

select extensions.ok(
  (public.study_profile_public_readiness_v4() ->> 'minorConversionSuppression')::boolean,
  'readiness verifies minor conversion suppression'
);

select extensions.is(
  (
    select pg_catalog.count(*)
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'under_18'
      and table_name in (
        'study_profile_responses',
        'study_profile_waitlist_confirmations'
      )
      and is_nullable = 'YES'
  ),
  2::bigint,
  'both conversion records preserve nullable under-18 status for legacy rows'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.confirm_study_profile_waitlist_measured(jsonb)',
    'execute'
  ),
  'the service role can call the measured confirmation wrapper'
);

select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.confirm_study_profile_waitlist_measured(jsonb)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.confirm_study_profile_waitlist_measured(jsonb)',
    'execute'
  ),
  'public browser roles cannot call the measured confirmation wrapper'
);

create or replace function pg_temp.study_profile_minor_payload(
  email_value text,
  visitor_value uuid,
  report_hash_value text,
  under_18_value boolean
)
returns jsonb
language sql
as $payload$
  select jsonb_build_object(
    'email', email_value,
    'visitorId', visitor_value,
    'reportTokenHash', report_hash_value,
    'profileModelVersion', 'profile_model_v1',
    'rawAnswers', jsonb_build_object(
      'q1', 1, 'q2', 1, 'q3', 1, 'q4', 1, 'q5', 1, 'q6', 1,
      'q7', 1, 'q8', 1, 'q9', 1, 'q10', 1, 'q11', 1, 'q12', 1
    ),
    'profileSnapshot', jsonb_build_object(
      'rawScores', jsonb_build_object(
        'starting_friction', 1, 'structure_need', 1,
        'attention_variability', 1, 'calibration_risk', 1,
        'mistake_sensitivity', 1, 'cognitive_stamina', 1
      ),
      'normalizedScores', jsonb_build_object(
        'starting_friction', 1, 'structure_need', 1,
        'attention_variability', 1, 'calibration_risk', 1,
        'mistake_sensitivity', 1, 'cognitive_stamina', 1
      ),
      'classifications', jsonb_build_object(
        'starting_friction', 'balanced', 'structure_need', 'balanced',
        'attention_variability', 'balanced', 'calibration_risk', 'balanced',
        'mistake_sensitivity', 'balanced', 'cognitive_stamina', 'balanced'
      ),
      'calibrationDirection', 'mixed',
      'primaryPattern', jsonb_build_object('dimension', 'starting_friction'),
      'secondaryPattern', jsonb_build_object('dimension', 'structure_need'),
      'scoringRevision', 'study_profile_scoring_v2'
    ),
    'reportState', '{}'::jsonb,
    'metadata', jsonb_build_object(
      'energyWindow', 'morning',
      'schoolLevel', 'college',
      'hardestPart', null
    ),
    'marketingConsent', false,
    'under18', under_18_value,
    'consentCopyVersion', 'study-profile-report-v3',
    'emailDeliveryStatus', 'skipped',
    'attribution', jsonb_build_object('source', 'instagram')
  );
$payload$;

create temporary table minor_conversion_receipts (
  step text primary key,
  receipt jsonb not null
) on commit drop;

insert into minor_conversion_receipts (step, receipt)
select 'adult-response', public.save_study_profile_response_attributed(
  pg_temp.study_profile_minor_payload(
    'meta-adult-minor-guard-db-test@example.test',
    '33333333-3333-4333-8333-333333333333',
    repeat('e', 64),
    false
  )
);

select extensions.is(
  (
    select response.under_18
    from public.study_profile_responses as response
    where response.id = (
      select (receipt ->> 'responseId')::uuid
      from minor_conversion_receipts
      where step = 'adult-response'
    )
  ),
  false,
  'an adult report response persists an explicit false status'
);

insert into minor_conversion_receipts (step, receipt)
select 'adult-request', public.request_study_profile_report_waitlist_confirmation_attributed(
  jsonb_build_object(
    'reportTokenHash', repeat('e', 64),
    'confirmationTokenHash', repeat('f', 64),
    'ageConfirmed', true,
    'consentCopyVersion', 'study-profile-waitlist-v4-report-cta',
    'consentSource', 'report_cta',
    'attribution', jsonb_build_object('source', 'instagram')
  )
);

select extensions.is(
  (
    select confirmation.under_18
    from public.study_profile_waitlist_confirmations as confirmation
    where confirmation.id = (
      select (receipt ->> 'confirmationId')::uuid
      from minor_conversion_receipts
      where step = 'adult-request'
    )
  ),
  false,
  'a report waitlist confirmation inherits the persisted adult status'
);

insert into minor_conversion_receipts (step, receipt)
select 'adult-confirm', public.confirm_study_profile_waitlist_measured(
  jsonb_build_object('confirmationTokenHash', repeat('f', 64))
);

select extensions.ok(
  (
    select (receipt ->> 'metaConversionEligible')::boolean
    from minor_conversion_receipts
    where step = 'adult-confirm'
  ),
  'a newly confirmed adult waitlist join is conversion eligible'
);

select extensions.ok(
  (
    public.confirm_study_profile_waitlist_measured(
      jsonb_build_object('confirmationTokenHash', repeat('f', 64))
    ) ->> 'metaConversionEligible'
  )::boolean,
  'a retry of the same adult token remains eligible for event-ID deduplication'
);

insert into minor_conversion_receipts (step, receipt)
select 'minor-request', public.request_study_profile_waitlist_confirmation_attributed(
  jsonb_build_object(
    'email', 'meta-minor-guard-db-test@example.test',
    'visitorId', '44444444-4444-4444-8444-444444444444',
    'confirmationTokenHash', repeat('1', 64),
    'ageConfirmed', true,
    'under18', true,
    'consentCopyVersion', 'study-profile-waitlist-v4-landing',
    'attribution', jsonb_build_object('source', 'facebook')
  )
);

select extensions.is(
  (
    select confirmation.under_18
    from public.study_profile_waitlist_confirmations as confirmation
    where confirmation.id = (
      select (receipt ->> 'confirmationId')::uuid
      from minor_conversion_receipts
      where step = 'minor-request'
    )
  ),
  true,
  'a landing waitlist request persists the under-18 status'
);

select extensions.ok(
  not (
    public.confirm_study_profile_waitlist_measured(
      jsonb_build_object('confirmationTokenHash', repeat('1', 64))
    ) ->> 'metaConversionEligible'
  )::boolean,
  'a confirmed under-18 waitlist join is not conversion eligible'
);

select * from extensions.finish();
rollback;
