-- Runtime content and checked progress only. No topic-map, composition,
-- scheduling or revision algorithm changes.
create table private.session_work_blocks (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  plan_session_id uuid not null references public.plan_sessions(id) on delete cascade,
  route_revision_id uuid not null,
  resource jsonb not null,
  answer_keys jsonb not null check (jsonb_typeof(answer_keys) = 'array'),
  progress jsonb not null,
  progress_version integer not null default 0,
  completion_summary jsonb,
  created_at timestamptz not null default now(),
  unique (plan_session_id, route_revision_id)
);
alter table private.session_work_blocks enable row level security;
revoke all on private.session_work_blocks from public, anon, authenticated, service_role;

alter function public.cache_generated_session(jsonb) rename to cache_generated_session_before_blocks_v1;
revoke all on function public.cache_generated_session_before_blocks_v1(jsonb) from public, anon, authenticated, service_role;
create function public.cache_generated_session(payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if payload #>> '{generatedSession,schemaVersion}' = '19'
    or exists(select 1 from public.plan_sessions s where s.id = (payload->>'planSessionId')::uuid
      and s.user_id = auth.uid() and s.step_data #>> '{generatedSession,schemaVersion}' = '19') then
    raise exception using errcode='42501', message='server_prepared_block_required';
  end if;
  perform public.cache_generated_session_before_blocks_v1(payload);
end $$;
revoke all on function public.cache_generated_session(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.cache_generated_session(jsonb) to authenticated;

create function public.save_session_work_block_v1(actor_user_id uuid, payload jsonb, answer_keys jsonb, initial_progress jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  resource jsonb := payload->'generatedSession';
  block_id uuid := (resource #>> '{block,id}')::uuid;
  session_id uuid := (payload->>'planSessionId')::uuid;
  route_id uuid := (payload->>'expectedRouteRevisionId')::uuid;
  owner_plan_id uuid;
  previous_sub text := current_setting('request.jwt.claim.sub',true);
  previous_role text := current_setting('request.jwt.claim.role',true);
  existing private.session_work_blocks%rowtype;
begin
  if auth.role() is distinct from 'service_role' or actor_user_id is null then
    raise exception using errcode='42501',message='server_prepared_block_required';
  end if;
  if resource->>'schemaVersion' is distinct from '19' or block_id is null or route_id is null
    or resource #>> '{block,semanticReview,status}' is distinct from 'passed'
    or jsonb_typeof(answer_keys) is distinct from 'array'
    or initial_progress->>'blockId' is distinct from block_id::text
    or initial_progress->'attempts' is distinct from '[]'::jsonb
    or initial_progress->'complete' is distinct from 'false'::jsonb then
    raise exception using errcode='22023', message='work_block_shape_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtext('yova_learning_data'),hashtext(actor_user_id::text));
  select s.plan_id into owner_plan_id from public.plan_sessions s join public.plans p on p.id=s.plan_id
    where s.id=session_id and s.user_id=actor_user_id and p.user_id=actor_user_id
      and s.status='ready' and p.status='active' and s.committed_route_revision_id=route_id;
  if not found then raise exception using errcode='40001',message='work_block_context_changed'; end if;
  select * into existing from private.session_work_blocks b where b.plan_session_id=session_id and b.route_revision_id=route_id;
  if found then
    if existing.id=block_id and existing.resource=resource and existing.answer_keys=answer_keys then return; end if;
    raise exception using errcode='40001',message='work_block_already_prepared';
  end if;
  insert into private.session_work_blocks(id,user_id,plan_id,plan_session_id,route_revision_id,resource,answer_keys,progress)
    values(block_id,actor_user_id,owner_plan_id,session_id,route_id,resource,answer_keys,initial_progress);
  -- Delegate the actual cache write to the existing owner/context/route guard.
  perform set_config('request.jwt.claim.sub',actor_user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform public.cache_generated_session_before_blocks_v1(payload);
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  perform set_config('request.jwt.claim.role',coalesce(previous_role,''),true);
end $$;
revoke all on function public.save_session_work_block_v1(uuid,jsonb,jsonb,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_session_work_block_v1(uuid,jsonb,jsonb,jsonb) to service_role;

create function public.read_session_work_block_v1(actor_user_id uuid, requested_plan_id uuid, requested_session_id uuid, requested_route_id uuid, requested_block_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.role() is distinct from 'service_role' or actor_user_id is null then
    raise exception using errcode='42501',message='server_checked_block_required';
  end if;
  select jsonb_build_object('resource',b.resource,'answerKeys',b.answer_keys,'progress',b.progress,'progressVersion',b.progress_version)
  into result from private.session_work_blocks b join public.plan_sessions s on s.id=b.plan_session_id
  join public.plans p on p.id=b.plan_id
  where b.id=requested_block_id and b.user_id=actor_user_id and b.plan_id=requested_plan_id
    and b.plan_session_id=requested_session_id and b.route_revision_id=requested_route_id
    and s.user_id=actor_user_id and p.user_id=actor_user_id and s.committed_route_revision_id=b.route_revision_id
    and s.step_data->'generatedSession'=b.resource and p.status='active' and s.status='ready';
  if result is null then raise exception using errcode='40001',message='work_block_context_changed'; end if;
  return result;
end $$;
revoke all on function public.read_session_work_block_v1(uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_session_work_block_v1(uuid,uuid,uuid,uuid,uuid) to service_role;

create function public.save_session_work_block_progress_v1(actor_user_id uuid, requested_plan_id uuid, requested_session_id uuid, requested_route_id uuid, requested_block_id uuid, expected_version integer, requested_progress jsonb, checked_summary jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare existing jsonb; next_version integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='server_checked_block_required'; end if;
  perform pg_advisory_xact_lock(hashtext('yova_learning_data'),hashtext(actor_user_id::text));
  existing := public.read_session_work_block_v1(actor_user_id,requested_plan_id,requested_session_id,requested_route_id,requested_block_id);
  if (existing->>'progressVersion')::integer <> expected_version then raise exception using errcode='40001',message='work_block_progress_changed'; end if;
  if requested_progress->>'blockId' is distinct from requested_block_id::text
    or jsonb_typeof(requested_progress->'attempts') is distinct from 'array'
    or (existing #>> '{progress,complete}'='true' and requested_progress is distinct from existing->'progress') then
    raise exception using errcode='22023',message='work_block_progress_invalid';
  end if;
  if not (requested_progress->'attempts' @> existing #> '{progress,attempts}')
    or not (requested_progress->'sourceCompletedIds' @> existing #> '{progress,sourceCompletedIds}') then
    raise exception using errcode='40001',message='work_block_progress_cannot_erase_work';
  end if;
  if requested_progress->>'complete'='true' then
    if checked_summary is null or exists (
      select 1 from jsonb_array_elements(existing #> '{resource,block,activities}') a
      where (a->>'sourceId' is not null and not (requested_progress->'sourceCompletedIds' ? (a->>'sourceId')))
        or (a->>'kind'='ai_explanation' and not (requested_progress->'explanationCompletedIds' ? (a->>'id')))
    ) or exists (
      select 1 from jsonb_array_elements(existing #> '{resource,block,questions}') q
      where not exists(select 1 from jsonb_array_elements(requested_progress->'attempts') a where a->>'questionId'=q->>'id')
    ) then raise exception using errcode='42501',message='checked_block_completion_required'; end if;
  elsif checked_summary is not null then raise exception using errcode='22023',message='unfinished_block_has_no_summary'; end if;
  update private.session_work_blocks set progress=requested_progress, progress_version=progress_version+1,completion_summary=checked_summary
    where id=requested_block_id and progress_version=expected_version returning progress_version into next_version;
  return next_version;
end $$;
revoke all on function public.save_session_work_block_progress_v1(uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_session_work_block_progress_v1(uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb) to service_role;

alter function public.complete_plan_session_with_route(jsonb) rename to complete_plan_session_before_blocks_v1;
revoke all on function public.complete_plan_session_before_blocks_v1(jsonb) from public, anon, authenticated, service_role;
create function public.complete_plan_session_with_route(payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare stored_resource jsonb; summary jsonb; session_id uuid := (payload->>'planSessionId')::uuid;
begin
  perform pg_advisory_xact_lock(hashtext('yova_learning_data'),hashtext(auth.uid()::text));
  select step_data->'generatedSession' into stored_resource from public.plan_sessions where id=session_id and user_id=auth.uid();
  if stored_resource->>'schemaVersion'='19' then
    select b.completion_summary into summary from private.session_work_blocks b
      where b.plan_session_id=session_id and b.user_id=auth.uid() and b.resource=stored_resource
        and b.route_revision_id::text=payload->>'routeRevisionId' and b.progress->>'complete'='true';
    if summary is null then raise exception using errcode='42501',message='checked_block_completion_required'; end if;
    -- The browser chooses when to finish, never what it demonstrated.
    payload := payload || summary || jsonb_build_object('confidenceEvidence','[]'::jsonb,'completionVariant','guided');
  end if;
  return public.complete_plan_session_before_blocks_v1(payload);
end $$;
revoke all on function public.complete_plan_session_with_route(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.complete_plan_session_with_route(jsonb) to authenticated;
notify pgrst, 'reload schema';

-- Retain every existing metadata and checkpoint guard. Only a private,
-- server-prepared V19 resource may use the new activity representation. V18
-- stays reserved and rejected by this ordinary cache boundary.
create or replace function public.guard_plan_session_private_json_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  generated_session jsonb := new.step_data -> 'generatedSession';
  checkpoint jsonb := new.step_data -> 'activeSessionCheckpoint';
  route_active_minutes integer;
  requested_planned_minutes integer;
  generated_schema_version integer;
begin
  if generated_session is distinct from old.step_data -> 'generatedSession'
    and generated_session is not null then
    if pg_catalog.jsonb_typeof(generated_session) is distinct from 'object'
      or pg_catalog.octet_length(generated_session::text) > 524288 then
      raise exception using
        errcode = '22023',
        message = 'generated_session_cache_shape_invalid';
    end if;
    generated_schema_version := public.study_route_integer_v1(
      generated_session -> 'schemaVersion',
      15,
      19,
      'generated_session_cache_shape_invalid'
    );
    if generated_schema_version not in (15, 16, 17, 19)
      or pg_catalog.jsonb_typeof(generated_session -> 'model') is distinct from 'string'
      or pg_catalog.length(pg_catalog.btrim(generated_session ->> 'model')) < 1
      or pg_catalog.jsonb_typeof(generated_session -> 'generatedAt') is distinct from 'string'
      or pg_catalog.jsonb_typeof(generated_session -> 'rationale') is distinct from 'string'
      or pg_catalog.jsonb_typeof(generated_session -> 'coverage') is distinct from 'object'
      or pg_catalog.jsonb_typeof(generated_session -> 'methodBriefing') is distinct from 'object'
      or pg_catalog.jsonb_typeof(generated_session -> 'deliveryPolicy') is distinct from 'object'
      or pg_catalog.jsonb_typeof(generated_session -> 'topicIds') is distinct from 'array'
      or pg_catalog.jsonb_typeof(generated_session -> 'activities') is distinct from 'array' then
      raise exception using
        errcode = '22023',
        message = 'generated_session_cache_shape_invalid';
    end if;
    if pg_catalog.jsonb_array_length(generated_session -> 'topicIds') not between 1 and 6
      or (generated_schema_version <> 19 and pg_catalog.jsonb_array_length(generated_session -> 'activities') not between 3 and 9) then
      raise exception using
        errcode = '22023',
        message = 'generated_session_cache_shape_invalid';
    end if;
  end if;

  if generated_session is distinct from old.step_data -> 'generatedSession'
    and generated_schema_version = 19 and not exists (
      select 1 from private.session_work_blocks b where b.plan_session_id=new.id
        and b.user_id=new.user_id and b.plan_id=new.plan_id
        and b.route_revision_id=new.committed_route_revision_id and b.resource=generated_session
    ) then
    raise exception using errcode='42501',message='server_prepared_block_required';
  end if;

  if checkpoint is distinct from old.step_data -> 'activeSessionCheckpoint'
    and checkpoint is not null
    and new.committed_route_revision_id is not null then
    if pg_catalog.jsonb_typeof(checkpoint) is distinct from 'object'
      or checkpoint ->> 'routeRevisionId'
        is distinct from new.committed_route_revision_id::text then
      -- The mature V1 delegate writes first; the route-aware wrapper stamps the
      -- route receipt in a second UPDATE inside the same transaction. Permit
      -- that one receipt-less intermediate value, but never a wrong receipt.
      if checkpoint ? 'routeRevisionId' then
        raise exception using
          errcode = '40001',
          message = 'study_route_checkpoint_minutes_conflict';
      end if;
    end if;
    select (route.route_payload #>> '{timing,activeMinutes}')::integer
    into route_active_minutes
    from public.study_routes as route
    where route.route_revision_id = new.committed_route_revision_id
      and route.plan_session_id = new.id
      and route.plan_id = new.plan_id
      and route.user_id = new.user_id;
    requested_planned_minutes := public.study_route_integer_v1(
      checkpoint -> 'plannedMinutes',
      1,
      180,
      'study_route_checkpoint_minutes_conflict'
    );
    if route_active_minutes is null
      or requested_planned_minutes <> route_active_minutes then
      raise exception using
        errcode = '40001',
        message = 'study_route_checkpoint_minutes_conflict';
    end if;
  end if;
  return new;
end;
$$;
