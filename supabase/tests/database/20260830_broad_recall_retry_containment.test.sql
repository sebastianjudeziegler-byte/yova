begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(16);

select extensions.is(
  (
    select pg_catalog.count(*)
    from supabase_migrations.schema_migrations as migration
    where migration.version = '202608300002'
  ),
  1::bigint,
  'the Broad Recall checkpoint retry-containment migration committed'
);

select extensions.is(
  (
    select pg_catalog.count(*)
    from (values
      ('public.guard_broad_recall_checkpoint_binding_v1()'),
      ('public.guard_broad_recall_attempt_binding_v1()'),
      ('public.guard_broad_recall_event_binding_v1()')
    ) as guard(signature)
    join pg_catalog.pg_proc as routine
      on routine.oid = pg_catalog.to_regprocedure(guard.signature)
    where routine.prosecdef
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
        like '%pg_catalog.jsonb_typeof(progress) is distinct from ''object''%'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
        like '%progress ->> ''kind'' is distinct from ''broad_recall''%'
  ),
  3::bigint,
  'all three security-definer guards use null-safe marker detection'
);

select extensions.ok(
  (
    select pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
      like '%when sqlstate ''40001''%'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
        like '%errcode = ''22023''%'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
        like '%if sqlerrm is distinct from ''broad_recall_progress_binding_conflict''%'
    from pg_catalog.pg_proc as routine
    where routine.oid = pg_catalog.to_regprocedure(
      'public.guard_broad_recall_checkpoint_binding_v1()'
    )
  ),
  'the checkpoint guard contains the exact retry-containment mapping'
);

select extensions.ok(
  not exists (
    select 1
    from (values
      ('public.guard_broad_recall_checkpoint_binding_v1()'),
      ('public.guard_broad_recall_attempt_binding_v1()'),
      ('public.guard_broad_recall_event_binding_v1()')
    ) as guard(signature)
    cross join (values
      ('anon'),
      ('authenticated'),
      ('service_role')
    ) as actor(role_name)
    where pg_catalog.has_function_privilege(
      actor.role_name,
      guard.signature,
      'execute'
    )
  ),
  'all three trigger guards remain unavailable to PostgREST roles'
);

create temporary table broad_recall_progress_fixture on commit drop as
select $progress$
{
  "kind": "broad_recall",
  "format": "broad_recall_v1",
  "activityIndex": 0,
  "gapCount": 1,
  "bindings": [{
    "targetId": "73000000-0000-4000-8000-000000000003",
    "evidenceId": "blurting-final-check:73000000-0000-4000-8000-000000000003"
  }],
  "events": []
}
$progress$::jsonb as progress;

create temporary table broad_recall_checkpoint_guard_fixture (
  id uuid primary key,
  user_id uuid not null,
  step_data jsonb not null
) on commit drop;

create trigger broad_recall_checkpoint_guard_fixture_trigger
before update of step_data on broad_recall_checkpoint_guard_fixture
for each row execute function public.guard_broad_recall_checkpoint_binding_v1();

insert into broad_recall_checkpoint_guard_fixture (id, user_id, step_data)
values (
  '73000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000002',
  '{}'::jsonb
);

select extensions.lives_ok(
  $statement$
    update broad_recall_checkpoint_guard_fixture
    set step_data = pg_catalog.jsonb_build_object(
      'activeSessionCheckpoint',
      pg_catalog.jsonb_build_object(
        'completedSteps', 0,
        'markerCase', 'absent'
      )
    )
  $statement$,
  'a checkpoint with no activity-progress key bypasses the Broad Recall guard'
);

select extensions.lives_ok(
  $statement$
    update broad_recall_checkpoint_guard_fixture
    set step_data = pg_catalog.jsonb_build_object(
      'activeSessionCheckpoint',
      pg_catalog.jsonb_build_object(
        'completedSteps', 0,
        'markerCase', 'json-null',
        'activityProgress', 'null'::jsonb
      )
    )
  $statement$,
  'a checkpoint with an explicit JSON null marker bypasses the Broad Recall guard'
);

create temporary table broad_recall_attempt_guard_fixture (
  id bigint generated always as identity primary key,
  result_data jsonb not null
) on commit drop;

create trigger broad_recall_attempt_guard_fixture_trigger
before insert or update of result_data on broad_recall_attempt_guard_fixture
for each row execute function public.guard_broad_recall_attempt_binding_v1();

select extensions.lives_ok(
  $statement$
    insert into broad_recall_attempt_guard_fixture (result_data)
    values ('{"status":"interrupted"}'::jsonb)
  $statement$,
  'an interrupted attempt with no activity-progress key bypasses the Broad Recall guard'
);

select extensions.lives_ok(
  $statement$
    insert into broad_recall_attempt_guard_fixture (result_data)
    values ('{"status":"interrupted","activityProgress":null}'::jsonb)
  $statement$,
  'an interrupted attempt with an explicit JSON null marker bypasses the Broad Recall guard'
);

create temporary table broad_recall_event_guard_fixture (
  id bigint generated always as identity primary key,
  event_type text not null,
  event_data jsonb not null
) on commit drop;

create trigger broad_recall_event_guard_fixture_trigger
before insert or update of event_type, event_data on broad_recall_event_guard_fixture
for each row execute function public.guard_broad_recall_event_binding_v1();

select extensions.lives_ok(
  $statement$
    insert into broad_recall_event_guard_fixture (event_type, event_data)
    values ('session_interrupted', '{"attemptId":"ordinary"}'::jsonb)
  $statement$,
  'a session_interrupted event with no activity-progress key bypasses the Broad Recall guard'
);

select extensions.lives_ok(
  $statement$
    insert into broad_recall_event_guard_fixture (event_type, event_data)
    values (
      'session_interrupted',
      '{"attemptId":"ordinary","activityProgress":null}'::jsonb
    )
  $statement$,
  'a session_interrupted event with an explicit JSON null marker bypasses the Broad Recall guard'
);

select extensions.throws_ok(
  $statement$
    update broad_recall_checkpoint_guard_fixture
    set step_data = pg_catalog.jsonb_build_object(
      'activeSessionCheckpoint',
      pg_catalog.jsonb_build_object(
        'completedSteps', 0,
        'resourceGeneratedAt', 'not-a-timestamp',
        'activityProgress', (
          select fixture.progress from broad_recall_progress_fixture as fixture
        )
      )
    )
  $statement$,
  '22023',
  'broad_recall_progress_binding_conflict',
  'malformed Broad Recall resource identity fails once without a retryable SQLSTATE'
);

select extensions.throws_ok(
  $statement$
    update broad_recall_checkpoint_guard_fixture
    set step_data = pg_catalog.jsonb_build_object(
      'activeSessionCheckpoint',
      pg_catalog.jsonb_build_object(
        'completedSteps', 0,
        'resourceGeneratedAt', '2026-08-30T18:00:00.000Z',
        'activityProgress', (
          select fixture.progress from broad_recall_progress_fixture as fixture
        )
      )
    )
  $statement$,
  '22023',
  'broad_recall_progress_binding_conflict',
  'an actual Broad Recall checkpoint still reaches the route/resource helper and fails closed'
);

select extensions.throws_ok(
  $statement$
    update broad_recall_checkpoint_guard_fixture
    set step_data = pg_catalog.jsonb_build_object(
      'activeSessionCheckpoint',
      pg_catalog.jsonb_build_object(
        'completedSteps', 0,
        'resourceGeneratedAt', '2026-08-30T18:00:00.000Z',
        'evidence', '{}'::jsonb,
        'activityProgress', (
          select fixture.progress from broad_recall_progress_fixture as fixture
        )
      )
    )
  $statement$,
  '22023',
  'broad_recall_unverified_evidence_forbidden',
  'unverified Broad Recall evidence remains fail closed without a retryable SQLSTATE'
);

select extensions.throws_ok(
  $statement$
    insert into broad_recall_attempt_guard_fixture (result_data)
    select pg_catalog.jsonb_build_object(
      'status', 'interrupted',
      'activityProgress', fixture.progress
    )
    from broad_recall_progress_fixture as fixture
  $statement$,
  '55000',
  'broad_recall_interruption_resource_identity_required',
  'an actual Broad Recall attempt remains fail closed'
);

select extensions.throws_ok(
  $statement$
    insert into broad_recall_event_guard_fixture (event_type, event_data)
    select
      'session_interrupted',
      pg_catalog.jsonb_build_object(
        'attemptId', 'broad',
        'activityProgress', fixture.progress
      )
    from broad_recall_progress_fixture as fixture
  $statement$,
  '55000',
  'broad_recall_interruption_resource_identity_required',
  'an actual Broad Recall interruption event remains fail closed'
);

update broad_recall_checkpoint_guard_fixture
set step_data = pg_catalog.jsonb_build_object(
  'activeSessionCheckpoint',
  pg_catalog.jsonb_build_object(
    'activityProgress', pg_catalog.jsonb_build_object(
      'kind', 'retrieval_round',
      'activityIndex', 0,
      'promptCount', 3,
      'ratings', pg_catalog.jsonb_build_array('got_it')
    )
  )
);

select extensions.is(
  (
    select fixture.step_data
      #>> '{activeSessionCheckpoint,activityProgress,kind}'
    from broad_recall_checkpoint_guard_fixture as fixture
  ),
  'retrieval_round',
  'ordinary retrieval checkpoints remain outside the Broad Recall guard'
);

select * from extensions.finish();
rollback;
