-- Put every provider-backed public route behind immutable, database-owned
-- limits. The application uses the service-only *_for_user RPCs after proving
-- the request's user with Supabase Auth. Authenticated compatibility RPCs stay
-- available for a database-first rolling deploy, but cannot choose their own
-- limits or refund a charge.

alter table public.ai_usage_windows
drop constraint if exists ai_usage_windows_action_check;

alter table public.ai_usage_windows
add constraint ai_usage_windows_action_check
check (action in (
  'plan_generation',
  'plan_adjustment',
  'intake_interpretation',
  'material_processing',
  'session_generation',
  'lesson_generation',
  'answer_evaluation',
  'tutor_message',
  'teaching_visual'
));

alter table public.ai_usage_claims
drop constraint if exists ai_usage_claims_action_check;

alter table public.ai_usage_claims
add constraint ai_usage_claims_action_check
check (action in (
  'plan_generation',
  'plan_adjustment',
  'intake_interpretation',
  'material_processing',
  'session_generation',
  'lesson_generation',
  'answer_evaluation',
  'tutor_message',
  'teaching_visual'
));

-- These are hard ceilings, not client input. request_public_accounts selects
-- the deployment's public-launch tier; only a service-role RPC can request the
-- larger invite-only tester tier.
create or replace function public.ai_usage_limits_v1(
  request_action text,
  request_public_accounts boolean
)
returns table(minute_limit integer, day_limit integer)
language plpgsql
immutable
security definer
set search_path = ''
as $limits$
begin
  if request_public_accounts is null then
    raise exception 'AI usage account mode is required.';
  end if;

  minute_limit := case request_action
      when 'plan_generation' then case when request_public_accounts then 3 else 5 end
      when 'plan_adjustment' then case when request_public_accounts then 3 else 5 end
      when 'intake_interpretation' then case when request_public_accounts then 6 else 10 end
      when 'material_processing' then case when request_public_accounts then 1 else 2 end
      when 'session_generation' then case when request_public_accounts then 5 else 8 end
      when 'lesson_generation' then case when request_public_accounts then 8 else 12 end
      when 'answer_evaluation' then case when request_public_accounts then 12 else 20 end
      when 'tutor_message' then case when request_public_accounts then 10 else 15 end
      when 'teaching_visual' then case when request_public_accounts then 1 else 2 end
      else null
    end;
  day_limit := case request_action
      when 'plan_generation' then case when request_public_accounts then 5 else 20 end
      when 'plan_adjustment' then case when request_public_accounts then 8 else 20 end
      when 'intake_interpretation' then case when request_public_accounts then 30 else 80 end
      when 'material_processing' then case when request_public_accounts then 3 else 10 end
      when 'session_generation' then case when request_public_accounts then 10 else 40 end
      when 'lesson_generation' then case when request_public_accounts then 20 else 80 end
      when 'answer_evaluation' then case when request_public_accounts then 40 else 120 end
      when 'tutor_message' then case when request_public_accounts then 30 else 80 end
      when 'teaching_visual' then case when request_public_accounts then 3 else 12 end
      else null
    end;

  if minute_limit is null or day_limit is null then
    raise exception 'AI usage action is not valid.';
  end if;

  return next;
end;
$limits$;

-- A true release is permitted only for a known pre-provider failure and only
-- before the fixed lease expires. It refunds both counters and deletes the
-- reservation so failures cannot leave unbounded released tombstones. Once a
-- lease has expired, it is consumed: the provider may already have charged us.
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
  select
    id,
    user_id,
    action,
    minute_window_started_at,
    day_window_started_at,
    lease_expires_at
  into reservation
  from public.ai_usage_claims
  where id = reservation_id
    and state = 'reserved'
  for update;

  if not found then
    return false;
  end if;

  if reservation.lease_expires_at <= release_timestamp then
    update public.ai_usage_claims
    set state = 'consumed',
        consumed_at = release_timestamp,
        released_at = null,
        lease_expires_at = null
    where id = reservation.id
      and state = 'reserved';
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

  delete from public.ai_usage_claims
  where id = reservation.id
    and state = 'reserved';

  return found;
end;
$release$;

-- An abandoned/expired reservation is never a refund signal. Consuming it
-- preserves the immutable daily ceiling even if a provider response or app
-- process disappeared after the paid invocation started.
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
  consumed_count integer := 0;
begin
  update public.ai_usage_claims
  set state = 'consumed',
      consumed_at = request_timestamp,
      released_at = null,
      lease_expires_at = null
  where user_id = reservation_user_id
    and action = reservation_action
    and state = 'reserved'
    and lease_expires_at <= request_timestamp;

  get diagnostics consumed_count = row_count;
  return consumed_count;
end;
$reclaim$;

-- Owner-internal reservation implementation. Both public-launch and tester
-- limits come exclusively from ai_usage_limits_v1, and every lease is fixed at
-- 180 seconds. The operation lookup is performed before either quota counter
-- increments, providing cross-instance single-flight behavior.
create or replace function public.reserve_ai_request_for_user_internal_v1(
  target_user_id uuid,
  request_action text,
  request_operation_key uuid,
  request_recovery_key uuid,
  request_public_accounts boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $reserve_internal$
declare
  effective_minute_limit integer;
  effective_day_limit integer;
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
  if target_user_id is null
    or request_operation_key is null
    or request_recovery_key is null
    or request_operation_key = request_recovery_key then
    raise exception 'AI usage reservation configuration is not valid.';
  end if;

  select limits.minute_limit, limits.day_limit
  into effective_minute_limit, effective_day_limit
  from public.ai_usage_limits_v1(
    request_action,
    request_public_accounts
  ) as limits;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(target_user_id::text || ':' || request_action)
  );

  request_timestamp := pg_catalog.clock_timestamp();
  minute_start := date_trunc('minute', request_timestamp);
  day_start := date_trunc('day', request_timestamp);

  perform public.reclaim_expired_ai_usage_reservations(
    target_user_id,
    request_action,
    request_timestamp
  );

  select id, state, lease_expires_at
  into prior_claim
  from public.ai_usage_claims
  where user_id = target_user_id
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
  where user_id = target_user_id
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
        180,
        greatest(
          1,
          ceil(extract(epoch from (prior_claim.lease_expires_at - request_timestamp)))::integer
        )
      ),
      'remainingToday', greatest(0, effective_day_limit - day_count)
    );
  elsif prior_claim_found then
    return jsonb_build_object(
      'allowed', false,
      'claimId', null,
      'operationKey', request_operation_key,
      'denialReason', 'operation_already_' || prior_claim.state,
      'retryAfterSeconds', 0,
      'remainingToday', greatest(0, effective_day_limit - day_count)
    );
  end if;

  if minute_count >= effective_minute_limit then
    retry_after := greatest(
      retry_after,
      ceil(extract(epoch from (minute_start + interval '1 minute' - request_timestamp)))::integer
    );
  end if;
  if day_count >= effective_day_limit then
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
      'remainingToday', greatest(0, effective_day_limit - day_count)
    );
  end if;

  insert into public.ai_usage_windows (
    user_id, action, window_kind, window_started_at, request_count, updated_at
  ) values (
    target_user_id, request_action, 'minute', minute_start, 1, request_timestamp
  )
  on conflict (user_id, action, window_kind, window_started_at)
  do update set
    request_count = public.ai_usage_windows.request_count + 1,
    updated_at = excluded.updated_at;

  insert into public.ai_usage_windows (
    user_id, action, window_kind, window_started_at, request_count, updated_at
  ) values (
    target_user_id, request_action, 'day', day_start, 1, request_timestamp
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
    target_user_id,
    request_action,
    minute_start,
    day_start,
    request_timestamp,
    'reserved',
    request_operation_key,
    request_recovery_key,
    request_timestamp + interval '180 seconds'
  );

  delete from public.ai_usage_windows
  where user_id = target_user_id
    and updated_at < request_timestamp - interval '8 days';

  delete from public.ai_usage_claims
  where user_id = target_user_id
    and state <> 'reserved'
    and created_at < request_timestamp - interval '8 days';

  return jsonb_build_object(
    'allowed', true,
    'claimId', usage_claim_id,
    'operationKey', request_operation_key,
    'reservationState', 'reserved',
    'replayed', false,
    'retryAfterSeconds', 0,
    'remainingToday', greatest(0, effective_day_limit - day_count - 1)
  );
end;
$reserve_internal$;

-- The application-only entry point. target_user_id is accepted only from the
-- service role; the route derives it from an authenticated getUser() result.
create or replace function public.reserve_ai_request_for_user(
  target_user_id uuid,
  request_action text,
  request_operation_key uuid,
  request_recovery_key uuid,
  request_public_accounts boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $reserve_for_user$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'ai_usage_service_role_required';
  end if;

  return public.reserve_ai_request_for_user_internal_v1(
    target_user_id,
    request_action,
    request_operation_key,
    request_recovery_key,
    request_public_accounts
  );
end;
$reserve_for_user$;

-- Rolling-deploy compatibility: retain the old signature, but ignore all
-- caller-selected limits and lease values. Direct authenticated callers get
-- the smaller immutable public tier and cannot mint a 1000/day allowance.
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
as $reserve_compat$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  return public.reserve_ai_request_for_user_internal_v1(
    current_user_id,
    request_action,
    request_operation_key,
    request_recovery_key,
    true
  );
end;
$reserve_compat$;

create or replace function public.consume_ai_request_claim_for_user_internal_v1(
  target_user_id uuid,
  usage_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $consume_internal$
declare
  claimed_action text;
  claim_state text;
begin
  if target_user_id is null or usage_claim_id is null then
    return false;
  end if;

  select action
  into claimed_action
  from public.ai_usage_claims
  where id = usage_claim_id
    and user_id = target_user_id;

  if not found then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(target_user_id::text || ':' || claimed_action)
  );

  select state
  into claim_state
  from public.ai_usage_claims
  where id = usage_claim_id
    and user_id = target_user_id
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
    and user_id = target_user_id
    and state = 'reserved';

  return found;
end;
$consume_internal$;

create or replace function public.consume_ai_request_claim_for_user(
  target_user_id uuid,
  usage_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $consume_for_user$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'ai_usage_service_role_required';
  end if;

  return public.consume_ai_request_claim_for_user_internal_v1(
    target_user_id,
    usage_claim_id
  );
end;
$consume_for_user$;

-- A compatibility success settlement is safe because it cannot decrement
-- counters and is still scoped to auth.uid().
create or replace function public.consume_ai_request_claim(
  usage_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $consume_compat$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  return public.consume_ai_request_claim_for_user_internal_v1(
    current_user_id,
    usage_claim_id
  );
end;
$consume_compat$;

-- Only the trusted server may refund a known-live, exact reservation. The
-- locked helper consumes instead if the lease has already expired.
create or replace function public.release_ai_request_claim_for_user(
  target_user_id uuid,
  usage_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $release_claim_for_user$
declare
  claimed_action text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'ai_usage_service_role_required';
  end if;

  select action
  into claimed_action
  from public.ai_usage_claims
  where id = usage_claim_id
    and user_id = target_user_id;

  if not found then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(target_user_id::text || ':' || claimed_action)
  );

  return public.release_ai_usage_reservation_locked(usage_claim_id, now());
end;
$release_claim_for_user$;

create or replace function public.release_ai_request_reservation_for_user(
  target_user_id uuid,
  request_action text,
  request_operation_key uuid,
  request_recovery_key uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $release_operation_for_user$
declare
  usage_claim_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'ai_usage_service_role_required';
  end if;

  if target_user_id is null
    or request_operation_key is null
    or request_recovery_key is null
    or request_operation_key = request_recovery_key then
    raise exception 'AI usage reservation recovery is not valid.';
  end if;

  perform 1
  from public.ai_usage_limits_v1(request_action, true);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(target_user_id::text || ':' || request_action)
  );

  select id
  into usage_claim_id
  from public.ai_usage_claims
  where user_id = target_user_id
    and action = request_action
    and operation_key = request_operation_key
    and recovery_key = request_recovery_key
  for update;

  if not found then
    return false;
  end if;

  return public.release_ai_usage_reservation_locked(usage_claim_id, now());
end;
$release_operation_for_user$;

-- The authenticated compatibility release names are intentionally
-- consume-only. An untrusted caller can settle its own reservation but cannot
-- run a reserve/refund loop to create unlimited ledger churn or paid retries.
create or replace function public.release_ai_request_claim(
  usage_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $release_claim_compat$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  return public.consume_ai_request_claim_for_user_internal_v1(
    current_user_id,
    usage_claim_id
  );
end;
$release_claim_compat$;

create or replace function public.release_ai_request_reservation(
  request_action text,
  request_operation_key uuid,
  request_recovery_key uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $release_operation_compat$
declare
  current_user_id uuid := auth.uid();
  usage_claim_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if request_operation_key is null
    or request_recovery_key is null
    or request_operation_key = request_recovery_key then
    raise exception 'AI usage reservation recovery is not valid.';
  end if;

  perform 1
  from public.ai_usage_limits_v1(request_action, true);

  select id
  into usage_claim_id
  from public.ai_usage_claims
  where user_id = current_user_id
    and action = request_action
    and operation_key = request_operation_key
    and recovery_key = request_recovery_key;

  if not found then
    return false;
  end if;

  return public.consume_ai_request_claim_for_user_internal_v1(
    current_user_id,
    usage_claim_id
  );
end;
$release_operation_compat$;

-- This non-idempotent legacy path has no production callers. Keep the
-- signature so a stale schema cache is harmless, but make it unusable even by
-- a mistakenly privileged caller and revoke every API role below.
create or replace function public.claim_ai_request(
  request_action text,
  minute_limit integer,
  day_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $legacy_claim_disabled$
begin
  raise exception using
    errcode = '0A000',
    message = 'legacy_ai_claim_disabled';
  return null;
end;
$legacy_claim_disabled$;

-- Allowance status remains an authenticated legacy surface for the existing
-- session UI. It deliberately rejects the three new strict-only actions and
-- clamps all caller-supplied values to immutable public-account ceilings.
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
  hard_minute_limit integer;
  hard_day_limit integer;
  effective_minute_limit integer;
  effective_day_limit integer;
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
    raise exception 'AI usage status configuration is not valid.';
  end if;

  select limits.minute_limit, limits.day_limit
  into hard_minute_limit, hard_day_limit
  from public.ai_usage_limits_v1(request_action, true) as limits;
  effective_minute_limit := least(minute_limit, hard_minute_limit);
  effective_day_limit := least(day_limit, hard_day_limit);

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

  if minute_count >= effective_minute_limit then
    limited_by := 'minute';
    reset_at := minute_start + interval '1 minute';
    retry_after := greatest(
      1,
      ceil(extract(epoch from (reset_at - request_timestamp)))::integer
    );
  end if;
  if day_count >= effective_day_limit then
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
    'remainingToday', greatest(0, effective_day_limit - day_count),
    'resetAt', reset_at
  );
end;
$status$;

-- Convert every already-expired lease to a paid/consumed attempt. Historical
-- released rows were already refunded, so they can be removed immediately.
update public.ai_usage_claims
set state = 'consumed',
    consumed_at = now(),
    released_at = null,
    lease_expires_at = null
where state = 'reserved'
  and lease_expires_at <= now();

delete from public.ai_usage_claims
where state = 'released';

revoke all on function public.ai_usage_limits_v1(text, boolean)
from public, anon, authenticated, service_role;
revoke all on function public.release_ai_usage_reservation_locked(uuid, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.reclaim_expired_ai_usage_reservations(uuid, text, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.reserve_ai_request_for_user_internal_v1(uuid, text, uuid, uuid, boolean)
from public, anon, authenticated, service_role;
revoke all on function public.consume_ai_request_claim_for_user_internal_v1(uuid, uuid)
from public, anon, authenticated, service_role;

revoke all on function public.reserve_ai_request_for_user(uuid, text, uuid, uuid, boolean)
from public, anon, authenticated, service_role;
grant execute on function public.reserve_ai_request_for_user(uuid, text, uuid, uuid, boolean)
to service_role;
revoke all on function public.consume_ai_request_claim_for_user(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.consume_ai_request_claim_for_user(uuid, uuid)
to service_role;
revoke all on function public.release_ai_request_claim_for_user(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.release_ai_request_claim_for_user(uuid, uuid)
to service_role;
revoke all on function public.release_ai_request_reservation_for_user(uuid, text, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.release_ai_request_reservation_for_user(uuid, text, uuid, uuid)
to service_role;

revoke all on function public.reserve_ai_request(text, integer, integer, uuid, uuid, integer)
from public, anon, authenticated, service_role;
grant execute on function public.reserve_ai_request(text, integer, integer, uuid, uuid, integer)
to authenticated;
revoke all on function public.consume_ai_request_claim(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.consume_ai_request_claim(uuid)
to authenticated;
revoke all on function public.release_ai_request_claim(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.release_ai_request_claim(uuid)
to authenticated;
revoke all on function public.release_ai_request_reservation(text, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.release_ai_request_reservation(text, uuid, uuid)
to authenticated;

revoke all on function public.claim_ai_request(text, integer, integer)
from public, anon, authenticated, service_role;
revoke all on function public.read_ai_usage_status(text, integer, integer)
from public, anon, authenticated, service_role;
grant execute on function public.read_ai_usage_status(text, integer, integer)
to authenticated;
