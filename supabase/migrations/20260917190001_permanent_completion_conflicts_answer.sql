-- A permanent completion refusal must answer the learner, not hang.
--
-- CI #420 proved the failure: a completion conflict raised by the locked
-- writer never returns. One request is sent, no reply ever arrives, the same
-- statement restarts every few seconds, and a second attempt ends up waiting
-- on the first one's advisory lock. The probe case
-- `answers a completion conflict instead of leaving the request open` timed
-- out exactly like the tampered-replay case, so this is every refusal, not one
-- code path.
--
-- The cause is the SQLSTATE. These refusals are deterministic and permanent --
-- the stored attempt genuinely differs, or the session genuinely is not ready
-- -- but they are raised as '40001', PostgreSQL's serialization failure, which
-- means "transient, retry me". The stack in front obliges, indefinitely.
--
-- PostgREST maps SQLSTATE 'PTxyz' to HTTP status xyz and returns "code":"PTxyz"
-- in the body, so 'PT409' answers a permanent conflict as HTTP 409 Conflict and
-- ends the request. Genuine serialization failures elsewhere keep '40001' and
-- stay retryable: only the messages listed here, which the client already
-- classifies as permanent, change.
--
-- Rows, locks, ordering, validation and every other check are untouched; this
-- migration only changes how these refusals are reported.
do $migration$
declare
  permanent text := 'study_route_completion_retry_conflict|study_route_completion_conflict'
    || '|study_route_completion_event_conflict|study_route_completion_session_not_ready'
    || '|study_route_evidence_conflict|study_route_revision_conflict'
    || '|post_session_study_route_coverage_conflict|post_session_adaptation_target_conflict'
    || '|study_route_interruption_conflict|study_route_interruption_event_conflict';
  pattern text := 'errcode = ''40001''(\s*,\s*message = ''(' || permanent || ')'')';
  routine record;
  definition text;
  rewritten text;
  changed integer := 0;
begin
  for routine in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosrc ~ pattern
    order by p.oid::regprocedure::text
  loop
    definition := pg_catalog.pg_get_functiondef(routine.signature);
    rewritten := regexp_replace(definition, pattern, 'errcode = ''PT409''\1', 'g');
    if rewritten = definition then
      raise exception 'Permanent conflict rewrite matched % in its source but not its definition', routine.signature;
    end if;
    execute rewritten;
    changed := changed + 1;
  end loop;

  -- Already applied, or the writers moved: either way, never leave a partial
  -- rewrite behind or claim a change that did not happen.
  if changed = 0 and not exists (
    select 1
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%PT409%'
  ) then
    raise exception 'No completion writer raises a permanent conflict; the rewrite anchors are gone';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~ pattern
  ) then
    raise exception 'A permanent completion conflict still reports a serialization failure';
  end if;
end;
$migration$;

-- The readiness contract advances: a deployment whose database still hangs on
-- these refusals must not be treated as ready.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('public.signed_in_generation_readiness_v6()'::regprocedure);
  anchor text := $anchor$'topicSegmentCompletions',position('validate_topic_segment_completion_v1(current_session.step_data, payload)' in pg_catalog.pg_get_functiondef('public.complete_plan_session_with_route(jsonb)'::regprocedure))>0$anchor$;
  probe text := $probe$position('PT409' in pg_catalog.pg_get_functiondef('public.complete_plan_session_with_route(jsonb)'::regprocedure))>0$probe$;
begin
  if position('permanentConflictsAnswer' in definition)>0 then return; end if;
  if position(anchor in definition)=0 then raise exception 'Permanent conflict readiness patch did not match'; end if;
  definition := replace(definition, anchor, anchor || ',
    ''permanentConflictsAnswer'',' || probe);
  definition := replace(definition, '''20260917180001''', '''20260917190001''');
  definition := replace(definition,
    'and position(''validate_topic_segment_completion_v1(current_session.step_data, payload)'' in pg_catalog.pg_get_functiondef(''public.complete_plan_session_with_route(jsonb)''::regprocedure))>0,',
    'and position(''validate_topic_segment_completion_v1(current_session.step_data, payload)'' in pg_catalog.pg_get_functiondef(''public.complete_plan_session_with_route(jsonb)''::regprocedure))>0 and ' || probe || ',');
  execute definition;
end;
$migration$;
