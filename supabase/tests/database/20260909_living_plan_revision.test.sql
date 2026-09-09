begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select extensions.plan(10);

insert into auth.users(id,email) values ('b1000000-0000-4000-8000-000000000001','living-plan-boundary@example.com');
insert into public.learning_items(id,user_id,title,kind,topic,source_mode,study_mode)
values ('b1000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001','AP Biology','topic','AP Biology','yova_generated','inside_yova');
insert into public.plans(id,user_id,learning_item_id,rationale,knowledge_map,generation_inputs)
values ('b1000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','Preserve completed biology work.',
  '{"version":1,"topics":[{"id":"b1000000-0000-4000-8000-000000000004","title":"Water polarity","description":"Explain partial charges in water molecules.","status":"not_started","initialEvidence":null}],"placementCheck":{"status":"skipped","completedAt":null,"demonstratedTopicIds":[],"gapTopicIds":[]}}', '{}');
insert into public.plan_sessions(id,user_id,plan_id,sequence,title,objective,method,method_rationale,estimated_minutes,status,step_data)
values ('b1000000-0000-4000-8000-000000000005','b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003',1,'Completed respiration','Explain cellular respiration','Feynman Technique','Explain the connections.',25,'complete','{"learnerWork":"Keep my completed explanation"}');

create temporary table before_completed as select to_jsonb(s) as row from public.plan_sessions s where id='b1000000-0000-4000-8000-000000000005';
create temporary table revision_payload as select jsonb_build_object(
  'operationId','b1000000-0000-4000-8000-000000000006', 'planId',p.id,
  'expectedRevisionId',coalesce(to_jsonb(p)->>'current_revision_id',p.id::text),
  'revisionId','b1000000-0000-4000-8000-000000000006',
  'expectedMap',p.knowledge_map,
  'knowledgeMap',jsonb_set(p.knowledge_map,'{topics,0,initialEvidence}','{"source":"learner_report","outcome":"covered_elsewhere","checked":false}'),
  'deadline',null, 'generationRequest','{}'::jsonb,'sessions','[]'::jsonb,'fixedEvents','[]'::jsonb,
  'proposal',jsonb_build_object('id','b1000000-0000-4000-8000-000000000006'),
  'receipt',jsonb_build_object('message','Practice Water polarity; everything else unchanged.')
) as payload from public.plans p where id='b1000000-0000-4000-8000-000000000003';

create function pg_temp.attempt_revision(payload jsonb) returns text language plpgsql as $$
begin
  execute 'select public.apply_plan_revision($1,$2)' using 'b1000000-0000-4000-8000-000000000001'::uuid,payload;
  return 'saved';
exception when others then return sqlstate;
end $$;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select extensions.is(pg_temp.attempt_revision(payload),'saved','the reviewed declaration saves without rewriting completed work') from revision_payload;
select extensions.is((select knowledge_map#>>'{topics,0,initialEvidence,outcome}' from public.plans where id='b1000000-0000-4000-8000-000000000003'),'covered_elsewhere','the topic displays learned-elsewhere coverage');
select extensions.is((select knowledge_map#>>'{topics,0,status}' from public.plans where id='b1000000-0000-4000-8000-000000000003'),'not_started','the report does not become evidenced knowledge');
select extensions.is((select to_jsonb(s) from public.plan_sessions s where id='b1000000-0000-4000-8000-000000000005'),(select row from before_completed),'completed session and learner work remain byte-identical');
select extensions.is(pg_temp.attempt_revision(payload),'saved','an exact lost-response retry acknowledges the same save') from revision_payload;
select extensions.is(pg_temp.attempt_revision(jsonb_set(payload,'{operationId}','"b1000000-0000-4000-8000-000000000007"')),'40001','an obsolete preview cannot overwrite the saved revision') from revision_payload;
select extensions.ok(coalesce((select not has_function_privilege('authenticated',p.oid,'execute') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='apply_plan_revision'),false),'a browser cannot submit arbitrary rebuilt sessions to the database');
select extensions.ok(coalesce((select has_function_privilege('service_role',p.oid,'execute') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='apply_plan_revision'),false),'only the signing server can submit an accepted patch');
select extensions.ok(coalesce((select not has_table_privilege('authenticated',c.oid,'insert,update,delete') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='plan_revisions'),false),'revision history cannot be forged by a browser');
select extensions.is((select knowledge_map->'placementCheck' from public.plans where id='b1000000-0000-4000-8000-000000000003'),(select payload#>'{expectedMap,placementCheck}' from revision_payload),'the placement ledger remains unchanged');
select * from extensions.finish();
rollback;
