-- Founder-only, aggregate analytics for YOVA and the public Study Profile.
-- Device telemetry is deliberately reduced to four broad categories. Raw user
-- agents, emails, response payloads, report tokens, and click IDs never cross
-- either dashboard RPC boundary.

alter table public.product_events
add column device_type text not null default 'unknown';

alter table public.product_events
add constraint product_events_device_type_check check (
  device_type in ('mobile', 'tablet', 'desktop', 'unknown')
);

alter table public.study_profile_events
add column device_type text not null default 'unknown';

-- Preserve any broad device category captured in the bounded event payload
-- before the dedicated column reached production. Invalid values stay unknown.
update public.study_profile_events
set device_type = event_data ->> 'deviceType'
where device_type = 'unknown'
  and event_data ->> 'deviceType' in (
    'mobile', 'tablet', 'desktop', 'unknown'
  );

alter table public.study_profile_events
add constraint study_profile_events_device_type_check check (
  device_type in ('mobile', 'tablet', 'desktop', 'unknown')
);

create index product_events_device_time_idx
on public.product_events (occurred_at desc, device_type);

create index study_profile_events_device_time_idx
on public.study_profile_events (occurred_at desc, device_type);

create index study_profile_waitlist_confirmations_requested_time_idx
on public.study_profile_waitlist_confirmations (requested_at desc);

create index study_profile_waitlist_confirmations_confirmed_time_idx
on public.study_profile_waitlist_confirmations (confirmed_at desc)
where confirmed_at is not null;

create or replace function private.founder_safe_attribution_label(
  candidate_value text,
  fallback_label text,
  maximum_length integer
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  normalized_value text := pg_catalog.lower(
    pg_catalog.btrim(candidate_value)
  );
  normalized_fallback text := coalesce(
    nullif(pg_catalog.lower(pg_catalog.btrim(fallback_label)), ''),
    'none'
  );
  resolved_maximum integer := greatest(
    1,
    least(coalesce(maximum_length, 160), 160)
  );
begin
  if normalized_value is null or normalized_value = '' then
    return normalized_fallback;
  end if;

  -- Mirror the application attribution guard at the final read boundary.
  -- The encoded checks are intentionally conservative because old rows may
  -- predate the current server validator.
  if pg_catalog.char_length(normalized_value) > resolved_maximum
    or normalized_value ~ '[[:cntrl:]]'
    or normalized_value like '%@%'
    or pg_catalog.strpos(normalized_value, '%40') > 0
    or pg_catalog.strpos(normalized_value, '%2540') > 0
    or normalized_value ~ 'study-profile(/|%2f|%252f)report(/|%2f|%252f)'
    or normalized_value ~ '(report|token)[^a-z0-9_-]{0,12}[a-z0-9_-]{32,128}'
    or normalized_value ~ '(^|[^a-z0-9_-])[a-z0-9_-]{40,}($|[^a-z0-9_-])'
  then
    return 'redacted';
  end if;

  return normalized_value;
end;
$$;

revoke all on function private.founder_safe_attribution_label(
  text,
  text,
  integer
)
from public, anon, authenticated, service_role;

create or replace function public.founder_product_analytics(
  window_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  resolved_window_days integer := greatest(
    1,
    least(coalesce(window_days, 30), 90)
  );
  generated_at timestamptz := now();
  window_start timestamptz;
  previous_window_start timestamptz;
  result jsonb;
begin
  if current_user_id is null or not exists (
    select 1
    from public.founder_accounts as founder
    where founder.user_id = current_user_id
  ) then
    raise exception 'Founder access is required.';
  end if;

  -- Dashboard windows are complete UTC calendar days including today.
  window_start := (
    pg_catalog.date_trunc('day', generated_at at time zone 'UTC')
    - pg_catalog.make_interval(days => resolved_window_days - 1)
  ) at time zone 'UTC';
  previous_window_start := window_start
    - pg_catalog.make_interval(days => resolved_window_days);

  with
  date_spine as materialized (
    select days.day_value::date as day
    from pg_catalog.generate_series(
      (window_start at time zone 'UTC')::date,
      (generated_at at time zone 'UTC')::date,
      interval '1 day'
    ) as days(day_value)
  ),
  eligible_profiles as materialized (
    select profile.id, profile.created_at, profile.onboarding_completed_at
    from public.profiles as profile
    where not exists (
      select 1
      from public.founder_accounts as founder
      where founder.user_id = profile.id
    )
  ),
  window_events as materialized (
    select
      event.user_id,
      event.event_name,
      event.event_data,
      event.device_type,
      event.occurred_at
    from public.product_events as event
    where event.occurred_at >= window_start
      and event.occurred_at <= generated_at
      and event.event_name <> 'generation_observed'
      and not exists (
        select 1
        from public.founder_accounts as founder
        where founder.user_id = event.user_id
      )
  ),
  previous_window_users as materialized (
    select distinct event.user_id
    from public.product_events as event
    where event.occurred_at >= previous_window_start
      and event.occurred_at < window_start
      and event.event_name <> 'generation_observed'
      and not exists (
        select 1
        from public.founder_accounts as founder
        where founder.user_id = event.user_id
      )
  ),
  returning_users as materialized (
    select distinct event.user_id
    from window_events as event
    inner join previous_window_users as previous
      on previous.user_id = event.user_id
  ),
  window_completed_attempts as materialized (
    select
      attempt.user_id,
      attempt.actual_minutes,
      attempt.user_feedback,
      attempt.completed_at
    from public.session_attempts as attempt
    where attempt.completed_at >= window_start
      and attempt.completed_at <= generated_at
      and not exists (
        select 1
        from public.founder_accounts as founder
        where founder.user_id = attempt.user_id
      )
  ),
  window_interrupted_attempts as materialized (
    select attempt.user_id, attempt.created_at
    from public.session_attempts as attempt
    where attempt.completed_at is null
      and attempt.result_data ->> 'status' = 'interrupted'
      and attempt.created_at >= window_start
      and attempt.created_at <= generated_at
      and not exists (
        select 1
        from public.founder_accounts as founder
        where founder.user_id = attempt.user_id
      )
  ),
  product_summary as materialized (
    select
      (select pg_catalog.count(*) from eligible_profiles) as total_accounts,
      (
        select pg_catalog.count(*)
        from eligible_profiles as profile
        where profile.created_at >= window_start
          and profile.created_at <= generated_at
      ) as new_accounts,
      (
        select pg_catalog.count(*)
        from eligible_profiles as profile
        where profile.created_at >= window_start
          and profile.created_at <= generated_at
          and profile.onboarding_completed_at is not null
      ) as onboarded_new_accounts,
      (
        select pg_catalog.count(distinct event.user_id)
        from window_events as event
      ) as engaged_users,
      (select pg_catalog.count(*) from returning_users) as returning_users,
      (
        select pg_catalog.count(*)
        from public.plans as plan
        where plan.created_at >= window_start
          and plan.created_at <= generated_at
          and not exists (
            select 1
            from public.founder_accounts as founder
            where founder.user_id = plan.user_id
          )
      ) as plans_created,
      (
        select pg_catalog.count(*)
        from public.plans as plan
        where plan.status = 'active'
          and not exists (
            select 1
            from public.founder_accounts as founder
            where founder.user_id = plan.user_id
          )
      ) as active_plans,
      (
        select pg_catalog.count(*)
        from window_events as event
        where event.event_name = 'session_started'
          and event.event_data ->> 'resumed' = 'false'
      ) as session_starts,
      (
        select pg_catalog.count(*)
        from window_events as event
        where event.event_name = 'session_started'
          and event.event_data ->> 'resumed' = 'true'
      ) as resumed_sessions,
      (
        select pg_catalog.count(*)
        from window_completed_attempts
      ) as sessions_completed,
      (
        select pg_catalog.count(*)
        from window_interrupted_attempts
      ) as sessions_interrupted,
      coalesce((
        select pg_catalog.sum(attempt.actual_minutes)
        from window_completed_attempts as attempt
      ), 0) as study_minutes,
      (
        select pg_catalog.count(*)
        from window_completed_attempts as attempt
        where attempt.user_feedback = 'about_right'
      ) as fit_sessions,
      (
        select pg_catalog.count(*)
        from window_completed_attempts as attempt
        where attempt.user_feedback is not null
      ) as rated_sessions,
      (
        select pg_catalog.count(*)
        from public.tutor_messages as message
        where message.role = 'user'
          and message.created_at >= window_start
          and message.created_at <= generated_at
          and not exists (
            select 1
            from public.founder_accounts as founder
            where founder.user_id = message.user_id
          )
      ) as tutor_questions,
      (
        select pg_catalog.count(*)
        from public.error_reports as report
        where report.occurred_at >= window_start
          and report.occurred_at <= generated_at
          and not exists (
            select 1
            from public.founder_accounts as founder
            where founder.user_id = report.user_id
          )
      ) as product_errors,
      (
        select pg_catalog.count(distinct report.user_id)
        from public.error_reports as report
        where report.occurred_at >= window_start
          and report.occurred_at <= generated_at
          and not exists (
            select 1
            from public.founder_accounts as founder
            where founder.user_id = report.user_id
          )
      ) as error_affected_users,
      (
        select pg_catalog.count(*)
        from public.support_requests as request
        where request.status in ('open', 'in_progress')
          and not exists (
            select 1
            from public.founder_accounts as founder
            where founder.user_id = request.user_id
          )
      ) as open_support_requests
  ),
  cohort_accounts as materialized (
    select
      profile.id,
      profile.onboarding_completed_at is not null as onboarded,
      exists (
        select 1
        from public.plans as plan
        where plan.user_id = profile.id
      ) as has_plan,
      exists (
        select 1
        from public.product_events as event
        where event.user_id = profile.id
          and event.event_name = 'session_started'
      ) or exists (
        select 1
        from public.session_attempts as attempt
        where attempt.user_id = profile.id
      ) as has_session_start,
      exists (
        select 1
        from public.session_attempts as attempt
        where attempt.user_id = profile.id
          and attempt.completed_at is not null
      ) as has_session_completion
    from eligible_profiles as profile
    where profile.created_at >= window_start
      and profile.created_at <= generated_at
  ),
  cohort_counts as materialized (
    select
      pg_catalog.count(*) as accounts,
      pg_catalog.count(*) filter (where onboarded) as onboarding,
      pg_catalog.count(*) filter (
        where onboarded and has_plan
      ) as plans,
      pg_catalog.count(*) filter (
        where onboarded and has_plan and has_session_start
      ) as sessions_started,
      pg_catalog.count(*) filter (
        where onboarded
          and has_plan
          and has_session_start
          and has_session_completion
      ) as sessions_completed
    from cohort_accounts
  ),
  daily_new_accounts as materialized (
    select
      (profile.created_at at time zone 'UTC')::date as day,
      pg_catalog.count(*) as count
    from eligible_profiles as profile
    where profile.created_at >= window_start
      and profile.created_at <= generated_at
    group by (profile.created_at at time zone 'UTC')::date
  ),
  daily_engaged_users as materialized (
    select
      (event.occurred_at at time zone 'UTC')::date as day,
      pg_catalog.count(distinct event.user_id) as count
    from window_events as event
    group by (event.occurred_at at time zone 'UTC')::date
  ),
  daily_plans as materialized (
    select
      (plan.created_at at time zone 'UTC')::date as day,
      pg_catalog.count(*) as count
    from public.plans as plan
    where plan.created_at >= window_start
      and plan.created_at <= generated_at
      and not exists (
        select 1
        from public.founder_accounts as founder
        where founder.user_id = plan.user_id
      )
    group by (plan.created_at at time zone 'UTC')::date
  ),
  daily_completed_sessions as materialized (
    select
      (attempt.completed_at at time zone 'UTC')::date as day,
      pg_catalog.count(*) as count
    from window_completed_attempts as attempt
    group by (attempt.completed_at at time zone 'UTC')::date
  ),
  daily_rows as materialized (
    select pg_catalog.jsonb_build_object(
      'date', pg_catalog.to_char(day.day, 'YYYY-MM-DD'),
      'newAccounts', coalesce(accounts.count, 0),
      'engagedUsers', coalesce(engaged.count, 0),
      'plansCreated', coalesce(plans.count, 0),
      'sessionsCompleted', coalesce(completions.count, 0)
    ) as payload,
    day.day
    from date_spine as day
    left join daily_new_accounts as accounts using (day)
    left join daily_engaged_users as engaged using (day)
    left join daily_plans as plans using (day)
    left join daily_completed_sessions as completions using (day)
  ),
  device_categories(device, sort_order) as (
    values
      ('mobile'::text, 1),
      ('tablet'::text, 2),
      ('desktop'::text, 3),
      ('unknown'::text, 4)
  ),
  device_counts as materialized (
    select
      event.device_type as device,
      pg_catalog.count(distinct event.user_id) as count
    from window_events as event
    group by event.device_type
  ),
  device_rows as materialized (
    select
      pg_catalog.jsonb_build_object(
        'device', category.device,
        'count', coalesce(device.count, 0)
      ) as payload,
      category.sort_order
    from device_categories as category
    left join device_counts as device using (device)
  ),
  event_rows as materialized (
    select pg_catalog.jsonb_build_object(
      'eventName', event.event_name,
      'count', pg_catalog.count(*),
      'users', pg_catalog.count(distinct event.user_id)
    ) as payload,
    pg_catalog.count(*) as event_count,
    event.event_name
    from window_events as event
    group by event.event_name
  )
  select pg_catalog.jsonb_build_object(
    'windowDays', resolved_window_days,
    'generatedAt', generated_at,
    'summary', pg_catalog.jsonb_build_object(
      'totalAccounts', summary.total_accounts,
      'newAccounts', summary.new_accounts,
      'onboardingRate', case
        when summary.new_accounts = 0 then 0
        else pg_catalog.round(
          100.0 * summary.onboarded_new_accounts / summary.new_accounts,
          1
        )
      end,
      'engagedUsers', summary.engaged_users,
      'returningUsers', summary.returning_users,
      'plansCreated', summary.plans_created,
      'activePlans', summary.active_plans,
      'sessionStarts', summary.session_starts,
      'resumedSessions', summary.resumed_sessions,
      'sessionsCompleted', summary.sessions_completed,
      'sessionCompletionRate', case
        when summary.sessions_completed + summary.sessions_interrupted = 0 then 0
        else pg_catalog.round(
          100.0 * summary.sessions_completed
            / (summary.sessions_completed + summary.sessions_interrupted),
          1
        )
      end,
      'studyMinutes', summary.study_minutes,
      'sessionFitRate', case
        when summary.rated_sessions = 0 then 0
        else pg_catalog.round(
          100.0 * summary.fit_sessions / summary.rated_sessions,
          1
        )
      end,
      'tutorQuestions', summary.tutor_questions,
      'productErrors', summary.product_errors,
      'errorAffectedUsers', summary.error_affected_users,
      'openSupportRequests', summary.open_support_requests
    ),
    'cohortFunnel', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'key', 'accounts',
        'label', 'Accounts created',
        'count', cohort.accounts
      ),
      pg_catalog.jsonb_build_object(
        'key', 'onboarding',
        'label', 'Onboarding completed',
        'count', cohort.onboarding
      ),
      pg_catalog.jsonb_build_object(
        'key', 'plans',
        'label', 'First plan created',
        'count', cohort.plans
      ),
      pg_catalog.jsonb_build_object(
        'key', 'sessions_started',
        'label', 'First session started',
        'count', cohort.sessions_started
      ),
      pg_catalog.jsonb_build_object(
        'key', 'sessions_completed',
        'label', 'First session completed',
        'count', cohort.sessions_completed
      )
    ),
    'daily', coalesce((
      select pg_catalog.jsonb_agg(row.payload order by row.day)
      from daily_rows as row
    ), '[]'::jsonb),
    'deviceBreakdown', coalesce((
      select pg_catalog.jsonb_agg(row.payload order by row.sort_order)
      from device_rows as row
    ), '[]'::jsonb),
    'eventBreakdown', coalesce((
      select pg_catalog.jsonb_agg(
        row.payload order by row.event_count desc, row.event_name
      )
      from event_rows as row
    ), '[]'::jsonb)
  )
  into result
  from product_summary as summary
  cross join cohort_counts as cohort;

  return result;
end;
$$;

revoke all on function public.founder_product_analytics(integer)
from public, anon;

grant execute on function public.founder_product_analytics(integer)
to authenticated;

create or replace function public.founder_study_profile_analytics(
  window_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  resolved_window_days integer := greatest(
    1,
    least(coalesce(window_days, 30), 90)
  );
  generated_at timestamptz := now();
  window_start timestamptz;
  result jsonb;
begin
  if current_user_id is null or not exists (
    select 1
    from public.founder_accounts as founder
    where founder.user_id = current_user_id
  ) then
    raise exception 'Founder access is required.';
  end if;

  window_start := (
    pg_catalog.date_trunc('day', generated_at at time zone 'UTC')
    - pg_catalog.make_interval(days => resolved_window_days - 1)
  ) at time zone 'UTC';

  with
  date_spine as materialized (
    select days.day_value::date as day
    from pg_catalog.generate_series(
      (window_start at time zone 'UTC')::date,
      (generated_at at time zone 'UTC')::date,
      interval '1 day'
    ) as days(day_value)
  ),
  window_events as materialized (
    select
      event.visitor_id,
      event.response_id,
      event.event_name,
      event.event_data,
      event.device_type,
      event.traffic_source,
      event.utm_source,
      event.utm_medium,
      event.utm_campaign,
      event.occurred_at,
      coalesce(
        event.visitor_id::text,
        'response:' || event.response_id::text
      ) as journey_key
    from public.study_profile_events as event
    where event.occurred_at >= window_start
      and event.occurred_at <= generated_at
  ),
  window_responses as materialized (
    select
      response.id,
      response.lead_id,
      response.visitor_id,
      response.primary_pattern,
      response.school_level,
      response.energy_window,
      response.email_delivery_status,
      response.traffic_source,
      response.utm_source,
      response.utm_medium,
      response.utm_campaign,
      response.created_at
    from public.study_profile_responses as response
    where response.created_at >= window_start
      and response.created_at <= generated_at
  ),
  latest_window_responses as materialized (
    select distinct on (response.lead_id)
      response.id,
      response.lead_id,
      response.primary_pattern,
      response.school_level,
      response.energy_window,
      response.created_at
    from window_responses as response
    order by response.lead_id, response.created_at desc, response.id desc
  ),
  window_confirmations as materialized (
    select
      confirmation.id,
      confirmation.lead_id,
      confirmation.response_id,
      confirmation.status,
      confirmation.delivery_status,
      confirmation.traffic_source,
      confirmation.utm_source,
      confirmation.utm_medium,
      confirmation.utm_campaign,
      confirmation.requested_at,
      confirmation.confirmed_at
    from public.study_profile_waitlist_confirmations as confirmation
    where (
      confirmation.requested_at >= window_start
      and confirmation.requested_at <= generated_at
    ) or (
      confirmation.confirmed_at >= window_start
      and confirmation.confirmed_at <= generated_at
    )
  ),
  stage_counts as materialized (
    select
      pg_catalog.count(*) filter (
        where event.event_name = 'study_profile_page_viewed'
      ) as page_views,
      pg_catalog.count(distinct event.journey_key) filter (
        where event.event_name = 'study_profile_page_viewed'
      ) as tracked_visits,
      pg_catalog.count(distinct event.journey_key) filter (
        where event.event_name = 'study_profile_started'
      ) as started,
      pg_catalog.count(distinct event.journey_key) filter (
        where event.event_name = 'study_profile_completed'
      ) as completed,
      pg_catalog.count(distinct coalesce(
        event.response_id::text,
        event.journey_key
      )) filter (
        where event.event_name = 'study_profile_report_viewed'
      ) as report_views,
      pg_catalog.count(*) filter (
        where event.event_name = 'study_profile_share_tapped'
      ) as share_taps
    from window_events as event
  ),
  response_counts as materialized (
    select
      pg_catalog.count(*) as report_unlocks,
      pg_catalog.count(distinct response.lead_id) as unique_report_leads
    from window_responses as response
  ),
  confirmation_counts as materialized (
    select
      pg_catalog.count(*) filter (
        where confirmation.requested_at >= window_start
          and confirmation.requested_at <= generated_at
      ) as waitlist_requests,
      pg_catalog.count(distinct confirmation.lead_id) filter (
        where confirmation.status = 'confirmed'
          and confirmation.confirmed_at >= window_start
          and confirmation.confirmed_at <= generated_at
      ) as confirmed_waitlist,
      pg_catalog.count(distinct confirmation.lead_id) filter (
        where confirmation.status = 'confirmed'
          and confirmation.response_id is not null
          and confirmation.confirmed_at >= window_start
          and confirmation.confirmed_at <= generated_at
      ) as report_waitlist
    from window_confirmations as confirmation
  ),
  lifetime_counts as materialized (
    select
      (
        select pg_catalog.count(*)
        from public.study_profile_leads as lead
        where lead.waitlist_status = 'joined'
      ) as lifetime_waitlist,
      (
        select pg_catalog.count(*)
        from public.study_profile_waitlist_confirmations as confirmation
        where confirmation.status = 'pending'
          and confirmation.expires_at > generated_at
      ) as pending_confirmations
  ),
  started_journeys as materialized (
    select distinct event.journey_key
    from window_events as event
    where event.event_name = 'study_profile_started'
  ),
  question_numbers as materialized (
    select questions.question_number
    from pg_catalog.generate_series(1, 14) as questions(question_number)
  ),
  question_counts as materialized (
    select
      question.question_number,
      pg_catalog.count(distinct event.journey_key) as answered_journeys
    from question_numbers as question
    left join window_events as event
      on event.event_name = 'study_profile_question_answered'
      and case
        when event.event_data ->> 'questionNumber' ~ '^[0-9]{1,2}$'
          then (event.event_data ->> 'questionNumber')::integer
        else null
      end = question.question_number
      and exists (
        select 1
        from started_journeys as started
        where started.journey_key = event.journey_key
      )
    group by question.question_number
  ),
  question_rows as materialized (
    select
      count.question_number,
      pg_catalog.jsonb_build_object(
        'questionNumber', count.question_number,
        'answeredJourneys', count.answered_journeys,
        'percentOfStarts', case
          when stage.started = 0 then 0
          else pg_catalog.round(
            100.0 * count.answered_journeys / stage.started,
            1
          )
        end,
        'dropFromPrevious', coalesce(
          pg_catalog.lag(count.answered_journeys) over (
            order by count.question_number
          ),
          stage.started
        ) - count.answered_journeys
      ) as payload
    from question_counts as count
    cross join stage_counts as stage
  ),
  event_acquisition as materialized (
    select
      private.founder_safe_attribution_label(
        coalesce(event.utm_source, event.traffic_source),
        'direct',
        100
      ) as source,
      private.founder_safe_attribution_label(
        event.utm_medium,
        'none',
        100
      ) as medium,
      private.founder_safe_attribution_label(
        event.utm_campaign,
        'none',
        160
      ) as campaign,
      pg_catalog.count(distinct event.journey_key) filter (
        where event.event_name = 'study_profile_page_viewed'
      ) as visits,
      pg_catalog.count(distinct event.journey_key) filter (
        where event.event_name = 'study_profile_started'
      ) as started,
      pg_catalog.count(distinct event.journey_key) filter (
        where event.event_name = 'study_profile_completed'
      ) as completed
    from window_events as event
    where event.event_name in (
      'study_profile_page_viewed',
      'study_profile_started',
      'study_profile_completed'
    )
    group by 1, 2, 3
  ),
  response_acquisition as materialized (
    select
      private.founder_safe_attribution_label(
        coalesce(response.utm_source, response.traffic_source),
        'direct',
        100
      ) as source,
      private.founder_safe_attribution_label(
        response.utm_medium,
        'none',
        100
      ) as medium,
      private.founder_safe_attribution_label(
        response.utm_campaign,
        'none',
        160
      ) as campaign,
      pg_catalog.count(*) as report_unlocks
    from window_responses as response
    group by 1, 2, 3
  ),
  confirmation_acquisition as materialized (
    select
      private.founder_safe_attribution_label(
        coalesce(confirmation.utm_source, confirmation.traffic_source),
        'direct',
        100
      ) as source,
      private.founder_safe_attribution_label(
        confirmation.utm_medium,
        'none',
        100
      ) as medium,
      private.founder_safe_attribution_label(
        confirmation.utm_campaign,
        'none',
        160
      ) as campaign,
      pg_catalog.count(distinct confirmation.lead_id) as confirmed_waitlist
    from window_confirmations as confirmation
    where confirmation.status = 'confirmed'
      and confirmation.confirmed_at >= window_start
      and confirmation.confirmed_at <= generated_at
    group by 1, 2, 3
  ),
  acquisition_keys as materialized (
    select source, medium, campaign from event_acquisition
    union
    select source, medium, campaign from response_acquisition
    union
    select source, medium, campaign from confirmation_acquisition
  ),
  acquisition_rows as materialized (
    select
      pg_catalog.jsonb_build_object(
        'source', key.source,
        'medium', key.medium,
        'campaign', key.campaign,
        'visits', coalesce(event.visits, 0),
        'started', coalesce(event.started, 0),
        'completed', coalesce(event.completed, 0),
        'reportUnlocks', coalesce(response.report_unlocks, 0),
        'confirmedWaitlist', coalesce(confirmation.confirmed_waitlist, 0)
      ) as payload,
      coalesce(event.visits, 0) as visit_count,
      coalesce(response.report_unlocks, 0) as unlock_count,
      coalesce(confirmation.confirmed_waitlist, 0) as waitlist_count,
      key.source,
      key.medium,
      key.campaign
    from acquisition_keys as key
    left join event_acquisition as event using (source, medium, campaign)
    left join response_acquisition as response using (source, medium, campaign)
    left join confirmation_acquisition as confirmation
      using (source, medium, campaign)
    order by
      coalesce(event.visits, 0) desc,
      coalesce(response.report_unlocks, 0) desc,
      coalesce(confirmation.confirmed_waitlist, 0) desc,
      key.source,
      key.medium,
      key.campaign
    limit 50
  ),
  audience_denominator as materialized (
    select pg_catalog.count(*) as total
    from latest_window_responses
  ),
  pattern_counts as materialized (
    select response.primary_pattern as key, pg_catalog.count(*) as count
    from latest_window_responses as response
    group by response.primary_pattern
  ),
  school_level_counts as materialized (
    select response.school_level as key, pg_catalog.count(*) as count
    from latest_window_responses as response
    group by response.school_level
  ),
  energy_window_counts as materialized (
    select response.energy_window as key, pg_catalog.count(*) as count
    from latest_window_responses as response
    group by response.energy_window
  ),
  pattern_rows as materialized (
    select
      count.key,
      count.count,
      pg_catalog.jsonb_build_object(
        'key', count.key,
        'count', count.count,
        'percent', case
          when denominator.total = 0 then 0
          else pg_catalog.round(
            100.0 * count.count / denominator.total,
            1
          )
        end
      ) as payload
    from pattern_counts as count
    cross join audience_denominator as denominator
  ),
  school_level_rows as materialized (
    select
      count.key,
      count.count,
      pg_catalog.jsonb_build_object(
        'key', count.key,
        'count', count.count,
        'percent', case
          when denominator.total = 0 then 0
          else pg_catalog.round(
            100.0 * count.count / denominator.total,
            1
          )
        end
      ) as payload
    from school_level_counts as count
    cross join audience_denominator as denominator
  ),
  energy_window_rows as materialized (
    select
      count.key,
      count.count,
      pg_catalog.jsonb_build_object(
        'key', count.key,
        'count', count.count,
        'percent', case
          when denominator.total = 0 then 0
          else pg_catalog.round(
            100.0 * count.count / denominator.total,
            1
          )
        end
      ) as payload
    from energy_window_counts as count
    cross join audience_denominator as denominator
  ),
  daily_page_views as materialized (
    select
      (event.occurred_at at time zone 'UTC')::date as day,
      pg_catalog.count(*) as page_views,
      pg_catalog.count(distinct event.journey_key) as tracked_visits
    from window_events as event
    where event.event_name = 'study_profile_page_viewed'
    group by (event.occurred_at at time zone 'UTC')::date
  ),
  daily_started as materialized (
    select
      (event.occurred_at at time zone 'UTC')::date as day,
      pg_catalog.count(distinct event.journey_key) as started
    from window_events as event
    where event.event_name = 'study_profile_started'
    group by (event.occurred_at at time zone 'UTC')::date
  ),
  daily_completed as materialized (
    select
      (event.occurred_at at time zone 'UTC')::date as day,
      pg_catalog.count(distinct event.journey_key) as completed
    from window_events as event
    where event.event_name = 'study_profile_completed'
    group by (event.occurred_at at time zone 'UTC')::date
  ),
  daily_report_unlocks as materialized (
    select
      (response.created_at at time zone 'UTC')::date as day,
      pg_catalog.count(*) as report_unlocks
    from window_responses as response
    group by (response.created_at at time zone 'UTC')::date
  ),
  daily_confirmed_waitlist as materialized (
    select
      (confirmation.confirmed_at at time zone 'UTC')::date as day,
      pg_catalog.count(distinct confirmation.lead_id) as confirmed_waitlist
    from window_confirmations as confirmation
    where confirmation.status = 'confirmed'
      and confirmation.confirmed_at >= window_start
      and confirmation.confirmed_at <= generated_at
    group by (confirmation.confirmed_at at time zone 'UTC')::date
  ),
  daily_rows as materialized (
    select
      day.day,
      pg_catalog.jsonb_build_object(
        'date', pg_catalog.to_char(day.day, 'YYYY-MM-DD'),
        'pageViews', coalesce(views.page_views, 0),
        'trackedVisits', coalesce(views.tracked_visits, 0),
        'started', coalesce(starts.started, 0),
        'completed', coalesce(completions.completed, 0),
        'reportUnlocks', coalesce(unlocks.report_unlocks, 0),
        'confirmedWaitlist', coalesce(waitlist.confirmed_waitlist, 0)
      ) as payload
    from date_spine as day
    left join daily_page_views as views using (day)
    left join daily_started as starts using (day)
    left join daily_completed as completions using (day)
    left join daily_report_unlocks as unlocks using (day)
    left join daily_confirmed_waitlist as waitlist using (day)
  ),
  device_categories(device, sort_order) as (
    values
      ('mobile'::text, 1),
      ('tablet'::text, 2),
      ('desktop'::text, 3),
      ('unknown'::text, 4)
  ),
  study_device_counts as materialized (
    select
      event.device_type as device,
      pg_catalog.count(distinct event.journey_key) as count
    from window_events as event
    where event.event_name = 'study_profile_page_viewed'
    group by event.device_type
  ),
  device_rows as materialized (
    select
      category.sort_order,
      pg_catalog.jsonb_build_object(
        'device', category.device,
        'count', coalesce(device.count, 0)
      ) as payload
    from device_categories as category
    left join study_device_counts as device using (device)
  ),
  delivery_counts as materialized (
    select
      pg_catalog.count(*) filter (
        where response.email_delivery_status = 'sent'
      ) as report_sent,
      pg_catalog.count(*) filter (
        where response.email_delivery_status = 'failed'
      ) as report_failed,
      pg_catalog.count(*) filter (
        where response.email_delivery_status = 'pending'
      ) as report_pending,
      pg_catalog.count(*) filter (
        where response.email_delivery_status = 'skipped'
      ) as report_skipped
    from window_responses as response
  ),
  confirmation_delivery_counts as materialized (
    select
      pg_catalog.count(*) filter (
        where confirmation.requested_at >= window_start
          and confirmation.requested_at <= generated_at
          and confirmation.delivery_status = 'sent'
      ) as confirmation_sent,
      pg_catalog.count(*) filter (
        where confirmation.requested_at >= window_start
          and confirmation.requested_at <= generated_at
          and confirmation.delivery_status = 'failed'
      ) as confirmation_failed,
      pg_catalog.count(*) filter (
        where confirmation.requested_at >= window_start
          and confirmation.requested_at <= generated_at
          and confirmation.delivery_status = 'pending'
      ) as confirmation_pending
    from window_confirmations as confirmation
  )
  select pg_catalog.jsonb_build_object(
    'windowDays', resolved_window_days,
    'generatedAt', generated_at,
    'summary', pg_catalog.jsonb_build_object(
      'pageViews', stage.page_views,
      'trackedVisits', stage.tracked_visits,
      'started', stage.started,
      'completed', stage.completed,
      'reportUnlocks', response.report_unlocks,
      'uniqueReportLeads', response.unique_report_leads,
      'reportViews', stage.report_views,
      'waitlistRequests', confirmation.waitlist_requests,
      'confirmedWaitlist', confirmation.confirmed_waitlist,
      'reportWaitlist', confirmation.report_waitlist,
      'shareTaps', stage.share_taps,
      'lifetimeWaitlist', lifetime.lifetime_waitlist,
      'pendingConfirmations', lifetime.pending_confirmations
    ),
    'rates', pg_catalog.jsonb_build_object(
      'visitToStart', case
        when stage.tracked_visits = 0 then 0
        else pg_catalog.round(100.0 * stage.started / stage.tracked_visits, 1)
      end,
      'startToComplete', case
        when stage.started = 0 then 0
        else pg_catalog.round(100.0 * stage.completed / stage.started, 1)
      end,
      'completeToUnlock', case
        when stage.completed = 0 then 0
        else pg_catalog.round(100.0 * response.report_unlocks / stage.completed, 1)
      end,
      'unlockToReportView', case
        when response.report_unlocks = 0 then 0
        else pg_catalog.round(100.0 * stage.report_views / response.report_unlocks, 1)
      end,
      'unlockToWaitlist', case
        when response.unique_report_leads = 0 then 0
        else pg_catalog.round(
          100.0
            * confirmation.report_waitlist
            / response.unique_report_leads,
          1
        )
      end,
      'visitToWaitlist', case
        when stage.tracked_visits = 0 then 0
        else pg_catalog.round(
          100.0 * confirmation.confirmed_waitlist / stage.tracked_visits,
          1
        )
      end
    ),
    'daily', coalesce((
      select pg_catalog.jsonb_agg(row.payload order by row.day)
      from daily_rows as row
    ), '[]'::jsonb),
    'questionReach', coalesce((
      select pg_catalog.jsonb_agg(
        row.payload order by row.question_number
      )
      from question_rows as row
    ), '[]'::jsonb),
    'acquisition', coalesce((
      select pg_catalog.jsonb_agg(
        row.payload order by
          row.visit_count desc,
          row.unlock_count desc,
          row.waitlist_count desc,
          row.source,
          row.medium,
          row.campaign
      )
      from acquisition_rows as row
    ), '[]'::jsonb),
    'audience', pg_catalog.jsonb_build_object(
      'patterns', coalesce((
        select pg_catalog.jsonb_agg(
          row.payload order by row.count desc, row.key
        )
        from pattern_rows as row
      ), '[]'::jsonb),
      'schoolLevels', coalesce((
        select pg_catalog.jsonb_agg(
          row.payload order by row.count desc, row.key
        )
        from school_level_rows as row
      ), '[]'::jsonb),
      'energyWindows', coalesce((
        select pg_catalog.jsonb_agg(
          row.payload order by row.count desc, row.key
        )
        from energy_window_rows as row
      ), '[]'::jsonb)
    ),
    'delivery', pg_catalog.jsonb_build_object(
      'reportSent', delivery.report_sent,
      'reportFailed', delivery.report_failed,
      'reportPending', delivery.report_pending,
      'reportSkipped', delivery.report_skipped,
      'confirmationSent', confirmation_delivery.confirmation_sent,
      'confirmationFailed', confirmation_delivery.confirmation_failed,
      'confirmationPending', confirmation_delivery.confirmation_pending
    ),
    'deviceBreakdown', coalesce((
      select pg_catalog.jsonb_agg(row.payload order by row.sort_order)
      from device_rows as row
    ), '[]'::jsonb)
  )
  into result
  from stage_counts as stage
  cross join response_counts as response
  cross join confirmation_counts as confirmation
  cross join lifetime_counts as lifetime
  cross join delivery_counts as delivery
  cross join confirmation_delivery_counts as confirmation_delivery;

  return result;
end;
$$;

revoke all on function public.founder_study_profile_analytics(integer)
from public, anon;

grant execute on function public.founder_study_profile_analytics(integer)
to authenticated;
