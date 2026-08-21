-- Make every durable AI charge a bounded reservation with an explicit terminal
-- state. This migration is deliberately database-first compatible: the
-- existing three-argument claim RPC remains available to an older app build,
-- while the new app uses reserve_ai_request with an idempotency key and a
-- short lease.

alter table public.ai_usage_claims
  add column state text,
  add column operation_key uuid,
  add column recovery_key uuid,
  add column lease_expires_at timestamptz,
  add column consumed_at timestamptz;

-- Preserve failure compensation for old-app work that is in flight while this
-- migration lands. Unreleased claims in today's still-active quota window get
-- the same end-of-day legacy lease as new compatibility claims. Older history
-- is terminal and must not become a backlog of expiring reservations.
update public.ai_usage_claims
set state = case
      when released_at is not null then 'released'
      when day_window_started_at = date_trunc('day', now()) then 'reserved'
      else 'consumed'
    end,
    lease_expires_at = case
      when released_at is null
        and day_window_started_at = date_trunc('day', now())
        then day_window_started_at + interval '1 day'
      else null
    end,
    consumed_at = case
      when released_at is null
        and day_window_started_at <> date_trunc('day', now())
        then created_at
      else null
    end;

alter table public.ai_usage_claims
  alter column state set not null,
  add constraint ai_usage_claims_state_check
    check (state in ('reserved', 'consumed', 'released')),
  add constraint ai_usage_claims_strict_key_shape_check
    check (
      (operation_key is null and recovery_key is null)
      or (
        operation_key is not null
        and recovery_key is not null
        and operation_key <> recovery_key
      )
    ),
  add constraint ai_usage_claims_reservation_shape_check
    check (
      (state = 'reserved' and released_at is null and consumed_at is null and lease_expires_at is not null)
      or (state = 'consumed' and released_at is null and consumed_at is not null and lease_expires_at is null)
      or (state = 'released' and released_at is not null and consumed_at is null and lease_expires_at is null)
    );

create unique index ai_usage_claims_operation_key_idx
on public.ai_usage_claims(user_id, action, operation_key)
where operation_key is not null;

-- This helper is callable only from the security-definer RPCs below. Every
-- caller first holds the user/action advisory lock, so the claim transition
-- and both counter decrements are serialized with new reservations.
create or replace function public.release_ai_usage_reservation_locked(
  reservation_id uuid,
  release_timestamp timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $release$
declare
  reservation record;
begin
  select id, user_id, action, minute_window_started_at, day_window_started_at
  into reservation
  from public.ai_usage_claims
  where id = reservation_id
    and state = 'reserved'
  for update;

  if not found then
    return false;
  end if;

  delete from public.ai_usage_windows
  where user_id = reservation.user_id
    and action = reservation.action
    and window_kind = 'minute'
    and window_started_at = reservation.minute_window_started_at
    and request_count = 1;

  update public.ai_usage_windows
  set request_count = request_count - 1,
      updated_at = release_timestamp
  where user_id = reservation.user_id
    and action = reservation.action
    and window_kind = 'minute'
    and window_started_at = reservation.minute_window_started_at
    and request_count > 1;

  delete from public.ai_usage_windows
  where user_id = reservation.user_id
    and action = reservation.action
    and window_kind = 'day'
    and window_started_at = reservation.day_window_started_at
    and request_count = 1;

  update public.ai_usage_windows
  set request_count = request_count - 1,
      updated_at = release_timestamp
  where user_id = reservation.user_id
    and action = reservation.action
    and window_kind = 'day'
    and window_started_at = reservation.day_window_started_at
    and request_count > 1;

  update public.ai_usage_claims
  set state = 'released',
      released_at = release_timestamp,
      consumed_at = null,
      lease_expires_at = null
  where id = reservation.id
    and state = 'reserved';

  return found;
end;
$release$;

create or replace function public.reclaim_expired_ai_usage_reservations(
  reservation_user_id uuid,
  reservation_action text,
  request_timestamp timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $reclaim$
declare
  expired_reservation record;
  reclaimed_count integer := 0;
begin
  for expired_reservation in
    select id
    from public.ai_usage_claims
    where user_id = reservation_user_id
      and action = reservation_action
      and state = 'reserved'
      and lease_expires_at <= request_timestamp
    order by created_at
    for update
  loop
    if public.release_ai_usage_reservation_locked(
      expired_reservation.id,
      request_timestamp
    ) then
      reclaimed_count := reclaimed_count + 1;
    end if;
  end loop;

  return reclaimed_count;
end;
$reclaim$;

-- Strict reservation RPC used by the new application. A committed RPC whose
-- response is lost can be found and released by operation key. Replaying a
-- still-live key reports operation_in_progress without incrementing either
-- counter or permitting a second provider run.
drop function if exists public.reserve_ai_request(text, integer, integer, uuid, integer);
create or replace function public.reserve_ai_request(
  request_action text,
  minute_limit integer,
  day_limit integer,
  request_operation_key uuid,
  request_recovery_key uuid,
  lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $reserve$
declare
  current_user_id uuid := auth.uid();
  request_timestamp timestamptz;
  minute_start timestamptz;
  day_start timestamptz;
  minute_count integer := 0;
  day_count integer := 0;
  retry_after integer := 0;
  usage_claim_id uuid := extensions.gen_random_uuid();
  prior_claim record;
  prior_claim_found boolean := false;
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
    or day_limit not between minute_limit and 1000
    or request_operation_key is null
    or request_recovery_key is null
    or request_operation_key = request_recovery_key
    or lease_seconds not between 30 and 600 then
    raise exception 'AI usage reservation configuration is not valid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(current_user_id::text || ':' || request_action)
  );

  -- Derive quota windows only after lock acquisition. A queued request that
  -- crosses a minute or UTC-day boundary must count against the new window,
  -- and its lease must not be shortened by time spent waiting for the lock.
  request_timestamp := pg_catalog.clock_timestamp();
  minute_start := date_trunc('minute', request_timestamp);
  day_start := date_trunc('day', request_timestamp);

  -- Expired reservations must stop contributing before either the idempotency
  -- decision or quota counts are read.
  perform public.reclaim_expired_ai_usage_reservations(
    current_user_id,
    request_action,
    request_timestamp
  );

  select id, state, lease_expires_at
  into prior_claim
  from public.ai_usage_claims
  where user_id = current_user_id
    and action = request_action
    and operation_key = request_operation_key
  for update;
  prior_claim_found := found;

  select
    coalesce(max(request_count) filter (
      where window_kind = 'minute' and window_started_at = minute_start
    ), 0),
    coalesce(max(request_count) filter (
      where window_kind = 'day' and window_started_at = day_start
    ), 0)
  into minute_count, day_count
  from public.ai_usage_windows
  where user_id = current_user_id
    and action = request_action
    and (
      (window_kind = 'minute' and window_started_at = minute_start)
      or (window_kind = 'day' and window_started_at = day_start)
    );

  if prior_claim_found and prior_claim.state = 'reserved' then
    return jsonb_build_object(
      'allowed', false,
      'claimId', null,
      'operationKey', request_operation_key,
      'denialReason', 'operation_in_progress',
      'retryAfterSeconds', least(
        600,
        greatest(
          1,
          ceil(extract(epoch from (prior_claim.lease_expires_at - request_timestamp)))::integer
        )
      ),
      'remainingToday', greatest(0, day_limit - day_count)
    );
  elsif prior_claim_found then
    return jsonb_build_object(
      'allowed', false,
      'claimId', null,
      'operationKey', request_operation_key,
      'denialReason', 'operation_already_' || prior_claim.state,
      'retryAfterSeconds', 0,
      'remainingToday', greatest(0, day_limit - day_count)
    );
  end if;

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
      'operationKey', request_operation_key,
      'denialReason', 'usage_limit',
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
    created_at,
    state,
    operation_key,
    recovery_key,
    lease_expires_at
  ) values (
    usage_claim_id,
    current_user_id,
    request_action,
    minute_start,
    day_start,
    request_timestamp,
    'reserved',
    request_operation_key,
    request_recovery_key,
    request_timestamp + pg_catalog.make_interval(secs => lease_seconds)
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
    'operationKey', request_operation_key,
    'reservationState', 'reserved',
    'replayed', false,
    'retryAfterSeconds', 0,
    'remainingToday', greatest(0, day_limit - day_count - 1)
  );
end;
$reserve$;

-- A successful new-app operation consumes only its exact live reservation.
create or replace function public.consume_ai_request_claim(
  usage_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $consume$
declare
  current_user_id uuid := auth.uid();
  claimed_action text;
  claim_state text;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  select action
  into claimed_action
  from public.ai_usage_claims
  where id = usage_claim_id
    and user_id = current_user_id;

  if not found then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(current_user_id::text || ':' || claimed_action)
  );

  select state
  into claim_state
  from public.ai_usage_claims
  where id = usage_claim_id
    and user_id = current_user_id
  for update;

  if not found or claim_state = 'released' then
    return false;
  end if;
  if claim_state = 'consumed' then
    return true;
  end if;

  update public.ai_usage_claims
  set state = 'consumed',
      consumed_at = now(),
      released_at = null,
      lease_expires_at = null
  where id = usage_claim_id
    and user_id = current_user_id
    and state = 'reserved';

  return found;
end;
$consume$;

-- Exact failure compensation remains the compatibility API for old and new
-- app builds. Lock order is advisory-lock then row-lock, matching reclaim and
-- settlement so concurrent terminal transitions cannot deadlock or double
-- decrement a window.
create or replace function public.release_ai_request_claim(
  usage_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $release_claim$
declare
  current_user_id uuid := auth.uid();
  claimed_action text;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  select action
  into claimed_action
  from public.ai_usage_claims
  where id = usage_claim_id
    and user_id = current_user_id;

  if not found then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(current_user_id::text || ':' || claimed_action)
  );

  return public.release_ai_usage_reservation_locked(usage_claim_id, now());
end;
$release_claim$;

-- Recovery path for the ambiguous case where reserve_ai_request committed but
-- its response never reached the route. The public operation key plus the
-- server-private recovery key identify the caller's reservation; both must
-- match, so a browser-visible operation id cannot refund live provider work.
drop function if exists public.release_ai_request_reservation(text, uuid);
create or replace function public.release_ai_request_reservation(
  request_action text,
  request_operation_key uuid,
  request_recovery_key uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $release_operation$
declare
  current_user_id uuid := auth.uid();
  usage_claim_id uuid;
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
    or request_operation_key is null
    or request_recovery_key is null
    or request_operation_key = request_recovery_key then
    raise exception 'AI usage reservation recovery is not valid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(current_user_id::text || ':' || request_action)
  );

  select id
  into usage_claim_id
  from public.ai_usage_claims
  where user_id = current_user_id
    and action = request_action
    and operation_key = request_operation_key
    and recovery_key = request_recovery_key
  for update;

  if not found then
    return false;
  end if;

  return public.release_ai_usage_reservation_locked(usage_claim_id, now());
end;
$release_operation$;

-- Keep the old three-argument RPC operational during the database-first
-- window. Older clients cannot settle success, so their lease lasts through
-- the active daily quota window. They can still release an exact failed claim.
create or replace function public.claim_ai_request(
  request_action text,
  minute_limit integer,
  day_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $legacy_claim$
declare
  current_user_id uuid := auth.uid();
  request_timestamp timestamptz;
  minute_start timestamptz;
  day_start timestamptz;
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
  request_timestamp := pg_catalog.clock_timestamp();
  minute_start := date_trunc('minute', request_timestamp);
  day_start := date_trunc('day', request_timestamp);
  perform public.reclaim_expired_ai_usage_reservations(
    current_user_id,
    request_action,
    request_timestamp
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
    created_at,
    state,
    operation_key,
    recovery_key,
    lease_expires_at
  ) values (
    usage_claim_id,
    current_user_id,
    request_action,
    minute_start,
    day_start,
    request_timestamp,
    'reserved',
    null,
    null,
    day_start + interval '1 day'
  );

  return jsonb_build_object(
    'allowed', true,
    'claimId', usage_claim_id,
    'retryAfterSeconds', 0,
    'remainingToday', greatest(0, day_limit - day_count - 1)
  );
end;
$legacy_claim$;

-- Status reads now reclaim dead new-app leases before counting. This function
-- is intentionally no longer STABLE because that cleanup is part of making
-- the displayed balance match the authoritative claim path.
create or replace function public.read_ai_usage_status(
  request_action text,
  minute_limit integer,
  day_limit integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $status$
declare
  current_user_id uuid := auth.uid();
  request_timestamp timestamptz;
  minute_start timestamptz;
  day_start timestamptz;
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(current_user_id::text || ':' || request_action)
  );
  request_timestamp := pg_catalog.clock_timestamp();
  minute_start := date_trunc('minute', request_timestamp);
  day_start := date_trunc('day', request_timestamp);
  perform public.reclaim_expired_ai_usage_reservations(
    current_user_id,
    request_action,
    request_timestamp
  );

  select
    coalesce(max(request_count) filter (
      where window_kind = 'minute' and window_started_at = minute_start
    ), 0),
    coalesce(max(request_count) filter (
      where window_kind = 'day' and window_started_at = day_start
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

revoke all on function public.release_ai_usage_reservation_locked(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.reclaim_expired_ai_usage_reservations(uuid, text, timestamptz) from public, anon, authenticated;

revoke all on function public.reserve_ai_request(text, integer, integer, uuid, uuid, integer) from public, anon;
grant execute on function public.reserve_ai_request(text, integer, integer, uuid, uuid, integer) to authenticated;
revoke all on function public.consume_ai_request_claim(uuid) from public, anon;
grant execute on function public.consume_ai_request_claim(uuid) to authenticated;
revoke all on function public.release_ai_request_reservation(text, uuid, uuid) from public, anon;
grant execute on function public.release_ai_request_reservation(text, uuid, uuid) to authenticated;

revoke all on function public.claim_ai_request(text, integer, integer) from public, anon;
grant execute on function public.claim_ai_request(text, integer, integer) to authenticated;
revoke all on function public.release_ai_request_claim(uuid) from public, anon;
grant execute on function public.release_ai_request_claim(uuid) to authenticated;
revoke all on function public.read_ai_usage_status(text, integer, integer) from public, anon;
grant execute on function public.read_ai_usage_status(text, integer, integer) to authenticated;
