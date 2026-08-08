-- Privacy-safe production generation telemetry. Event payloads contain only
-- validator identifiers, timing, token counts, and repair outcomes.

alter table public.product_events
drop constraint if exists product_events_event_name_check;

alter table public.product_events
add constraint product_events_event_name_check check (event_name in (
  'onboarding_started',
  'onboarding_completed',
  'alpha_entered',
  'plan_created',
  'session_started',
  'session_generated',
  'session_completed',
  'session_interrupted',
  'session_repair_adapted',
  'tutor_message_sent',
  'generation_observed'
));

create table public.founder_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.founder_accounts enable row level security;
revoke all on public.founder_accounts from anon, authenticated;

create or replace function public.founder_generation_reliability(window_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  result jsonb;
begin
  if current_user_id is null or not exists (
    select 1 from public.founder_accounts where user_id = current_user_id
  ) then
    raise exception 'Founder access is required.';
  end if;

  with observations as (
    select event_data, occurred_at
    from public.product_events
    where event_name = 'generation_observed'
      and event_data ->> 'environment' = 'production'
      and occurred_at >= now() - make_interval(days => greatest(1, least(window_days, 90)))
  ), repair_events as (
    select * from observations
    where (event_data ->> 'repairAttempted')::boolean is true
  ), failing_validators as (
    select event_data ->> 'failedValidator' as validator, count(*)::integer as failures
    from observations
    where event_data ->> 'failedValidator' is not null
    group by event_data ->> 'failedValidator'
    order by count(*) desc, event_data ->> 'failedValidator'
    limit 3
  )
  select jsonb_build_object(
    'windowDays', greatest(1, least(window_days, 90)),
    'totalGenerations', (select count(*) from observations),
    'planGenerations', (select count(*) from observations where event_data ->> 'generationType' = 'plan'),
    'sessionGenerations', (select count(*) from observations where event_data ->> 'generationType' = 'session'),
    'firstPassRate', coalesce((
      select round(100.0 * count(*) filter (where (event_data ->> 'firstAttemptPassed')::boolean is true) / nullif(count(*) filter (where event_data ->> 'firstAttemptPassed' is not null), 0), 1)
      from observations
    ), 0),
    'postRepairSuccessRate', coalesce((
      select round(100.0 * count(*) filter (where (event_data ->> 'repairSucceeded')::boolean is true) / nullif(count(*), 0), 1)
      from repair_events
    ), 0),
    'p50LatencyMs', coalesce((select percentile_cont(0.50) within group (order by (event_data ->> 'elapsedMs')::numeric) from observations), 0),
    'p95LatencyMs', coalesce((select percentile_cont(0.95) within group (order by (event_data ->> 'elapsedMs')::numeric) from observations), 0),
    'topFailingValidators', coalesce((select jsonb_agg(jsonb_build_object('validator', validator, 'failures', failures)) from failing_validators), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.founder_generation_reliability(integer) from public;
grant execute on function public.founder_generation_reliability(integer) to authenticated;

