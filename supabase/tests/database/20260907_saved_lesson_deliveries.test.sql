begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select extensions.plan(12);

select extensions.ok(not has_table_privilege('authenticated','public.session_lesson_deliveries','insert')
  and not has_table_privilege('authenticated','public.session_lesson_deliveries','update')
  and not has_table_privilege('authenticated','public.session_lesson_deliveries','delete'), 'a browser cannot forge or overwrite delivered teaching');
select extensions.ok(has_table_privilege('service_role','public.session_lesson_deliveries','insert')
  and not has_table_privilege('service_role','public.session_lesson_deliveries','update'), 'the server can save but cannot overwrite the first delivery');
select extensions.ok(not has_table_privilege('anon','public.session_lesson_deliveries','select'), 'signed-out requests cannot read teaching');

insert into auth.users(id,email) values
('a1777777-0000-4000-8000-000000000001','lesson-owner@example.com'),
('a1777777-0000-4000-8000-000000000002','lesson-other@example.com');
insert into public.learning_items(id,user_id,title,kind,topic,source_mode,study_mode) values
('a2777777-0000-4000-8000-000000000001','a1777777-0000-4000-8000-000000000001','Glycolysis','topic','Glycolysis','yova_generated','inside_yova');
insert into public.plans(id,user_id,learning_item_id,status,rationale) values
('a3777777-0000-4000-8000-000000000001','a1777777-0000-4000-8000-000000000001','a2777777-0000-4000-8000-000000000001','completed','Learn glycolysis products.');
insert into public.plan_sessions(id,user_id,plan_id,sequence,title,objective,method,method_rationale,estimated_minutes,status,step_data) values
('a4777777-0000-4000-8000-000000000001','a1777777-0000-4000-8000-000000000001','a3777777-0000-4000-8000-000000000001',1,'Glycolysis products','Explain the net yield.','Feynman Technique','Explain, check and repair.',15,'complete','{}');
insert into public.session_lesson_deliveries(user_id,plan_id,plan_session_id,resource_fingerprint,activity_index,content,delivery_mode,model) values
('a1777777-0000-4000-8000-000000000001','a3777777-0000-4000-8000-000000000001','a4777777-0000-4000-8000-000000000001',repeat('a',64),0,'One glucose gives two pyruvate, net two ATP and two NADH.','generated','test-model');

set local role authenticated;
select set_config('request.jwt.claim.sub','a1777777-0000-4000-8000-000000000001',true);
select extensions.is((select content from public.session_lesson_deliveries), 'One glucose gives two pyruvate, net two ATP and two NADH.', 'the owner can review exact teaching after completion');
select set_config('request.jwt.claim.sub','a1777777-0000-4000-8000-000000000002',true);
select extensions.is((select count(*) from public.session_lesson_deliveries),0::bigint,'another learner cannot read the explanation');
reset role;

set local role service_role;
insert into public.session_lesson_deliveries(user_id,plan_id,plan_session_id,resource_fingerprint,activity_index,content,delivery_mode,model) values
('a1777777-0000-4000-8000-000000000001','a3777777-0000-4000-8000-000000000001','a4777777-0000-4000-8000-000000000001',repeat('a',64),0,'A different concurrent response.','generated','test-model') on conflict (plan_session_id,resource_fingerprint,activity_index) do nothing;
select extensions.is((select content from public.session_lesson_deliveries), 'One glucose gives two pyruvate, net two ATP and two NADH.', 'a concurrent delivery cannot replace the original');
insert into public.session_lesson_deliveries(user_id,plan_id,plan_session_id,resource_fingerprint,activity_index,content,delivery_mode,model) values
('a1777777-0000-4000-8000-000000000001','a3777777-0000-4000-8000-000000000001','a4777777-0000-4000-8000-000000000001',repeat('b',64),0,'A separately revised lesson.','bounded_fallback','test-model');
select extensions.is((select count(*) from public.session_lesson_deliveries),2::bigint,'separate resource versions keep separate teaching');
select extensions.throws_ok($test$ insert into public.session_lesson_deliveries(user_id,plan_id,plan_session_id,resource_fingerprint,activity_index,content,delivery_mode,model) values
('a1777777-0000-4000-8000-000000000002','a3777777-0000-4000-8000-000000000001','a4777777-0000-4000-8000-000000000001',repeat('c',64),0,'Wrong owner.','generated','test-model') $test$, '23503', 'lesson_delivery_owner_mismatch', 'even the server must use a consistent owner and session');
reset role;
select extensions.is((select step_data from public.plan_sessions where id='a4777777-0000-4000-8000-000000000001'),'{}'::jsonb,'saving prose does not change the assessment or checkpoint contract');
insert into public.account_data_exports(id,user_id,session_id,status,temp_storage_path,final_storage_path,prepare_expires_at) values
('a5777777-0000-4000-8000-000000000001','a1777777-0000-4000-8000-000000000001','saved-lesson-export','finalizing',
 'a1777777-0000-4000-8000-000000000001/a5777777-0000-4000-8000-000000000001/device-state.json',
 'a1777777-0000-4000-8000-000000000001/a5777777-0000-4000-8000-000000000001/yova-data.json',now()+interval '30 minutes');
select set_config('request.jwt.claim.sub','a1777777-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"session_id":"saved-lesson-export"}',true);
select extensions.ok(exists(select 1 from jsonb_array_elements(public.export_yova_account_data()->'savedLessons') lesson
  where lesson->>'content'='One glucose gives two pyruvate, net two ATP and two NADH.'), 'the claimed account export includes the original delivered explanation');
select extensions.is(jsonb_array_length(public.export_yova_account_data()->'savedLessons'),2,'the export retains distinct resource versions');
delete from auth.users where id='a1777777-0000-4000-8000-000000000001';
select extensions.is((select count(*) from public.session_lesson_deliveries),0::bigint,'account removal deletes saved teaching');
select * from extensions.finish();
rollback;
