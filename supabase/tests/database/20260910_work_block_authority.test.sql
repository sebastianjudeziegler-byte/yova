begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select extensions.plan(3);
insert into auth.users(id,email) values ('c1000000-0000-4000-8000-000000000001','block-owner@example.com');
insert into public.learning_items(id,user_id,title,kind,topic,source_mode,study_mode) values
('c1000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','ATP','topic','ATP','yova_generated','inside_yova');
insert into public.plans(id,user_id,learning_item_id,status,rationale) values
('c1000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','active','Practice ATP energy transfer.');
insert into public.plan_sessions(id,user_id,plan_id,sequence,title,objective,method,method_rationale,estimated_minutes,status,step_data) values
('c1000000-0000-4000-8000-000000000004','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003',1,'ATP products','Name the products.','Retrieval Practice','Recall then check.',15,'ready','{"generatedSession":{"schemaVersion":19,"block":{"id":"c1000000-0000-4000-8000-000000000005"}}}');
create function pg_temp.try_cache(resource jsonb) returns text language plpgsql as $$
begin
 perform public.cache_generated_session(jsonb_build_object('planSessionId','c1000000-0000-4000-8000-000000000004','expectedRouteRevisionId',null,'generatedSession',resource));
 return 'saved';
exception when others then return sqlstate;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select extensions.is(pg_temp.try_cache('{"schemaVersion":19,"block":{"id":"c1000000-0000-4000-8000-000000000005","semanticReview":{"status":"passed"}}}'), '42501', 'a browser cannot mint a reviewed practice set or its answer authority');
reset role;
-- A trusted setup inserts an unsupported descriptor to isolate completion.
-- A raw resource descriptor is not a checked result, even if a compromised
-- browser supplies a complete-looking source checkbox and secure score.
set local role authenticated;
savepoint downgrade;
select extensions.is(pg_temp.try_cache('{"schemaVersion":15,"model":"test","generatedAt":"2026-09-10T10:00:00Z","rationale":"Read then check","coverage":{},"methodBriefing":{},"deliveryPolicy":{},"topicIds":["c1000000-0000-4000-8000-000000000007"],"activities":[{},{},{}]}'), '42501', 'a browser cannot downgrade a prepared block to escape its completion check');
rollback to savepoint downgrade;
select extensions.throws_ok($test$
 select public.complete_plan_session_with_route(jsonb_build_object(
 'attemptId','c1000000-0000-4000-8000-000000000006','planId','c1000000-0000-4000-8000-000000000003','planSessionId','c1000000-0000-4000-8000-000000000004',
 'routeRevisionId',null,'completionVariant','guided','startedAt',now()-interval '15 minutes','completedAt',now(),'actualMinutes',15,'plannedMinutes',15,
 'correctAnswers',2,'totalAnswers',2,'conceptEvidence','[]'::jsonb,'confidenceEvidence','[]'::jsonb,'sourceCompleted',true))
$test$, '42501', 'checked_block_completion_required', 'marking a source read and asserting a score cannot complete the block');
reset role;
select * from extensions.finish();
rollback;
