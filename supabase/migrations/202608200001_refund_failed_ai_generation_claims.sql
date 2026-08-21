-- Reserve durable AI allowance before contacting a provider, then allow the
-- server to return that exact reservation when no usable learner result was
-- produced. Aggregate windows remain the authoritative limiter; this private
-- claim ledger makes compensation idempotent under retries.

create table public.ai_usage_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in (
    'plan_generation',
    'session_generation',
    'lesson_generation',
    'answer_evaluation',
    'tutor_message',
    'teaching_visual'
  )),
  minute_window_started_at timestamptz not null,
  day_window_started_at timestamptz not null,
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create index ai_usage_claims_user_action_created_idx
on public.ai_usage_claims(user_id, action, created_at desc);

alter table public.ai_usage_claims enable row level security;

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
  usage_claim_id uuid := extensions.gen_random_uuid();
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
    retry_after := greatest(
      retry_after,
      ceil(extract(epoch from (minute_start + interval '1 minute' - request_timestamp)))::integer
    );
  end if;
  if day_count >= day_limit then
    retry_after := greatest(
      retry_after,
      ceil(extract(epoch from (day_start + interval '1 day' - request_timestamp)))::integer
    );
  end if;

  if retry_after > 0 then
    return jsonb_build_object(
      'allowed', false,
      'claimId', null,
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

  insert into public.ai_usage_claims (
    id,
    user_id,
    action,
    minute_window_started_at,
    day_window_started_at,
    created_at
  ) values (
    usage_claim_id,
    current_user_id,
    request_action,
    minute_start,
    day_start,
    request_timestamp
  );

  delete from public.ai_usage_windows
  where user_id = current_user_id
    and updated_at < request_timestamp - interval '8 days';

  delete from public.ai_usage_claims
  where user_id = current_user_id
    and created_at < request_timestamp - interval '8 days';

  return jsonb_build_object(
    'allowed', true,
    'claimId', usage_claim_id,
    'retryAfterSeconds', 0,
    'remainingToday', greatest(0, day_limit - day_count - 1)
  );
end;
$$;

create or replace function public.release_ai_request_claim(
  usage_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  claimed_action text;
  claimed_minute_start timestamptz;
  claimed_day_start timestamptz;
  prior_release timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  select action, minute_window_started_at, day_window_started_at, released_at
  into claimed_action, claimed_minute_start, claimed_day_start, prior_release
  from public.ai_usage_claims
  where id = usage_claim_id
    and user_id = current_user_id
  for update;

  if not found or prior_release is not null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(current_user_id::text || ':' || claimed_action)
  );

  delete from public.ai_usage_windows
  where user_id = current_user_id
    and action = claimed_action
    and window_kind = 'minute'
    and window_started_at = claimed_minute_start
    and request_count = 1;

  update public.ai_usage_windows
  set request_count = request_count - 1,
      updated_at = now()
  where user_id = current_user_id
    and action = claimed_action
    and window_kind = 'minute'
    and window_started_at = claimed_minute_start
    and request_count > 1;

  delete from public.ai_usage_windows
  where user_id = current_user_id
    and action = claimed_action
    and window_kind = 'day'
    and window_started_at = claimed_day_start
    and request_count = 1;

  update public.ai_usage_windows
  set request_count = request_count - 1,
      updated_at = now()
  where user_id = current_user_id
    and action = claimed_action
    and window_kind = 'day'
    and window_started_at = claimed_day_start
    and request_count > 1;

  update public.ai_usage_claims
  set released_at = now()
  where id = usage_claim_id
    and user_id = current_user_id;

  return true;
end;
$$;

revoke all on table public.ai_usage_claims from public, anon, authenticated;
revoke all on function public.claim_ai_request(text, integer, integer) from public, anon;
grant execute on function public.claim_ai_request(text, integer, integer) to authenticated;
revoke all on function public.release_ai_request_claim(uuid) from public, anon;
grant execute on function public.release_ai_request_claim(uuid) to authenticated;
