begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(6);

select extensions.is(
  (
    select pg_catalog.count(*)
    from supabase_migrations.schema_migrations as migration
    where migration.version = '202609060002'
  ),
  1::bigint,
  'the Study Profile first-touch correction migration committed'
);

select extensions.is(
  public.study_profile_public_readiness_v3() ->> 'contractVersion',
  '202609060002',
  'readiness exposes the corrected attribution contract version'
);

select extensions.ok(
  (public.study_profile_public_readiness_v3() ->> 'ready')::boolean,
  'the corrected public Study Profile database boundary is ready'
);

select extensions.ok(
  (public.study_profile_public_readiness_v3() ->> 'attributionFirstTouch')::boolean,
  'readiness verifies first tagged-touch handling'
);

create or replace function pg_temp.study_profile_payload(
  email_value text,
  visitor_value uuid,
  report_hash_value text,
  attribution_value jsonb
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
    'consentCopyVersion', 'study-profile-report-v3',
    'emailDeliveryStatus', 'skipped',
    'attribution', attribution_value
  );
$payload$;

create temporary table meta_attribution_receipts (
  step text primary key,
  receipt jsonb not null
) on commit drop;

insert into meta_attribution_receipts (step, receipt)
select 'direct-response', public.save_study_profile_response_attributed(
  pg_temp.study_profile_payload(
    'meta-direct-first-touch-db-test@example.test',
    '11111111-1111-4111-8111-111111111111',
    repeat('a', 64),
    jsonb_build_object('source', 'direct')
  )
);

insert into meta_attribution_receipts (step, receipt)
select 'direct-confirmation', public.request_study_profile_report_waitlist_confirmation_attributed(
  jsonb_build_object(
    'reportTokenHash', repeat('a', 64),
    'confirmationTokenHash', repeat('c', 64),
    'ageConfirmed', true,
    'consentCopyVersion', 'study-profile-waitlist-v3-report-cta',
    'consentSource', 'report_cta',
    'attribution', jsonb_build_object(
      'source', 'instagram',
      'utmSource', 'instagram',
      'utmMedium', 'paid_social',
      'utmCampaign', 'study_profile_quiz',
      'utmContent', 'static_v1',
      'utmTerm', 'student_productivity',
      'fbclid', 'meta_click_direct_first'
    )
  )
);

select extensions.ok(
  (
    select
      confirmation.traffic_source = 'instagram'
      and confirmation.utm_source = 'instagram'
      and confirmation.utm_medium = 'paid_social'
      and confirmation.utm_campaign = 'study_profile_quiz'
      and confirmation.utm_content = 'static_v1'
      and confirmation.utm_term = 'student_productivity'
      and confirmation.fbclid = 'meta_click_direct_first'
    from public.study_profile_waitlist_confirmations as confirmation
    where confirmation.id = (
      select (receipt ->> 'confirmationId')::uuid
      from meta_attribution_receipts
      where step = 'direct-confirmation'
    )
  ),
  'a direct response accepts the later report CTA as its first tagged touch'
);

insert into meta_attribution_receipts (step, receipt)
select 'tagged-response', public.save_study_profile_response_attributed(
  pg_temp.study_profile_payload(
    'meta-tagged-first-touch-db-test@example.test',
    '22222222-2222-4222-8222-222222222222',
    repeat('b', 64),
    jsonb_build_object(
      'source', 'instagram',
      'utmSource', 'instagram',
      'utmMedium', 'paid_social',
      'utmCampaign', 'original_campaign',
      'utmContent', 'original_creative',
      'fbclid', 'meta_click_original'
    )
  )
);

insert into meta_attribution_receipts (step, receipt)
select 'tagged-confirmation', public.request_study_profile_report_waitlist_confirmation_attributed(
  jsonb_build_object(
    'reportTokenHash', repeat('b', 64),
    'confirmationTokenHash', repeat('d', 64),
    'ageConfirmed', true,
    'consentCopyVersion', 'study-profile-waitlist-v3-report-cta',
    'consentSource', 'report_cta',
    'attribution', jsonb_build_object(
      'source', 'facebook',
      'utmSource', 'facebook',
      'utmMedium', 'paid_social',
      'utmCampaign', 'later_campaign',
      'utmContent', 'later_creative',
      'fbclid', 'meta_click_later'
    )
  )
);

select extensions.ok(
  (
    select
      confirmation.traffic_source = 'instagram'
      and confirmation.utm_source = 'instagram'
      and confirmation.utm_medium = 'paid_social'
      and confirmation.utm_campaign = 'original_campaign'
      and confirmation.utm_content = 'original_creative'
      and confirmation.utm_term is null
      and confirmation.fbclid = 'meta_click_original'
    from public.study_profile_waitlist_confirmations as confirmation
    where confirmation.id = (
      select (receipt ->> 'confirmationId')::uuid
      from meta_attribution_receipts
      where step = 'tagged-confirmation'
    )
  ),
  'an attributed response keeps one coherent original snapshot'
);

select * from extensions.finish();
rollback;
