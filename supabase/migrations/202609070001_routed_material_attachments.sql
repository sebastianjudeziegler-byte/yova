-- Attach sources and revise only future session source authority atomically.
-- The private attachment writer continues to validate ownership, ready chunks,
-- append-only provenance, saved-work protection and the five-source limit.
create or replace function public.attach_materials_to_plan(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
set statement_timeout = '20s'
as $$
declare
  owner_id uuid := auth.uid();
  target_plan_id uuid := (payload ->> 'planId')::uuid;
  stored_session public.plan_sessions%rowtype;
  previous_route public.study_routes%rowtype;
  candidate jsonb;
  receipt jsonb;
  committed jsonb;
  committed_routes jsonb := '[]'::jsonb;
  remaining_count integer;
  candidate_count integer;
begin
  if owner_id is null then raise exception using errcode='28000', message='material_attachment_authentication_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('yova_learning_data'),pg_catalog.hashtext(owner_id::text));
  perform p.id from public.plans p where p.id=target_plan_id and p.user_id=owner_id and p.status='active' for update;
  if not found then raise exception using errcode='55000',message='material_attachment_plan_not_found'; end if;
  perform s.id from public.plan_sessions s where s.plan_id=target_plan_id and s.user_id=owner_id order by s.sequence,s.id for update;
  select count(*) into remaining_count from public.plan_sessions s where s.plan_id=target_plan_id and s.user_id=owner_id and s.status in ('ready','upcoming') and s.committed_route_revision_id is not null;
  if remaining_count=0 then return public.attach_materials_to_plan_without_study_routes(payload); end if;
  if remaining_count <> (select count(*) from public.plan_sessions s where s.plan_id=target_plan_id and s.user_id=owner_id and s.status in ('ready','upcoming')) then raise exception using errcode='40001',message='material_attachment_route_coverage_conflict'; end if;
  if pg_catalog.jsonb_typeof(payload->'studyRoutes') is distinct from 'array' then raise exception using errcode='40001',message='material_attachment_route_update_required'; end if;
  select count(distinct r.value #>> '{identity,sessionId}') into candidate_count from pg_catalog.jsonb_array_elements(payload->'studyRoutes') r(value);
  if candidate_count<>remaining_count or pg_catalog.jsonb_array_length(payload->'studyRoutes')<>remaining_count then raise exception using errcode='40001',message='material_attachment_route_coverage_conflict'; end if;
  for candidate in select value from pg_catalog.jsonb_array_elements(payload->'studyRoutes') loop
    select s.* into stored_session from public.plan_sessions s where s.id=(candidate #>> '{identity,sessionId}')::uuid and s.plan_id=target_plan_id and s.user_id=owner_id and s.status in ('ready','upcoming');
    if not found then raise exception using errcode='40001',message='material_attachment_route_session_conflict'; end if;
    select r.* into previous_route from public.study_routes r where r.route_revision_id=stored_session.committed_route_revision_id and r.plan_session_id=stored_session.id and r.user_id=owner_id and r.lifecycle='committed';
    if not found or (candidate #>> '{identity,supersedesRevisionId}' is distinct from previous_route.route_revision_id::text and candidate #>> '{identity,routeRevisionId}' is distinct from previous_route.route_revision_id::text)
      or ((candidate->'target')-'sourceRequirements') is distinct from ((previous_route.route_payload->'target')-'sourceRequirements')
      or (candidate-'identity'-'target'-'provenance') is distinct from (previous_route.route_payload-'target'-'provenance')
      or ((candidate->'provenance')-'ruleTrace') is distinct from ((previous_route.route_payload->'provenance')-'ruleTrace')
      or candidate #>> '{target,sourceRequirements,sourceType}' is distinct from 'user_materials'
      or candidate #> '{target,sourceRequirements,groundingRequired}' is distinct from 'true'::jsonb
    then raise exception using errcode='40001',message='material_attachment_source_only_revision_required'; end if;
  end loop;

  receipt := public.attach_materials_to_plan_without_study_routes(payload);
  for candidate in select value from pg_catalog.jsonb_array_elements(payload->'studyRoutes') loop
    if (select pg_catalog.jsonb_agg(source.value order by source.value) from pg_catalog.jsonb_array_elements_text(candidate #> '{target,sourceRequirements,requiredSourceIds}') source(value))
      is distinct from (select pg_catalog.jsonb_agg(material.value->>'id' order by material.value->>'id') from pg_catalog.jsonb_array_elements(receipt->'materials') material(value))
    then raise exception using errcode='40001',message='material_attachment_source_identity_conflict'; end if;
    committed := public.commit_study_route_revision(candidate);
    committed_routes := committed_routes || pg_catalog.jsonb_build_array(committed->'studyRoute');
  end loop;
  return receipt || pg_catalog.jsonb_build_object('studyRoutes',committed_routes);
end;
$$;
revoke all on function public.attach_materials_to_plan(jsonb) from public,anon,authenticated;
grant execute on function public.attach_materials_to_plan(jsonb) to authenticated;
