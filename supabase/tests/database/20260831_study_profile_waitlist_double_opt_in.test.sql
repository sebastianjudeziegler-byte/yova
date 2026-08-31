begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(18);

select extensions.is(
  (
    select pg_catalog.count(*)
    from supabase_migrations.schema_migrations as migration
    where migration.version = '202608310002'
  ),
  1::bigint,
  'the Study Profile double opt-in migration committed'
);

select extensions.is(
  public.study_profile_public_readiness_v1() ->> 'contractVersion',
  '202608310002',
  'readiness exposes the expected contract version'
);

select extensions.ok(
  (public.study_profile_public_readiness_v1() ->> 'ready')::boolean,
  'the complete public Study Profile database boundary is ready'
);

select extensions.ok(
  (public.study_profile_public_readiness_v1() ->> 'pendingConfirmationColumns')::boolean,
  'pending confirmation storage and RLS are present'
);

select extensions.ok(
  (public.study_profile_public_readiness_v1() ->> 'confirmationRpcs')::boolean,
  'all confirmation RPCs are present'
);

select extensions.ok(
  (public.study_profile_public_readiness_v1() ->> 'reportEmailCooldown')::boolean,
  'the report email cooldown boundary is present'
);

select extensions.ok(
  (public.study_profile_public_readiness_v1() ->> 'serviceRoleBoundary')::boolean,
  'browser roles cannot cross the confirmation boundary'
);

select extensions.ok(
  pg_catalog.lower(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.request_study_profile_waitlist_confirmation(jsonb)'
    )
  )) like '%on conflict (email_normalized) do nothing%',
  'landing signup resolves a concurrent first-response lead without a unique failure'
);

create temporary table waitlist_confirmation_receipts (
  step text primary key,
  receipt jsonb not null
) on commit drop;

insert into waitlist_confirmation_receipts (step, receipt)
select 'requested', public.request_study_profile_waitlist_confirmation(
  jsonb_build_object(
    'email', 'double-opt-in-db-test@example.test',
    'visitorId', '11111111-1111-4111-8111-111111111111',
    'confirmationTokenHash', repeat('a', 64),
    'ageConfirmed', true,
    'consentCopyVersion', 'study-profile-waitlist-v3-landing',
    'attribution', jsonb_build_object('source', 'database-test')
  )
);

select extensions.is(
  (select receipt ->> 'state' from waitlist_confirmation_receipts where step = 'requested'),
  'pending',
  'a landing signup starts pending'
);

select extensions.ok(
  not (
    select waitlist_status = 'joined'
    from public.study_profile_leads
    where email_normalized = 'double-opt-in-db-test@example.test'
  ),
  'requesting an email does not join the waitlist'
);

select extensions.is(
  (
    select token_hash
    from public.study_profile_waitlist_confirmations
    where lead_id = (
      select id
      from public.study_profile_leads
      where email_normalized = 'double-opt-in-db-test@example.test'
    )
  ),
  repeat('a', 64),
  'the database stores the supplied SHA-256 hash'
);

do $$
begin
  perform public.mark_study_profile_waitlist_confirmation_delivery(
    jsonb_build_object(
      'confirmationId', (
        select receipt ->> 'confirmationId'
        from waitlist_confirmation_receipts
        where step = 'requested'
      ),
      'deliveryStatus', 'sent',
      'providerMessageId', 'db-test-message'
    )
  );
end
$$;

insert into waitlist_confirmation_receipts (step, receipt)
select 'confirmed', public.confirm_study_profile_waitlist(
  jsonb_build_object('confirmationTokenHash', repeat('a', 64))
);

select extensions.is(
  (select receipt ->> 'status' from waitlist_confirmation_receipts where step = 'confirmed'),
  'confirmed',
  'the delivered confirmation can be completed'
);

select extensions.ok(
  (
    select waitlist_status = 'joined'
      and waitlist_consent_source = 'landing'
      and waitlist_consent_copy_version = 'study-profile-waitlist-v3-landing'
      and exists (
        select 1
        from public.study_profile_waitlist_confirmations as confirmation
        where confirmation.lead_id = study_profile_leads.id
          and confirmation.age_confirmed
      )
    from public.study_profile_leads
    where email_normalized = 'double-opt-in-db-test@example.test'
  ),
  'confirmation applies the preserved source and consent version'
);

select extensions.ok(
  (
    select status = 'confirmed'
      and token_hash is null
      and consumed_token_hash = repeat('a', 64)
      and confirmed_at is not null
      and replay_expires_at > now()
    from public.study_profile_waitlist_confirmations
    where lead_id = (
      select id
      from public.study_profile_leads
      where email_normalized = 'double-opt-in-db-test@example.test'
    )
  ),
  'confirmation consumes the token hash exactly once'
);

select extensions.ok(
  (
    public.confirm_study_profile_waitlist(
      jsonb_build_object('confirmationTokenHash', repeat('a', 64))
    ) ->> 'status'
  ) = 'confirmed'
  and not (
    public.confirm_study_profile_waitlist(
      jsonb_build_object('confirmationTokenHash', repeat('a', 64))
    ) ->> 'newlyJoined'
  )::boolean,
  'a retry within 15 minutes is idempotently confirmed without a second join'
);

update public.study_profile_waitlist_confirmations
set
  confirmed_at = now() - interval '20 minutes',
  replay_expires_at = now() - interval '5 minutes'
where consumed_token_hash = repeat('a', 64);

select extensions.is(
  public.confirm_study_profile_waitlist(
    jsonb_build_object('confirmationTokenHash', repeat('a', 64))
  ) ->> 'status',
  'invalid',
  'a consumed token cannot authorize confirmation after the replay window'
);

insert into waitlist_confirmation_receipts (step, receipt)
select 'cap-first', public.request_study_profile_waitlist_confirmation(
  jsonb_build_object(
    'email', 'recipient-cap-db-test@example.test',
    'visitorId', '22222222-2222-4222-8222-222222222222',
    'confirmationTokenHash', repeat('b', 64),
    'ageConfirmed', true,
    'consentCopyVersion', 'study-profile-waitlist-v3-landing'
  )
);

do $$
declare
  cap_lead_id uuid;
  cap_confirmation_id uuid;
begin
  select id into cap_lead_id
  from public.study_profile_leads
  where email_normalized = 'recipient-cap-db-test@example.test';

  select (receipt ->> 'confirmationId')::uuid into cap_confirmation_id
  from waitlist_confirmation_receipts
  where step = 'cap-first';

  update public.study_profile_email_delivery_attempts
  set reserved_at = now() - interval '16 minutes'
  where lead_id = cap_lead_id;

  update public.study_profile_waitlist_confirmations
  set
    requested_at = now() - interval '20 minutes',
    resend_after = now() - interval '16 minutes'
  where id = cap_confirmation_id;

  insert into public.study_profile_email_delivery_attempts (
    lead_id,
    confirmation_id,
    delivery_kind,
    reserved_at
  )
  select
    cap_lead_id,
    cap_confirmation_id,
    'waitlist_confirmation',
    now() - interval '16 minutes'
  from generate_series(1, 4);
end
$$;

select extensions.is(
  public.request_study_profile_waitlist_confirmation(
    jsonb_build_object(
      'email', 'recipient-cap-db-test@example.test',
      'visitorId', '22222222-2222-4222-8222-222222222222',
      'confirmationTokenHash', repeat('c', 64),
      'ageConfirmed', true,
      'consentCopyVersion', 'study-profile-waitlist-v3-landing'
    )
  ) ->> 'state',
  'daily_cap',
  'five reserved delivery attempts cap the normalized recipient for 24 hours'
);

select extensions.ok(
  pg_catalog.lower(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.reserve_study_profile_report_email_delivery(jsonb)'
    )
  )) like '%pg_advisory_xact_lock%'
  and pg_catalog.lower(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.reserve_study_profile_report_email_delivery(jsonb)'
    )
  )) like '%15 minutes%',
  'report email reservations serialize a 15-minute cooldown'
);

select * from extensions.finish();
rollback;
