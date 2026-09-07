begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select extensions.plan(9);

select extensions.ok(
  not has_any_column_privilege('authenticated', 'public.plans', 'update'),
  'a browser cannot PATCH a topic into demonstrated knowledge'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.update_plan_diagnostic_knowledge_map_v1(uuid,jsonb)', 'execute'),
  'the old client-scored placement writer is closed'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.save_server_scored_plan_diagnostic_v1(uuid,uuid,jsonb,jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.save_server_scored_plan_diagnostic_v1(uuid,uuid,jsonb,jsonb)', 'execute'),
  'only the scoring server can save placement evidence'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.claim_placement_scoring_v1(uuid,text,text,timestamptz)', 'execute'),
  'a browser cannot reserve a forged scoring receipt'
);

insert into auth.users(id,email) values('ac019a71-c66a-4bfc-80e3-ab35a89e0071','placement-integrity@example.com');
select set_config('request.jwt.claim.role','service_role',true);
select extensions.is(
  public.claim_placement_scoring_v1('ac019a71-c66a-4bfc-80e3-ab35a89e0071',repeat('a',64),repeat('b',64),now()+interval '30 minutes'),
  true, 'the first submitted answers can be scored'
);
select extensions.is(
  public.claim_placement_scoring_v1('ac019a71-c66a-4bfc-80e3-ab35a89e0071',repeat('a',64),repeat('b',64),now()+interval '30 minutes'),
  true, 'a lost response can retry the same answers'
);
select extensions.is(
  public.claim_placement_scoring_v1('ac019a71-c66a-4bfc-80e3-ab35a89e0071',repeat('a',64),repeat('c',64),now()+interval '30 minutes'),
  false, 'changing answers cannot fish for demonstrated status on the same check'
);
select extensions.ok(
  (public.signed_in_generation_readiness_v4()->>'placementEvidenceBoundary')::boolean
  and (public.signed_in_generation_readiness_v4()->>'unansweredCompletionFeedback')::boolean,
  'release readiness requires server placement and an unanswered completion rating'
);
select extensions.ok(
  (public.public_launch_abuse_readiness_v1()->>'untrustedInsertQuotas')::boolean,
  'the launch quota probe recognizes the replacement server scoring path'
);
select * from extensions.finish();
rollback;
