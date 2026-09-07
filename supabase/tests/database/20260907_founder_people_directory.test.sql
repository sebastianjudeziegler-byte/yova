begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(19);

select extensions.is(
  (
    select pg_catalog.count(*)
    from supabase_migrations.schema_migrations as migration
    where migration.version = '202609070006'
  ),
  1::bigint,
  'the corrected founder people directory migration committed'
);

select extensions.ok(
  (
    select
      routine.prosecdef
      and routine.provolatile = 's'
      and routine.proconfig @> array['search_path=""']
    from pg_catalog.pg_proc as routine
    where routine.oid = pg_catalog.to_regprocedure(
      'public.founder_people_directory(text,text,text,timestamptz,text,integer)'
    )
  ),
  'the directory is a stable security-definer function with an empty search path'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.founder_people_directory(text,text,text,timestamptz,text,integer)',
    'execute'
  ),
  'authenticated founders can execute the directory RPC'
);

select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.founder_people_directory(text,text,text,timestamptz,text,integer)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.founder_people_directory(text,text,text,timestamptz,text,integer)',
    'execute'
  ),
  'anonymous and service roles cannot execute the directory RPC'
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
    '99000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'directory-20260907-founder@example.test',
    '',
    pg_catalog.now() - interval '10 days',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"privateMarker":"must-not-leak"}'::jsonb,
    pg_catalog.now() - interval '10 days',
    pg_catalog.now() - interval '10 days'
  ),
  (
    '99000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'directory-20260907-linked@example.test',
    '',
    pg_catalog.now() - interval '8 days',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    pg_catalog.now() - interval '8 days',
    pg_catalog.now() - interval '8 days'
  ),
  (
    '99000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'directory-20260907-account@example.test',
    '',
    null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    pg_catalog.now() - interval '7 days',
    pg_catalog.now() - interval '7 days'
  );

update public.profiles
set
  display_name = case id
    when '99000000-0000-4000-8000-000000000002'::uuid
      then 'Linked Learner'
    when '99000000-0000-4000-8000-000000000003'::uuid
      then 'Account Learner'
    else 'Founder'
  end,
  onboarding_completed_at = case
    when id = '99000000-0000-4000-8000-000000000002'::uuid
      then pg_catalog.now() - interval '6 days'
    else null
  end
where id in (
  '99000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000002',
  '99000000-0000-4000-8000-000000000003'
);

insert into public.tester_invites (
  email,
  display_name,
  auth_user_id,
  invited_by,
  status,
  send_count,
  invited_at,
  joined_at
) values
  (
    'directory-20260907-founder@example.test',
    'Founder Invite',
    '99000000-0000-4000-8000-000000000001',
    '99000000-0000-4000-8000-000000000001',
    'joined',
    1,
    pg_catalog.now() - interval '9 days',
    pg_catalog.now() - interval '9 days'
  ),
  (
    'directory-20260907-linked@example.test',
    'Linked Invite',
    '99000000-0000-4000-8000-000000000002',
    '99000000-0000-4000-8000-000000000001',
    'joined',
    1,
    pg_catalog.now() - interval '5 days',
    pg_catalog.now() - interval '4 days'
  ),
  (
    'directory-20260907-tester@example.test',
    'Pending Tester',
    null,
    '99000000-0000-4000-8000-000000000001',
    'pending',
    1,
    pg_catalog.now() - interval '3 days',
    null
  );

insert into public.study_profile_leads (email_normalized)
values ('directory-20260907-founder@example.test');

create or replace function pg_temp.founder_people_profile_payload(
  email_value text,
  visitor_value uuid,
  report_hash_value text,
  marketing_consent_value boolean,
  delivery_status_value text,
  under_18_value boolean,
  attribution_value jsonb
)
returns jsonb
language sql
as $payload$
  select pg_catalog.jsonb_build_object(
    'email', email_value,
    'visitorId', visitor_value,
    'reportTokenHash', report_hash_value,
    'profileModelVersion', 'profile_model_v1',
    'rawAnswers', pg_catalog.jsonb_build_object(
      'q1', 1, 'q2', 1, 'q3', 1, 'q4', 1, 'q5', 1, 'q6', 1,
      'q7', 1, 'q8', 1, 'q9', 1, 'q10', 1, 'q11', 1, 'q12', 1
    ),
    'profileSnapshot', pg_catalog.jsonb_build_object(
      'rawScores', pg_catalog.jsonb_build_object(
        'starting_friction', 1, 'structure_need', 1,
        'attention_variability', 1, 'calibration_risk', 1,
        'mistake_sensitivity', 1, 'cognitive_stamina', 1
      ),
      'normalizedScores', pg_catalog.jsonb_build_object(
        'starting_friction', 1, 'structure_need', 1,
        'attention_variability', 1, 'calibration_risk', 1,
        'mistake_sensitivity', 1, 'cognitive_stamina', 1
      ),
      'classifications', pg_catalog.jsonb_build_object(
        'starting_friction', 'balanced', 'structure_need', 'balanced',
        'attention_variability', 'balanced', 'calibration_risk', 'balanced',
        'mistake_sensitivity', 'balanced', 'cognitive_stamina', 'balanced'
      ),
      'calibrationDirection', 'mixed',
      'primaryPattern', pg_catalog.jsonb_build_object(
        'dimension', 'starting_friction'
      ),
      'secondaryPattern', pg_catalog.jsonb_build_object(
        'dimension', 'structure_need'
      ),
      'scoringRevision', 'study_profile_scoring_v2'
    ),
    'reportState', '{}'::jsonb,
    'metadata', pg_catalog.jsonb_build_object(
      'energyWindow', 'morning',
      'schoolLevel', 'college',
      'hardestPart', 'private response must not leave storage'
    ),
    'marketingConsent', marketing_consent_value,
    'consentCopyVersion', 'study-profile-report-v3',
    'emailDeliveryStatus', delivery_status_value,
    'under18', under_18_value,
    'attribution', attribution_value
  );
$payload$;

create temporary table founder_people_receipts (
  name text primary key,
  receipt jsonb not null
) on commit drop;

insert into founder_people_receipts (name, receipt)
select 'linked', public.save_study_profile_response_attributed(
  pg_temp.founder_people_profile_payload(
    'directory-20260907-linked@example.test',
    '99000000-0000-4000-8000-000000000012',
    pg_catalog.repeat('a', 64),
    true,
    'sent',
    false,
    pg_catalog.jsonb_build_object(
      'source', 'instagram',
      'utmSource', 'instagram',
      'utmMedium', 'paid_social',
      'utmCampaign', 'study_profile_quiz',
      'utmContent', 'creative-one',
      'utmTerm', 'exam prep',
      'fbclid', 'meta_click_linked_secret'
    )
  )
);

insert into founder_people_receipts (name, receipt)
select 'lead', public.save_study_profile_response_attributed(
  pg_temp.founder_people_profile_payload(
    'directory-20260907-lead@example.test',
    '99000000-0000-4000-8000-000000000013',
    pg_catalog.repeat('b', 64),
    false,
    'failed',
    true,
    pg_catalog.jsonb_build_object(
      'source', 'campaign',
      'utmSource', 'owner@example.test',
      'utmMedium', 'study-profile/report/' || pg_catalog.repeat('c', 32),
      'utmCampaign', pg_catalog.repeat('d', 40),
      'utmContent', 'creative-two',
      'utmTerm', 'study habits',
      'fbclid', 'meta_click_lead_secret'
    )
  )
);

update public.study_profile_responses
set email_sent_at = pg_catalog.now() - interval '2 days'
where id = (
  select (receipt ->> 'responseId')::uuid
  from founder_people_receipts
  where name = 'linked'
);

update public.study_profile_leads
set
  waitlist_status = 'joined',
  waitlist_joined_at = pg_catalog.now() - interval '1 day',
  waitlist_consent_copy_version = 'study-profile-waitlist-v3-report-cta',
  waitlist_consent_source = 'report_cta',
  beta_interest = true,
  beta_interest_updated_at = pg_catalog.now() - interval '1 day'
where email_normalized = 'directory-20260907-linked@example.test';

insert into public.study_profile_waitlist_confirmations (
  lead_id,
  response_id,
  visitor_id,
  status,
  consent_copy_version,
  consent_source,
  age_confirmed,
  scoring_revision,
  profile_model_version,
  requested_at,
  confirmed_at,
  delivery_status,
  under_18
)
select
  lead.id,
  (receipt.receipt ->> 'responseId')::uuid,
  '99000000-0000-4000-8000-000000000012',
  'confirmed',
  'study-profile-waitlist-v3-report-cta',
  'report_cta',
  true,
  'study_profile_scoring_v2',
  'profile_model_v1',
  pg_catalog.now() - interval '1 day',
  pg_catalog.now() - interval '1 day',
  'sent',
  false
from public.study_profile_leads as lead
cross join founder_people_receipts as receipt
where lead.email_normalized = 'directory-20260907-linked@example.test'
  and receipt.name = 'linked';

insert into public.study_profile_waitlist_confirmations (
  lead_id,
  response_id,
  visitor_id,
  token_hash,
  status,
  consent_copy_version,
  consent_source,
  age_confirmed,
  scoring_revision,
  profile_model_version,
  requested_at,
  expires_at,
  resend_after,
  delivery_status,
  under_18
)
select
  lead.id,
  (receipt.receipt ->> 'responseId')::uuid,
  '99000000-0000-4000-8000-000000000013',
  pg_catalog.repeat('e', 64),
  'pending',
  'study-profile-waitlist-v3-email-gate',
  'email_gate',
  true,
  'study_profile_scoring_v2',
  'profile_model_v1',
  pg_catalog.now() - interval '1 hour',
  pg_catalog.now() + interval '23 hours',
  pg_catalog.now() + interval '14 minutes',
  'pending',
  true
from public.study_profile_leads as lead
cross join founder_people_receipts as receipt
where lead.email_normalized = 'directory-20260907-lead@example.test'
  and receipt.name = 'lead';

insert into public.study_profile_events (
  visitor_id,
  response_id,
  event_name,
  event_data,
  profile_model_version,
  device_type,
  occurred_at
)
select
  '99000000-0000-4000-8000-000000000012',
  (receipt ->> 'responseId')::uuid,
  'study_profile_report_viewed',
  '{}'::jsonb,
  'profile_model_v1',
  'mobile',
  pg_catalog.now() - interval '30 minutes'
from founder_people_receipts
where name = 'linked';

do $block$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    '99000000-0000-4000-8000-000000000003',
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$block$;

select extensions.throws_ok(
  $statement$
    select public.founder_people_directory()
  $statement$,
  'P0001',
  'Founder access is required.',
  'a signed-in non-founder cannot read the people directory'
);

insert into public.founder_accounts (user_id)
values ('99000000-0000-4000-8000-000000000001');

do $block$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    '99000000-0000-4000-8000-000000000001',
    true
  );
end;
$block$;

select extensions.throws_ok(
  $statement$
    select public.founder_people_directory(
      '',
      'all',
      'all',
      pg_catalog.now(),
      pg_catalog.repeat('x', 321),
      25
    )
  $statement$,
  'P0001',
  'A valid founder people cursor email is required.',
  'the direct RPC rejects an unbounded cursor email'
);

create temporary table founder_people_results (
  name text primary key,
  payload jsonb not null
) on commit drop;

insert into founder_people_results (name, payload) values
  (
    'all',
    public.founder_people_directory('directory-20260907-')
  ),
  (
    'accounts',
    public.founder_people_directory(
      'directory-20260907-', 'accounts', 'all'
    )
  ),
  (
    'leads',
    public.founder_people_directory(
      'directory-20260907-', 'leads', 'all'
    )
  ),
  (
    'waitlist',
    public.founder_people_directory(
      'directory-20260907-', 'waitlist', 'all'
    )
  ),
  (
    'testers',
    public.founder_people_directory(
      'directory-20260907-', 'testers', 'all'
    )
  ),
  (
    'onboarding-incomplete',
    public.founder_people_directory(
      'directory-20260907-', 'all', 'onboarding_incomplete'
    )
  ),
  (
    'report-unlocked',
    public.founder_people_directory(
      'directory-20260907-', 'all', 'report_unlocked'
    )
  ),
  (
    'confirmation-pending',
    public.founder_people_directory(
      'directory-20260907-', 'all', 'confirmation_pending'
    )
  ),
  (
    'waitlist-confirmed',
    public.founder_people_directory(
      'directory-20260907-', 'all', 'waitlist_confirmed'
    )
  ),
  (
    'email-failed',
    public.founder_people_directory(
      'directory-20260907-', 'all', 'email_failed'
    )
  ),
  (
    'display-name-search',
    public.founder_people_directory('linked learner')
  ),
  (
    'page-one',
    public.founder_people_directory(
      'directory-20260907-', 'all', 'all', null, null, 2
    )
  ),
  (
    'clamped-one',
    public.founder_people_directory(
      'directory-20260907-', 'all', 'all', null, null, 0
    )
  );

insert into founder_people_results (name, payload)
select
  'page-two',
  public.founder_people_directory(
    'directory-20260907-',
    'all',
    'all',
    (first_page.payload #>> '{nextCursor,seenAt}')::timestamptz,
    first_page.payload #>> '{nextCursor,email}',
    2
  )
from founder_people_results as first_page
where first_page.name = 'page-one';

select extensions.is(
  (
    select pg_catalog.array_agg(key order by key)
    from founder_people_results as result,
      lateral pg_catalog.jsonb_object_keys(result.payload) as key
    where result.name = 'all'
  ),
  array[
    'generatedAt',
    'hasMore',
    'nextCursor',
    'rows',
    'summary',
    'total'
  ]::text[],
  'the directory returns only the documented top-level contract'
);

select extensions.ok(
  (
    select
      (result.payload ->> 'total')::integer = 4
      and (result.payload #>> '{summary,uniquePeople}')::integer = 4
      and (result.payload #>> '{summary,yovaAccounts}')::integer = 2
      and (result.payload #>> '{summary,studyProfileLeads}')::integer = 2
      and (result.payload #>> '{summary,confirmedWaitlist}')::integer = 1
      and (result.payload #>> '{summary,pendingInvites}')::integer = 1
    from founder_people_results as result
    where result.name = 'all'
  ),
  'summary counts exclude founders and merge exact normalized emails'
);

select extensions.is(
  (
    select pg_catalog.array_agg(key order by key)
    from founder_people_results as result
    cross join lateral pg_catalog.jsonb_array_elements(
      result.payload -> 'rows'
    ) as person_row
    cross join lateral pg_catalog.jsonb_object_keys(person_row) as key
    where result.name = 'all'
      and person_row ->> 'email' = 'directory-20260907-linked@example.test'
  ),
  (
    select pg_catalog.array_agg(expected_key order by expected_key)
    from pg_catalog.unnest(array[
      'email', 'kind', 'matchBasis', 'displayName', 'recentAt',
      'hasYovaAccount', 'hasStudyProfileLead', 'accountCreatedAt',
      'emailConfirmedAt', 'lastSignInAt', 'onboardingCompletedAt',
      'inviteStatus', 'invitedAt', 'joinedAt', 'lastProductActivityAt',
      'plansCount', 'sessionsCompleted', 'studyMinutes', 'leadCreatedAt',
      'profileStatus', 'reportCount', 'latestReportAt', 'reportEmailStatus',
      'reportEmailSentAt', 'reportViewedAt', 'marketingConsentAt',
      'waitlistStatus', 'waitlistConfirmationStatus',
      'waitlistConsentSource', 'waitlistRequestedAt', 'waitlistJoinedAt',
      'confirmationDeliveryStatus', 'schoolLevel', 'ageBand',
      'primaryPattern', 'energyWindow', 'source', 'medium', 'campaign',
      'content', 'term', 'deviceType', 'hasMetaClick', 'betaInterest'
    ]::text[]) as expected_key
  ),
  'every directory row has exactly the strict safe-field contract'
);

select extensions.ok(
  (
    select
      person_row ->> 'kind' = 'linked'
      and person_row ->> 'matchBasis' = 'exact_normalized_email'
      and (person_row ->> 'hasYovaAccount')::boolean
      and (person_row ->> 'hasStudyProfileLead')::boolean
      and person_row ->> 'displayName' = 'Linked Learner'
      and person_row ->> 'inviteStatus' = 'joined'
      and (person_row ->> 'reportCount')::integer = 1
      and person_row ->> 'reportEmailStatus' = 'sent'
      and person_row ->> 'marketingConsentAt' is not null
      and person_row ->> 'waitlistStatus' = 'joined'
      and person_row ->> 'waitlistConfirmationStatus' = 'confirmed'
      and person_row ->> 'waitlistConsentSource' = 'report_cta'
      and person_row ->> 'confirmationDeliveryStatus' = 'sent'
      and person_row ->> 'ageBand' = '18_plus'
      and person_row ->> 'source' = 'instagram'
      and person_row ->> 'medium' = 'paid_social'
      and person_row ->> 'campaign' = 'study_profile_quiz'
      and person_row ->> 'deviceType' = 'mobile'
      and (person_row ->> 'hasMetaClick')::boolean
      and (person_row ->> 'betaInterest')::boolean
    from founder_people_results as result
    cross join lateral pg_catalog.jsonb_array_elements(
      result.payload -> 'rows'
    ) as person_row
    where result.name = 'all'
      and person_row ->> 'email' = 'directory-20260907-linked@example.test'
  ),
  'an exact email match links safe account, invite, report, and consent facts'
);

select extensions.ok(
  (
    select
      person_row ->> 'kind' = 'lead'
      and person_row ->> 'matchBasis' is null
      and not (person_row ->> 'hasYovaAccount')::boolean
      and (person_row ->> 'hasStudyProfileLead')::boolean
      and person_row ->> 'profileStatus' = 'report_unlocked'
      and person_row ->> 'reportEmailStatus' = 'failed'
      and person_row ->> 'marketingConsentAt' is null
      and person_row ->> 'waitlistConfirmationStatus' = 'pending'
      and person_row ->> 'waitlistConsentSource' = 'email_gate'
      and person_row ->> 'ageBand' = '13_17'
      and person_row ->> 'source' = 'redacted'
      and person_row ->> 'medium' = 'redacted'
      and person_row ->> 'campaign' = 'redacted'
      and person_row ->> 'content' = 'creative-two'
      and person_row ->> 'term' = 'study habits'
      and (person_row ->> 'hasMetaClick')::boolean
    from founder_people_results as result
    cross join lateral pg_catalog.jsonb_array_elements(
      result.payload -> 'rows'
    ) as person_row
    where result.name = 'all'
      and person_row ->> 'email' = 'directory-20260907-lead@example.test'
  ),
  'lead rows expose truthful lifecycle data and redact unsafe attribution labels'
);

select extensions.ok(
  (
    select
      pg_catalog.jsonb_array_length(result.payload -> 'rows') = 4
      and pg_catalog.strpos(
        result.payload::text,
        'directory-20260907-founder@example.test'
      ) = 0
      and (
        select pg_catalog.array_agg(
          person_row ->> 'kind'
          order by person_row ->> 'kind'
        )
        from pg_catalog.jsonb_array_elements(
          result.payload -> 'rows'
        ) as person_row
      ) = array['account', 'lead', 'linked', 'tester']::text[]
    from founder_people_results as result
    where result.name = 'all'
  ),
  'the directory excludes the founder and emits the four documented row kinds'
);

select extensions.ok(
  (
    select pg_catalog.bool_and((result.payload ->> 'total')::integer = 2)
    from founder_people_results as result
    where result.name in ('accounts', 'leads', 'waitlist', 'testers')
  ),
  'all four kind filters use the merged person facts'
);

select extensions.ok(
  (
    select pg_catalog.bool_and((result.payload ->> 'total')::integer = 1)
    from founder_people_results as result
    where result.name in (
      'onboarding-incomplete',
      'confirmation-pending',
      'waitlist-confirmed',
      'email-failed'
    )
  )
  and (
    select (result.payload ->> 'total')::integer = 2
    from founder_people_results as result
    where result.name = 'report-unlocked'
  ),
  'each status filter selects its authoritative lifecycle state'
);

select extensions.ok(
  (
    select
      (result.payload ->> 'total')::integer = 1
      and result.payload #>> '{rows,0,email}' =
        'directory-20260907-linked@example.test'
    from founder_people_results as result
    where result.name = 'display-name-search'
  ),
  'search matches a normalized display name without widening the payload'
);

select extensions.ok(
  (
    select
      pg_catalog.jsonb_array_length(result.payload -> 'rows') = 2
      and (result.payload ->> 'hasMore')::boolean
      and result.payload -> 'nextCursor' is not null
    from founder_people_results as result
    where result.name = 'page-one'
  ),
  'the first keyset page returns its requested size and an opaque cursor'
);

select extensions.ok(
  (
    select
      pg_catalog.jsonb_array_length(second_page.payload -> 'rows') = 2
      and not (second_page.payload ->> 'hasMore')::boolean
      and second_page.payload -> 'nextCursor' = 'null'::jsonb
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(first_page.payload -> 'rows') as first_row
        inner join pg_catalog.jsonb_array_elements(
          second_page.payload -> 'rows'
        ) as second_row
          on second_row ->> 'email' = first_row ->> 'email'
      )
    from founder_people_results as first_page
    cross join founder_people_results as second_page
    where first_page.name = 'page-one'
      and second_page.name = 'page-two'
  ),
  'the next keyset page is stable and contains no duplicate person'
);

select extensions.ok(
  (
    select
      pg_catalog.jsonb_array_length(result.payload -> 'rows') = 1
      and (result.payload ->> 'hasMore')::boolean
    from founder_people_results as result
    where result.name = 'clamped-one'
  ),
  'the direct RPC clamps a non-positive result limit to one row'
);

select extensions.ok(
  (
    select
      pg_catalog.strpos(
        pg_catalog.lower(result.payload::text),
        'must-not-leak'
      ) = 0
      and pg_catalog.strpos(
        result.payload::text,
        '99000000-0000-4000-8000-000000000012'
      ) = 0
      and pg_catalog.strpos(
        result.payload::text,
        pg_catalog.repeat('a', 64)
      ) = 0
      and pg_catalog.strpos(
        result.payload::text,
        'meta_click_linked_secret'
      ) = 0
      and pg_catalog.strpos(
        pg_catalog.lower(result.payload::text),
        'private response must not leave storage'
      ) = 0
    from founder_people_results as result
    where result.name = 'all'
  ),
  'private metadata, visitor IDs, response text, hashes, and click IDs never leave the RPC'
);

select * from extensions.finish();
rollback;
