-- Reserve and contain the future generated-resource authority boundary while
-- Blurting remains disabled. The current generatedSession slot is the mature
-- generic V15-V17 cache and cannot truthfully represent the dedicated,
-- multi-target Blurting resource. This migration therefore creates no mint,
-- no consumable permit, and no authorized Blurting cache writer. A later
-- migration must introduce a dedicated production resource store/shape before
-- any authority can be issued or consumed.

-- Freeze every row family used by the mature cache writer before inspecting
-- the dormant cohort or replacing its public wrapper. The order mirrors that
-- writer: plan, learning item, session, then committed route.
begin;

lock table
  public.plans,
  public.learning_items,
  public.plan_sessions,
  public.study_routes
in share row exclusive mode;

-- Abort if the deployed one-argument function no longer has the route-bound
-- invariants that this compatibility wrapper expects. These sentinels guard a
-- coordinated migration dependency; they are not a substitute for executing
-- the ordered chain against real PostgreSQL before release.
do $$
declare
  cache_definition text := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.cache_generated_session(jsonb)'::pg_catalog.regprocedure
  ));
begin
  if cache_definition not like '%security definer%'
    or cache_definition not like '%set search_path to ''''%'
    or cache_definition not like '%expectedrouterevisionid%'
    or cache_definition not like '%stored_generated_session is not distinct from requested_generated_session%'
    or cache_definition not like '%session_generation_context_changed%'
    or cache_definition not like '%for update%'
    or cache_definition not like '%committed_route_revision_id is not distinct from stored_route_revision_id%' then
    raise exception using
      errcode = '55000',
      message = 'generated_resource_cache_delegate_preflight_failed';
  end if;
end;
$$;

-- Recognize both the legacy scaffold signals and the isolated V18 candidate.
-- Normalization is used only for rejection; no normalized value is accepted
-- into storage. V18 is currently reserved exclusively for Blurting.
create or replace function public.generated_session_has_broad_recall_v1(
  generated_session jsonb
)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
begin
  if pg_catalog.jsonb_typeof(generated_session) is distinct from 'object' then
    return false;
  end if;

  -- Optional type markers use total comparisons so an absent field is false,
  -- never SQL NULL that can poison the complete OR expression.
  return (
      pg_catalog.jsonb_typeof(generated_session -> 'schemaVersion')
        is not distinct from 'number'
      and generated_session ->> 'schemaVersion' = '18'
    )
    or pg_catalog.lower(pg_catalog.btrim(coalesce(
      generated_session ->> 'boundaryStatus',
      ''
    ))) = 'disabled_schema_only'
    or pg_catalog.lower(pg_catalog.btrim(coalesce(
      generated_session #>> '{deliveryIdentity,visibleMethodName}',
      ''
    ))) = 'blurting'
    or pg_catalog.btrim(coalesce(
      generated_session #>> '{deliveryIdentity,visibleSupportingTechniqueId}',
      ''
    )) = 'blurting_v1'
    or (
      pg_catalog.jsonb_typeof(generated_session -> 'orderedTargets')
        is not distinct from 'array'
      and pg_catalog.jsonb_typeof(generated_session -> 'phaseEnvelopes')
        is not distinct from 'array'
    )
    or pg_catalog.lower(pg_catalog.btrim(coalesce(
      generated_session #>> '{methodBriefing,name}',
      ''
    ))) = 'blurting'
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof(generated_session -> 'activities') = 'array'
            then generated_session -> 'activities'
          else '[]'::jsonb
        end
      ) as activity(value)
      where pg_catalog.lower(pg_catalog.btrim(coalesce(
          activity.value #>> '{methodRuntime,format}',
          ''
        ))) = 'broad_recall_v1'
        or pg_catalog.jsonb_typeof(
          activity.value #> '{methodRuntime,targetBindings}'
        ) = 'array'
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof(generated_session -> 'phaseEnvelopes') = 'array'
            then generated_session -> 'phaseEnvelopes'
          else '[]'::jsonb
        end
      ) as phase(value)
      where pg_catalog.lower(pg_catalog.btrim(coalesce(
          phase.value #>> '{runtime,format}',
          ''
        ))) = 'broad_recall_v1'
        or pg_catalog.jsonb_typeof(
          phase.value #> '{runtime,targetBindings}'
        ) = 'array'
    );
end;
$$;

revoke all on function public.generated_session_has_broad_recall_v1(jsonb)
from public, anon, authenticated, service_role;

-- Blurting issuance and resource authorization are both disabled before this
-- migration. Refuse to grandfather a non-null resource under an active
-- Blurting route or a broad marker hidden under any other route.
do $$
begin
  if exists (
    select 1
    from public.plan_sessions as session
    left join public.study_routes as route
      on route.route_revision_id = session.committed_route_revision_id
      and route.plan_session_id = session.id
      and route.plan_id = session.plan_id
      and route.user_id = session.user_id
    where session.step_data -> 'generatedSession' is not null
      and (
        route.route_payload #>> '{approach,visibleSupportingTechniqueId}'
          = 'blurting_v1'
        or coalesce(public.generated_session_has_broad_recall_v1(
          session.step_data -> 'generatedSession'
        ), false)
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'generated_resource_authority_preflight_failed';
  end if;
end;
$$;

-- Private schema reservation only. This migration contains no INSERT into the
-- table and grants no role table access. The shape may be replaced by the
-- later dedicated-resource migration; its existence is not live authority.
create table public.generated_resource_authority_permits (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null,
  learning_item_id uuid not null,
  plan_session_id uuid not null,
  route_revision_id uuid not null references public.study_routes(route_revision_id)
    on delete cascade,
  resource_generated_at timestamptz not null,
  generated_resource_digest bytea not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint generated_resource_authority_exact_resource_unique unique (
    user_id,
    plan_session_id,
    route_revision_id,
    generated_resource_digest
  ),
  constraint generated_resource_authority_digest_check check (
    pg_catalog.octet_length(generated_resource_digest) = 32
  ),
  constraint generated_resource_authority_ttl_check check (
    expires_at = issued_at + interval '5 minutes'
  ),
  constraint generated_resource_authority_outcome_check check (
    consumed_at is null or consumed_at >= issued_at
  ),
  constraint generated_resource_authority_plan_owner_fk foreign key (
    plan_id,
    user_id
  ) references public.plans(id, user_id) on delete cascade,
  constraint generated_resource_authority_item_owner_fk foreign key (
    learning_item_id,
    user_id
  ) references public.learning_items(id, user_id) on delete cascade,
  constraint generated_resource_authority_session_owner_fk foreign key (
    plan_session_id,
    plan_id,
    user_id
  ) references public.plan_sessions(id, plan_id, user_id) on delete cascade
);

create index generated_resource_authority_expiry_idx
on public.generated_resource_authority_permits(expires_at);

create index generated_resource_authority_user_idx
on public.generated_resource_authority_permits(user_id, issued_at desc);

alter table public.generated_resource_authority_permits enable row level security;
revoke all on table public.generated_resource_authority_permits
from public, anon, authenticated, service_role;

-- Canonical digest helper reserved for a future dedicated resource. It is
-- private, unused by this migration, and cannot mint or consume anything.
create or replace function public.generated_resource_digest_v1(
  generated_resource jsonb
)
returns bytea
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select extensions.digest(
    pg_catalog.convert_to(
      'yova.generated_resource_reservation.v1|'
        || generated_resource::text,
      'UTF8'
    ),
    'sha256'
  );
$$;

revoke all on function public.generated_resource_digest_v1(jsonb)
from public, anon, authenticated, service_role;

-- Enforce compatibility at storage, independent of the API's early 409. A
-- broad resource is rejected under every route, and every non-null resource
-- is rejected under an active Blurting route. Removal remains available for
-- invalidation, method exit, Reset, and deletion. Route-pointer changes are
-- covered so an old ordinary resource cannot become attached by transition.
create or replace function public.guard_generated_resource_authority_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  prior_generated_session jsonb := case
    when tg_op = 'UPDATE' then old.step_data -> 'generatedSession'
    else null
  end;
  generated_session jsonb := new.step_data -> 'generatedSession';
  active_blurting_route boolean;
  has_broad_signal boolean;
  route_pointer_changed boolean := case
    when tg_op = 'UPDATE' then new.committed_route_revision_id
      is distinct from old.committed_route_revision_id
    else new.committed_route_revision_id is not null
  end;
begin
  if generated_session is null
    or (
      generated_session is not distinct from prior_generated_session
      and not route_pointer_changed
    ) then
    return new;
  end if;

  has_broad_signal := coalesce(
    public.generated_session_has_broad_recall_v1(generated_session),
    false
  );

  select exists (
    select 1
    from public.study_routes as route
    where route.route_revision_id = new.committed_route_revision_id
      and route.plan_session_id = new.id
      and route.plan_id = new.plan_id
      and route.user_id = new.user_id
      and route.lifecycle = 'committed'
      and route.route_payload
        #>> '{approach,visibleSupportingTechniqueId}' = 'blurting_v1'
  )
  into active_blurting_route;

  if has_broad_signal or active_blurting_route then
    raise exception using
      errcode = '42501',
      message = 'generated_resource_authority_unavailable';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_generated_resource_authority_v1()
from public, anon, authenticated, service_role;

drop trigger if exists plan_sessions_guard_generated_resource_authority_v1
on public.plan_sessions;
create trigger plan_sessions_guard_generated_resource_authority_v1
before insert or update of step_data, committed_route_revision_id
on public.plan_sessions
for each row execute function public.guard_generated_resource_authority_v1();

-- Deletion-only hygiene for the reserved table. There is intentionally no
-- companion mint RPC. Keeping cleanup service-only also prevents the empty
-- reservation from becoming an authenticated storage channel.
create or replace function public.cleanup_generated_resource_authority_permits_v1(
  requested_limit integer default 500
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'generated_resource_reservation_service_role_required';
  end if;
  if requested_limit is null or requested_limit not between 1 and 2000 then
    raise exception using
      errcode = '22023',
      message = 'generated_resource_reservation_cleanup_limit_invalid';
  end if;

  with cleanup_candidates as (
    select permit.id
    from public.generated_resource_authority_permits as permit
    where (
      permit.consumed_at is null
      and permit.expires_at <= pg_catalog.clock_timestamp()
    ) or (
      permit.consumed_at
        <= pg_catalog.clock_timestamp() - interval '24 hours'
    )
    order by permit.expires_at, permit.id
    for update skip locked
    limit requested_limit
  ), deleted as (
    delete from public.generated_resource_authority_permits as permit
    using cleanup_candidates as candidate
    where permit.id = candidate.id
    returning permit.id
  )
  select pg_catalog.count(*)::integer
  into deleted_count
  from deleted;

  return deleted_count;
end;
$$;

revoke all on function public.cleanup_generated_resource_authority_permits_v1(integer)
from public, anon, authenticated, service_role;
grant execute on function public.cleanup_generated_resource_authority_permits_v1(integer)
to service_role;

-- Reset clears the private reservation under the learner account lock.
-- Account, plan, item, session, and route deletion are independently covered
-- by ON DELETE CASCADE constraints.
alter function public.reset_yova_learning_data()
rename to reset_yova_learning_data_without_generated_resource_reservation_v1;

revoke all on function public.reset_yova_learning_data_without_generated_resource_reservation_v1()
from public, anon, authenticated, service_role;

create or replace function public.reset_yova_learning_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  delete from public.generated_resource_authority_permits as permit
  where permit.user_id = current_user_id;

  return public.reset_yova_learning_data_without_generated_resource_reservation_v1();
end;
$$;

revoke all on function public.reset_yova_learning_data()
from public, anon, authenticated, service_role;
grant execute on function public.reset_yova_learning_data()
to authenticated;

-- Preserve the mature route-bound cache body as the sole private storage
-- delegate. Only its original authenticated one-argument ordinary signature
-- is recreated; there is deliberately no two-argument authority overload.
alter function public.cache_generated_session(jsonb)
rename to cache_generated_session_without_generated_resource_authority_v1;

revoke all on function public.cache_generated_session_without_generated_resource_authority_v1(jsonb)
from public, anon, authenticated, service_role;

create or replace function public.cache_generated_session(payload jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_session_id uuid;
  requested_route_revision_id uuid;
  generated_route_revision_id uuid;
  generated_context_route_revision_id uuid;
  generated_session jsonb := payload -> 'generatedSession';
  has_expected_context boolean := payload ? 'expectedKnowledgeMap';
  active_blurting_route boolean;
begin
  if current_user_id is null then
    -- Preserve the mature delegate's authentication code and message.
    perform public.cache_generated_session_without_generated_resource_authority_v1(
      payload
    );
    return;
  end if;

  if coalesce(
    public.generated_session_has_broad_recall_v1(generated_session),
    false
  ) then
    raise exception using
      errcode = '42501',
      message = 'generated_resource_authority_unavailable';
  end if;

  -- Preserve malformed ordinary behavior and, importantly, the mature
  -- delegate's parse-before-lock ordering. Every failing path below delegates
  -- before acquiring the account advisory lock.
  begin
    requested_session_id := (payload ->> 'planSessionId')::uuid;
    requested_route_revision_id := nullif(
      payload ->> 'expectedRouteRevisionId',
      ''
    )::uuid;
    generated_route_revision_id := nullif(
      generated_session ->> 'routeRevisionId',
      ''
    )::uuid;
    generated_context_route_revision_id := nullif(
      generated_session #>> '{cacheContext,routeRevisionId}',
      ''
    )::uuid;
  exception when others then
    perform public.cache_generated_session_without_generated_resource_authority_v1(
      payload
    );
    return;
  end;

  if requested_session_id is null
    or not (payload ? 'expectedRouteRevisionId')
    or pg_catalog.jsonb_typeof(generated_session) is distinct from 'object'
    or has_expected_context <> (payload ? 'expectedSourceMode')
    or has_expected_context <> (payload ? 'expectedPlanUpdatedAt')
    or has_expected_context <> (payload ? 'expectedSessionUpdatedAt')
    or has_expected_context <> (payload ? 'expectedLearningItemUpdatedAt') then
    perform public.cache_generated_session_without_generated_resource_authority_v1(
      payload
    );
    return;
  end if;

  -- Parsed route-receipt parity remains owned by the unchanged mature
  -- delegate after it acquires the canonical row locks.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  select exists (
    select 1
    from public.plan_sessions as session
    join public.study_routes as route
      on route.route_revision_id = session.committed_route_revision_id
      and route.plan_session_id = session.id
      and route.plan_id = session.plan_id
      and route.user_id = session.user_id
      and route.lifecycle = 'committed'
    where session.id = requested_session_id
      and session.user_id = current_user_id
      and route.route_payload
        #>> '{approach,visibleSupportingTechniqueId}' = 'blurting_v1'
  )
  into active_blurting_route;

  if active_blurting_route then
    raise exception using
      errcode = '42501',
      message = 'generated_resource_authority_unavailable';
  end if;

  perform public.cache_generated_session_without_generated_resource_authority_v1(
    payload
  );
end;
$$;

revoke all on function public.cache_generated_session(jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.cache_generated_session(jsonb)
to authenticated;

comment on function public.cache_generated_session(jsonb) is
  'Original authenticated cache signature for ordinary StudyRoutes; broad candidates and every non-null active-Blurting resource remain unavailable pending a dedicated resource store.';

-- The recreated ordinary signature must be visible to PostgREST immediately
-- after this forward-only compatibility migration commits.
notify pgrst, 'reload schema';

commit;
