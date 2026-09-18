-- Brief 2: preserve code-owned work through the protected activation and
-- revision paths. Existing authorization and permit checks remain unchanged.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('public.save_generated_plan(jsonb)'::regprocedure);
  anchor text := $anchor$'amountLabel', session ->> 'amountLabel',$anchor$;
  fixed text := $fixed$'workload', session -> 'workload',
        'amountLabel', session ->> 'amountLabel',$fixed$;
begin
  if position(fixed in definition)>0 then return; end if;
  if position(anchor in definition)=0 then raise exception 'Topic workload activation patch did not match the protected writer'; end if;
  execute replace(definition,anchor,fixed);
end;
$migration$;

do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('public.read_plan_revision_context(uuid)'::regprocedure);
  anchor text := $anchor$'revisionEditedFields',s.step_data->'revisionEditedFields',$anchor$;
  fixed text := $fixed$'workload',s.step_data->'workload',
    'revisionEditedFields',s.step_data->'revisionEditedFields',$fixed$;
begin
  if position(fixed in definition)>0 then return; end if;
  if position(anchor in definition)=0 then raise exception 'Topic workload revision reader patch did not match'; end if;
  execute replace(definition,anchor,fixed);
end;
$migration$;

-- Forty accepted topics can each have three learning blocks and two initial
-- practice placeholders. Only the versioned topic model receives this bound;
-- existing plan generations retain the original fourteen-session limit.
do $migration$
declare
  signature text;
  definition text;
  anchor text := $anchor$pg_catalog.jsonb_array_length(payload -> 'sessions') not between 1 and 14$anchor$;
  fixed text := $fixed$pg_catalog.jsonb_array_length(payload -> 'sessions') not between 1 and (case when payload #>> '{generationInputs,planModel,version}' = 'topic_plan_v2' then 200 else 14 end)$fixed$;
begin
  foreach signature in array array['public.mint_plan_activation_permit_v1(jsonb,uuid,timestamp with time zone)','public.save_generated_plan_with_routes(jsonb,uuid)'] loop
    definition := pg_catalog.pg_get_functiondef(signature::regprocedure);
    if position(fixed in definition)>0 then continue; end if;
    if position(anchor in definition)=0 then raise exception 'Topic queue bound patch did not match %',signature; end if;
    execute replace(definition,anchor,fixed);
  end loop;
end;
$migration$;

-- The revision writer already merges arbitrary validated step fields, so it
-- preserves workload. Widen its patch limit only for the persisted topic model.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('public.apply_plan_revision(uuid,jsonb)'::regprocedure);
  anchor text := $anchor$jsonb_array_length(payload->'sessions')>28$anchor$;
  fixed text := $fixed$jsonb_array_length(payload->'sessions')>(case when p.generation_inputs #>> '{planModel,version}' = 'topic_plan_v2' then 400 else 28 end)$fixed$;
begin
  if position(fixed in definition)>0 then return; end if;
  if position(anchor in definition)=0 then raise exception 'Topic queue revision bound patch did not match'; end if;
  execute replace(definition,anchor,fixed);
end;
$migration$;

-- Refuse a release with a stale writer: losing workload on reload would turn a
-- paid learner's substantial practice back into the old default five items.
create or replace function public.signed_in_generation_readiness_v6()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  base_readiness jsonb;
  workload_ready boolean := false;
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
  return base_readiness || jsonb_build_object('contractVersion','20260917160001',
    'ready',coalesce((base_readiness->>'ready')::boolean,false) and workload_ready,
    'topicPlanWorkloads',workload_ready);
end;
$$;
revoke all on function public.signed_in_generation_readiness_v6() from public, anon, authenticated, service_role;
grant execute on function public.signed_in_generation_readiness_v6() to service_role;
