-- Founder-only operational directory for YOVA accounts, Study Profile leads,
-- and tester invitations. This deliberately exposes a narrow, explicit set of
-- fields: no quiz answers, free responses, report or confirmation credentials,
-- provider identifiers, raw event payloads, or account metadata cross the RPC.

create or replace function public.founder_people_directory(
  search_text text default '',
  kind_filter text default 'all',
  status_filter text default 'all',
  cursor_seen_at timestamptz default null,
  cursor_email text default null,
  result_limit integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  generated_at timestamptz := pg_catalog.now();
  normalized_search text := pg_catalog.lower(
    pg_catalog.btrim(pg_catalog.coalesce(search_text, ''))
  );
  resolved_kind text := pg_catalog.lower(
    pg_catalog.btrim(pg_catalog.coalesce(kind_filter, 'all'))
  );
  resolved_status text := pg_catalog.lower(
    pg_catalog.btrim(pg_catalog.coalesce(status_filter, 'all'))
  );
  normalized_cursor_email text := pg_catalog.lower(
    pg_catalog.btrim(pg_catalog.coalesce(cursor_email, ''))
  );
  resolved_limit integer := pg_catalog.greatest(
    1,
    pg_catalog.least(pg_catalog.coalesce(result_limit, 25), 100)
  );
  result jsonb;
begin
  if current_user_id is null or not exists (
    select 1
    from public.founder_accounts as founder
    where founder.user_id = current_user_id
  ) then
    raise exception 'Founder access is required.';
  end if;

  if pg_catalog.char_length(normalized_search) > 120 then
    raise exception 'Founder people search is too long.';
  end if;

  if resolved_kind not in (
    'all', 'accounts', 'leads', 'waitlist', 'testers'
  ) then
    raise exception 'Unsupported founder people kind filter.';
  end if;

  if resolved_status not in (
    'all',
    'onboarding_incomplete',
    'report_unlocked',
    'confirmation_pending',
    'waitlist_confirmed',
    'email_failed'
  ) then
    raise exception 'Unsupported founder people status filter.';
  end if;

  if (cursor_seen_at is null) <> (cursor_email is null) then
    raise exception 'A complete founder people cursor is required.';
  end if;

  if cursor_seen_at is not null and (
    normalized_cursor_email = ''
    or pg_catalog.char_length(normalized_cursor_email) > 320
  ) then
    raise exception 'A valid founder people cursor email is required.';
  end if;

  with
  founder_emails as materialized (
    select distinct pg_catalog.lower(pg_catalog.btrim(auth_user.email)) as email
    from public.founder_accounts as founder
    inner join auth.users as auth_user on auth_user.id = founder.user_id
    where pg_catalog.nullif(pg_catalog.btrim(auth_user.email), '') is not null
  ),
  eligible_auth_users as materialized (
    select
      auth_user.id as user_id,
      pg_catalog.lower(pg_catalog.btrim(auth_user.email)) as email,
      auth_user.created_at,
      auth_user.updated_at,
      auth_user.email_confirmed_at,
      auth_user.last_sign_in_at
    from auth.users as auth_user
    where auth_user.deleted_at is null
      and auth_user.is_anonymous is false
      and pg_catalog.nullif(pg_catalog.btrim(auth_user.email), '') is not null
      and pg_catalog.char_length(pg_catalog.btrim(auth_user.email)) <= 320
      and not exists (
        select 1
        from public.founder_accounts as founder
        where founder.user_id = auth_user.id
      )
      and not exists (
        select 1
        from founder_emails as founder
        where founder.email = pg_catalog.lower(pg_catalog.btrim(auth_user.email))
      )
  ),
  account_rollup as materialized (
    select
      account.email,
      (
        pg_catalog.array_agg(
          pg_catalog.nullif(pg_catalog.btrim(profile.display_name), '')
          order by
            profile.updated_at desc nulls last,
            account.updated_at desc nulls last,
            account.user_id desc
        ) filter (
          where pg_catalog.nullif(
            pg_catalog.btrim(profile.display_name),
            ''
          ) is not null
        )
      )[1] as display_name,
      pg_catalog.min(account.created_at) as account_created_at,
      pg_catalog.max(account.email_confirmed_at) as email_confirmed_at,
      pg_catalog.max(account.last_sign_in_at) as last_sign_in_at,
      pg_catalog.max(profile.onboarding_completed_at) as onboarding_completed_at
    from eligible_auth_users as account
    left join public.profiles as profile on profile.id = account.user_id
    group by account.email
  ),
  account_product_rollup as materialized (
    select
      account.email,
      pg_catalog.max(event.occurred_at) as last_product_activity_at
    from eligible_auth_users as account
    inner join public.product_events as event
      on event.user_id = account.user_id
      and event.event_name <> 'generation_observed'
    group by account.email
  ),
  account_latest_device as materialized (
    select distinct on (account.email)
      account.email,
      event.device_type
    from eligible_auth_users as account
    inner join public.product_events as event
      on event.user_id = account.user_id
      and event.event_name <> 'generation_observed'
    order by
      account.email,
      event.occurred_at desc,
      event.id desc
  ),
  account_plan_rollup as materialized (
    select account.email, pg_catalog.count(plan.id) as plans_count
    from eligible_auth_users as account
    inner join public.plans as plan on plan.user_id = account.user_id
    group by account.email
  ),
  account_session_rollup as materialized (
    select
      account.email,
      pg_catalog.count(attempt.id) filter (
        where attempt.completed_at is not null
      ) as sessions_completed,
      pg_catalog.coalesce(
        pg_catalog.sum(attempt.actual_minutes) filter (
          where attempt.completed_at is not null
        ),
        0
      ) as study_minutes
    from eligible_auth_users as account
    inner join public.session_attempts as attempt
      on attempt.user_id = account.user_id
    group by account.email
  ),
  eligible_invites as materialized (
    select
      pg_catalog.lower(pg_catalog.btrim(invite.email)) as email,
      invite.display_name,
      invite.status,
      invite.invited_at,
      invite.joined_at,
      invite.updated_at
    from public.tester_invites as invite
    where not exists (
      select 1
      from founder_emails as founder
      where founder.email = pg_catalog.lower(pg_catalog.btrim(invite.email))
    )
  ),
  invite_rollup as materialized (
    select
      invite.email,
      (
        pg_catalog.array_agg(
          pg_catalog.nullif(pg_catalog.btrim(invite.display_name), '')
          order by invite.updated_at desc, invite.invited_at desc
        ) filter (
          where pg_catalog.nullif(
            pg_catalog.btrim(invite.display_name),
            ''
          ) is not null
        )
      )[1] as display_name,
      case
        when pg_catalog.bool_or(invite.status = 'joined') then 'joined'
        else 'pending'
      end as invite_status,
      pg_catalog.max(invite.invited_at) as invited_at,
      pg_catalog.max(invite.joined_at) as joined_at,
      pg_catalog.max(invite.updated_at) as invite_updated_at
    from eligible_invites as invite
    group by invite.email
  ),
  eligible_leads as materialized (
    select lead.*
    from public.study_profile_leads as lead
    where not exists (
      select 1
      from founder_emails as founder
      where founder.email = lead.email_normalized
    )
  ),
  response_rollup as materialized (
    select
      response.lead_id,
      pg_catalog.count(*) as report_count,
      pg_catalog.max(response.created_at) as latest_report_at
    from public.study_profile_responses as response
    inner join eligible_leads as lead on lead.id = response.lead_id
    group by response.lead_id
  ),
  latest_response as materialized (
    select distinct on (response.lead_id)
      response.lead_id,
      response.id,
      response.visitor_id,
      response.created_at,
      response.email_delivery_status,
      response.email_sent_at,
      response.school_level,
      response.under_18,
      response.primary_pattern,
      response.energy_window,
      response.traffic_source,
      response.utm_source,
      response.utm_medium,
      response.utm_campaign,
      response.utm_content,
      response.utm_term,
      response.fbclid
    from public.study_profile_responses as response
    inner join eligible_leads as lead on lead.id = response.lead_id
    order by response.lead_id, response.created_at desc, response.id desc
  ),
  latest_confirmation as materialized (
    select distinct on (confirmation.lead_id)
      confirmation.lead_id,
      confirmation.id,
      confirmation.visitor_id,
      confirmation.status,
      confirmation.consent_source,
      confirmation.delivery_status,
      confirmation.requested_at,
      confirmation.confirmed_at,
      confirmation.expires_at,
      confirmation.under_18,
      confirmation.traffic_source,
      confirmation.utm_source,
      confirmation.utm_medium,
      confirmation.utm_campaign,
      confirmation.utm_content,
      confirmation.utm_term,
      confirmation.fbclid
    from public.study_profile_waitlist_confirmations as confirmation
    inner join eligible_leads as lead on lead.id = confirmation.lead_id
    order by
      confirmation.lead_id,
      confirmation.requested_at desc,
      confirmation.id desc
  ),
  active_confirmation as materialized (
    select distinct on (confirmation.lead_id)
      confirmation.lead_id,
      confirmation.requested_at
    from public.study_profile_waitlist_confirmations as confirmation
    inner join eligible_leads as lead on lead.id = confirmation.lead_id
    where confirmation.status = 'pending'
      and confirmation.expires_at > generated_at
    order by
      confirmation.lead_id,
      confirmation.requested_at desc,
      confirmation.id desc
  ),
  lead_visitor_keys as materialized (
    select response.lead_id, response.visitor_id
    from public.study_profile_responses as response
    inner join eligible_leads as lead on lead.id = response.lead_id
    union
    select confirmation.lead_id, confirmation.visitor_id
    from public.study_profile_waitlist_confirmations as confirmation
    inner join eligible_leads as lead on lead.id = confirmation.lead_id
    where confirmation.visitor_id is not null
  ),
  lead_latest_device as materialized (
    select distinct on (visitor.lead_id)
      visitor.lead_id,
      event.device_type
    from lead_visitor_keys as visitor
    inner join public.study_profile_events as event
      on event.visitor_id = visitor.visitor_id
    order by
      visitor.lead_id,
      (event.device_type = 'unknown'),
      event.occurred_at desc,
      event.id desc
  ),
  lead_report_views as materialized (
    select
      visitor.lead_id,
      pg_catalog.max(event.occurred_at) as report_viewed_at
    from lead_visitor_keys as visitor
    inner join public.study_profile_events as event
      on event.visitor_id = visitor.visitor_id
      and event.event_name = 'study_profile_report_viewed'
    group by visitor.lead_id
  ),
  person_emails as materialized (
    select account.email from account_rollup as account
    union
    select lead.email_normalized from eligible_leads as lead
    union
    select invite.email from invite_rollup as invite
  ),
  people as materialized (
    select
      person.email,
      case
        when account.email is not null and lead.id is not null then 'linked'
        when account.email is not null then 'account'
        when lead.id is not null then 'lead'
        else 'tester'
      end as kind,
      case
        when account.email is not null and lead.id is not null
          then 'exact_normalized_email'
        else null
      end as match_basis,
      pg_catalog.coalesce(account.display_name, invite.display_name) as display_name,
      account.email is not null as has_yova_account,
      lead.id is not null as has_study_profile_lead,
      account.account_created_at,
      account.email_confirmed_at,
      account.last_sign_in_at,
      account.onboarding_completed_at,
      invite.invite_status,
      invite.invited_at,
      invite.joined_at,
      product.last_product_activity_at,
      pg_catalog.coalesce(plan.plans_count, 0) as plans_count,
      pg_catalog.coalesce(session.sessions_completed, 0) as sessions_completed,
      pg_catalog.coalesce(session.study_minutes, 0) as study_minutes,
      lead.created_at as lead_created_at,
      lead.marketing_consent_at,
      case
        when lead.id is null then null
        when pg_catalog.coalesce(response_count.report_count, 0) > 0
          then 'report_unlocked'
        else 'waitlist_only'
      end as profile_status,
      pg_catalog.coalesce(response_count.report_count, 0) as report_count,
      response_count.latest_report_at,
      response.email_delivery_status as report_email_status,
      response.email_sent_at as report_email_sent_at,
      report_view.report_viewed_at,
      lead.waitlist_status,
      confirmation.requested_at as waitlist_requested_at,
      lead.waitlist_joined_at,
      confirmation.status as waitlist_confirmation_status,
      pg_catalog.coalesce(
        lead.waitlist_consent_source,
        confirmation.consent_source
      ) as waitlist_consent_source,
      confirmation.delivery_status as confirmation_delivery_status,
      response.school_level,
      case
        when response.under_18 is true or confirmation.under_18 is true
          then '13_17'
        when response.under_18 is false or confirmation.under_18 is false
          then '18_plus'
        else 'unknown'
      end as age_band,
      response.primary_pattern,
      response.energy_window,
      case when lead.id is null then null else
        private.founder_safe_attribution_label(
          pg_catalog.coalesce(
            response.utm_source,
            confirmation.utm_source,
            pg_catalog.nullif(
              pg_catalog.lower(pg_catalog.btrim(response.traffic_source)),
              'direct'
            ),
            pg_catalog.nullif(
              pg_catalog.lower(pg_catalog.btrim(confirmation.traffic_source)),
              'direct'
            ),
            response.traffic_source,
            confirmation.traffic_source
          ),
          'direct',
          100
        )
      end as source,
      case when lead.id is null then null else
        private.founder_safe_attribution_label(
          pg_catalog.coalesce(response.utm_medium, confirmation.utm_medium),
          'none',
          100
        )
      end as medium,
      case when lead.id is null then null else
        private.founder_safe_attribution_label(
          pg_catalog.coalesce(response.utm_campaign, confirmation.utm_campaign),
          'none',
          160
        )
      end as campaign,
      case when lead.id is null then null else
        private.founder_safe_attribution_label(
          pg_catalog.coalesce(response.utm_content, confirmation.utm_content),
          'none',
          160
        )
      end as content,
      case when lead.id is null then null else
        private.founder_safe_attribution_label(
          pg_catalog.coalesce(response.utm_term, confirmation.utm_term),
          'none',
          160
        )
      end as term,
      case
        when lead_device.device_type is not null
          and lead_device.device_type <> 'unknown'
          then lead_device.device_type
        when account_device.device_type is not null
          and account_device.device_type <> 'unknown'
          then account_device.device_type
        else pg_catalog.coalesce(
          lead_device.device_type,
          account_device.device_type,
          'unknown'
        )
      end as device_type,
      pg_catalog.coalesce(
        response.fbclid is not null or confirmation.fbclid is not null,
        false
      ) as has_meta_click,
      lead.beta_interest,
      active_confirmation.lead_id is not null as confirmation_pending,
      pg_catalog.coalesce(
        response.email_delivery_status = 'failed'
          or confirmation.delivery_status = 'failed'
          or confirmation.status = 'delivery_failed',
        false
      ) as email_failed,
      pg_catalog.greatest(
        pg_catalog.coalesce(account.account_created_at, '-infinity'::timestamptz),
        pg_catalog.coalesce(account.last_sign_in_at, '-infinity'::timestamptz),
        pg_catalog.coalesce(product.last_product_activity_at, '-infinity'::timestamptz),
        pg_catalog.coalesce(invite.invite_updated_at, '-infinity'::timestamptz),
        pg_catalog.coalesce(lead.updated_at, '-infinity'::timestamptz),
        pg_catalog.coalesce(response_count.latest_report_at, '-infinity'::timestamptz),
        pg_catalog.coalesce(report_view.report_viewed_at, '-infinity'::timestamptz),
        pg_catalog.coalesce(confirmation.requested_at, '-infinity'::timestamptz),
        pg_catalog.coalesce(lead.waitlist_joined_at, '-infinity'::timestamptz)
      ) as recent_at
    from person_emails as person
    left join account_rollup as account on account.email = person.email
    left join account_product_rollup as product on product.email = person.email
    left join account_latest_device as account_device on account_device.email = person.email
    left join account_plan_rollup as plan on plan.email = person.email
    left join account_session_rollup as session on session.email = person.email
    left join invite_rollup as invite on invite.email = person.email
    left join eligible_leads as lead on lead.email_normalized = person.email
    left join response_rollup as response_count on response_count.lead_id = lead.id
    left join latest_response as response on response.lead_id = lead.id
    left join latest_confirmation as confirmation on confirmation.lead_id = lead.id
    left join active_confirmation on active_confirmation.lead_id = lead.id
    left join lead_latest_device as lead_device on lead_device.lead_id = lead.id
    left join lead_report_views as report_view on report_view.lead_id = lead.id
  ),
  filtered_people as materialized (
    select person.*
    from people as person
    where (
      normalized_search = ''
      or pg_catalog.strpos(person.email, normalized_search) > 0
      or pg_catalog.strpos(
        pg_catalog.lower(pg_catalog.coalesce(person.display_name, '')),
        normalized_search
      ) > 0
    )
      and case resolved_kind
        when 'accounts' then person.has_yova_account
        when 'leads' then person.has_study_profile_lead
        when 'waitlist' then person.waitlist_status = 'joined'
          or person.confirmation_pending
        when 'testers' then person.invite_status is not null
        else true
      end
      and case resolved_status
        when 'onboarding_incomplete' then person.has_yova_account
          and person.onboarding_completed_at is null
        when 'report_unlocked' then person.report_count > 0
        when 'confirmation_pending' then person.confirmation_pending
        when 'waitlist_confirmed' then person.waitlist_status = 'joined'
        when 'email_failed' then person.email_failed
        else true
      end
  ),
  cursor_page as materialized (
    select
      person.*,
      pg_catalog.row_number() over (
        order by person.recent_at desc, person.email asc
      ) as row_number
    from filtered_people as person
    where cursor_seen_at is null
      or person.recent_at < cursor_seen_at
      or (
        person.recent_at = cursor_seen_at
        and person.email > normalized_cursor_email
      )
    order by person.recent_at desc, person.email asc
    limit resolved_limit + 1
  ),
  visible_rows as materialized (
    select
      page.row_number,
      page.recent_at,
      page.email,
      pg_catalog.jsonb_build_object(
        'email', page.email,
        'kind', page.kind,
        'matchBasis', page.match_basis,
        'displayName', page.display_name,
        'recentAt', page.recent_at,
        'hasYovaAccount', page.has_yova_account,
        'hasStudyProfileLead', page.has_study_profile_lead,
        'accountCreatedAt', page.account_created_at,
        'emailConfirmedAt', page.email_confirmed_at,
        'lastSignInAt', page.last_sign_in_at,
        'onboardingCompletedAt', page.onboarding_completed_at,
        'inviteStatus', page.invite_status,
        'invitedAt', page.invited_at,
        'joinedAt', page.joined_at,
        'lastProductActivityAt', page.last_product_activity_at,
        'plansCount', page.plans_count,
        'sessionsCompleted', page.sessions_completed,
        'studyMinutes', page.study_minutes,
        'leadCreatedAt', page.lead_created_at,
        'marketingConsentAt', page.marketing_consent_at,
        'profileStatus', page.profile_status,
        'reportCount', page.report_count,
        'latestReportAt', page.latest_report_at,
        'reportEmailStatus', page.report_email_status,
        'reportEmailSentAt', page.report_email_sent_at,
        'reportViewedAt', page.report_viewed_at,
        'waitlistStatus', page.waitlist_status,
        'waitlistRequestedAt', page.waitlist_requested_at,
        'waitlistJoinedAt', page.waitlist_joined_at,
        'waitlistConfirmationStatus', page.waitlist_confirmation_status,
        'waitlistConsentSource', page.waitlist_consent_source,
        'confirmationDeliveryStatus', page.confirmation_delivery_status,
        'schoolLevel', page.school_level,
        'ageBand', page.age_band,
        'primaryPattern', page.primary_pattern,
        'energyWindow', page.energy_window,
        'source', page.source,
        'medium', page.medium,
        'campaign', page.campaign,
        'content', page.content,
        'term', page.term,
        'deviceType', page.device_type,
        'hasMetaClick', page.has_meta_click,
        'betaInterest', page.beta_interest
      ) as payload
    from cursor_page as page
    where page.row_number <= resolved_limit
  ),
  directory_summary as materialized (
    select pg_catalog.jsonb_build_object(
      'uniquePeople', (select pg_catalog.count(*) from people),
      'yovaAccounts', (select pg_catalog.count(*) from eligible_auth_users),
      'studyProfileLeads', (select pg_catalog.count(*) from eligible_leads),
      'confirmedWaitlist', (
        select pg_catalog.count(*)
        from eligible_leads as lead
        where lead.waitlist_status = 'joined'
      ),
      'pendingInvites', (
        select pg_catalog.count(*)
        from eligible_invites as invite
        where invite.status = 'pending'
      )
    ) as payload
  ),
  page_metadata as materialized (
    select
      exists (
        select 1 from cursor_page as page
        where page.row_number > resolved_limit
      ) as has_more,
      (
        select pg_catalog.jsonb_build_object(
          'seenAt', row.recent_at,
          'email', row.email
        )
        from visible_rows as row
        order by row.row_number desc
        limit 1
      ) as last_cursor
  )
  select pg_catalog.jsonb_build_object(
    'generatedAt', generated_at,
    'summary', summary.payload,
    'total', (select pg_catalog.count(*) from filtered_people),
    'rows', pg_catalog.coalesce((
      select pg_catalog.jsonb_agg(row.payload order by row.row_number)
      from visible_rows as row
    ), '[]'::jsonb),
    'hasMore', metadata.has_more,
    'nextCursor', case
      when metadata.has_more then metadata.last_cursor
      else null
    end
  )
  into result
  from directory_summary as summary
  cross join page_metadata as metadata;

  return result;
end;
$$;

revoke all on function public.founder_people_directory(
  text,
  text,
  text,
  timestamptz,
  text,
  integer
)
from public, anon, authenticated, service_role;

grant execute on function public.founder_people_directory(
  text,
  text,
  text,
  timestamptz,
  text,
  integer
)
to authenticated;
