-- Persist whether a Study Profile submitter identifies as under 18 and keep
-- Meta conversion eligibility server-derived through the confirmation flow.
-- Existing rows intentionally remain null and are not eligible for conversion.

alter table public.study_profile_responses
add column if not exists under_18 boolean;

alter table public.study_profile_waitlist_confirmations
add column if not exists under_18 boolean;

create or replace function public.save_study_profile_response_attributed(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  receipt jsonb;
  resolved_response_id uuid;
  resolved_under_18 boolean := case
    when payload -> 'under18' = 'true'::jsonb then true
    when payload -> 'under18' = 'false'::jsonb then false
    else null
  end;
begin
  receipt := public.save_study_profile_response(payload);
  resolved_response_id := (receipt ->> 'responseId')::uuid;

  update public.study_profile_responses
  set
    fbclid = nullif(btrim(payload #>> '{attribution,fbclid}'), ''),
    under_18 = resolved_under_18
  where id = resolved_response_id;

  return receipt;
end;
$$;

revoke all on function public.save_study_profile_response_attributed(jsonb)
from public, anon, authenticated;

grant execute on function public.save_study_profile_response_attributed(jsonb)
to service_role;

create or replace function public.request_study_profile_waitlist_confirmation_attributed(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  receipt jsonb;
  resolved_confirmation_id uuid;
  resolved_under_18 boolean := case
    when payload -> 'under18' = 'true'::jsonb then true
    when payload -> 'under18' = 'false'::jsonb then false
    else null
  end;
begin
  receipt := public.request_study_profile_waitlist_confirmation(payload);
  resolved_confirmation_id := nullif(receipt ->> 'confirmationId', '')::uuid;

  if resolved_confirmation_id is not null then
    update public.study_profile_waitlist_confirmations
    set under_18 = case
      when under_18 is true or resolved_under_18 is true then true
      when under_18 is false or resolved_under_18 is false then false
      else null
    end
    where id = resolved_confirmation_id;
  end if;

  if resolved_confirmation_id is not null
    and coalesce((receipt ->> 'shouldSend')::boolean, false)
  then
    update public.study_profile_waitlist_confirmations
    set
      traffic_source = nullif(btrim(payload #>> '{attribution,source}'), ''),
      referrer_host = nullif(btrim(payload #>> '{attribution,referrerHost}'), ''),
      utm_source = nullif(btrim(payload #>> '{attribution,utmSource}'), ''),
      utm_medium = nullif(btrim(payload #>> '{attribution,utmMedium}'), ''),
      utm_campaign = nullif(btrim(payload #>> '{attribution,utmCampaign}'), ''),
      utm_content = nullif(btrim(payload #>> '{attribution,utmContent}'), ''),
      utm_term = nullif(btrim(payload #>> '{attribution,utmTerm}'), ''),
      fbclid = nullif(btrim(payload #>> '{attribution,fbclid}'), '')
    where id = resolved_confirmation_id;
  end if;

  return receipt;
end;
$$;

revoke all on function public.request_study_profile_waitlist_confirmation_attributed(jsonb)
from public, anon, authenticated;

grant execute on function public.request_study_profile_waitlist_confirmation_attributed(jsonb)
to service_role;

create or replace function public.request_study_profile_report_waitlist_confirmation_attributed(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  receipt jsonb;
  resolved_confirmation_id uuid;
begin
  receipt := public.request_study_profile_report_waitlist_confirmation(payload);

  if receipt is null then
    return null;
  end if;

  resolved_confirmation_id := nullif(receipt ->> 'confirmationId', '')::uuid;

  if resolved_confirmation_id is not null then
    update public.study_profile_waitlist_confirmations as confirmation
    set under_18 = case
      when confirmation.under_18 is true or response.under_18 is true then true
      when confirmation.under_18 is false or response.under_18 is false then false
      else null
    end
    from public.study_profile_responses as response
    where confirmation.id = resolved_confirmation_id
      and response.id = confirmation.response_id;
  end if;

  if resolved_confirmation_id is not null
    and coalesce((receipt ->> 'shouldSend')::boolean, false)
  then
    update public.study_profile_waitlist_confirmations as confirmation
    set
      traffic_source = case when response.has_attribution
        then response.traffic_source
        else nullif(btrim(payload #>> '{attribution,source}'), '')
      end,
      referrer_host = case when response.has_attribution
        then response.referrer_host
        else nullif(btrim(payload #>> '{attribution,referrerHost}'), '')
      end,
      utm_source = case when response.has_attribution
        then response.utm_source
        else nullif(btrim(payload #>> '{attribution,utmSource}'), '')
      end,
      utm_medium = case when response.has_attribution
        then response.utm_medium
        else nullif(btrim(payload #>> '{attribution,utmMedium}'), '')
      end,
      utm_campaign = case when response.has_attribution
        then response.utm_campaign
        else nullif(btrim(payload #>> '{attribution,utmCampaign}'), '')
      end,
      utm_content = case when response.has_attribution
        then response.utm_content
        else nullif(btrim(payload #>> '{attribution,utmContent}'), '')
      end,
      utm_term = case when response.has_attribution
        then response.utm_term
        else nullif(btrim(payload #>> '{attribution,utmTerm}'), '')
      end,
      fbclid = case when response.has_attribution
        then response.fbclid
        else nullif(btrim(payload #>> '{attribution,fbclid}'), '')
      end
    from (
      select
        response.id,
        response.traffic_source,
        response.referrer_host,
        response.utm_source,
        response.utm_medium,
        response.utm_campaign,
        response.utm_content,
        response.utm_term,
        response.fbclid,
        pg_catalog.num_nonnulls(
          nullif(
            pg_catalog.lower(pg_catalog.btrim(response.traffic_source)),
            'direct'
          ),
          response.referrer_host,
          response.utm_source,
          response.utm_medium,
          response.utm_campaign,
          response.utm_content,
          response.utm_term,
          response.fbclid
        ) > 0 as has_attribution
      from public.study_profile_responses as response
    ) as response
    where confirmation.id = resolved_confirmation_id
      and response.id = confirmation.response_id;
  end if;

  return receipt;
end;
$$;

revoke all on function public.request_study_profile_report_waitlist_confirmation_attributed(jsonb)
from public, anon, authenticated;

grant execute on function public.request_study_profile_report_waitlist_confirmation_attributed(jsonb)
to service_role;

create or replace function public.confirm_study_profile_waitlist_measured(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  confirmation_hash text := lower(btrim(payload ->> 'confirmationTokenHash'));
  was_replay boolean := false;
  receipt jsonb;
  resolved_under_18 boolean;
  conversion_eligible boolean := false;
begin
  if confirmation_hash is not null then
    select exists (
      select 1
      from public.study_profile_waitlist_confirmations
      where consumed_token_hash = confirmation_hash
        and status = 'confirmed'
        and replay_expires_at > now()
    )
    into was_replay;
  end if;

  receipt := public.confirm_study_profile_waitlist(payload);

  if receipt ->> 'status' = 'confirmed' then
    select under_18
    into resolved_under_18
    from public.study_profile_waitlist_confirmations
    where consumed_token_hash = confirmation_hash
      and status = 'confirmed'
    limit 1;

    conversion_eligible := resolved_under_18 is false
      and (
        coalesce((receipt ->> 'newlyJoined')::boolean, false)
        or was_replay
      );
  end if;

  return receipt || jsonb_build_object(
    'metaConversionEligible', conversion_eligible
  );
end;
$$;

revoke all on function public.confirm_study_profile_waitlist_measured(jsonb)
from public, anon, authenticated;

grant execute on function public.confirm_study_profile_waitlist_measured(jsonb)
to service_role;

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
    and pg_catalog.to_regprocedure(
      'public.confirm_study_profile_waitlist_measured(jsonb)'
    ) is not null
    and (
      select
        not candidate_proc.prosecdef
        and pg_catalog.strpos(candidate_proc.prosrc, 'under_18') > 0
        and pg_catalog.strpos(candidate_proc.prosrc, 'metaConversionEligible') > 0
        and pg_catalog.strpos(candidate_proc.prosrc, 'was_replay') > 0
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
