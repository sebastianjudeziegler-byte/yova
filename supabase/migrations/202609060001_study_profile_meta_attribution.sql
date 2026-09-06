-- Preserve Meta campaign attribution through the Study Profile email gate and
-- double-opt-in waitlist flow without widening any public database grants.

alter table public.study_profile_responses
add column if not exists fbclid text check (
  fbclid is null
  or (
    char_length(fbclid) between 1 and 500
    and fbclid ~ '^[A-Za-z0-9._-]+$'
  )
);

alter table public.study_profile_waitlist_confirmations
add column if not exists fbclid text check (
  fbclid is null
  or (
    char_length(fbclid) between 1 and 500
    and fbclid ~ '^[A-Za-z0-9._-]+$'
  )
);

create or replace function public.save_study_profile_response_attributed(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  receipt jsonb;
  resolved_response_id uuid;
begin
  receipt := public.save_study_profile_response(payload);
  resolved_response_id := (receipt ->> 'responseId')::uuid;

  update public.study_profile_responses
  set fbclid = nullif(btrim(payload #>> '{attribution,fbclid}'), '')
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
begin
  receipt := public.request_study_profile_waitlist_confirmation(payload);
  resolved_confirmation_id := nullif(receipt ->> 'confirmationId', '')::uuid;

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
        id,
        traffic_source,
        referrer_host,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term,
        fbclid,
        pg_catalog.num_nonnulls(
          traffic_source,
          referrer_host,
          utm_source,
          utm_medium,
          utm_campaign,
          utm_content,
          utm_term,
          fbclid
        ) > 0 as has_attribution
      from public.study_profile_responses
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

create or replace function public.study_profile_public_readiness_v2()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  base_readiness jsonb := public.study_profile_public_readiness_v1();
  attribution_capture boolean;
begin
  select
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'study_profile_responses'
        and column_name = 'fbclid'
    )
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'study_profile_waitlist_confirmations'
        and column_name = 'fbclid'
    )
    and pg_catalog.to_regprocedure(
      'public.save_study_profile_response_attributed(jsonb)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.request_study_profile_waitlist_confirmation_attributed(jsonb)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.request_study_profile_report_waitlist_confirmation_attributed(jsonb)'
    ) is not null
    and (
      select
        not candidate_proc.prosecdef
        and pg_catalog.strpos(
          candidate_proc.prosrc,
          'public.save_study_profile_response(payload)'
        ) > 0
        and pg_catalog.strpos(
          candidate_proc.prosrc,
          'update public.study_profile_responses'
        ) > 0
      from pg_catalog.pg_proc as candidate_proc
      where candidate_proc.oid = pg_catalog.to_regprocedure(
        'public.save_study_profile_response_attributed(jsonb)'
      )
    ) is true
    and (
      select
        not candidate_proc.prosecdef
        and pg_catalog.strpos(
          candidate_proc.prosrc,
          'public.request_study_profile_waitlist_confirmation(payload)'
        ) > 0
        and pg_catalog.strpos(
          candidate_proc.prosrc,
          'update public.study_profile_waitlist_confirmations'
        ) > 0
      from pg_catalog.pg_proc as candidate_proc
      where candidate_proc.oid = pg_catalog.to_regprocedure(
        'public.request_study_profile_waitlist_confirmation_attributed(jsonb)'
      )
    ) is true
    and (
      select
        not candidate_proc.prosecdef
        and pg_catalog.strpos(
          candidate_proc.prosrc,
          'public.request_study_profile_report_waitlist_confirmation(payload)'
        ) > 0
        and pg_catalog.strpos(
          candidate_proc.prosrc,
          'update public.study_profile_waitlist_confirmations as confirmation'
        ) > 0
      from pg_catalog.pg_proc as candidate_proc
      where candidate_proc.oid = pg_catalog.to_regprocedure(
        'public.request_study_profile_report_waitlist_confirmation_attributed(jsonb)'
      )
    ) is true
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.save_study_profile_response_attributed(jsonb)',
      'execute'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.request_study_profile_waitlist_confirmation_attributed(jsonb)',
      'execute'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.request_study_profile_report_waitlist_confirmation_attributed(jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.save_study_profile_response_attributed(jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.save_study_profile_response_attributed(jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.request_study_profile_waitlist_confirmation_attributed(jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.request_study_profile_waitlist_confirmation_attributed(jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.request_study_profile_report_waitlist_confirmation_attributed(jsonb)',
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.request_study_profile_report_waitlist_confirmation_attributed(jsonb)',
      'execute'
    )
  into attribution_capture;

  return base_readiness || jsonb_build_object(
    'contractVersion', '202609060001',
    'ready', coalesce((base_readiness ->> 'ready')::boolean, false)
      and attribution_capture,
    'attributionCapture', attribution_capture
  );
end;
$$;

revoke all on function public.study_profile_public_readiness_v2()
from public, anon, authenticated, service_role;

grant execute on function public.study_profile_public_readiness_v2()
to service_role;
