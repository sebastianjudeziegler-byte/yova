-- Freeze the deployed method_eligibility_v2 cohort while issuing the
-- Practice-first method_eligibility_v3 policy. The mature exact-choice writer
-- stays byte-for-byte available for v2 predecessors; v3 is an additive clone
-- whose only semantic substitution is the immutable eligibility trace ID.

begin;

do $clone_v3_writer$
declare
  v2_definition text;
  v3_definition text;
  eligibility_marker_count integer;
  writer_name_marker_count integer;
begin
  if pg_catalog.to_regprocedure(
    'public.change_plan_session_method_with_route_v2(jsonb)'
  ) is null then
    raise exception using
      errcode = '55000',
      message = 'method_eligibility_v3_requires_v2_writer';
  end if;

  select pg_catalog.pg_get_functiondef(routine.oid)
  into v2_definition
  from pg_catalog.pg_proc as routine
  where routine.oid = pg_catalog.to_regprocedure(
    'public.change_plan_session_method_with_route_v2(jsonb)'
  );

  eligibility_marker_count := (
    pg_catalog.char_length(v2_definition)
    - pg_catalog.char_length(pg_catalog.replace(
      v2_definition,
      'method_eligibility_v2',
      ''
    ))
  ) / pg_catalog.char_length('method_eligibility_v2');
  writer_name_marker_count := (
    pg_catalog.char_length(v2_definition)
    - pg_catalog.char_length(pg_catalog.replace(
      v2_definition,
      'change_plan_session_method_with_route_v2',
      ''
    ))
  ) / pg_catalog.char_length(
    'change_plan_session_method_with_route_v2'
  );
  if eligibility_marker_count is distinct from 5
    or writer_name_marker_count is distinct from 1
    or pg_catalog.strpos(v2_definition, 'method_eligibility_v3') > 0 then
    raise exception using
      errcode = '55000',
      message = 'method_eligibility_v2_writer_shape_conflict';
  end if;

  v3_definition := pg_catalog.replace(
    v2_definition,
    'change_plan_session_method_with_route_v2',
    'change_plan_session_method_with_route_v3'
  );
  v3_definition := pg_catalog.replace(
    v3_definition,
    'method_eligibility_v2',
    'method_eligibility_v3'
  );
  execute v3_definition;

  if pg_catalog.to_regprocedure(
    'public.change_plan_session_method_with_route_v3(jsonb)'
  ) is null then
    raise exception using
      errcode = '55000',
      message = 'method_eligibility_v3_writer_creation_failed';
  end if;
end;
$clone_v3_writer$;

revoke all on function
  public.change_plan_session_method_with_route_v3(jsonb)
from public, anon, authenticated, service_role;

comment on function
  public.change_plan_session_method_with_route_v3(jsonb) is
  'Private exact-choice writer for immutable method_eligibility_v3 predecessors.';

-- Dispatch from the authenticated, stored predecessor. Successor JSON is
-- never allowed to choose its validator or upgrade an old route's policy.
create or replace function public.change_plan_session_method_with_route(
  payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_plan_id uuid;
  requested_session_id uuid;
  expected_route_revision_id uuid;
  predecessor_route_payload jsonb;
  predecessor_policy_versions text[] := '{}'::text[];
  predecessor_has_agency_controller boolean := false;
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'post_commit_method_choice_authentication_required';
  end if;

  if pg_catalog.jsonb_typeof(payload) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_scope_conflict';
  end if;

  begin
    requested_plan_id := (payload ->> 'planId')::uuid;
    requested_session_id := (payload ->> 'planSessionId')::uuid;
    expected_route_revision_id := (
      payload ->> 'expectedRouteRevisionId'
    )::uuid;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_scope_conflict';
  end;

  select route.route_payload
  into predecessor_route_payload
  from public.study_routes as route
  where route.route_revision_id = expected_route_revision_id
    and route.plan_id = requested_plan_id
    and route.plan_session_id = requested_session_id
    and route.user_id = current_user_id;

  if predecessor_route_payload is not null then
    select
      coalesce(
        pg_catalog.array_agg(
          distinct trace.value ->> 'ruleId'
          order by trace.value ->> 'ruleId'
        ) filter (
          where trace.value ->> 'ruleId' in (
            'method_eligibility_v2',
            'method_eligibility_v3'
          )
        ),
        '{}'::text[]
      ),
      coalesce(
        pg_catalog.bool_or(
          trace.value ->> 'ruleId'
            = 'study_route_agency_mode_controller_v1'
        ),
        false
      )
    into
      predecessor_policy_versions,
      predecessor_has_agency_controller
    from pg_catalog.jsonb_array_elements(
      predecessor_route_payload #> '{provenance,ruleTrace}'
    ) as trace(value);
  end if;

  if coalesce(
    pg_catalog.array_length(predecessor_policy_versions, 1),
    0
  ) > 1 then
    raise exception using
      errcode = '22023',
      message = 'post_commit_method_choice_agency_conflict';
  end if;

  if predecessor_policy_versions[1] = 'method_eligibility_v3' then
    return public.change_plan_session_method_with_route_v3(payload);
  end if;
  if predecessor_policy_versions[1] = 'method_eligibility_v2' then
    return public.change_plan_session_method_with_route_v2(payload);
  end if;
  -- Routes issued by the current agency controller before eligibility
  -- provenance was added still carry an immutable, predecessor-owned format
  -- marker. Exact stored alternatives use frozen v2 semantics; true legacy
  -- routes without that marker remain on the legacy writer.
  if predecessor_has_agency_controller then
    return public.change_plan_session_method_with_route_v2(payload);
  end if;
  return public.change_plan_session_method_with_route_legacy_v1(payload);
end;
$$;

revoke all on function public.change_plan_session_method_with_route(jsonb)
from public, anon, authenticated, service_role;
grant execute on function
  public.change_plan_session_method_with_route(jsonb)
to authenticated;

comment on function public.change_plan_session_method_with_route(jsonb) is
  'Stable authenticated adapter selected only from the owned stored predecessor eligibility trace.';

-- Older clients retain v2 readiness. This release requires both immutable
-- writers and the predecessor-owned dispatcher before it can issue v3 routes.
create or replace function public.signed_in_generation_readiness_v3()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_readiness jsonb;
  eligibility_v3_ready boolean;
  result_ready boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'signed_in_generation_readiness_service_role_required';
  end if;

  base_readiness := public.signed_in_generation_readiness_v2();
  eligibility_v3_ready :=
    pg_catalog.to_regprocedure(
      'public.change_plan_session_method_with_route_v3(jsonb)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.change_plan_session_method_with_route(jsonb)'
    ) is not null
    and not coalesce(
      pg_catalog.has_function_privilege(
        'authenticated',
        'public.change_plan_session_method_with_route_v3(jsonb)',
        'execute'
      ),
      false
    )
    and not coalesce(
      pg_catalog.has_function_privilege(
        'service_role',
        'public.change_plan_session_method_with_route_v3(jsonb)',
        'execute'
      ),
      false
    )
    and pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(
          'public.change_plan_session_method_with_route_v3(jsonb)'
        )::oid
      ),
      'method_eligibility_v3'
    ) > 0
    and pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(
          'public.change_plan_session_method_with_route_v3(jsonb)'
        )::oid
      ),
      'method_eligibility_v2'
    ) = 0
    and pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(
          'public.change_plan_session_method_with_route(jsonb)'
        )::oid
      ),
      'change_plan_session_method_with_route_v3'
    ) > 0
    and pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(
          'public.change_plan_session_method_with_route(jsonb)'
        )::oid
      ),
      'predecessor_route_payload #> ''{provenance,ruleTrace}'''
    ) > 0;

  result_ready := coalesce(
    (base_readiness ->> 'ready')::boolean,
    false
  ) and eligibility_v3_ready;

  return pg_catalog.jsonb_build_object(
    'contractVersion', '202608310003',
    'ready', result_ready,
    'studyRoutesSchema', coalesce(
      (base_readiness ->> 'studyRoutesSchema')::boolean,
      false
    ),
    'planSessionsRoutePointer', coalesce(
      (base_readiness ->> 'planSessionsRoutePointer')::boolean,
      false
    ),
    'requiredRouteRpcs', coalesce(
      (base_readiness ->> 'requiredRouteRpcs')::boolean,
      false
    ),
    'expandedMethodAgencyBoundary', coalesce(
      (base_readiness ->> 'expandedMethodAgencyBoundary')::boolean,
      false
    ),
    'methodEligibilityV3Boundary', eligibility_v3_ready
  );
end;
$$;

revoke all on function public.signed_in_generation_readiness_v3()
from public, anon, authenticated, service_role;
grant execute on function public.signed_in_generation_readiness_v3()
to service_role;

comment on function public.signed_in_generation_readiness_v3() is
  'Service-only read-only capability probe for the additive eligibility-v3 method-choice boundary.';

commit;
