alter table public.study_profile_events
drop constraint if exists study_profile_events_event_name_check;

alter table public.study_profile_leads
add column if not exists waitlist_consent_source text;

alter table public.study_profile_leads
drop constraint if exists study_profile_leads_waitlist_consent_source_check;

alter table public.study_profile_leads
add constraint study_profile_leads_waitlist_consent_source_check check (
  waitlist_consent_source is null
  or waitlist_consent_source in ('landing', 'email_gate', 'report_cta')
);

alter table public.study_profile_events
add constraint study_profile_events_event_name_check check (
  event_name in (
    'study_profile_page_viewed',
    'study_profile_started',
    'study_profile_question_answered',
    'study_profile_completed',
    'study_profile_email_submitted',
    'study_profile_report_viewed',
    'study_profile_waitlist_joined',
    'study_profile_beta_interest',
    'study_profile_share_tapped'
  )
);

create or replace function public.join_study_profile_waitlist(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(payload ->> 'email'));
  consent_version text := btrim(payload ->> 'consentCopyVersion');
  consent_source text := btrim(payload ->> 'consentSource');
  resolved_visitor_id uuid := (payload ->> 'visitorId')::uuid;
  resolved_lead_id uuid;
  already_joined boolean := false;
begin
  if normalized_email is null
    or char_length(normalized_email) not between 3 and 320
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  then
    raise exception 'A valid normalized email is required.';
  end if;

  if consent_version is null or char_length(consent_version) not between 1 and 80 then
    raise exception 'A waitlist consent copy version is required.';
  end if;

  if consent_source is distinct from 'landing' then
    raise exception 'The landing waitlist source is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(normalized_email));

  select id, waitlist_status = 'joined'
  into resolved_lead_id, already_joined
  from public.study_profile_leads
  where email_normalized = normalized_email
  for update;

  if resolved_lead_id is null then
    already_joined := false;
    insert into public.study_profile_leads (
      email_normalized,
      waitlist_status,
      waitlist_joined_at,
      waitlist_consent_copy_version,
      waitlist_consent_source
    ) values (
      normalized_email,
      'joined',
      now(),
      consent_version,
      consent_source
    )
    returning id into resolved_lead_id;
  elsif not already_joined then
    update public.study_profile_leads
    set
      waitlist_status = 'joined',
      waitlist_joined_at = now(),
      waitlist_consent_copy_version = consent_version,
      waitlist_consent_source = consent_source
    where id = resolved_lead_id;
  end if;

  if not already_joined then
    insert into public.study_profile_events (
      visitor_id,
      event_name,
      event_data,
      profile_model_version,
      traffic_source,
      referrer_host,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term
    ) values (
      resolved_visitor_id,
      'study_profile_waitlist_joined',
      jsonb_build_object(
        'source', 'landing',
        'scoringRevision', 'study_profile_scoring_v2'
      ),
      'profile_model_v1',
      nullif(btrim(payload #>> '{attribution,source}'), ''),
      nullif(btrim(payload #>> '{attribution,referrerHost}'), ''),
      nullif(btrim(payload #>> '{attribution,utmSource}'), ''),
      nullif(btrim(payload #>> '{attribution,utmMedium}'), ''),
      nullif(btrim(payload #>> '{attribution,utmCampaign}'), ''),
      nullif(btrim(payload #>> '{attribution,utmContent}'), ''),
      nullif(btrim(payload #>> '{attribution,utmTerm}'), '')
    );
  end if;

  return jsonb_build_object(
    'leadId', resolved_lead_id,
    'waitlistJoined', true,
    'newlyJoined', not already_joined
  );
end;
$$;

revoke all on function public.join_study_profile_waitlist(jsonb)
from public, anon, authenticated;

grant execute on function public.join_study_profile_waitlist(jsonb)
to service_role;

create or replace function public.join_study_profile_report_waitlist(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  token_hash text := lower(btrim(payload ->> 'reportTokenHash'));
  consent_version text := btrim(payload ->> 'consentCopyVersion');
  consent_source text := btrim(payload ->> 'consentSource');
  resolved_scoring_revision text;
  resolved_response_id uuid;
  resolved_lead_id uuid;
  resolved_model_version text;
  resolved_beta_interest boolean;
  already_joined boolean := false;
begin
  if token_hash is null or token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid report token hash is required.';
  end if;

  if consent_version is null or char_length(consent_version) not between 1 and 80 then
    raise exception 'A waitlist consent copy version is required.';
  end if;

  if consent_source is null or consent_source not in ('email_gate', 'report_cta') then
    raise exception 'A supported report waitlist source is required.';
  end if;

  select
    id,
    lead_id,
    profile_model_version,
    coalesce(
      nullif(btrim(profile_snapshot ->> 'scoringRevision'), ''),
      'study_profile_scoring_v1'
    )
  into
    resolved_response_id,
    resolved_lead_id,
    resolved_model_version,
    resolved_scoring_revision
  from public.study_profile_responses
  where report_token_hash = token_hash;

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

  select waitlist_status = 'joined', beta_interest
  into already_joined, resolved_beta_interest
  from public.study_profile_leads
  where id = resolved_lead_id
  for update;

  if already_joined is null then
    return null;
  end if;

  if not already_joined then
    update public.study_profile_leads
    set
      waitlist_status = 'joined',
      waitlist_joined_at = now(),
      waitlist_consent_copy_version = consent_version,
      waitlist_consent_source = consent_source
    where id = resolved_lead_id;

    insert into public.study_profile_events (
      response_id,
      event_name,
      event_data,
      profile_model_version
    ) values (
      resolved_response_id,
      'study_profile_waitlist_joined',
      jsonb_build_object(
        'source', consent_source,
        'scoringRevision', resolved_scoring_revision
      ),
      resolved_model_version
    );
  end if;

  return jsonb_build_object(
    'leadId', resolved_lead_id,
    'responseId', resolved_response_id,
    'waitlistJoined', true,
    'newlyJoined', not already_joined,
    'betaInterest', resolved_beta_interest
  );
end;
$$;

revoke all on function public.join_study_profile_report_waitlist(jsonb)
from public, anon, authenticated;

grant execute on function public.join_study_profile_report_waitlist(jsonb)
to service_role;
