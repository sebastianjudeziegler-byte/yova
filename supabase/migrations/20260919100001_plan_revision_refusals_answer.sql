-- A refused plan change or Undo must answer the learner, not hang.
--
-- Brief 2.5 root cause 3, audit finding 16: Undo hung for more than a minute
-- and the plan was not restored after a reload. The revision writer,
-- apply_plan_revision, raises its deterministic refusals -- the plan moved on
-- (obsolete preview), a changed or missing session, saved work, a source that
-- expired, capacity that changed, a retry whose content differs -- as SQLSTATE
-- 40001. That is PostgreSQL's serialization failure, "transient, retry me", and
-- the stack in front of the database retries it indefinitely, exactly as
-- 20260917190001 found for completions. Nothing commits, so the reload shows
-- the unchanged plan. docs/audits/BACKLOG.md kept this as an open question
-- after 20260917190001; this is the answer.
--
-- These refusals are permanent for the request that hit them, so they are
-- raised as PT409, which PostgREST answers as HTTP 409 Conflict. Rows, locks,
-- ordering and every check are untouched; only the reported code changes.
do $migration$
declare
  pattern text := 'errcode\s*=\s*''40001''(\s*,\s*message\s*=\s*''plan_revision_[a-z_]+'')';
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
    rewritten := regexp_replace(definition, pattern, 'errcode=''PT409''\1', 'g');
    if rewritten = definition then
      raise exception 'Plan revision refusal rewrite matched % in its source but not its definition', routine.signature;
    end if;
    execute rewritten;
    changed := changed + 1;
  end loop;

  if changed = 0 and position('PT409' in pg_catalog.pg_get_functiondef('public.apply_plan_revision(uuid,jsonb)'::regprocedure)) = 0 then
    raise exception 'The plan revision writer raises no refusal; the rewrite anchors are gone';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~ pattern
  ) then
    raise exception 'A plan revision refusal still reports a serialization failure';
  end if;
end;
$migration$;

-- The readiness contract advances: a deployment whose database still hangs on
-- a refused plan change or Undo must not be treated as ready.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('public.signed_in_generation_readiness_v6()'::regprocedure);
  anchor text := $anchor$'permanentConflictsAnswer',position('PT409' in pg_catalog.pg_get_functiondef('public.complete_plan_session_with_route(jsonb)'::regprocedure))>0$anchor$;
  probe text := $probe$(position('PT409' in pg_catalog.pg_get_functiondef('public.apply_plan_revision(uuid,jsonb)'::regprocedure))>0 and pg_catalog.pg_get_functiondef('public.apply_plan_revision(uuid,jsonb)'::regprocedure) !~ 'errcode\s*=\s*''40001''\s*,\s*message\s*=\s*''plan_revision_')$probe$;
begin
  if position('planRevisionRefusalsAnswer' in definition)>0 then return; end if;
  if position(anchor in definition)=0 then raise exception 'Plan revision refusal readiness patch did not match'; end if;
  definition := replace(definition, anchor, anchor || ',
    ''planRevisionRefusalsAnswer'',' || probe);
  definition := replace(definition, '''20260917190001''', '''20260919100001''');
  definition := replace(definition,
    'and position(''PT409'' in pg_catalog.pg_get_functiondef(''public.complete_plan_session_with_route(jsonb)''::regprocedure))>0,',
    'and position(''PT409'' in pg_catalog.pg_get_functiondef(''public.complete_plan_session_with_route(jsonb)''::regprocedure))>0 and ' || probe || ',');
  -- The key and the ready clause must both carry the probe, and the version
  -- must advance; a partial patch would claim readiness it does not check.
  if (length(definition) - length(replace(definition, probe, ''))) / length(probe) < 2
    or position('''20260919100001''' in definition) = 0 then
    raise exception 'Plan revision refusal readiness patch applied only partly';
  end if;
  execute definition;
end;
$migration$;
