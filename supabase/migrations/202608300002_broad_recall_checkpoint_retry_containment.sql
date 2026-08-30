-- Deterministic Broad Recall binding rejections are input/state conflicts, not
-- PostgreSQL serialization failures. Older PostgREST transaction runners can
-- retry SQLSTATE 40001 inside one HTTP request, so exposing that code from this
-- trigger can turn one rejected legacy checkpoint into an unbounded database
-- retry loop. Migration 004's three guards also used nullable `<>` predicates:
-- a row with no activityProgress therefore fell through as if it were Broad
-- Recall. Make all marker checks null-safe, keep every fail-closed check, and
-- surface known checkpoint rejections as invalid_parameter_value (22023),
-- which old clients already preserve locally as an unavailable cloud write.

begin;

create or replace function public.guard_broad_recall_checkpoint_binding_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  checkpoint jsonb := new.step_data -> 'activeSessionCheckpoint';
  progress jsonb := checkpoint -> 'activityProgress';
  completed_steps integer;
  resource_generated_at timestamptz;
begin
  if checkpoint is not distinct from old.step_data -> 'activeSessionCheckpoint'
    or pg_catalog.jsonb_typeof(progress) is distinct from 'object'
    or progress ->> 'kind' is distinct from 'broad_recall' then
    return new;
  end if;

  begin
    completed_steps := (checkpoint ->> 'completedSteps')::integer;
    resource_generated_at := (
      checkpoint ->> 'resourceGeneratedAt'
    )::timestamptz;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'broad_recall_progress_binding_conflict';
  end;

  if progress ->> 'activityIndex' is distinct from completed_steps::text then
    raise exception using
      errcode = '22023',
      message = 'broad_recall_progress_binding_conflict';
  end if;

  if checkpoint -> 'pendingRepair' is not null
    or checkpoint -> 'evidence' is not null then
    raise exception using
      errcode = '22023',
      message = 'broad_recall_unverified_evidence_forbidden';
  end if;

  begin
    perform public.assert_broad_recall_progress_binding_v1(
      new.user_id,
      new.id,
      progress,
      resource_generated_at
    );
  exception when sqlstate '40001' then
    -- Only translate the helper's deterministic business rejection. A real or
    -- unrelated serialization failure must retain its original retry signal.
    if sqlerrm is distinct from 'broad_recall_progress_binding_conflict' then
      raise;
    end if;

    raise exception using
      errcode = '22023',
      message = 'broad_recall_progress_binding_conflict';
  end;

  return new;
end;
$$;

create or replace function public.guard_broad_recall_attempt_binding_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  progress jsonb := new.result_data -> 'activityProgress';
begin
  if pg_catalog.jsonb_typeof(progress) is distinct from 'object'
    or progress ->> 'kind' is distinct from 'broad_recall' then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'broad_recall_interruption_resource_identity_required';
end;
$$;

create or replace function public.guard_broad_recall_event_binding_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  progress jsonb := new.event_data -> 'activityProgress';
begin
  if new.event_type is distinct from 'session_interrupted'
    or pg_catalog.jsonb_typeof(progress) is distinct from 'object'
    or progress ->> 'kind' is distinct from 'broad_recall' then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'broad_recall_interruption_resource_identity_required';
end;
$$;

revoke all on function public.guard_broad_recall_checkpoint_binding_v1()
from public, anon, authenticated;
revoke all on function public.guard_broad_recall_attempt_binding_v1()
from public, anon, authenticated;
revoke all on function public.guard_broad_recall_event_binding_v1()
from public, anon, authenticated;

comment on function public.guard_broad_recall_checkpoint_binding_v1() is
  'Fail-closed Broad Recall checkpoint guard. Deterministic binding rejections use 22023 so legacy PostgREST transaction runners cannot amplify them through automatic 40001 retries.';
comment on function public.guard_broad_recall_attempt_binding_v1() is
  'Fail-closed Broad Recall attempt guard. Missing or non-Broad activity progress remains outside the guard.';
comment on function public.guard_broad_recall_event_binding_v1() is
  'Fail-closed Broad Recall interruption-event guard. Missing or non-Broad activity progress remains outside the guard.';

commit;
