alter table public.ai_usage_windows
drop constraint if exists ai_usage_windows_action_check;

alter table public.ai_usage_windows
add constraint ai_usage_windows_action_check
check (action in ('plan_generation', 'session_generation', 'answer_evaluation', 'tutor_message'));

create or replace function public.claim_ai_request(
  request_action text,
  minute_limit integer,
  day_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  request_timestamp timestamptz := now();
  minute_start timestamptz := date_trunc('minute', request_timestamp);
  day_start timestamptz := date_trunc('day', request_timestamp);
  minute_count integer := 0;
  day_count integer := 0;
  retry_after integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if request_action not in ('plan_generation', 'session_generation', 'answer_evaluation', 'tutor_message')
    or minute_limit not between 1 and 100
    or day_limit not between minute_limit and 1000 then
    raise exception 'AI usage limit configuration is not valid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(current_user_id::text || ':' || request_action)
  );

  select coalesce(max(request_count), 0)
  into minute_count
  from public.ai_usage_windows
  where user_id = current_user_id
    and action = request_action
    and window_kind = 'minute'
    and window_started_at = minute_start;

  select coalesce(max(request_count), 0)
  into day_count
  from public.ai_usage_windows
  where user_id = current_user_id
    and action = request_action
    and window_kind = 'day'
    and window_started_at = day_start;

  if minute_count >= minute_limit then
    retry_after := greatest(retry_after, ceil(extract(epoch from (minute_start + interval '1 minute' - request_timestamp)))::integer);
  end if;
  if day_count >= day_limit then
    retry_after := greatest(retry_after, ceil(extract(epoch from (day_start + interval '1 day' - request_timestamp)))::integer);
  end if;

  if retry_after > 0 then
    return jsonb_build_object(
      'allowed', false,
      'retryAfterSeconds', greatest(1, retry_after),
      'remainingToday', greatest(0, day_limit - day_count)
    );
  end if;

  insert into public.ai_usage_windows (
    user_id, action, window_kind, window_started_at, request_count, updated_at
  ) values (
    current_user_id, request_action, 'minute', minute_start, 1, request_timestamp
  )
  on conflict (user_id, action, window_kind, window_started_at)
  do update set
    request_count = public.ai_usage_windows.request_count + 1,
    updated_at = excluded.updated_at;

  insert into public.ai_usage_windows (
    user_id, action, window_kind, window_started_at, request_count, updated_at
  ) values (
    current_user_id, request_action, 'day', day_start, 1, request_timestamp
  )
  on conflict (user_id, action, window_kind, window_started_at)
  do update set
    request_count = public.ai_usage_windows.request_count + 1,
    updated_at = excluded.updated_at;

  delete from public.ai_usage_windows
  where user_id = current_user_id
    and updated_at < request_timestamp - interval '8 days';

  return jsonb_build_object(
    'allowed', true,
    'retryAfterSeconds', 0,
    'remainingToday', greatest(0, day_limit - day_count - 1)
  );
end;
$$;

revoke all on function public.claim_ai_request(text, integer, integer) from public;
grant execute on function public.claim_ai_request(text, integer, integer) to authenticated;
