-- Require response-scoped confirmation even when the normalized address is
-- already on the global waitlist, and bind report unlock confirmation to both
-- high-entropy bearer tokens in one database transaction.

alter table public.study_profile_waitlist_confirmations
add column if not exists meta_registration_eligible boolean;

create or replace function public.request_study_profile_report_waitlist_confirmation(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  report_hash text := lower(btrim(payload ->> 'reportTokenHash'));
  confirmation_hash text := lower(btrim(payload ->> 'confirmationTokenHash'));
  consent_version text := btrim(payload ->> 'consentCopyVersion');
  consent_source text := btrim(payload ->> 'consentSource');
  resolved_response_id uuid;
  resolved_lead_id uuid;
  resolved_email text;
  resolved_model_version text;
  resolved_scoring_revision text;
  resolved_confirmation_id uuid;
  existing_confirmation_id uuid;
  existing_resend_after timestamptz;
  daily_attempt_count bigint;
  earliest_daily_attempt timestamptz;
  latest_confirmation_attempt timestamptz;
  retry_after_seconds integer;
begin
  if report_hash is null or report_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid report token hash is required.';
  end if;

  if confirmation_hash is null or confirmation_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid confirmation token hash is required.';
  end if;

  if consent_version is null or char_length(consent_version) not between 1 and 80 then
    raise exception 'A waitlist consent copy version is required.';
  end if;

  if consent_source is null or consent_source not in ('email_gate', 'report_cta') then
    raise exception 'A supported report waitlist source is required.';
  end if;

  if payload -> 'ageConfirmed' is distinct from 'true'::jsonb then
    raise exception 'A 13-or-older affirmation is required.';
  end if;

  select
    response.id,
    response.lead_id,
    lead.email_normalized,
    response.profile_model_version,
    coalesce(
      nullif(btrim(response.profile_snapshot ->> 'scoringRevision'), ''),
      'study_profile_scoring_v1'
    )
  into
    resolved_response_id,
    resolved_lead_id,
    resolved_email,
    resolved_model_version,
    resolved_scoring_revision
  from public.study_profile_responses as response
  join public.study_profile_leads as lead on lead.id = response.lead_id
  where response.report_token_hash = report_hash;

  if resolved_response_id is null or resolved_lead_id is null then
    return null;
  end if;

  if resolved_scoring_revision not in (
    'study_profile_scoring_v1',
    'study_profile_scoring_v2'
  ) then
    raise exception 'The stored Study Profile scoring revision is not supported.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(resolved_lead_id::text)
  );

  -- Keep the same recipient-first lock order as the landing confirmation RPC.
  -- Global membership deliberately does not satisfy this response's proof of
  -- inbox control, so every unconfirmed report can issue its own scoped token.
  perform 1
  from public.study_profile_leads
  where id = resolved_lead_id
  for update;

  update public.study_profile_waitlist_confirmations
  set consumed_token_hash = null, replay_expires_at = null
  where lead_id = resolved_lead_id
    and status = 'confirmed'
    and consumed_token_hash is not null
    and replay_expires_at <= now();

  if exists (
    select 1
    from public.study_profile_waitlist_confirmations
    where response_id = resolved_response_id
      and status = 'confirmed'
  ) then
    return jsonb_build_object(
      'state', 'joined',
      'shouldSend', false,
      'confirmationId', null,
      'email', null,
      'retryAfterSeconds', 0
    );
  end if;

  select id, resend_after
  into existing_confirmation_id, existing_resend_after
  from public.study_profile_waitlist_confirmations
  where response_id = resolved_response_id
    and status = 'pending'
    and expires_at > now()
  order by requested_at desc
  limit 1
  for update;

  if existing_confirmation_id is not null and existing_resend_after > now() then
    return jsonb_build_object(
      'state', 'pending',
      'shouldSend', false,
      'confirmationId', existing_confirmation_id,
      'email', resolved_email,
      'retryAfterSeconds', greatest(
        1,
        ceil(extract(epoch from (existing_resend_after - now())))::integer
      )
    );
  end if;

  select max(reserved_at)
  into latest_confirmation_attempt
  from public.study_profile_email_delivery_attempts
  where lead_id = resolved_lead_id
    and delivery_kind = 'waitlist_confirmation';

  if latest_confirmation_attempt > now() - interval '15 minutes' then
    return jsonb_build_object(
      'state', 'masked',
      'shouldSend', false,
      'confirmationId', null,
      'email', null,
      'retryAfterSeconds', greatest(
        1,
        ceil(extract(epoch from (
          latest_confirmation_attempt + interval '15 minutes' - now()
        )))::integer
      )
    );
  end if;

  select count(*), min(reserved_at)
  into daily_attempt_count, earliest_daily_attempt
  from public.study_profile_email_delivery_attempts
  where lead_id = resolved_lead_id
    and reserved_at > now() - interval '24 hours';

  if daily_attempt_count >= 5 then
    retry_after_seconds := least(
      86400,
      greatest(
        1,
        ceil(extract(epoch from (
          earliest_daily_attempt + interval '24 hours' - now()
        )))::integer
      )
    );
    return jsonb_build_object(
      'state', 'daily_cap',
      'shouldSend', false,
      'confirmationId', null,
      'email', null,
      'retryAfterSeconds', retry_after_seconds
    );
  end if;

  update public.study_profile_waitlist_confirmations
  set
    status = case when expires_at <= now() then 'expired' else 'superseded' end,
    token_hash = null
  where response_id = resolved_response_id and status = 'pending';

  insert into public.study_profile_waitlist_confirmations (
    lead_id,
    response_id,
    token_hash,
    consent_copy_version,
    consent_source,
    age_confirmed,
    scoring_revision,
    profile_model_version
  ) values (
    resolved_lead_id,
    resolved_response_id,
    confirmation_hash,
    consent_version,
    consent_source,
    true,
    resolved_scoring_revision,
    resolved_model_version
  ) returning id into resolved_confirmation_id;

  insert into public.study_profile_email_delivery_attempts (
    lead_id,
    confirmation_id,
    delivery_kind
  ) values (
    resolved_lead_id,
    resolved_confirmation_id,
    'waitlist_confirmation'
  );

  return jsonb_build_object(
    'state', 'pending',
    'shouldSend', true,
    'confirmationId', resolved_confirmation_id,
    'email', resolved_email,
    'retryAfterSeconds', 0
  );
end;
$$;

revoke all on function public.request_study_profile_report_waitlist_confirmation(jsonb)
from public, anon, authenticated, service_role;

grant execute on function public.request_study_profile_report_waitlist_confirmation(jsonb)
to service_role;

-- The token-only browser endpoint is retained for the landing-page waitlist,
-- but it must never consume a confirmation that is bound to a private report.
-- Report confirmations require both bearer tokens through the atomic RPC below.
create or replace function public.confirm_study_profile_waitlist_measured(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  confirmation_hash text := lower(btrim(payload ->> 'confirmationTokenHash'));
  resolved_confirmation_id uuid;
  receipt jsonb;
  resolved_under_18 boolean;
  persisted_registration_eligible boolean;
  conversion_eligible boolean := false;
begin
  if confirmation_hash is null or confirmation_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid confirmation token hash is required.';
  end if;

  select confirmation.id
  into resolved_confirmation_id
  from public.study_profile_waitlist_confirmations as confirmation
  where confirmation.response_id is null
    and (
      (
        confirmation.token_hash = confirmation_hash
        and confirmation.status = 'pending'
      )
      or (
        confirmation.consumed_token_hash = confirmation_hash
        and confirmation.status = 'confirmed'
        and confirmation.replay_expires_at > now()
      )
    )
  limit 1;

  if resolved_confirmation_id is null then
    return jsonb_build_object(
      'status', 'invalid',
      'waitlistJoined', false,
      'newlyJoined', false,
      'metaConversionEligible', false
    );
  end if;

  receipt := public.confirm_study_profile_waitlist(payload);

  if receipt ->> 'status' = 'confirmed' then
    select confirmation.under_18, confirmation.meta_registration_eligible
    into resolved_under_18, persisted_registration_eligible
    from public.study_profile_waitlist_confirmations as confirmation
    where confirmation.id = resolved_confirmation_id
      and confirmation.response_id is null
      and confirmation.consumed_token_hash = confirmation_hash
      and confirmation.status = 'confirmed'
    limit 1;

    conversion_eligible := coalesce(
      persisted_registration_eligible,
      resolved_under_18 is false
        and coalesce((receipt ->> 'newlyJoined')::boolean, false),
      false
    );

    if persisted_registration_eligible is null then
      update public.study_profile_waitlist_confirmations
      set meta_registration_eligible = conversion_eligible
      where id = resolved_confirmation_id
        and response_id is null
        and status = 'confirmed';
    end if;
  end if;

  return receipt || jsonb_build_object(
    'metaConversionEligible', conversion_eligible
  );
end;
$$;

revoke all on function public.confirm_study_profile_waitlist_measured(jsonb)
from public, anon, authenticated, service_role;

grant execute on function public.confirm_study_profile_waitlist_measured(jsonb)
to service_role;

-- Keep the previous readiness endpoint truthful during a rolling deploy. Its
-- original source check looked for the retired replay heuristic, so recompute
-- the same capability against the persisted eligibility implementation.
create or replace function public.study_profile_public_readiness_v4()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  base_readiness jsonb := public.study_profile_public_readiness_v3();
  minor_conversion_suppression boolean;
begin
  select
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'study_profile_responses'
        and column_name = 'under_18'
        and is_nullable = 'YES'
    )
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'study_profile_waitlist_confirmations'
        and column_name = 'under_18'
        and is_nullable = 'YES'
    )
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'study_profile_waitlist_confirmations'
        and column_name = 'meta_registration_eligible'
        and is_nullable = 'YES'
    )
    and pg_catalog.to_regprocedure(
      'public.confirm_study_profile_waitlist_measured(jsonb)'
    ) is not null
    and (
      select
        not candidate_proc.prosecdef
        and pg_catalog.strpos(candidate_proc.prosrc, 'under_18') > 0
        and pg_catalog.strpos(candidate_proc.prosrc, 'metaConversionEligible') > 0
        and pg_catalog.strpos(candidate_proc.prosrc, 'meta_registration_eligible') > 0
        and pg_catalog.strpos(candidate_proc.prosrc, 'response_id is null') > 0
      from pg_catalog.pg_proc as candidate_proc
      where candidate_proc.oid = pg_catalog.to_regprocedure(
        'public.confirm_study_profile_waitlist_measured(jsonb)'
      )
    ) is true
    and (
      select not candidate_proc.prosecdef
        and pg_catalog.strpos(candidate_proc.prosrc, 'under_18') > 0
      from pg_catalog.pg_proc as candidate_proc
      where candidate_proc.oid = pg_catalog.to_regprocedure(
        'public.save_study_profile_response_attributed(jsonb)'
      )
    ) is true
    and (
      select not candidate_proc.prosecdef
        and pg_catalog.strpos(candidate_proc.prosrc, 'under_18') > 0
      from pg_catalog.pg_proc as candidate_proc
      where candidate_proc.oid = pg_catalog.to_regprocedure(
        'public.request_study_profile_waitlist_confirmation_attributed(jsonb)'
      )
    ) is true
    and (
      select not candidate_proc.prosecdef
        and pg_catalog.strpos(candidate_proc.prosrc, 'under_18') > 0
      from pg_catalog.pg_proc as candidate_proc
      where candidate_proc.oid = pg_catalog.to_regprocedure(
        'public.request_study_profile_report_waitlist_confirmation_attributed(jsonb)'
      )
    ) is true
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.confirm_study_profile_waitlist_measured(jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.confirm_study_profile_waitlist_measured(jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.confirm_study_profile_waitlist_measured(jsonb)',
      'execute'
    )
  into minor_conversion_suppression;

  return base_readiness || jsonb_build_object(
    'contractVersion', '202609060003',
    'ready', coalesce((base_readiness ->> 'ready')::boolean, false)
      and coalesce(minor_conversion_suppression, false),
    'minorConversionSuppression', coalesce(minor_conversion_suppression, false)
  );
end;
$$;

revoke all on function public.study_profile_public_readiness_v4()
from public, anon, authenticated, service_role;

grant execute on function public.study_profile_public_readiness_v4()
to service_role;

create or replace function public.confirm_study_profile_report_waitlist_measured(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  report_hash text := lower(btrim(payload ->> 'reportTokenHash'));
  confirmation_hash text := lower(btrim(payload ->> 'confirmationTokenHash'));
  resolved_response_id uuid;
  resolved_response_lead_id uuid;
  resolved_confirmation_id uuid;
  resolved_confirmation_response_id uuid;
  resolved_confirmation_lead_id uuid;
  resolved_confirmation_status text;
  resolved_under_18 boolean;
  persisted_registration_eligible boolean;
  registration_eligible boolean := false;
  receipt jsonb;
begin
  if report_hash is null or report_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid report token hash is required.';
  end if;

  if confirmation_hash is null or confirmation_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid confirmation token hash is required.';
  end if;

  select response.id, response.lead_id
  into resolved_response_id, resolved_response_lead_id
  from public.study_profile_responses as response
  where response.report_token_hash = report_hash
  for share;

  if resolved_response_id is null then
    return jsonb_build_object(
      'status', 'invalid',
      'waitlistJoined', false,
      'newlyJoined', false,
      'metaRegistrationEligible', false,
      'reportUnlocked', false,
      'responseId', null,
      'under18', null
    );
  end if;

  select
    confirmation.id,
    confirmation.response_id,
    confirmation.lead_id,
    confirmation.status,
    confirmation.under_18,
    confirmation.meta_registration_eligible
  into
    resolved_confirmation_id,
    resolved_confirmation_response_id,
    resolved_confirmation_lead_id,
    resolved_confirmation_status,
    resolved_under_18,
    persisted_registration_eligible
  from public.study_profile_waitlist_confirmations as confirmation
  where confirmation.token_hash = confirmation_hash
    and confirmation.status = 'pending';

  if resolved_confirmation_id is null then
    select
      confirmation.id,
      confirmation.response_id,
      confirmation.lead_id,
      confirmation.status,
      confirmation.under_18,
      confirmation.meta_registration_eligible
    into
      resolved_confirmation_id,
      resolved_confirmation_response_id,
      resolved_confirmation_lead_id,
      resolved_confirmation_status,
      resolved_under_18,
      persisted_registration_eligible
    from public.study_profile_waitlist_confirmations as confirmation
    where confirmation.consumed_token_hash = confirmation_hash
      and confirmation.status = 'confirmed'
      and confirmation.replay_expires_at > now();
  end if;

  if resolved_confirmation_id is null then
    return jsonb_build_object(
      'status', 'invalid',
      'waitlistJoined', false,
      'newlyJoined', false,
      'metaRegistrationEligible', false,
      'reportUnlocked', false,
      'responseId', null,
      'under18', null
    );
  end if;

  if resolved_confirmation_response_id is distinct from resolved_response_id
    or resolved_confirmation_lead_id is distinct from resolved_response_lead_id
  then
    return jsonb_build_object(
      'status', 'mismatch',
      'waitlistJoined', false,
      'newlyJoined', false,
      'metaRegistrationEligible', false,
      'reportUnlocked', false,
      'responseId', null,
      'under18', null
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(resolved_confirmation_lead_id::text)
  );

  perform 1
  from public.study_profile_leads
  where id = resolved_confirmation_lead_id
  for update;

  -- Recheck the exact pair after acquiring the same lead-first locks used by
  -- the underlying confirmation function. A superseded or moved credential
  -- cannot be consumed through a stale pre-lock read.
  select
    confirmation.status,
    confirmation.under_18,
    confirmation.meta_registration_eligible
  into
    resolved_confirmation_status,
    resolved_under_18,
    persisted_registration_eligible
  from public.study_profile_waitlist_confirmations as confirmation
  where confirmation.id = resolved_confirmation_id
    and confirmation.response_id = resolved_response_id
    and confirmation.lead_id = resolved_response_lead_id
    and (
      (
        confirmation.token_hash = confirmation_hash
        and confirmation.status = 'pending'
      )
      or (
        confirmation.consumed_token_hash = confirmation_hash
        and confirmation.status = 'confirmed'
        and confirmation.replay_expires_at > now()
      )
    )
  for update;

  if not found then
    return jsonb_build_object(
      'status', 'invalid',
      'waitlistJoined', false,
      'newlyJoined', false,
      'metaRegistrationEligible', false,
      'reportUnlocked', false,
      'responseId', null,
      'under18', null
    );
  end if;

  receipt := public.confirm_study_profile_waitlist(
    jsonb_build_object('confirmationTokenHash', confirmation_hash)
  );

  if receipt ->> 'status' = 'expired' then
    return jsonb_build_object(
      'status', 'expired',
      'waitlistJoined', false,
      'newlyJoined', false,
      'metaRegistrationEligible', false,
      'reportUnlocked', false,
      'responseId', null,
      'under18', null
    );
  end if;

  if receipt ->> 'status' is distinct from 'confirmed' then
    return jsonb_build_object(
      'status', 'invalid',
      'waitlistJoined', false,
      'newlyJoined', false,
      'metaRegistrationEligible', false,
      'reportUnlocked', false,
      'responseId', null,
      'under18', null
    );
  end if;

  select
    confirmation.under_18,
    confirmation.meta_registration_eligible
  into resolved_under_18, persisted_registration_eligible
  from public.study_profile_waitlist_confirmations as confirmation
  where confirmation.id = resolved_confirmation_id
    and confirmation.response_id = resolved_response_id
    and confirmation.status = 'confirmed'
    and confirmation.consumed_token_hash = confirmation_hash
    and confirmation.replay_expires_at > now();

  if not found then
    return jsonb_build_object(
      'status', 'invalid',
      'waitlistJoined', false,
      'newlyJoined', false,
      'metaRegistrationEligible', false,
      'reportUnlocked', false,
      'responseId', null,
      'under18', null
    );
  end if;

  registration_eligible := coalesce(
    persisted_registration_eligible,
    resolved_under_18 is false
      and coalesce((receipt ->> 'newlyJoined')::boolean, false),
    false
  );

  if persisted_registration_eligible is null then
    update public.study_profile_waitlist_confirmations
    set meta_registration_eligible = registration_eligible
    where id = resolved_confirmation_id
      and status = 'confirmed';
  end if;

  return jsonb_build_object(
    'status', 'confirmed',
    'waitlistJoined', true,
    'newlyJoined', coalesce((receipt ->> 'newlyJoined')::boolean, false),
    'metaRegistrationEligible', registration_eligible,
    'reportUnlocked', true,
    'responseId', resolved_response_id,
    'under18', resolved_under_18
  );
end;
$$;

revoke all on function public.confirm_study_profile_report_waitlist_measured(jsonb)
from public, anon, authenticated, service_role;

grant execute on function public.confirm_study_profile_report_waitlist_measured(jsonb)
to service_role;

create or replace function public.study_profile_public_readiness_v5()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  base_readiness jsonb := public.study_profile_public_readiness_v3();
  minor_conversion_suppression boolean := false;
  report_scoped_reconfirmation boolean := false;
  bound_report_confirmation boolean := false;
  landing_confirmation_isolation boolean := false;
begin
  select
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'study_profile_responses'
        and column_name = 'under_18'
        and is_nullable = 'YES'
    )
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'study_profile_waitlist_confirmations'
        and column_name = 'under_18'
        and is_nullable = 'YES'
    )
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'study_profile_waitlist_confirmations'
        and column_name = 'meta_registration_eligible'
        and is_nullable = 'YES'
    )
    and pg_catalog.to_regprocedure(
      'public.confirm_study_profile_waitlist_measured(jsonb)'
    ) is not null
    and (
      select
        not candidate_proc.prosecdef
        and pg_catalog.strpos(candidate_proc.prosrc, 'under_18') > 0
        and pg_catalog.strpos(candidate_proc.prosrc, 'metaConversionEligible') > 0
        and pg_catalog.strpos(candidate_proc.prosrc, 'meta_registration_eligible') > 0
        and pg_catalog.strpos(candidate_proc.prosrc, 'response_id is null') > 0
      from pg_catalog.pg_proc as candidate_proc
      where candidate_proc.oid = pg_catalog.to_regprocedure(
        'public.confirm_study_profile_waitlist_measured(jsonb)'
      )
    ) is true
    and (
      select not candidate_proc.prosecdef
        and pg_catalog.strpos(candidate_proc.prosrc, 'under_18') > 0
      from pg_catalog.pg_proc as candidate_proc
      where candidate_proc.oid = pg_catalog.to_regprocedure(
        'public.save_study_profile_response_attributed(jsonb)'
      )
    ) is true
    and (
      select not candidate_proc.prosecdef
        and pg_catalog.strpos(candidate_proc.prosrc, 'under_18') > 0
      from pg_catalog.pg_proc as candidate_proc
      where candidate_proc.oid = pg_catalog.to_regprocedure(
        'public.request_study_profile_waitlist_confirmation_attributed(jsonb)'
      )
    ) is true
    and (
      select not candidate_proc.prosecdef
        and pg_catalog.strpos(candidate_proc.prosrc, 'under_18') > 0
      from pg_catalog.pg_proc as candidate_proc
      where candidate_proc.oid = pg_catalog.to_regprocedure(
        'public.request_study_profile_report_waitlist_confirmation_attributed(jsonb)'
      )
    ) is true
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.confirm_study_profile_waitlist_measured(jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.confirm_study_profile_waitlist_measured(jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.confirm_study_profile_waitlist_measured(jsonb)',
      'execute'
    )
  into minor_conversion_suppression;

  select
    not candidate_proc.prosecdef
    and pg_catalog.strpos(
      candidate_proc.prosrc,
      'waitlist_status = ''joined'''
    ) = 0
    and pg_catalog.strpos(
      candidate_proc.prosrc,
      'response_id = resolved_response_id'
    ) > 0
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.request_study_profile_report_waitlist_confirmation(jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.request_study_profile_report_waitlist_confirmation(jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.request_study_profile_report_waitlist_confirmation(jsonb)',
      'execute'
    )
  into report_scoped_reconfirmation
  from pg_catalog.pg_proc as candidate_proc
  where candidate_proc.oid = pg_catalog.to_regprocedure(
    'public.request_study_profile_report_waitlist_confirmation(jsonb)'
  );

  select
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'study_profile_waitlist_confirmations'
        and column_name = 'meta_registration_eligible'
        and is_nullable = 'YES'
    )
    and not candidate_proc.prosecdef
    and pg_catalog.strpos(candidate_proc.prosrc, 'reportTokenHash') > 0
    and pg_catalog.strpos(candidate_proc.prosrc, 'confirmationTokenHash') > 0
    and pg_catalog.strpos(
      candidate_proc.prosrc,
      'confirmation.response_id = resolved_response_id'
    ) > 0
    and pg_catalog.strpos(
      candidate_proc.prosrc,
      'public.confirm_study_profile_waitlist('
    ) > 0
    and pg_catalog.strpos(candidate_proc.prosrc, 'metaRegistrationEligible') > 0
    and pg_catalog.strpos(candidate_proc.prosrc, 'reportUnlocked') > 0
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.confirm_study_profile_report_waitlist_measured(jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.confirm_study_profile_report_waitlist_measured(jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.confirm_study_profile_report_waitlist_measured(jsonb)',
      'execute'
    )
  into bound_report_confirmation
  from pg_catalog.pg_proc as candidate_proc
  where candidate_proc.oid = pg_catalog.to_regprocedure(
    'public.confirm_study_profile_report_waitlist_measured(jsonb)'
  );

  select
    not candidate_proc.prosecdef
    and pg_catalog.strpos(candidate_proc.prosrc, 'response_id is null') > 0
    and pg_catalog.strpos(candidate_proc.prosrc, 'meta_registration_eligible') > 0
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.confirm_study_profile_waitlist_measured(jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.confirm_study_profile_waitlist_measured(jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.confirm_study_profile_waitlist_measured(jsonb)',
      'execute'
    )
  into landing_confirmation_isolation
  from pg_catalog.pg_proc as candidate_proc
  where candidate_proc.oid = pg_catalog.to_regprocedure(
    'public.confirm_study_profile_waitlist_measured(jsonb)'
  );

  return base_readiness || jsonb_build_object(
    'contractVersion', '202609080001',
    'ready', coalesce((base_readiness ->> 'ready')::boolean, false)
      and coalesce(minor_conversion_suppression, false)
      and coalesce(report_scoped_reconfirmation, false)
      and coalesce(bound_report_confirmation, false)
      and coalesce(landing_confirmation_isolation, false),
    'minorConversionSuppression', coalesce(minor_conversion_suppression, false),
    'reportScopedReconfirmation', coalesce(report_scoped_reconfirmation, false),
    'boundReportConfirmation', coalesce(bound_report_confirmation, false),
    'landingConfirmationIsolation', coalesce(landing_confirmation_isolation, false)
  );
end;
$$;

revoke all on function public.study_profile_public_readiness_v5()
from public, anon, authenticated, service_role;

grant execute on function public.study_profile_public_readiness_v5()
to service_role;
