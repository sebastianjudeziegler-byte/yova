-- Complete the approved topic-scoped source binding at the database projection
-- boundary. All other route, ownership, timing and evidence guards stay intact.
create function public.study_route_source_matches_map_v1(candidate jsonb, knowledge_map jsonb, legacy_source_mode text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare expected_ids jsonb; actual_ids jsonb; active_ids jsonb; source_type text;
begin
  source_type := candidate #>> '{target,sourceRequirements,sourceType}';
  if not exists (select 1 from jsonb_array_elements(coalesce(candidate #> '{provenance,ruleTrace}','[]'::jsonb)) t where t->>'ruleId'='topic_source_binding_v1') then
    return coalesce(case source_type when 'user_materials' then 'user_materials' when 'yova_generated' then 'yova_generated' when 'trusted_external_source' then 'yova_generated' end = legacy_source_mode,false);
  end if;
  active_ids := public.study_route_active_topic_ids_v1(candidate);
  if jsonb_typeof(active_ids) is distinct from 'array' or jsonb_array_length(active_ids)=0
    or exists(select 1 from jsonb_array_elements_text(active_ids) targets(id) where not exists(select 1 from jsonb_array_elements(knowledge_map->'topics') topic where topic->>'id'=id)) then return false; end if;
  with selected as (
    select topic from jsonb_array_elements(knowledge_map->'topics') topic where active_ids ? (topic->>'id')
  ), declared as (
    select reference->>'materialId' id from selected cross join lateral jsonb_array_elements(coalesce(topic->'sourceReferences','[]'::jsonb)) reference where reference->>'sectionRole'='content_source'
    union
    select case when attachment ? 'material_id' then attachment->>'material_id' else 'topic-source:'||(topic->>'id')||':'||(ordinality-1)::text end
    from selected cross join lateral jsonb_array_elements(coalesce(topic->'attachedSources','[]'::jsonb)) with ordinality a(attachment,ordinality)
  ) select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into expected_ids from declared;
  select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into actual_ids from jsonb_array_elements_text(candidate #> '{target,sourceRequirements,requiredSourceIds}') ids(id);
  return actual_ids=expected_ids
    and source_type=case when jsonb_array_length(expected_ids)>0 then 'user_materials' else 'yova_generated' end
    and (candidate #> '{target,sourceRequirements,groundingRequired}')=to_jsonb(jsonb_array_length(expected_ids)>0);
end $$;
revoke all on function public.study_route_source_matches_map_v1(jsonb,jsonb,text) from public,anon,authenticated,service_role;

do $migration$
declare definition text; anchor text;
begin
  definition := pg_get_functiondef('public.assert_study_route_pointer_projection_v1()'::regprocedure);
  anchor := 'expected_source_mode is distinct from stored_source_mode';
  if position(anchor in definition)=0 then raise exception 'topic source pointer anchor missing'; end if;
  execute replace(definition,anchor,'not public.study_route_source_matches_map_v1(pointed_route.route_payload, (select p.knowledge_map from public.plans p where p.id=new.plan_id and p.user_id=new.user_id), stored_source_mode)');

  definition := pg_get_functiondef('public.assert_learning_item_route_projection_v1()'::regprocedure);
  anchor := $source$case route.route_payload #>> '{target,sourceRequirements,sourceType}'
          when 'user_materials' then 'user_materials'
          when 'yova_generated' then 'yova_generated'
          when 'trusted_external_source' then 'yova_generated'
          else null
        end is distinct from current_source_mode$source$;
  if position(anchor in definition)=0 then raise exception 'topic source item anchor missing'; end if;
  execute replace(definition,anchor,'not public.study_route_source_matches_map_v1(route.route_payload, plan.knowledge_map, current_source_mode)');
end;
$migration$;
