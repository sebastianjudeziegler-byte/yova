begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select extensions.plan(9);

-- A plan activated through the real writer, then previewed: the path learners
-- take. The earlier suite only activated drafts that already carried edits.
insert into auth.users(id,email) values ('c2000000-0000-4000-8000-000000000001','revision-null-edits@example.com');
select set_config('request.jwt.claim.sub','c2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"c2000000-0000-4000-8000-000000000001"}',true);
select public.save_generated_plan('{"id":"c2000000-0000-4000-8000-000000000002","learningItemId":"c2000000-0000-4000-8000-000000000003","title":"Cell membrane transport","topic":"Osmosis","kind":"topic","sourceMode":"yova_generated","studyMode":"inside_yova","status":"active","rationale":"Preview a plan activated without reviewed edits.","sessions":[
  {"id":"c2000000-0000-4000-8000-000000000004","sequence":1,"title":"Learn osmosis","objective":"Explain water movement.","method":"Feynman Technique","methodReason":"Explain it simply.","scheduledFor":"2030-06-03T15:00:00.000Z","estimatedMinutes":25,"status":"upcoming","amountLabel":"One explanation","learningMode":"learn"},
  {"id":"c2000000-0000-4000-8000-000000000005","sequence":2,"title":"Practice diffusion","objective":"Predict particle movement.","method":"Practice Problems","methodReason":"Apply the rule.","scheduledFor":"2030-06-04T15:00:00.000Z","estimatedMinutes":25,"status":"upcoming","amountLabel":"Five problems","learningMode":"study","revisionEditedFields":null},
  {"id":"c2000000-0000-4000-8000-000000000006","sequence":3,"title":"Review transport","objective":"Compare transport types.","method":"Concept Mapping","methodReason":"Connect the ideas.","scheduledFor":"2030-06-05T15:00:00.000Z","estimatedMinutes":15,"status":"upcoming","amountLabel":"One map","learningMode":"study","revisionEditedFields":["scheduledFor"]}
]}'::jsonb);

select extensions.is((select step_data->'revisionEditedFields' from public.plan_sessions where id='c2000000-0000-4000-8000-000000000004'),'[]'::jsonb,'activation without reviewed edits stores an empty list, not null');
select extensions.is((select step_data->'revisionEditedFields' from public.plan_sessions where id='c2000000-0000-4000-8000-000000000005'),'[]'::jsonb,'activation of an explicit null stores an empty list');
select extensions.is((select step_data->'revisionEditedFields' from public.plan_sessions where id='c2000000-0000-4000-8000-000000000006'),'["scheduledFor"]'::jsonb,'activation still retains reviewed edits');

-- A row saved between 202609090001 and this fix, exactly as production holds it.
insert into public.plan_sessions(id,user_id,plan_id,sequence,title,objective,method,method_rationale,estimated_minutes,status,step_data)
values ('c2000000-0000-4000-8000-000000000007','c2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002',4,'Earlier null row','Explain active transport.','Active Recall','Recall the steps.',25,'upcoming','{"amountLabel":"One recall","learningMode":"study","revisionEditedFields":null}');

create temporary table context as select public.read_plan_revision_context('c2000000-0000-4000-8000-000000000002') as value;
select extensions.ok((select bool_and(jsonb_typeof(p->'editedFields')='array') from context, jsonb_array_elements(value->'protections') p),'every protection returns an edit list the preview can read');
select extensions.is((select p->'editedFields' from context, jsonb_array_elements(value->'protections') p where p->>'sessionId'='c2000000-0000-4000-8000-000000000007'),'[]'::jsonb,'an already stored null reads as no reviewed edits');
select extensions.is((select (p->>'pinnedTime')::boolean from context, jsonb_array_elements(value->'protections') p where p->>'sessionId'='c2000000-0000-4000-8000-000000000007'),false,'an already stored null does not pin the session time');
select extensions.ok(not exists(select 1 from context, jsonb_array_elements(value#>'{plan,sessions}') s where jsonb_typeof(s->'revisionEditedFields')='null'),'no plan session carries a null edit list');

select extensions.ok(has_function_privilege('authenticated','public.read_plan_revision_context(uuid)','execute'),'the signed-in learner can still read their revision context');
select extensions.ok(not has_function_privilege('anon','public.read_plan_revision_context(uuid)','execute'),'a signed-out visitor still cannot read revision context');
select * from extensions.finish();
rollback;
