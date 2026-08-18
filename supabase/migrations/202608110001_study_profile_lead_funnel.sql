create table public.study_profile_leads (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null unique,
  marketing_consent_at timestamptz,
  marketing_consent_copy_version text,
  marketing_consent_source text check (
    marketing_consent_source is null
    or marketing_consent_source in ('email_gate', 'report_cta')
  ),
  waitlist_status text not null default 'not_joined' check (
    waitlist_status in ('not_joined', 'joined')
  ),
  waitlist_joined_at timestamptz,
  waitlist_consent_copy_version text,
  beta_interest boolean,
  beta_interest_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint study_profile_leads_email_valid check (
    char_length(email_normalized) between 3 and 320
    and email_normalized = lower(btrim(email_normalized))
    and email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  constraint study_profile_leads_marketing_consent_consistent check (
    (
      marketing_consent_at is null
      and marketing_consent_copy_version is null
      and marketing_consent_source is null
    )
    or (
      marketing_consent_at is not null
      and marketing_consent_copy_version is not null
      and marketing_consent_source is not null
    )
  ),
  constraint study_profile_leads_waitlist_consistent check (
    (
      waitlist_status = 'not_joined'
      and waitlist_joined_at is null
      and waitlist_consent_copy_version is null
    )
    or (
      waitlist_status = 'joined'
      and waitlist_joined_at is not null
      and waitlist_consent_copy_version is not null
    )
  ),
  constraint study_profile_leads_beta_consistent check (
    (beta_interest is null and beta_interest_updated_at is null)
    or (
      beta_interest is not null
      and beta_interest_updated_at is not null
      and waitlist_status = 'joined'
    )
  )
);

create table public.study_profile_responses (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.study_profile_leads(id) on delete cascade,
  visitor_id uuid not null,
  report_token_hash text not null unique check (
    report_token_hash ~ '^[0-9a-f]{64}$'
  ),
  profile_model_version text not null check (
    char_length(profile_model_version) between 3 and 64
  ),
  raw_answers jsonb not null,
  raw_scores jsonb not null,
  normalized_scores jsonb not null,
  classifications jsonb not null,
  calibration_direction text not null check (
    calibration_direction in (
      'relatively_calibrated',
      'mixed',
      'overconfidence_risk',
      'underconfidence_risk'
    )
  ),
  primary_pattern text not null,
  secondary_pattern text not null,
  profile_snapshot jsonb not null,
  report_state jsonb not null,
  energy_window text not null check (
    energy_window in ('morning', 'afternoon', 'evening', 'late_night', 'varies')
  ),
  school_level text not null check (
    school_level in ('high_school', 'college', 'other')
  ),
  optional_free_response text check (
    optional_free_response is null
    or char_length(optional_free_response) <= 600
  ),
  marketing_consent boolean not null default false,
  consent_copy_version text not null check (
    char_length(consent_copy_version) between 1 and 80
  ),
  traffic_source text check (
    traffic_source is null or char_length(traffic_source) <= 100
  ),
  referrer_host text check (
    referrer_host is null or char_length(referrer_host) <= 255
  ),
  utm_source text check (
    utm_source is null or char_length(utm_source) <= 100
  ),
  utm_medium text check (
    utm_medium is null or char_length(utm_medium) <= 100
  ),
  utm_campaign text check (
    utm_campaign is null or char_length(utm_campaign) <= 160
  ),
  utm_content text check (
    utm_content is null or char_length(utm_content) <= 160
  ),
  utm_term text check (
    utm_term is null or char_length(utm_term) <= 160
  ),
  email_delivery_status text not null default 'pending' check (
    email_delivery_status in ('pending', 'sent', 'failed', 'skipped')
  ),
  email_provider_message_id text check (
    email_provider_message_id is null
    or char_length(email_provider_message_id) <= 200
  ),
  email_last_attempted_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint study_profile_response_patterns check (
    primary_pattern in (
      'starting_friction',
      'structure_need',
      'attention_variability',
      'calibration_risk',
      'mistake_sensitivity',
      'cognitive_stamina'
    )
    and secondary_pattern in (
      'starting_friction',
      'structure_need',
      'attention_variability',
      'calibration_risk',
      'mistake_sensitivity',
      'cognitive_stamina'
    )
    and primary_pattern <> secondary_pattern
  ),
  constraint study_profile_answers_shape check (
    jsonb_typeof(raw_answers) = 'object'
    and jsonb_array_length(jsonb_path_query_array(raw_answers, '$.*')) = 12
    and raw_answers ?& array[
      'q1', 'q2', 'q3', 'q4', 'q5', 'q6',
      'q7', 'q8', 'q9', 'q10', 'q11', 'q12'
    ]
    and octet_length(raw_answers::text) <= 4096
  ),
  constraint study_profile_scores_shape check (
    jsonb_typeof(raw_scores) = 'object'
    and jsonb_typeof(normalized_scores) = 'object'
    and jsonb_typeof(classifications) = 'object'
    and jsonb_array_length(jsonb_path_query_array(raw_scores, '$.*')) = 6
    and jsonb_array_length(jsonb_path_query_array(normalized_scores, '$.*')) = 6
    and jsonb_array_length(jsonb_path_query_array(classifications, '$.*')) = 6
  ),
  constraint study_profile_snapshot_shape check (
    jsonb_typeof(profile_snapshot) = 'object'
    and octet_length(profile_snapshot::text) <= 32768
  ),
  constraint study_profile_report_shape check (
    jsonb_typeof(report_state) = 'object'
    and octet_length(report_state::text) <= 65536
  )
);

create table public.study_profile_events (
  id bigint generated always as identity primary key,
  visitor_id uuid,
  response_id uuid references public.study_profile_responses(id) on delete cascade,
  event_name text not null check (
    event_name in (
      'study_profile_page_viewed',
      'study_profile_started',
      'study_profile_question_answered',
      'study_profile_completed',
      'study_profile_email_submitted',
      'study_profile_report_viewed',
      'study_profile_waitlist_joined',
      'study_profile_beta_interest'
    )
  ),
  event_data jsonb not null default '{}'::jsonb,
  profile_model_version text not null check (
    char_length(profile_model_version) between 3 and 64
  ),
  traffic_source text check (
    traffic_source is null or char_length(traffic_source) <= 100
  ),
  referrer_host text check (
    referrer_host is null or char_length(referrer_host) <= 255
  ),
  utm_source text check (
    utm_source is null or char_length(utm_source) <= 100
  ),
  utm_medium text check (
    utm_medium is null or char_length(utm_medium) <= 100
  ),
  utm_campaign text check (
    utm_campaign is null or char_length(utm_campaign) <= 160
  ),
  utm_content text check (
    utm_content is null or char_length(utm_content) <= 160
  ),
  utm_term text check (
    utm_term is null or char_length(utm_term) <= 160
  ),
  occurred_at timestamptz not null default now(),

  constraint study_profile_event_identity check (
    visitor_id is not null or response_id is not null
  ),
  constraint study_profile_event_data check (
    jsonb_typeof(event_data) = 'object'
    and octet_length(event_data::text) <= 2048
  )
);

create index study_profile_responses_lead_time_idx
on public.study_profile_responses(lead_id, created_at desc);

create index study_profile_responses_created_idx
on public.study_profile_responses(created_at desc);

create index study_profile_events_funnel_idx
on public.study_profile_events(event_name, occurred_at desc);

create index study_profile_events_visitor_idx
on public.study_profile_events(visitor_id, occurred_at)
where visitor_id is not null;

create index study_profile_events_response_idx
on public.study_profile_events(response_id, occurred_at)
where response_id is not null;

create trigger study_profile_leads_set_updated_at
before update on public.study_profile_leads
for each row execute function public.set_updated_at();

create trigger study_profile_responses_set_updated_at
before update on public.study_profile_responses
for each row execute function public.set_updated_at();

alter table public.study_profile_leads enable row level security;
alter table public.study_profile_responses enable row level security;
alter table public.study_profile_events enable row level security;

revoke all on table public.study_profile_leads from anon, authenticated;
revoke all on table public.study_profile_responses from anon, authenticated;
revoke all on table public.study_profile_events from anon, authenticated;

grant select, insert, update, delete
on table public.study_profile_leads, public.study_profile_responses, public.study_profile_events
to service_role;

grant usage, select on sequence public.study_profile_events_id_seq to service_role;

create or replace function public.save_study_profile_response(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(payload ->> 'email'));
  wants_updates boolean := coalesce((payload ->> 'marketingConsent')::boolean, false);
  consent_version text := payload ->> 'consentCopyVersion';
  resolved_lead_id uuid;
  resolved_response_id uuid;
begin
  if normalized_email is null
    or char_length(normalized_email) not between 3 and 320
  then
    raise exception 'A valid normalized email is required.';
  end if;

  insert into public.study_profile_leads as existing (
    email_normalized,
    marketing_consent_at,
    marketing_consent_copy_version,
    marketing_consent_source
  ) values (
    normalized_email,
    case when wants_updates then now() else null end,
    case when wants_updates then consent_version else null end,
    case when wants_updates then 'email_gate' else null end
  )
  on conflict (email_normalized) do update set
    updated_at = now(),
    marketing_consent_at = case
      when wants_updates then coalesce(existing.marketing_consent_at, now())
      else existing.marketing_consent_at
    end,
    marketing_consent_copy_version = case
      when wants_updates then coalesce(existing.marketing_consent_copy_version, consent_version)
      else existing.marketing_consent_copy_version
    end,
    marketing_consent_source = case
      when wants_updates then coalesce(existing.marketing_consent_source, 'email_gate')
      else existing.marketing_consent_source
    end
  returning id into resolved_lead_id;

  insert into public.study_profile_responses (
    lead_id,
    visitor_id,
    report_token_hash,
    profile_model_version,
    raw_answers,
    raw_scores,
    normalized_scores,
    classifications,
    calibration_direction,
    primary_pattern,
    secondary_pattern,
    profile_snapshot,
    report_state,
    energy_window,
    school_level,
    optional_free_response,
    marketing_consent,
    consent_copy_version,
    traffic_source,
    referrer_host,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    email_delivery_status
  ) values (
    resolved_lead_id,
    (payload ->> 'visitorId')::uuid,
    payload ->> 'reportTokenHash',
    payload ->> 'profileModelVersion',
    payload -> 'rawAnswers',
    payload #> '{profileSnapshot,rawScores}',
    payload #> '{profileSnapshot,normalizedScores}',
    payload #> '{profileSnapshot,classifications}',
    payload #>> '{profileSnapshot,calibrationDirection}',
    payload #>> '{profileSnapshot,primaryPattern,dimension}',
    payload #>> '{profileSnapshot,secondaryPattern,dimension}',
    payload -> 'profileSnapshot',
    payload -> 'reportState',
    payload #>> '{metadata,energyWindow}',
    payload #>> '{metadata,schoolLevel}',
    nullif(btrim(payload #>> '{metadata,hardestPart}'), ''),
    wants_updates,
    consent_version,
    nullif(btrim(payload #>> '{attribution,source}'), ''),
    nullif(btrim(payload #>> '{attribution,referrerHost}'), ''),
    nullif(btrim(payload #>> '{attribution,utmSource}'), ''),
    nullif(btrim(payload #>> '{attribution,utmMedium}'), ''),
    nullif(btrim(payload #>> '{attribution,utmCampaign}'), ''),
    nullif(btrim(payload #>> '{attribution,utmContent}'), ''),
    nullif(btrim(payload #>> '{attribution,utmTerm}'), ''),
    coalesce(payload ->> 'emailDeliveryStatus', 'pending')
  )
  returning id into resolved_response_id;

  insert into public.study_profile_events (
    visitor_id,
    response_id,
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
    (payload ->> 'visitorId')::uuid,
    resolved_response_id,
    'study_profile_email_submitted',
    '{}'::jsonb,
    payload ->> 'profileModelVersion',
    nullif(btrim(payload #>> '{attribution,source}'), ''),
    nullif(btrim(payload #>> '{attribution,referrerHost}'), ''),
    nullif(btrim(payload #>> '{attribution,utmSource}'), ''),
    nullif(btrim(payload #>> '{attribution,utmMedium}'), ''),
    nullif(btrim(payload #>> '{attribution,utmCampaign}'), ''),
    nullif(btrim(payload #>> '{attribution,utmContent}'), ''),
    nullif(btrim(payload #>> '{attribution,utmTerm}'), '')
  );

  return jsonb_build_object(
    'leadId', resolved_lead_id,
    'responseId', resolved_response_id
  );
end;
$$;

revoke all on function public.save_study_profile_response(jsonb) from public, anon, authenticated;
grant execute on function public.save_study_profile_response(jsonb) to service_role;
