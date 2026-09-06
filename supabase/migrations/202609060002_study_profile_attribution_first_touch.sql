-- Treat an untagged direct response as unattributed when a later report CTA
-- supplies the first campaign touch. Preserve any real response attribution.

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

create or replace function public.study_profile_public_readiness_v3()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  base_readiness jsonb := public.study_profile_public_readiness_v2();
  attribution_first_touch boolean;
begin
  select
    not candidate_proc.prosecdef
    and pg_catalog.strpos(
      candidate_proc.prosrc,
      'nullif('
    ) > 0
    and pg_catalog.strpos(
      candidate_proc.prosrc,
      'pg_catalog.lower(pg_catalog.btrim(response.traffic_source))'
    ) > 0
    and pg_catalog.strpos(
      candidate_proc.prosrc,
      $needle$'direct'$needle$
    ) > 0
    and pg_catalog.strpos(
      candidate_proc.prosrc,
      'response.fbclid'
    ) > 0
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.request_study_profile_report_waitlist_confirmation_attributed(jsonb)',
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
  into attribution_first_touch
  from pg_catalog.pg_proc as candidate_proc
  where candidate_proc.oid = pg_catalog.to_regprocedure(
    'public.request_study_profile_report_waitlist_confirmation_attributed(jsonb)'
  );

  return base_readiness || jsonb_build_object(
    'contractVersion', '202609060002',
    'ready', coalesce((base_readiness ->> 'ready')::boolean, false)
      and coalesce(attribution_first_touch, false),
    'attributionFirstTouch', coalesce(attribution_first_touch, false)
  );
end;
$$;

revoke all on function public.study_profile_public_readiness_v3()
from public, anon, authenticated, service_role;

grant execute on function public.study_profile_public_readiness_v3()
to service_role;
