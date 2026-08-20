-- Let authenticated learners inspect the same durable AI windows used by
-- claim_ai_request without consuming a request. This powers preflight UI only;
-- the mutating claim remains authoritative when generation actually begins.

create or replace function public.read_ai_usage_status(
  request_action text,
  minute_limit integer,
  day_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $status$
declare
  current_user_id uuid := auth.uid();
  request_timestamp timestamptz := now();
  minute_start timestamptz := date_trunc('minute', request_timestamp);
  day_start timestamptz := date_trunc('day', request_timestamp);
  minute_count integer := 0;
  day_count integer := 0;
  retry_after integer := 0;
  reset_at timestamptz := null;
  limited_by text := null;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if request_action not in (
    'plan_generation',
    'session_generation',
    'lesson_generation',
    'answer_evaluation',
    'tutor_message',
    'teaching_visual'
  )
    or minute_limit not between 1 and 100
    or day_limit not between minute_limit and 1000 then
    raise exception 'AI usage limit configuration is not valid.';
  end if;

  select
    coalesce(max(request_count) filter (
      where window_kind = 'minute'
        and window_started_at = minute_start
    ), 0),
    coalesce(max(request_count) filter (
      where window_kind = 'day'
        and window_started_at = day_start
    ), 0)
  into minute_count, day_count
  from public.ai_usage_windows
  where user_id = current_user_id
    and action = request_action
    and (
      (window_kind = 'minute' and window_started_at = minute_start)
      or (window_kind = 'day' and window_started_at = day_start)
    );

  if minute_count >= minute_limit then
    limited_by := 'minute';
    reset_at := minute_start + interval '1 minute';
    retry_after := greatest(
      1,
      ceil(extract(epoch from (reset_at - request_timestamp)))::integer
    );
  end if;

  -- The daily boundary is authoritative when both windows are exhausted.
  if day_count >= day_limit then
    limited_by := 'day';
    reset_at := day_start + interval '1 day';
    retry_after := greatest(
      1,
      ceil(extract(epoch from (reset_at - request_timestamp)))::integer
    );
  end if;

  return jsonb_build_object(
    'allowed', limited_by is null,
    'limitedBy', limited_by,
    'retryAfterSeconds', retry_after,
    'remainingToday', greatest(0, day_limit - day_count),
    'resetAt', reset_at
  );
end;
$status$;

revoke all on function public.read_ai_usage_status(text, integer, integer) from public;
revoke all on function public.read_ai_usage_status(text, integer, integer) from anon;
grant execute on function public.read_ai_usage_status(text, integer, integer) to authenticated;
