begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select extensions.plan(20);

select extensions.ok(
  has_table_privilege('authenticated', 'public.plan_sessions', 'select'),
  'the signed-in learning-state reload has an explicit session read privilege'
);
select extensions.ok(
  (select bool_and(has_column_privilege('authenticated', 'public.plan_sessions', column_name, 'select'))
   from unnest(array['id','plan_id','sequence','title','objective','method','method_rationale','scheduled_for',
     'estimated_minutes','status','step_data','committed_route_revision_id']) as columns(column_name)),
  'every column selected by the browser learning-state reload is readable'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.plan_sessions'::regclass),
  'row-level security remains enabled on session reads'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.plan_sessions', 'insert')
  and not has_table_privilege('authenticated', 'public.plan_sessions', 'update')
  and not has_table_privilege('authenticated', 'public.plan_sessions', 'delete')
  and not has_any_column_privilege('authenticated', 'public.plan_sessions', 'insert')
  and not has_any_column_privilege('authenticated', 'public.plan_sessions', 'update'),
  'neither table-level nor leftover column-level writes are reopened'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.plan_sessions', 'select'),
  'the repair does not grant signed-out visitors session reads'
);
select extensions.ok(
  not has_table_privilege('service_role', 'public.plan_sessions', 'select'),
  'the repair does not broaden the server role to direct session reads'
);

-- Distinct owners make it impossible for a missing/overbroad policy to pass
-- merely because the test happens to contain only the current user's rows.
insert into auth.users(id,email) values
('a9170000-0000-4000-8000-000000000001','session-read-owner@example.com'),
('a9170000-0000-4000-8000-000000000002','session-read-other@example.com');
insert into public.learning_items(id,user_id,title,kind,topic,source_mode,study_mode) values
('b9170000-0000-4000-8000-000000000001','a9170000-0000-4000-8000-000000000001','Cell transport','topic','Osmosis','yova_generated','inside_yova'),
('b9170000-0000-4000-8000-000000000002','a9170000-0000-4000-8000-000000000002','Energy transfer','topic','ATP','yova_generated','inside_yova');
insert into public.plans(id,user_id,learning_item_id,status,rationale) values
('c9170000-0000-4000-8000-000000000001','a9170000-0000-4000-8000-000000000001','b9170000-0000-4000-8000-000000000001','active','Learn and practise transport.'),
('c9170000-0000-4000-8000-000000000002','a9170000-0000-4000-8000-000000000002','b9170000-0000-4000-8000-000000000002','active','Learn and practise energy transfer.');
insert into public.plan_sessions(id,user_id,plan_id,sequence,title,objective,method,method_rationale,estimated_minutes,status,step_data) values
('d9170000-0000-4000-8000-000000000001','a9170000-0000-4000-8000-000000000001','c9170000-0000-4000-8000-000000000001',1,'Completed osmosis practice','Explain water movement.','Active Recall','Recall and check.',15,'complete','{"learningMode":"study"}'),
('d9170000-0000-4000-8000-000000000002','a9170000-0000-4000-8000-000000000002','c9170000-0000-4000-8000-000000000002',1,'Other learner practice','Explain energy transfer.','Active Recall','Recall and check.',15,'ready','{"learningMode":"study"}');

set local role authenticated;
select set_config('request.jwt.claim.sub','a9170000-0000-4000-8000-000000000001',true);
select extensions.lives_ok($query$
  select id,plan_id,sequence,title,objective,method,method_rationale,scheduled_for,
    estimated_minutes,status,step_data,committed_route_revision_id
  from public.plan_sessions order by sequence
$query$, 'the exact learning-state session projection succeeds as the signed-in owner');
select extensions.is((select count(*) from public.plan_sessions),1::bigint,
  'the owner sees only their session');
select extensions.is((select count(*) from public.plan_sessions where id='d9170000-0000-4000-8000-000000000002'),0::bigint,
  'an explicit other-account session ID cannot bypass owner filtering');
select extensions.is((select status from public.plan_sessions where id='d9170000-0000-4000-8000-000000000001'),'complete',
  'the browser can reload the committed completion status');
select extensions.throws_ok($query$
  update public.plan_sessions set status='complete' where id='d9170000-0000-4000-8000-000000000001'
$query$,'42501','permission denied for table plan_sessions','direct completion/status updates remain denied');
select extensions.throws_ok($query$
  insert into public.plan_sessions(id,user_id,plan_id,sequence,title,objective,method,method_rationale,estimated_minutes,status)
  values('d9170000-0000-4000-8000-000000000003','a9170000-0000-4000-8000-000000000001','c9170000-0000-4000-8000-000000000001',2,'Forged session','Forged objective','Active Recall','Forged reason',15,'complete')
$query$,'42501','permission denied for table plan_sessions','direct session inserts remain denied');
select extensions.throws_ok($query$
  delete from public.plan_sessions where id='d9170000-0000-4000-8000-000000000001'
$query$,'42501','permission denied for table plan_sessions','direct session deletion remains denied');
select set_config('request.jwt.claim.sub','a9170000-0000-4000-8000-000000000002',true);
select extensions.is((select title from public.plan_sessions),'Other learner practice',
  'a different signed-in learner reads their own row rather than the first owner row');
reset role;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select extensions.throws_ok('select id,status from public.plan_sessions','42501','permission denied for table plan_sessions',
  'a signed-out request cannot use the restored read surface');
reset role;
-- A migration-ready deployment must not advertise readiness when the exact
-- privilege or owner predicate needed by reload disappears.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select extensions.is(public.signed_in_generation_readiness_v6()->>'contractVersion','20260917170001',
  'the existing v6 RPC advertises the read-grant migration contract');
select extensions.ok((public.signed_in_generation_readiness_v6()->>'planSessionReads')::boolean,
  'readiness includes the owner-scoped session read capability');
revoke select on table public.plan_sessions from authenticated;
select extensions.ok(not (public.signed_in_generation_readiness_v6()->>'ready')::boolean
  and not (public.signed_in_generation_readiness_v6()->>'planSessionReads')::boolean,
  'readiness fails closed if the reload SELECT grant is missing');
grant select on table public.plan_sessions to authenticated;
alter policy "plan_sessions_owner_all" on public.plan_sessions using (true);
select extensions.ok(not (public.signed_in_generation_readiness_v6()->>'ready')::boolean
  and not (public.signed_in_generation_readiness_v6()->>'planSessionReads')::boolean,
  'readiness rejects an owner policy broadened to every row');
alter policy "plan_sessions_owner_all" on public.plan_sessions using ((select auth.uid()) = user_id);
select extensions.ok((public.signed_in_generation_readiness_v6()->>'planSessionReads')::boolean,
  'readiness recovers after the exact owner boundary is restored');
select * from extensions.finish();
rollback;
