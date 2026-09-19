-- A session save refused over its planned minutes must answer, not loop.
--
-- Production, 19 Sept 2026: the database ran at 100% CPU for hours. Postgres
-- logged `study_route_planned_minutes_conflict` (SQLSTATE 40001) many times a
-- second from `complete_plan_session_with_route`. The routed-minutes guards
-- refuse a completion whose `plannedMinutes` differs from the committed
-- route's `timing.activeMinutes` - a deterministic, permanent refusal - but
-- raise it as a serialization failure, which the stack in front of the
-- database retries indefinitely (the mechanism 20260917190001 and
-- 20260919100001 fixed for other refusals). The same save restarted without
-- end, held the per-user advisory lock, and never reached the learner as an
-- error. The app sent the session timer instead of the committed minutes
-- (fixed in the client alongside this migration).
--
-- The refusal is raised as PT409, which PostgREST answers as HTTP 409. The
-- check itself, and every other guard, is unchanged.
do $migration$
declare
  guard regprocedure;
  definition text;
  rewritten text;
  pattern text := 'errcode\s*=\s*''40001''(\s*,\s*message\s*=\s*''study_route_planned_minutes_conflict'')';
begin
  foreach guard in array array[
    'public.guard_routed_attempt_minutes_v1()'::regprocedure,
    'public.guard_routed_event_minutes_v1()'::regprocedure
  ] loop
    definition := pg_catalog.pg_get_functiondef(guard);
    rewritten := regexp_replace(definition, pattern, 'errcode = ''PT409''\1', 'g');
    if rewritten <> definition then
      execute rewritten;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~ pattern
  ) then
    raise exception 'A planned-minutes refusal still reports a serialization failure';
  end if;
end;
$migration$;
