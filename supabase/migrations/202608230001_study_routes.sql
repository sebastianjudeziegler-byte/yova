-- Persist the deterministic decision that authorizes one study session. Route
-- content is append-only: a material change creates a new revision, while the
-- session points at exactly one committed revision. Legacy sessions may keep a
-- null pointer until their route is reconstructed.

alter table public.plan_sessions
add constraint plan_sessions_route_scope_key
unique (id, plan_id, user_id);

create table public.study_routes (
  route_revision_id uuid primary key,
  route_lineage_id uuid not null,
  revision_number integer not null,
  schema_version smallint not null default 1,
  lifecycle text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null,
  plan_session_id uuid not null,
  predecessor_revision_id uuid,
  route_payload jsonb not null,
  route_fingerprint text not null,
  created_at timestamptz not null,
  committed_at timestamptz,
  constraint study_routes_revision_number_check
    check (revision_number between 1 and 10000),
  constraint study_routes_schema_version_check
    check (schema_version = 1),
  constraint study_routes_lifecycle_check
    check (lifecycle in ('provisional', 'committed', 'superseded')),
  constraint study_routes_lifecycle_time_check check (
    (
      lifecycle = 'provisional'
      and committed_at is null
    ) or (
      lifecycle in ('committed', 'superseded')
      and committed_at is not null
      and committed_at >= created_at
    )
  ),
  constraint study_routes_predecessor_shape_check check (
    (revision_number = 1 and predecessor_revision_id is null)
    or (revision_number > 1 and predecessor_revision_id is not null)
  ),
  constraint study_routes_route_payload_check check (
    jsonb_typeof(route_payload) = 'object'
    and octet_length(route_payload::text) between 2 and 262144
  ),
  constraint study_routes_route_fingerprint_check
    check (route_fingerprint ~ '^sr1:[0-9a-f]{64}$'),
  constraint study_routes_lineage_revision_key
    unique (route_lineage_id, revision_number),
  constraint study_routes_revision_scope_key
    unique (
      route_revision_id,
      route_lineage_id,
      plan_session_id,
      plan_id,
      user_id
    ),
  constraint study_routes_plan_owner_fk
    foreign key (plan_id, user_id)
    references public.plans(id, user_id)
    on delete cascade,
  constraint study_routes_session_plan_owner_fk
    foreign key (plan_session_id, plan_id, user_id)
    references public.plan_sessions(id, plan_id, user_id)
    on delete cascade,
  constraint study_routes_predecessor_scope_fk
    foreign key (
      predecessor_revision_id,
      route_lineage_id,
      plan_session_id,
      plan_id,
      user_id
    )
    references public.study_routes(
      route_revision_id,
      route_lineage_id,
      plan_session_id,
      plan_id,
      user_id
    )
    on delete cascade
);

create index study_routes_user_id_idx
on public.study_routes(user_id);

create index study_routes_session_history_idx
on public.study_routes(user_id, plan_session_id, revision_number desc);

create unique index study_routes_one_committed_per_session_idx
on public.study_routes(plan_session_id)
where lifecycle = 'committed';

alter table public.plan_sessions
add column committed_route_revision_id uuid;

-- The scope columns make a cross-session or cross-owner pointer impossible.
-- Keep this side deferred rather than SET NULL: an FK-driven pointer update
-- would run the existing plan-session UPDATE guards while the same session is
-- being cascade-deleted. With deferred NO ACTION, deleting a plan/session also
-- cascades its routes and the circular reference is gone at commit; deleting a
-- referenced route by itself remains forbidden. The route-to-session FK above
-- is the cascading side of the relationship.
alter table public.plan_sessions
add constraint plan_sessions_committed_route_owner_fk
foreign key (committed_route_revision_id, id, plan_id, user_id)
references public.study_routes(
  route_revision_id,
  plan_session_id,
  plan_id,
  user_id
)
on delete no action
deferrable initially deferred;

alter table public.study_routes enable row level security;

create policy "study_routes_owner_select" on public.study_routes
for select to authenticated
using ((select auth.uid()) = user_id);

-- Route rows are readable by their owner but never directly writable from an
-- authenticated client. The definer RPC below is the only lifecycle boundary.
revoke all on table public.study_routes from public, anon, authenticated;
grant select on table public.study_routes to authenticated;

create or replace function public.guard_study_route_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  authorized_revision_id text := pg_catalog.current_setting(
    'yova.study_route_lifecycle_revision',
    true
  );
begin
  if authorized_revision_id is distinct from new.route_revision_id::text then
    raise exception using
      errcode = '42501',
      message = 'study_route_rpc_required';
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.route_revision_id is distinct from old.route_revision_id
    or new.route_lineage_id is distinct from old.route_lineage_id
    or new.revision_number is distinct from old.revision_number
    or new.schema_version is distinct from old.schema_version
    or new.user_id is distinct from old.user_id
    or new.plan_id is distinct from old.plan_id
    or new.plan_session_id is distinct from old.plan_session_id
    or new.predecessor_revision_id is distinct from old.predecessor_revision_id
    or new.route_payload is distinct from old.route_payload
    or new.route_fingerprint is distinct from old.route_fingerprint
    or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'study_route_revision_immutable';
  end if;

  if old.lifecycle = 'provisional'
    and new.lifecycle = 'committed'
    and old.committed_at is null
    and new.committed_at is not null
    and new.committed_at >= new.created_at then
    return new;
  end if;

  if old.lifecycle = 'committed'
    and new.lifecycle = 'superseded'
    and new.committed_at is not distinct from old.committed_at then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'study_route_lifecycle_transition_invalid';
end;
$$;

create trigger study_routes_guard_immutability
before insert or update on public.study_routes
for each row execute function public.guard_study_route_immutability();

-- Commit either the first route for a session or the direct successor of its
-- current committed route. PostgreSQL wraps the whole function call in one
-- transaction, so a failed insert or pointer update rolls back superseding the
-- predecessor as well.
create or replace function public.commit_study_route_revision(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_identity jsonb := payload -> 'identity';
  requested_route_payload jsonb;
  requested_route_revision_id uuid;
  requested_route_lineage_id uuid;
  requested_revision_number integer;
  requested_revision_number_numeric numeric;
  requested_schema_version smallint;
  requested_plan_id uuid;
  requested_plan_session_id uuid;
  requested_predecessor_revision_id uuid;
  requested_created_at timestamptz;
  requested_committed_at timestamptz;
  requested_route_fingerprint text;
  requested_plan public.plans%rowtype;
  requested_session public.plan_sessions%rowtype;
  existing_route public.study_routes%rowtype;
  predecessor_route public.study_routes%rowtype;
  committed_route public.study_routes%rowtype;
  canonical_study_route jsonb;
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'study_route_authentication_required';
  end if;

  if jsonb_typeof(payload) is distinct from 'object'
    or not (payload ?& array[
      'identity',
      'target',
      'approach',
      'timing',
      'execution',
      'agency',
      'explanation',
      'provenance'
    ])
    or exists (
      select 1
      from jsonb_object_keys(payload) as root_keys(root_key)
      where root_key not in (
        'identity',
        'target',
        'approach',
        'timing',
        'execution',
        'agency',
        'explanation',
        'provenance'
      )
    )
    or jsonb_typeof(payload -> 'identity') is distinct from 'object'
    or jsonb_typeof(payload -> 'target') is distinct from 'object'
    or jsonb_typeof(payload -> 'approach') is distinct from 'object'
    or jsonb_typeof(payload -> 'timing') is distinct from 'object'
    or jsonb_typeof(payload -> 'execution') is distinct from 'object'
    or jsonb_typeof(payload -> 'agency') is distinct from 'object'
    or jsonb_typeof(payload -> 'explanation') is distinct from 'object'
    or jsonb_typeof(payload -> 'provenance') is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'study_route_invalid_payload';
  end if;

  if not (requested_identity ?& array[
      'routeLineageId',
      'routeRevisionId',
      'revisionNumber',
      'schemaVersion',
      'lifecycleStatus',
      'planId',
      'sessionId',
      'createdAt',
      'committedAt'
    ])
    or exists (
      select 1
      from jsonb_object_keys(requested_identity) as identity_keys(identity_key)
      where identity_key not in (
        'routeLineageId',
        'routeRevisionId',
        'revisionNumber',
        'schemaVersion',
        'lifecycleStatus',
        'planId',
        'sessionId',
        'createdAt',
        'committedAt',
        'supersedesRevisionId'
      )
    )
    or jsonb_typeof(requested_identity -> 'routeLineageId') is distinct from 'string'
    or jsonb_typeof(requested_identity -> 'routeRevisionId') is distinct from 'string'
    or jsonb_typeof(requested_identity -> 'revisionNumber') is distinct from 'number'
    or requested_identity -> 'schemaVersion' is distinct from '1'::jsonb
    or requested_identity ->> 'lifecycleStatus' is distinct from 'committed'
    or jsonb_typeof(requested_identity -> 'planId') is distinct from 'string'
    or jsonb_typeof(requested_identity -> 'sessionId') is distinct from 'string'
    or jsonb_typeof(requested_identity -> 'createdAt') is distinct from 'string'
    or jsonb_typeof(requested_identity -> 'committedAt') is distinct from 'string'
    or (
      requested_identity ? 'supersedesRevisionId'
      and jsonb_typeof(requested_identity -> 'supersedesRevisionId')
        is distinct from 'string'
    ) then
    raise exception using
      errcode = '22023',
      message = 'study_route_invalid_identity';
  end if;

  begin
    requested_route_revision_id := (requested_identity ->> 'routeRevisionId')::uuid;
    requested_route_lineage_id := (requested_identity ->> 'routeLineageId')::uuid;
    requested_revision_number_numeric := (requested_identity ->> 'revisionNumber')::numeric;
    requested_schema_version := (requested_identity ->> 'schemaVersion')::smallint;
    requested_plan_id := (requested_identity ->> 'planId')::uuid;
    requested_plan_session_id := (requested_identity ->> 'sessionId')::uuid;
    requested_predecessor_revision_id := case
      when requested_identity ? 'supersedesRevisionId'
        then (requested_identity ->> 'supersedesRevisionId')::uuid
      else null
    end;
    requested_created_at := (requested_identity ->> 'createdAt')::timestamptz;
    requested_committed_at := (requested_identity ->> 'committedAt')::timestamptz;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'study_route_invalid_identity';
  end;

  if requested_revision_number_numeric <> trunc(requested_revision_number_numeric)
    or requested_revision_number_numeric not between 1 and 10000
    or requested_schema_version <> 1
    or requested_created_at > pg_catalog.clock_timestamp() + interval '5 minutes'
    or requested_committed_at < requested_created_at
    or requested_committed_at > pg_catalog.clock_timestamp() + interval '5 minutes'
    or (
      requested_revision_number_numeric = 1
      and requested_predecessor_revision_id is not null
    )
    or (
      requested_revision_number_numeric > 1
      and requested_predecessor_revision_id is null
    )
    or requested_predecessor_revision_id = requested_route_revision_id then
    raise exception using
      errcode = '22023',
      message = 'study_route_invalid_identity';
  end if;

  requested_revision_number := requested_revision_number_numeric::integer;
  requested_route_payload := payload - 'identity';
  if octet_length(requested_route_payload::text) > 262144 then
    raise exception using
      errcode = '22023',
      message = 'study_route_payload_too_large';
  end if;

  requested_route_fingerprint := 'sr1:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(requested_route_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  -- Share the account-level order used by Reset, account deletion, plan
  -- deletion, plan adjustment and session scheduling.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  select *
  into requested_plan
  from public.plans as plan
  where plan.id = requested_plan_id
    and plan.user_id = current_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'study_route_plan_not_found';
  end if;

  select *
  into requested_session
  from public.plan_sessions as session
  where session.id = requested_plan_session_id
    and session.plan_id = requested_plan.id
    and session.user_id = current_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'study_route_session_not_found';
  end if;

  select *
  into existing_route
  from public.study_routes as route
  where route.route_revision_id = requested_route_revision_id
  for update;

  if found then
    if existing_route.route_fingerprint is distinct from requested_route_fingerprint
      or existing_route.route_lineage_id is distinct from requested_route_lineage_id
      or existing_route.revision_number is distinct from requested_revision_number
      or existing_route.schema_version is distinct from requested_schema_version
      or existing_route.user_id is distinct from current_user_id
      or existing_route.plan_id is distinct from requested_plan.id
      or existing_route.plan_session_id is distinct from requested_session.id
      or existing_route.predecessor_revision_id
        is distinct from requested_predecessor_revision_id
      or existing_route.created_at is distinct from requested_created_at
      or (
        existing_route.lifecycle in ('committed', 'superseded')
        and existing_route.committed_at is distinct from requested_committed_at
      ) then
      raise exception using
        errcode = '40001',
        message = 'study_route_revision_conflict';
    end if;

    -- A transport retry is harmless, even after the learner has started. No
    -- route state changes in this branch, so an active checkpoint remains valid.
    if existing_route.lifecycle = 'committed'
      and requested_session.committed_route_revision_id
        is not distinct from existing_route.route_revision_id then
      canonical_study_route := jsonb_build_object(
        'identity',
        jsonb_build_object(
          'routeLineageId', existing_route.route_lineage_id,
          'routeRevisionId', existing_route.route_revision_id,
          'revisionNumber', existing_route.revision_number,
          'schemaVersion', existing_route.schema_version,
          'lifecycleStatus', existing_route.lifecycle,
          'planId', existing_route.plan_id,
          'sessionId', existing_route.plan_session_id,
          'createdAt', existing_route.created_at,
          'committedAt', existing_route.committed_at
        ) || case
          when existing_route.predecessor_revision_id is null then '{}'::jsonb
          else jsonb_build_object(
            'supersedesRevisionId', existing_route.predecessor_revision_id
          )
        end
      ) || existing_route.route_payload;

      return jsonb_build_object(
        'studyRoute', canonical_study_route,
        'routeFingerprint', existing_route.route_fingerprint,
        'committedRouteRevisionId', existing_route.route_revision_id
      );
    end if;

    if existing_route.lifecycle <> 'provisional' then
      raise exception using
        errcode = '40001',
        message = 'study_route_revision_conflict';
    end if;
  end if;

  -- Archived/completed plans may acknowledge an exact transport retry, but no
  -- inactive plan can accept a first route or a successor revision.
  if requested_plan.status <> 'active' then
    raise exception using
      errcode = '55000',
      message = 'study_route_plan_inactive';
  end if;

  -- Like the active-checkpoint case, a completed session may acknowledge an
  -- exact transport retry, but it may never accept a new commitment.
  if requested_session.status not in ('ready', 'upcoming') then
    raise exception using
      errcode = '55000',
      message = 'study_route_session_terminal';
  end if;

  if requested_revision_number = 1 then
    if requested_session.committed_route_revision_id is not null then
      raise exception using
        errcode = '40001',
        message = 'study_route_expected_revision_conflict';
    end if;
  else
    select *
    into predecessor_route
    from public.study_routes as route
    where route.route_revision_id = requested_predecessor_revision_id
      and route.route_lineage_id = requested_route_lineage_id
      and route.plan_session_id = requested_session.id
      and route.plan_id = requested_plan.id
      and route.user_id = current_user_id
    for update;

    if not found
      or predecessor_route.lifecycle <> 'committed'
      or predecessor_route.revision_number + 1 <> requested_revision_number
      or predecessor_route.committed_at > requested_created_at
      or requested_session.committed_route_revision_id
        is distinct from predecessor_route.route_revision_id then
      raise exception using
        errcode = '40001',
        message = 'study_route_predecessor_conflict';
    end if;
  end if;

  -- A route may not change underneath a browser that has durable in-progress
  -- work. Exact retries returned above; every path below changes commitment.
  if requested_session.step_data ? 'activeSessionCheckpoint' then
    raise exception using
      errcode = '55000',
      message = 'study_route_active_checkpoint';
  end if;

  if requested_revision_number > 1 then
    perform pg_catalog.set_config(
      'yova.study_route_lifecycle_revision',
      predecessor_route.route_revision_id::text,
      true
    );

    update public.study_routes
    set lifecycle = 'superseded'
    where route_revision_id = predecessor_route.route_revision_id
      and lifecycle = 'committed';

    if not found then
      raise exception using
        errcode = '40001',
        message = 'study_route_predecessor_conflict';
    end if;
  end if;

  perform pg_catalog.set_config(
    'yova.study_route_lifecycle_revision',
    requested_route_revision_id::text,
    true
  );

  if existing_route.route_revision_id is not null then
    update public.study_routes
    set
      lifecycle = 'committed',
      committed_at = requested_committed_at
    where route_revision_id = requested_route_revision_id
      and lifecycle = 'provisional'
    returning * into committed_route;
  else
    insert into public.study_routes (
      route_revision_id,
      route_lineage_id,
      revision_number,
      schema_version,
      lifecycle,
      user_id,
      plan_id,
      plan_session_id,
      predecessor_revision_id,
      route_payload,
      route_fingerprint,
      created_at,
      committed_at
    ) values (
      requested_route_revision_id,
      requested_route_lineage_id,
      requested_revision_number,
      requested_schema_version,
      'committed',
      current_user_id,
      requested_plan.id,
      requested_session.id,
      requested_predecessor_revision_id,
      requested_route_payload,
      requested_route_fingerprint,
      requested_created_at,
      requested_committed_at
    )
    returning * into committed_route;
  end if;

  if committed_route.route_revision_id is null then
    raise exception using
      errcode = '40001',
      message = 'study_route_revision_conflict';
  end if;

  update public.plan_sessions as session
  set committed_route_revision_id = committed_route.route_revision_id
  where session.id = requested_session.id
    and session.plan_id = requested_plan.id
    and session.user_id = current_user_id
    and session.committed_route_revision_id is not distinct from
      requested_session.committed_route_revision_id;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'study_route_pointer_conflict';
  end if;

  canonical_study_route := jsonb_build_object(
    'identity',
    jsonb_build_object(
      'routeLineageId', committed_route.route_lineage_id,
      'routeRevisionId', committed_route.route_revision_id,
      'revisionNumber', committed_route.revision_number,
      'schemaVersion', committed_route.schema_version,
      'lifecycleStatus', committed_route.lifecycle,
      'planId', committed_route.plan_id,
      'sessionId', committed_route.plan_session_id,
      'createdAt', committed_route.created_at,
      'committedAt', committed_route.committed_at
    ) || case
      when committed_route.predecessor_revision_id is null then '{}'::jsonb
      else jsonb_build_object(
        'supersedesRevisionId', committed_route.predecessor_revision_id
      )
    end
  ) || committed_route.route_payload;

  return jsonb_build_object(
    'studyRoute', canonical_study_route,
    'routeFingerprint', committed_route.route_fingerprint,
    'committedRouteRevisionId', committed_route.route_revision_id
  );
end;
$$;

revoke all on function public.guard_study_route_immutability()
from public, anon, authenticated;
revoke all on function public.commit_study_route_revision(jsonb)
from public, anon, authenticated;
grant execute on function public.commit_study_route_revision(jsonb)
to authenticated;
