-- A fresh migration replay has owner RLS on plan_sessions, but no explicit
-- authenticated SELECT grant. The route-write cutover (202608230008) closes
-- table and column writes without supplying that read privilege; the later
-- read grants for the other learning-state tables omit this table. Thus the
-- protected completion RPC can commit while the normal PostgREST reload gets
-- 42501. Make the existing owner-scoped read contract explicit.
--
-- Do not change the RLS policy, grant anonymous/service-role access, or reopen
-- any table/column write. Session mutations remain behind the protected RPCs.
grant select on table public.plan_sessions to authenticated;

-- Keep the existing service-only RPC name. Advancing its contract stops an
-- older v6 function from claiming this read capability before migration.
create or replace function public.signed_in_generation_readiness_v6()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  base_readiness jsonb;
  workload_ready boolean := false;
  session_reads_ready boolean := false;
  activation_oid regprocedure;
  revision_oid regprocedure;
  permit_oid regprocedure;
  revision_writer_oid regprocedure;
  routed_writer_oid regprocedure;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501', message='signed_in_generation_readiness_service_role_required';
  end if;
  base_readiness := public.signed_in_generation_readiness_v5();
  activation_oid := pg_catalog.to_regprocedure('public.save_generated_plan(jsonb)');
  revision_oid := pg_catalog.to_regprocedure('public.read_plan_revision_context(uuid)');
  permit_oid := pg_catalog.to_regprocedure('public.mint_plan_activation_permit_v1(jsonb,uuid,timestamp with time zone)');
  revision_writer_oid := pg_catalog.to_regprocedure('public.apply_plan_revision(uuid,jsonb)');
  routed_writer_oid := pg_catalog.to_regprocedure('public.save_generated_plan_with_routes(jsonb,uuid)');
  if revision_writer_oid is not null and routed_writer_oid is not null and activation_oid is not null and revision_oid is not null and permit_oid is not null then
    workload_ready := position($marker$'workload', session -> 'workload'$marker$ in pg_catalog.pg_get_functiondef(activation_oid)) > 0
      and position($marker$'workload',s.step_data->'workload'$marker$ in pg_catalog.pg_get_functiondef(revision_oid)) > 0
      and position('topic_plan_v2' in pg_catalog.pg_get_functiondef(permit_oid)) > 0
      and position('topic_plan_v2' in pg_catalog.pg_get_functiondef(routed_writer_oid)) > 0
      and position('then 400 else 28 end' in pg_catalog.pg_get_functiondef(revision_writer_oid)) > 0;
  end if;
  -- ACLs and RLS are separate requirements. Accept only the established
  -- authenticated-owner predicate, with no additional permissive read policy
  -- that could broaden it for authenticated/PUBLIC callers.
  select coalesce(c.relrowsecurity, false)
    and pg_catalog.has_table_privilege('authenticated', c.oid, 'select')
    and exists (
      select 1 from pg_catalog.pg_policy policy
      where policy.polrelid=c.oid and policy.polname='plan_sessions_owner_all'
        and policy.polpermissive and policy.polcmd in ('*','r')
        and policy.polroles=array['authenticated'::regrole::oid]
        and pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)), '\s+', '', 'g')
          in ('((selectauth.uid()asuid)=user_id)','((selectauth.uid())=user_id)','(auth.uid()=user_id)')
    )
    and not exists (
      select 1 from pg_catalog.pg_policy policy
      where policy.polrelid=c.oid and policy.polname<>'plan_sessions_owner_all'
        and policy.polpermissive and policy.polcmd in ('*','r')
        and policy.polroles && array[0::oid,'authenticated'::regrole::oid]
    )
    into session_reads_ready
    from pg_catalog.pg_class c where c.oid='public.plan_sessions'::regclass;
  return base_readiness || jsonb_build_object('contractVersion','20260917170001',
    'ready',coalesce((base_readiness->>'ready')::boolean,false) and workload_ready and coalesce(session_reads_ready,false),
    'topicPlanWorkloads',workload_ready, 'planSessionReads',coalesce(session_reads_ready,false));
end;
$$;
revoke all on function public.signed_in_generation_readiness_v6() from public, anon, authenticated, service_role;
grant execute on function public.signed_in_generation_readiness_v6() to service_role;
