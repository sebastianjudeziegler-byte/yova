begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select extensions.plan(4);

-- A permanent refusal must answer. Raised as SQLSTATE 40001 it reads as a
-- serialization failure, is retried in front of the database, and the learner's
-- request never returns (CI #420). PostgREST maps PT409 to HTTP 409 Conflict.
select extensions.is(
  (select count(*) from pg_catalog.pg_proc as p
   join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~ 'errcode = ''40001''(\s*,\s*message = ''(study_route_completion_retry_conflict|study_route_completion_conflict|study_route_completion_event_conflict|study_route_completion_session_not_ready|study_route_evidence_conflict|study_route_revision_conflict|post_session_study_route_coverage_conflict|post_session_adaptation_target_conflict|study_route_interruption_conflict|study_route_interruption_event_conflict)'')'),
  0::bigint,
  'no writer reports a permanent completion or interruption conflict as a serialization failure'
);

select extensions.ok(
  (select count(*) >= 2 from pg_catalog.pg_proc as p
   join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%PT409%'),
  'the completion and interruption writers raise their permanent conflicts as PT409'
);

-- Genuine serialization failures stay retryable: only the listed permanent
-- messages changed, and the ambiguous 40001 raises are untouched.
select extensions.ok(
  position('errcode = ''40001''' in pg_catalog.pg_get_functiondef('public.complete_plan_session_with_route(jsonb)'::regprocedure)) > 0,
  'ordinary serialization failures still raise 40001 and remain retryable'
);

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select extensions.ok(
  (public.signed_in_generation_readiness_v6()->>'permanentConflictsAnswer')::boolean,
  'readiness reports that permanent completion conflicts answer instead of hanging'
);

select * from extensions.finish();
rollback;
