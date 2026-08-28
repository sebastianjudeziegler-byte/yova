-- Close the remaining StudyRoute integrity boundaries without rewriting the
-- historical migrations. All route decisions remain client-readable, while
-- only the route-aware, ownership-checked RPCs may create evidence or mutate
-- route pointers.

revoke all on function public.commit_study_route_revision(jsonb)
from public, anon, authenticated;

revoke all on table public.session_attempts, public.learning_events
from public, anon, authenticated;
grant select on table public.session_attempts, public.learning_events
to authenticated;

-- Keep the mature account writers intact, but serialize them before any of
-- their historical row-lock order begins. Reset and every route-aware writer
-- already take this same account lock first. The renamed delegates stay
-- private, while the public signatures and learner-visible behavior remain
-- unchanged.
alter function public.set_learning_plan_archive_state(jsonb) security definer;
alter function public.set_learning_plan_archive_state(jsonb)
rename to set_learning_plan_archive_state_without_account_lock_v1;

revoke all on function public.set_learning_plan_archive_state_without_account_lock_v1(jsonb)
from public, anon, authenticated;

create or replace function public.set_learning_plan_archive_state(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  return public.set_learning_plan_archive_state_without_account_lock_v1(payload);
end;
$$;

revoke all on function public.set_learning_plan_archive_state(jsonb)
from public, anon, authenticated;
grant execute on function public.set_learning_plan_archive_state(jsonb)
to authenticated;

alter function public.save_learner_profile(jsonb) security definer;
alter function public.save_learner_profile(jsonb)
rename to save_learner_profile_without_account_lock_v1;

revoke all on function public.save_learner_profile_without_account_lock_v1(jsonb)
from public, anon, authenticated;

create or replace function public.save_learner_profile(payload jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  expected_account_id uuid := nullif(payload ->> 'expectedAccountId', '')::uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if expected_account_id is null
    or expected_account_id is distinct from current_user_id then
    raise exception 'Authenticated account does not match the expected account.'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  perform public.save_learner_profile_without_account_lock_v1(payload);
end;
$$;

revoke all on function public.save_learner_profile(jsonb)
from public, anon, authenticated;
grant execute on function public.save_learner_profile(jsonb)
to authenticated;

alter function public.delete_yova_account(uuid) security definer;
alter function public.delete_yova_account(uuid)
rename to delete_yova_account_without_account_lock_v1;

revoke all on function public.delete_yova_account_without_account_lock_v1(uuid)
from public, anon, authenticated;

create or replace function public.delete_yova_account(expected_account_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null
    or expected_account_id is null
    or current_user_id <> expected_account_id then
    raise exception using
      errcode = '42501',
      message = 'account_deletion_identity_mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  return public.delete_yova_account_without_account_lock_v1(expected_account_id);
end;
$$;

revoke all on function public.delete_yova_account(uuid)
from public, anon, authenticated;
grant execute on function public.delete_yova_account(uuid)
to authenticated;

-- Take the parent-table DDL boundary before touching session/route trigger
-- metadata. Route writers lock plans before sessions and routes, so this keeps
-- migration lock acquisition in the same order. Existing plans form the fixed
-- legacy cohort; every post-migration insert receives the new default.
alter table public.plans
add column study_route_coverage_required boolean not null default false;

alter table public.plans
alter column study_route_coverage_required set default true;

-- A route snapshot may retain many deferred targets, but the executable
-- session contract exposes at most six active topic ids. Migration 005
-- projected every snapshot target, including deferred ones. Centralize the
-- active-only projection and replace those two private helpers without
-- widening the bounded session contract.
create or replace function public.study_route_active_topic_ids_v1(
  requested_route jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  projected_topic_ids jsonb;
begin
  if pg_catalog.jsonb_typeof(requested_route #> '{target,targetStates}')
      is distinct from 'array'
    or pg_catalog.jsonb_typeof(requested_route #> '{execution,deferredTargets}')
      is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'post_session_study_route_projection_invalid';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(target.value ->> 'targetId') order by target.ordinality
    ),
    '[]'::jsonb
  )
  into projected_topic_ids
  from pg_catalog.jsonb_array_elements(
    requested_route #> '{target,targetStates}'
  ) with ordinality as target(value, ordinality)
  where not exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      requested_route #> '{execution,deferredTargets}'
    ) as deferred(value)
    where deferred.value ->> 'targetId' = target.value ->> 'targetId'
  );

  return projected_topic_ids;
end;
$$;

revoke all on function public.study_route_active_topic_ids_v1(jsonb)
from public, anon, authenticated;

create or replace function public.persist_route_session_arrays(
  requested_plan_id uuid,
  requested_session_id uuid,
  requested_session jsonb,
  requested_route jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_route_revision_id uuid;
  requested_topic_ids jsonb := requested_session -> 'topicIds';
  requested_content_targets jsonb := requested_session -> 'contentTargets';
  requested_completion_evidence jsonb := requested_session -> 'completionEvidence';
  projected_topic_ids jsonb;
  projected_completion_evidence jsonb;
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'study_route_authentication_required';
  end if;

  begin
    requested_route_revision_id := (
      requested_route #>> '{identity,routeRevisionId}'
    )::uuid;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'post_session_study_route_projection_invalid';
  end;

  if pg_catalog.jsonb_typeof(requested_topic_ids) is distinct from 'array'
    or pg_catalog.jsonb_typeof(requested_content_targets) is distinct from 'array'
    or pg_catalog.jsonb_typeof(requested_completion_evidence) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'post_session_route_arrays_invalid';
  end if;

  if pg_catalog.jsonb_array_length(requested_topic_ids) not between 1 and 6
    or pg_catalog.jsonb_array_length(requested_content_targets) not between 1 and 6
    or pg_catalog.jsonb_array_length(requested_completion_evidence) not between 1 and 4
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(requested_topic_ids) as item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'string'
        or (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(requested_content_targets) as item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'string'
        or pg_catalog.length(pg_catalog.btrim(item.value #>> '{}')) not between 1 and 180
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(requested_completion_evidence) as item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'string'
        or pg_catalog.length(pg_catalog.btrim(item.value #>> '{}')) not between 1 and 220
    ) then
    raise exception using
      errcode = '22023',
      message = 'post_session_route_arrays_invalid';
  end if;

  if pg_catalog.jsonb_typeof(
      requested_route #> '{execution,completionEvidence}'
    ) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'post_session_study_route_projection_invalid';
  end if;

  projected_topic_ids := public.study_route_active_topic_ids_v1(requested_route);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(evidence.value ->> 'description')
      order by evidence.ordinality
    ),
    '[]'::jsonb
  )
  into projected_completion_evidence
  from pg_catalog.jsonb_array_elements(
    requested_route #> '{execution,completionEvidence}'
  ) with ordinality as evidence(value, ordinality);

  if requested_topic_ids is distinct from projected_topic_ids
    or requested_completion_evidence
      is distinct from projected_completion_evidence then
    raise exception using
      errcode = '40001',
      message = 'post_session_route_array_projection_conflict';
  end if;

  if exists (
    select 1
    from public.plan_sessions as session
    where session.id = requested_session_id
      and session.plan_id = requested_plan_id
      and session.user_id = current_user_id
      and (
        session.committed_route_revision_id is null
        or session.committed_route_revision_id = requested_route_revision_id
      )
      and session.step_data -> 'topicIds' is not distinct from requested_topic_ids
      and session.step_data -> 'contentTargets'
        is not distinct from requested_content_targets
      and session.step_data -> 'completionEvidence'
        is not distinct from requested_completion_evidence
  ) then
    return;
  end if;

  update public.plan_sessions as session
  set step_data = pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        coalesce(session.step_data, '{}'::jsonb),
        '{topicIds}',
        requested_topic_ids,
        true
      ),
      '{contentTargets}',
      requested_content_targets,
      true
    ),
    '{completionEvidence}',
    requested_completion_evidence,
    true
  )
  where session.id = requested_session_id
    and session.plan_id = requested_plan_id
    and session.user_id = current_user_id
    and (
      session.committed_route_revision_id is null
      or session.committed_route_revision_id = requested_route_revision_id
    );

  if not found then
    raise exception using
      errcode = '40001',
      message = 'post_session_route_array_projection_conflict';
  end if;
end;
$$;

revoke all on function public.persist_route_session_arrays(
  uuid, uuid, jsonb, jsonb
) from public, anon, authenticated;

create or replace function public.assert_committed_study_route_projection(
  requested_route jsonb,
  requested_plan_id uuid,
  requested_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_route_revision_id uuid;
  requested_active_minutes integer;
  expected_learning_mode text;
  expected_desired_outcome text;
  stored_study_mode text;
  stored_session public.plan_sessions%rowtype;
  stored_route public.study_routes%rowtype;
  projected_topic_ids jsonb;
  projected_completion_evidence jsonb;
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'study_route_authentication_required';
  end if;

  begin
    requested_route_revision_id := (
      requested_route #>> '{identity,routeRevisionId}'
    )::uuid;
    requested_active_minutes := (
      requested_route #>> '{timing,activeMinutes}'
    )::integer;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'post_session_study_route_projection_invalid';
  end;

  if requested_route #>> '{identity,planId}'
      is distinct from requested_plan_id::text
    or requested_route #>> '{identity,sessionId}'
      is distinct from requested_session_id::text
    or requested_route #>> '{identity,lifecycleStatus}'
      is distinct from 'committed' then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_projection_conflict';
  end if;

  expected_learning_mode := case requested_route #>> '{approach,mode}'
    when 'learn' then 'learn'
    when 'practice' then 'study'
    else null
  end;

  select session.*
  into stored_session
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.plan_id = requested_plan_id
    and session.user_id = current_user_id;

  if found then
    expected_desired_outcome := coalesce(
      nullif(pg_catalog.btrim(stored_session.objective), ''),
      nullif(pg_catalog.btrim(stored_session.title), ''),
      'Complete this session'
    );
    expected_desired_outcome := case
      when pg_catalog.length(expected_desired_outcome) >= 5
        then pg_catalog.left(expected_desired_outcome, 500)
      else pg_catalog.left('Learn ' || expected_desired_outcome, 500)
    end;

    select item.study_mode
    into stored_study_mode
    from public.plans as plan
    join public.learning_items as item
      on item.id = plan.learning_item_id
      and item.user_id = plan.user_id
    where plan.id = requested_plan_id
      and plan.user_id = current_user_id;
  end if;

  if not found
    or stored_session.committed_route_revision_id
      is distinct from requested_route_revision_id
    or stored_session.method
      is distinct from requested_route #>> '{approach,visibleMethodName}'
    or stored_session.method_rationale
      is distinct from requested_route #>> '{explanation,shortReason}'
    or stored_session.estimated_minutes is distinct from requested_active_minutes
    or stored_session.step_data ->> 'learningMode'
      is distinct from expected_learning_mode
    or requested_route #>> '{target,desiredOutcome}'
      is distinct from expected_desired_outcome
    or requested_route #>> '{approach,executionEnvironment}'
      is distinct from stored_study_mode then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_projection_conflict';
  end if;

  select route.*
  into stored_route
  from public.study_routes as route
  where route.route_revision_id = requested_route_revision_id
    and route.plan_session_id = requested_session_id
    and route.plan_id = requested_plan_id
    and route.user_id = current_user_id;

  if not found
    or stored_route.lifecycle <> 'committed'
    or stored_route.route_payload is distinct from requested_route - 'identity' then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_projection_conflict';
  end if;

  if pg_catalog.jsonb_typeof(stored_session.step_data -> 'topicIds')
      is distinct from 'array'
    or pg_catalog.jsonb_typeof(
      requested_route #> '{execution,completionEvidence}'
    ) is distinct from 'array'
    or pg_catalog.jsonb_typeof(
      stored_session.step_data -> 'completionEvidence'
    ) is distinct from 'array' then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_projection_conflict';
  end if;

  projected_topic_ids := public.study_route_active_topic_ids_v1(requested_route);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(evidence.value ->> 'description')
      order by evidence.ordinality
    ),
    '[]'::jsonb
  )
  into projected_completion_evidence
  from pg_catalog.jsonb_array_elements(
    requested_route #> '{execution,completionEvidence}'
  ) with ordinality as evidence(value, ordinality);

  if projected_topic_ids is distinct from stored_session.step_data -> 'topicIds'
    or projected_completion_evidence
      is distinct from stored_session.step_data -> 'completionEvidence' then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_projection_conflict';
  end if;
end;
$$;

revoke all on function public.assert_committed_study_route_projection(
  jsonb, uuid, uuid
) from public, anon, authenticated;

-- Small private validators keep the row trigger readable. They deliberately
-- normalize validation failures to SQLSTATE 22023 instead of exposing cast or
-- JSON traversal errors to callers.
create or replace function public.study_route_assert_object_v1(
  candidate jsonb,
  required_keys text[],
  allowed_keys text[],
  error_message text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  required_key text;
begin
  if pg_catalog.jsonb_typeof(candidate) is distinct from 'object' then
    raise exception using errcode = '22023', message = error_message;
  end if;

  foreach required_key in array required_keys loop
    if not (candidate ? required_key) then
      raise exception using errcode = '22023', message = error_message;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(candidate) as candidate_key(key)
    where not (candidate_key.key = any(allowed_keys))
  ) then
    raise exception using errcode = '22023', message = error_message;
  end if;
end;
$$;

create or replace function public.study_route_text_v1(
  candidate jsonb,
  minimum_length integer,
  maximum_length integer,
  error_message text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  parsed text;
begin
  if pg_catalog.jsonb_typeof(candidate) is distinct from 'string' then
    raise exception using errcode = '22023', message = error_message;
  end if;
  parsed := pg_catalog.btrim(candidate #>> '{}');
  if pg_catalog.length(parsed) not between minimum_length and maximum_length then
    raise exception using errcode = '22023', message = error_message;
  end if;
  return parsed;
end;
$$;

create or replace function public.study_route_integer_v1(
  candidate jsonb,
  minimum_value integer,
  maximum_value integer,
  error_message text
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  parsed numeric;
begin
  if pg_catalog.jsonb_typeof(candidate) is distinct from 'number' then
    raise exception using errcode = '22023', message = error_message;
  end if;
  begin
    parsed := (candidate #>> '{}')::numeric;
  exception when others then
    raise exception using errcode = '22023', message = error_message;
  end;
  if parsed <> pg_catalog.trunc(parsed)
    or parsed not between minimum_value and maximum_value then
    raise exception using errcode = '22023', message = error_message;
  end if;
  return parsed::integer;
end;
$$;

create or replace function public.study_route_uuid_v1(
  candidate jsonb,
  error_message text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  raw_uuid text;
  parsed uuid;
begin
  if pg_catalog.jsonb_typeof(candidate) is distinct from 'string' then
    raise exception using errcode = '22023', message = error_message;
  end if;
  raw_uuid := candidate #>> '{}';
  if raw_uuid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = error_message;
  end if;
  begin
    parsed := raw_uuid::uuid;
  exception when others then
    raise exception using errcode = '22023', message = error_message;
  end;
  return parsed;
end;
$$;

create or replace function public.study_route_timestamp_v1(
  candidate jsonb,
  error_message text
)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  raw_timestamp text;
  parsed timestamptz;
begin
  if pg_catalog.jsonb_typeof(candidate) is distinct from 'string' then
    raise exception using errcode = '22023', message = error_message;
  end if;
  raw_timestamp := candidate #>> '{}';
  if raw_timestamp !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception using errcode = '22023', message = error_message;
  end if;
  begin
    parsed := raw_timestamp::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = error_message;
  end;
  return parsed;
end;
$$;

create or replace function public.study_route_assert_string_array_v1(
  candidate jsonb,
  minimum_count integer,
  maximum_count integer,
  minimum_length integer,
  maximum_length integer,
  require_unique boolean,
  error_message text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  entry jsonb;
  parsed text;
  seen text[] := '{}'::text[];
begin
  if pg_catalog.jsonb_typeof(candidate) is distinct from 'array' then
    raise exception using errcode = '22023', message = error_message;
  end if;
  if pg_catalog.jsonb_array_length(candidate)
      not between minimum_count and maximum_count then
    raise exception using errcode = '22023', message = error_message;
  end if;

  for entry in
    select element.value
    from pg_catalog.jsonb_array_elements(candidate) as element(value)
  loop
    parsed := public.study_route_text_v1(
      entry,
      minimum_length,
      maximum_length,
      error_message
    );
    if require_unique and parsed = any(seen) then
      raise exception using errcode = '22023', message = error_message;
    end if;
    seen := pg_catalog.array_append(seen, parsed);
  end loop;
end;
$$;

revoke all on function public.study_route_assert_object_v1(jsonb, text[], text[], text)
from public, anon, authenticated;
revoke all on function public.study_route_text_v1(jsonb, integer, integer, text)
from public, anon, authenticated;
revoke all on function public.study_route_integer_v1(jsonb, integer, integer, text)
from public, anon, authenticated;
revoke all on function public.study_route_uuid_v1(jsonb, text)
from public, anon, authenticated;
revoke all on function public.study_route_timestamp_v1(jsonb, text)
from public, anon, authenticated;
revoke all on function public.study_route_assert_string_array_v1(
  jsonb, integer, integer, integer, integer, boolean, text
) from public, anon, authenticated;

create or replace function public.assert_study_route_payload_v1(
  route_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target jsonb;
  approach jsonb;
  timing jsonb;
  execution jsonb;
  agency jsonb;
  explanation jsonb;
  provenance jsonb;
  source_requirements jsonb;
  target_state jsonb;
  next_review jsonb;
  phase jsonb;
  completion_item jsonb;
  deferred_target jsonb;
  alternative jsonb;
  route_override jsonb;
  rule_trace_entry jsonb;
  array_entry jsonb;
  target_id uuid;
  target_ids uuid[] := '{}'::uuid[];
  phase_target_ids uuid[];
  deferred_ids uuid[] := '{}'::uuid[];
  covered_ids uuid[] := '{}'::uuid[];
  evidence_target_ids uuid[];
  phase_id text;
  phase_ids text[] := '{}'::text[];
  evidence_id text;
  evidence_ids text[] := '{}'::text[];
  alternative_id text;
  alternative_ids text[] := '{}'::text[];
  alternative_signature text;
  alternative_signatures text[] := '{}'::text[];
  primary_signature text;
  changed_field text;
  changed_fields text[] := '{}'::text[];
  active_minutes integer;
  elapsed_minutes integer;
  hard_maximum_minutes integer;
  break_minutes integer := 0;
  phase_minutes integer := 0;
  phase_active_minutes integer;
  activity_limit integer;
  scheduled_for timestamptz;
  last_observed_at timestamptz;
  phase_ordinality integer := 0;
  break_phase_ordinality integer;
  active_target_count integer := 0;
begin
  perform public.study_route_assert_object_v1(
    route_payload,
    array['target', 'approach', 'timing', 'execution', 'agency', 'explanation', 'provenance'],
    array['target', 'approach', 'timing', 'execution', 'agency', 'explanation', 'provenance'],
    'study_route_semantic_root_invalid'
  );

  target := route_payload -> 'target';
  approach := route_payload -> 'approach';
  timing := route_payload -> 'timing';
  execution := route_payload -> 'execution';
  agency := route_payload -> 'agency';
  explanation := route_payload -> 'explanation';
  provenance := route_payload -> 'provenance';

  perform public.study_route_assert_object_v1(
    target,
    array['taskFamily', 'desiredOutcome', 'targetStates', 'sourceRequirements'],
    array['taskFamily', 'desiredOutcome', 'targetStates', 'sourceRequirements'],
    'study_route_semantic_target_invalid'
  );
  if target ->> 'taskFamily' not in (
    'memorization', 'conceptual_learning', 'problem_solving',
    'reading_to_quiz', 'writing_argumentation', 'programming',
    'mixed_assessment'
  ) or pg_catalog.jsonb_typeof(target -> 'taskFamily') is distinct from 'string' then
    raise exception using errcode = '22023', message = 'study_route_semantic_target_invalid';
  end if;
  perform public.study_route_text_v1(
    target -> 'desiredOutcome', 5, 500, 'study_route_semantic_target_invalid'
  );
  if pg_catalog.jsonb_typeof(target -> 'targetStates') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'study_route_semantic_target_invalid';
  end if;
  if pg_catalog.jsonb_array_length(target -> 'targetStates') not between 1 and 40 then
    raise exception using errcode = '22023', message = 'study_route_semantic_target_invalid';
  end if;

  for target_state in
    select element.value
    from pg_catalog.jsonb_array_elements(target -> 'targetStates') as element(value)
  loop
    perform public.study_route_assert_object_v1(
      target_state,
      array['targetId', 'stage', 'uncertainty', 'evidenceRefs'],
      array['targetId', 'stage', 'uncertainty', 'evidenceRefs', 'lastObservedAt', 'nextReview'],
      'study_route_semantic_target_state_invalid'
    );
    target_id := public.study_route_uuid_v1(
      target_state -> 'targetId', 'study_route_semantic_target_state_invalid'
    );
    if target_id = any(target_ids) then
      raise exception using errcode = '22023', message = 'study_route_semantic_target_state_invalid';
    end if;
    target_ids := pg_catalog.array_append(target_ids, target_id);
    if pg_catalog.jsonb_typeof(target_state -> 'stage') is distinct from 'string'
      or target_state ->> 'stage' not in ('novice', 'developing', 'retrieval_ready')
      or pg_catalog.jsonb_typeof(target_state -> 'uncertainty') is distinct from 'string'
      or target_state ->> 'uncertainty' not in ('unknown', 'high', 'medium', 'low') then
      raise exception using errcode = '22023', message = 'study_route_semantic_target_state_invalid';
    end if;
    perform public.study_route_assert_string_array_v1(
      target_state -> 'evidenceRefs', 0, 40, 1, 200, true,
      'study_route_semantic_target_state_invalid'
    );

    last_observed_at := null;
    if target_state ? 'lastObservedAt' then
      last_observed_at := public.study_route_timestamp_v1(
        target_state -> 'lastObservedAt', 'study_route_semantic_target_state_invalid'
      );
    end if;
    if target_state ? 'nextReview' then
      next_review := target_state -> 'nextReview';
      perform public.study_route_assert_object_v1(
        next_review,
        array['scheduledFor', 'reviewType', 'activeMinutes', 'reason', 'evidenceRefs'],
        array['scheduledFor', 'reviewType', 'activeMinutes', 'reason', 'evidenceRefs'],
        'study_route_semantic_review_invalid'
      );
      scheduled_for := public.study_route_timestamp_v1(
        next_review -> 'scheduledFor', 'study_route_semantic_review_invalid'
      );
      if pg_catalog.jsonb_typeof(next_review -> 'reviewType') is distinct from 'string'
        or next_review ->> 'reviewType' not in ('retrieval_check', 'transfer_check') then
        raise exception using errcode = '22023', message = 'study_route_semantic_review_invalid';
      end if;
      perform public.study_route_integer_v1(
        next_review -> 'activeMinutes', 2, 5, 'study_route_semantic_review_invalid'
      );
      perform public.study_route_text_v1(
        next_review -> 'reason', 8, 300, 'study_route_semantic_review_invalid'
      );
      perform public.study_route_assert_string_array_v1(
        next_review -> 'evidenceRefs', 0, 40, 1, 200, true,
        'study_route_semantic_review_invalid'
      );
      if last_observed_at is not null and scheduled_for <= last_observed_at then
        raise exception using errcode = '22023', message = 'study_route_semantic_review_invalid';
      end if;
    end if;
  end loop;

  source_requirements := target -> 'sourceRequirements';
  perform public.study_route_assert_object_v1(
    source_requirements,
    array['sourceType', 'requiredSourceIds', 'groundingRequired', 'instructions'],
    array['sourceType', 'requiredSourceIds', 'groundingRequired', 'instructions'],
    'study_route_semantic_source_invalid'
  );
  if pg_catalog.jsonb_typeof(source_requirements -> 'sourceType') is distinct from 'string'
    or source_requirements ->> 'sourceType' not in (
      'user_materials', 'yova_generated', 'trusted_external_source'
    )
    or pg_catalog.jsonb_typeof(source_requirements -> 'groundingRequired')
      is distinct from 'boolean' then
    raise exception using errcode = '22023', message = 'study_route_semantic_source_invalid';
  end if;
  perform public.study_route_assert_string_array_v1(
    source_requirements -> 'requiredSourceIds', 0, 20, 1, 200, true,
    'study_route_semantic_source_invalid'
  );
  if source_requirements ->> 'sourceType' <> 'yova_generated'
    and pg_catalog.jsonb_array_length(source_requirements -> 'requiredSourceIds') = 0 then
    raise exception using errcode = '22023', message = 'study_route_semantic_source_invalid';
  end if;
  if source_requirements ->> 'sourceType' = 'yova_generated'
    and pg_catalog.jsonb_array_length(source_requirements -> 'requiredSourceIds') <> 0 then
    raise exception using errcode = '22023', message = 'study_route_semantic_source_invalid';
  end if;
  perform public.study_route_assert_string_array_v1(
    source_requirements -> 'instructions', 0, 10, 5, 300, false,
    'study_route_semantic_source_invalid'
  );

  perform public.study_route_assert_object_v1(
    approach,
    array['mode', 'executionEnvironment', 'primaryMethodId', 'visibleMethodName', 'confidenceLevel'],
    array['mode', 'executionEnvironment', 'primaryMethodId', 'visibleMethodName', 'visibleSupportingTechniqueId', 'confidenceLevel'],
    'study_route_semantic_approach_invalid'
  );
  if pg_catalog.jsonb_typeof(approach -> 'mode') is distinct from 'string'
    or approach ->> 'mode' not in ('learn', 'practice')
    or pg_catalog.jsonb_typeof(approach -> 'executionEnvironment') is distinct from 'string'
    or approach ->> 'executionEnvironment' not in ('inside_yova', 'outside_yova')
    or pg_catalog.jsonb_typeof(approach -> 'primaryMethodId') is distinct from 'string'
    or approach ->> 'primaryMethodId' not in (
      'retrieval_practice', 'spaced_retrieval', 'self_explanation',
      'worked_example_fading', 'interleaved_practice', 'read_recall_review',
      'retrieval_based_outlining', 'scaffolded_coding',
      'practice_test_error_repair'
    )
    or pg_catalog.jsonb_typeof(approach -> 'confidenceLevel') is distinct from 'string'
    or approach ->> 'confidenceLevel' not in ('unknown', 'low', 'medium', 'high') then
    raise exception using errcode = '22023', message = 'study_route_semantic_approach_invalid';
  end if;
  perform public.study_route_text_v1(
    approach -> 'visibleMethodName', 2, 90, 'study_route_semantic_approach_invalid'
  );
  if approach ? 'visibleSupportingTechniqueId' then
    perform public.study_route_text_v1(
      approach -> 'visibleSupportingTechniqueId', 1, 200,
      'study_route_semantic_approach_invalid'
    );
  end if;
  if source_requirements ->> 'sourceType' = 'trusted_external_source'
    and approach ->> 'executionEnvironment' <> 'outside_yova' then
    raise exception using errcode = '22023', message = 'study_route_semantic_source_invalid';
  end if;

  perform public.study_route_assert_object_v1(
    timing,
    array['activeMinutes', 'elapsedMinutes', 'durationSource'],
    array['activeMinutes', 'elapsedMinutes', 'durationSource', 'hardMaximumMinutes', 'optionalTimedBreak'],
    'study_route_semantic_timing_invalid'
  );
  active_minutes := public.study_route_integer_v1(
    timing -> 'activeMinutes', 5, 180, 'study_route_semantic_timing_invalid'
  );
  elapsed_minutes := public.study_route_integer_v1(
    timing -> 'elapsedMinutes', 1, 240, 'study_route_semantic_timing_invalid'
  );
  if pg_catalog.jsonb_typeof(timing -> 'durationSource') is distinct from 'string'
    or timing ->> 'durationSource' not in (
      'router_default', 'profile_recommendation', 'observed_outcome_adjustment',
      'availability_cap',
      'learner_override', 'scheduled_review', 'legacy_reconstruction'
    ) then
    raise exception using errcode = '22023', message = 'study_route_semantic_timing_invalid';
  end if;
  hard_maximum_minutes := null;
  if timing ? 'hardMaximumMinutes' then
    hard_maximum_minutes := public.study_route_integer_v1(
      timing -> 'hardMaximumMinutes', 1, 240, 'study_route_semantic_timing_invalid'
    );
  end if;
  break_minutes := 0;
  if timing ? 'optionalTimedBreak' then
    perform public.study_route_assert_object_v1(
      timing -> 'optionalTimedBreak',
      array['minutes', 'afterPhaseId'],
      array['minutes', 'afterPhaseId'],
      'study_route_semantic_break_invalid'
    );
    break_minutes := public.study_route_integer_v1(
      timing #> '{optionalTimedBreak,minutes}', 1, 30,
      'study_route_semantic_break_invalid'
    );
    perform public.study_route_text_v1(
      timing #> '{optionalTimedBreak,afterPhaseId}', 1, 200,
      'study_route_semantic_break_invalid'
    );
  end if;
  if elapsed_minutes <> active_minutes + break_minutes
    or (hard_maximum_minutes is not null and elapsed_minutes > hard_maximum_minutes) then
    raise exception using errcode = '22023', message = 'study_route_semantic_timing_invalid';
  end if;

  perform public.study_route_assert_object_v1(
    execution,
    array['orderedPhases', 'difficultyTier', 'initialSupport', 'activityLimit', 'completionEvidence', 'deferredTargets'],
    array['orderedPhases', 'difficultyTier', 'initialSupport', 'activityLimit', 'completionEvidence', 'deferredTargets'],
    'study_route_semantic_execution_invalid'
  );
  if pg_catalog.jsonb_typeof(execution -> 'orderedPhases') is distinct from 'array'
    or pg_catalog.jsonb_typeof(execution -> 'completionEvidence') is distinct from 'array'
    or pg_catalog.jsonb_typeof(execution -> 'deferredTargets') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'study_route_semantic_execution_invalid';
  end if;
  if pg_catalog.jsonb_array_length(execution -> 'orderedPhases') not between 1 and 20
    or pg_catalog.jsonb_array_length(execution -> 'completionEvidence') not between 1 and 4
    or pg_catalog.jsonb_array_length(execution -> 'deferredTargets') not between 0 and 40
    or pg_catalog.jsonb_typeof(execution -> 'difficultyTier') is distinct from 'string'
    or execution ->> 'difficultyTier' not in ('unknown', 'foundational', 'standard', 'stretch')
    or pg_catalog.jsonb_typeof(execution -> 'initialSupport') is distinct from 'string'
    or execution ->> 'initialSupport' not in (
      'unknown', 'supported_start', 'fading', 'independent_start'
    ) then
    raise exception using errcode = '22023', message = 'study_route_semantic_execution_invalid';
  end if;
  activity_limit := public.study_route_integer_v1(
    execution -> 'activityLimit', 1, 20, 'study_route_semantic_execution_invalid'
  );

  phase_ordinality := 0;
  for phase in
    select element.value
    from pg_catalog.jsonb_array_elements(execution -> 'orderedPhases') as element(value)
  loop
    phase_ordinality := phase_ordinality + 1;
    perform public.study_route_assert_object_v1(
      phase,
      array['phaseId', 'methodPhase', 'activeMinutes', 'targetIds'],
      array['phaseId', 'methodPhase', 'activeMinutes', 'targetIds'],
      'study_route_semantic_phase_invalid'
    );
    phase_id := public.study_route_text_v1(
      phase -> 'phaseId', 1, 200, 'study_route_semantic_phase_invalid'
    );
    if phase_id = any(phase_ids) then
      raise exception using errcode = '22023', message = 'study_route_semantic_phase_invalid';
    end if;
    phase_ids := pg_catalog.array_append(phase_ids, phase_id);
    if pg_catalog.jsonb_typeof(phase -> 'methodPhase') is distinct from 'string'
      or phase ->> 'methodPhase' not in (
        'orient', 'model', 'read_source', 'retrieve', 'explain',
        'guided_practice', 'independent_practice', 'discriminate',
        'repair', 'evidence_match', 'code_trace', 'transfer',
        'schedule_return', 'reflect'
      ) then
      raise exception using errcode = '22023', message = 'study_route_semantic_phase_invalid';
    end if;
    phase_active_minutes := public.study_route_integer_v1(
      phase -> 'activeMinutes', 1, 180, 'study_route_semantic_phase_invalid'
    );
    phase_minutes := phase_minutes + phase_active_minutes;
    if pg_catalog.jsonb_typeof(phase -> 'targetIds') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'study_route_semantic_phase_invalid';
    end if;
    if pg_catalog.jsonb_array_length(phase -> 'targetIds') not between 0 and 40 then
      raise exception using errcode = '22023', message = 'study_route_semantic_phase_invalid';
    end if;
    phase_target_ids := '{}'::uuid[];
    for array_entry in
      select element.value
      from pg_catalog.jsonb_array_elements(phase -> 'targetIds') as element(value)
    loop
      target_id := public.study_route_uuid_v1(
        array_entry, 'study_route_semantic_phase_invalid'
      );
      if target_id = any(phase_target_ids) then
        raise exception using errcode = '22023', message = 'study_route_semantic_phase_invalid';
      end if;
      phase_target_ids := pg_catalog.array_append(phase_target_ids, target_id);
      if not (target_id = any(target_ids)) then
        raise exception using errcode = '22023', message = 'study_route_semantic_target_reference_invalid';
      end if;
      if not (target_id = any(covered_ids)) then
        covered_ids := pg_catalog.array_append(covered_ids, target_id);
      end if;
    end loop;
  end loop;
  if phase_minutes <> active_minutes then
    raise exception using errcode = '22023', message = 'study_route_semantic_phase_minutes_invalid';
  end if;

  for deferred_target in
    select element.value
    from pg_catalog.jsonb_array_elements(execution -> 'deferredTargets') as element(value)
  loop
    perform public.study_route_assert_object_v1(
      deferred_target,
      array['targetId', 'reason'],
      array['targetId', 'reason'],
      'study_route_semantic_deferred_target_invalid'
    );
    target_id := public.study_route_uuid_v1(
      deferred_target -> 'targetId', 'study_route_semantic_deferred_target_invalid'
    );
    if target_id = any(deferred_ids)
      or not (target_id = any(target_ids)) then
      raise exception using errcode = '22023', message = 'study_route_semantic_deferred_target_invalid';
    end if;
    deferred_ids := pg_catalog.array_append(deferred_ids, target_id);
    perform public.study_route_text_v1(
      deferred_target -> 'reason', 8, 300,
      'study_route_semantic_deferred_target_invalid'
    );
  end loop;

  foreach target_id in array deferred_ids loop
    if target_id = any(covered_ids) then
      raise exception using errcode = '22023', message = 'study_route_semantic_active_deferred_overlap';
    end if;
  end loop;
  foreach target_id in array target_ids loop
    if not (target_id = any(deferred_ids))
      and not (target_id = any(covered_ids)) then
      raise exception using errcode = '22023', message = 'study_route_semantic_target_coverage_invalid';
    end if;
    if not (target_id = any(deferred_ids)) then
      active_target_count := active_target_count + 1;
    end if;
  end loop;
  if active_target_count > 6 then
    raise exception using errcode = '22023', message = 'study_route_semantic_active_target_capacity_invalid';
  end if;

  for completion_item in
    select element.value
    from pg_catalog.jsonb_array_elements(execution -> 'completionEvidence') as element(value)
  loop
    perform public.study_route_assert_object_v1(
      completion_item,
      array['evidenceId', 'targetIds', 'kind', 'description', 'requiresIndependentAttempt'],
      array['evidenceId', 'targetIds', 'kind', 'description', 'requiresIndependentAttempt'],
      'study_route_semantic_completion_evidence_invalid'
    );
    evidence_id := public.study_route_text_v1(
      completion_item -> 'evidenceId', 1, 200,
      'study_route_semantic_completion_evidence_invalid'
    );
    if evidence_id = any(evidence_ids) then
      raise exception using errcode = '22023', message = 'study_route_semantic_completion_evidence_invalid';
    end if;
    evidence_ids := pg_catalog.array_append(evidence_ids, evidence_id);
    if pg_catalog.jsonb_typeof(completion_item -> 'targetIds') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'study_route_semantic_completion_evidence_invalid';
    end if;
    if pg_catalog.jsonb_array_length(completion_item -> 'targetIds') not between 1 and 40
      or pg_catalog.jsonb_typeof(completion_item -> 'kind') is distinct from 'string'
      or completion_item ->> 'kind' not in (
        'retrieval', 'application', 'explanation', 'artifact', 'verification'
      )
      or pg_catalog.jsonb_typeof(completion_item -> 'requiresIndependentAttempt')
        is distinct from 'boolean' then
      raise exception using errcode = '22023', message = 'study_route_semantic_completion_evidence_invalid';
    end if;
    perform public.study_route_text_v1(
      completion_item -> 'description', 8, 300,
      'study_route_semantic_completion_evidence_invalid'
    );
    evidence_target_ids := '{}'::uuid[];
    for array_entry in
      select element.value
      from pg_catalog.jsonb_array_elements(completion_item -> 'targetIds') as element(value)
    loop
      target_id := public.study_route_uuid_v1(
        array_entry, 'study_route_semantic_completion_evidence_invalid'
      );
      if target_id = any(evidence_target_ids)
        or not (target_id = any(target_ids))
        or target_id = any(deferred_ids) then
        raise exception using errcode = '22023', message = 'study_route_semantic_completion_evidence_invalid';
      end if;
      evidence_target_ids := pg_catalog.array_append(evidence_target_ids, target_id);
    end loop;
  end loop;

  if timing ? 'optionalTimedBreak' then
    break_phase_ordinality := pg_catalog.array_position(
      phase_ids,
      timing #>> '{optionalTimedBreak,afterPhaseId}'
    );
    if break_phase_ordinality is null
      or break_phase_ordinality = pg_catalog.array_length(phase_ids, 1) then
      raise exception using errcode = '22023', message = 'study_route_semantic_break_invalid';
    end if;
  end if;

  perform public.study_route_assert_object_v1(
    agency,
    array['controlMode', 'selectedBy', 'alternatives'],
    array['controlMode', 'selectedBy', 'alternatives', 'override'],
    'study_route_semantic_agency_invalid'
  );
  if pg_catalog.jsonb_typeof(agency -> 'controlMode') is distinct from 'string'
    or agency ->> 'controlMode' not in (
      'yova_decides', 'help_me_choose', 'learner_customizes', 'legacy_unknown'
    )
    or pg_catalog.jsonb_typeof(agency -> 'selectedBy') is distinct from 'string'
    or agency ->> 'selectedBy' not in ('yova', 'learner', 'legacy_unknown')
    or pg_catalog.jsonb_typeof(agency -> 'alternatives') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'study_route_semantic_agency_invalid';
  end if;
  if pg_catalog.jsonb_array_length(agency -> 'alternatives') not between 0 and 2 then
    raise exception using errcode = '22023', message = 'study_route_semantic_agency_invalid';
  end if;
  primary_signature := pg_catalog.jsonb_build_array(
    approach -> 'mode',
    approach -> 'executionEnvironment',
    approach -> 'primaryMethodId',
    timing -> 'activeMinutes'
  )::text;
  for alternative in
    select element.value
    from pg_catalog.jsonb_array_elements(agency -> 'alternatives') as element(value)
  loop
    perform public.study_route_assert_object_v1(
      alternative,
      array['alternativeId', 'mode', 'executionEnvironment', 'primaryMethodId', 'visibleMethodName', 'activeMinutes', 'tradeoff'],
      array['alternativeId', 'mode', 'executionEnvironment', 'primaryMethodId', 'visibleMethodName', 'activeMinutes', 'tradeoff'],
      'study_route_semantic_alternative_invalid'
    );
    alternative_id := public.study_route_text_v1(
      alternative -> 'alternativeId', 1, 200,
      'study_route_semantic_alternative_invalid'
    );
    if alternative_id = any(alternative_ids)
      or pg_catalog.jsonb_typeof(alternative -> 'mode') is distinct from 'string'
      or alternative ->> 'mode' not in ('learn', 'practice')
      or pg_catalog.jsonb_typeof(alternative -> 'executionEnvironment') is distinct from 'string'
      or alternative ->> 'executionEnvironment' not in ('inside_yova', 'outside_yova')
      or pg_catalog.jsonb_typeof(alternative -> 'primaryMethodId') is distinct from 'string'
      or alternative ->> 'primaryMethodId' not in (
        'retrieval_practice', 'spaced_retrieval', 'self_explanation',
        'worked_example_fading', 'interleaved_practice', 'read_recall_review',
        'retrieval_based_outlining', 'scaffolded_coding',
        'practice_test_error_repair'
      ) then
      raise exception using errcode = '22023', message = 'study_route_semantic_alternative_invalid';
    end if;
    alternative_ids := pg_catalog.array_append(alternative_ids, alternative_id);
    perform public.study_route_text_v1(
      alternative -> 'visibleMethodName', 2, 90,
      'study_route_semantic_alternative_invalid'
    );
    perform public.study_route_integer_v1(
      alternative -> 'activeMinutes', 1, 180,
      'study_route_semantic_alternative_invalid'
    );
    perform public.study_route_text_v1(
      alternative -> 'tradeoff', 8, 300,
      'study_route_semantic_alternative_invalid'
    );
    alternative_signature := pg_catalog.jsonb_build_array(
      alternative -> 'mode',
      alternative -> 'executionEnvironment',
      alternative -> 'primaryMethodId',
      alternative -> 'activeMinutes'
    )::text;
    if alternative_signature = primary_signature
      or alternative_signature = any(alternative_signatures) then
      raise exception using errcode = '22023', message = 'study_route_semantic_alternative_invalid';
    end if;
    alternative_signatures := pg_catalog.array_append(
      alternative_signatures,
      alternative_signature
    );
  end loop;

  if agency ? 'override' then
    route_override := agency -> 'override';
    perform public.study_route_assert_object_v1(
      route_override,
      array['requestedAt', 'changedFields'],
      array['requestedAt', 'changedFields', 'reason'],
      'study_route_semantic_override_invalid'
    );
    perform public.study_route_timestamp_v1(
      route_override -> 'requestedAt', 'study_route_semantic_override_invalid'
    );
    if pg_catalog.jsonb_typeof(route_override -> 'changedFields') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'study_route_semantic_override_invalid';
    end if;
    if pg_catalog.jsonb_array_length(route_override -> 'changedFields') not between 1 and 8
      or agency ->> 'selectedBy' <> 'learner' then
      raise exception using errcode = '22023', message = 'study_route_semantic_override_invalid';
    end if;
    for array_entry in
      select element.value
      from pg_catalog.jsonb_array_elements(route_override -> 'changedFields') as element(value)
    loop
      changed_field := public.study_route_text_v1(
        array_entry, 1, 40, 'study_route_semantic_override_invalid'
      );
      if changed_field not in (
        'targets', 'mode', 'execution_environment', 'primary_method',
        'duration', 'phase_order', 'support_bounds', 'review_contract'
      ) or changed_field = any(changed_fields) then
        raise exception using errcode = '22023', message = 'study_route_semantic_override_invalid';
      end if;
      changed_fields := pg_catalog.array_append(changed_fields, changed_field);
    end loop;
    if route_override ? 'reason' then
      perform public.study_route_text_v1(
        route_override -> 'reason', 3, 300,
        'study_route_semantic_override_invalid'
      );
    end if;
  end if;

  perform public.study_route_assert_object_v1(
    explanation,
    array['shortReason', 'taskRequirements', 'learnerDeclarations', 'observations', 'uncertainties'],
    array['shortReason', 'taskRequirements', 'learnerDeclarations', 'observations', 'uncertainties'],
    'study_route_semantic_explanation_invalid'
  );
  perform public.study_route_text_v1(
    explanation -> 'shortReason', 8, 300,
    'study_route_semantic_explanation_invalid'
  );
  perform public.study_route_assert_string_array_v1(
    explanation -> 'taskRequirements', 0, 10, 3, 500, false,
    'study_route_semantic_explanation_invalid'
  );
  perform public.study_route_assert_string_array_v1(
    explanation -> 'learnerDeclarations', 0, 10, 3, 500, false,
    'study_route_semantic_explanation_invalid'
  );
  perform public.study_route_assert_string_array_v1(
    explanation -> 'observations', 0, 10, 3, 500, false,
    'study_route_semantic_explanation_invalid'
  );
  perform public.study_route_assert_string_array_v1(
    explanation -> 'uncertainties', 0, 10, 3, 500, false,
    'study_route_semantic_explanation_invalid'
  );

  perform public.study_route_assert_object_v1(
    provenance,
    array['routerVersion', 'profileVersion', 'evidenceRefs', 'ruleTrace'],
    array['routerVersion', 'profileVersion', 'evidenceRefs', 'ruleTrace'],
    'study_route_semantic_provenance_invalid'
  );
  perform public.study_route_text_v1(
    provenance -> 'routerVersion', 1, 256,
    'study_route_semantic_provenance_invalid'
  );
  perform public.study_route_text_v1(
    provenance -> 'profileVersion', 1, 200,
    'study_route_semantic_provenance_invalid'
  );
  perform public.study_route_assert_string_array_v1(
    provenance -> 'evidenceRefs', 0, 100, 1, 200, true,
    'study_route_semantic_provenance_invalid'
  );
  if pg_catalog.jsonb_typeof(provenance -> 'ruleTrace') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'study_route_semantic_provenance_invalid';
  end if;
  if pg_catalog.jsonb_array_length(provenance -> 'ruleTrace') not between 1 and 200 then
    raise exception using errcode = '22023', message = 'study_route_semantic_provenance_invalid';
  end if;
  for rule_trace_entry in
    select element.value
    from pg_catalog.jsonb_array_elements(provenance -> 'ruleTrace') as element(value)
  loop
    perform public.study_route_assert_object_v1(
      rule_trace_entry,
      array['ruleId', 'result', 'reason', 'evidenceRefs'],
      array['ruleId', 'result', 'reason', 'evidenceRefs'],
      'study_route_semantic_rule_trace_invalid'
    );
    perform public.study_route_text_v1(
      rule_trace_entry -> 'ruleId', 1, 200,
      'study_route_semantic_rule_trace_invalid'
    );
    perform public.study_route_text_v1(
      rule_trace_entry -> 'result', 1, 200,
      'study_route_semantic_rule_trace_invalid'
    );
    perform public.study_route_text_v1(
      rule_trace_entry -> 'reason', 3, 500,
      'study_route_semantic_rule_trace_invalid'
    );
    perform public.study_route_assert_string_array_v1(
      rule_trace_entry -> 'evidenceRefs', 0, 40, 1, 200, true,
      'study_route_semantic_rule_trace_invalid'
    );
  end loop;
end;
$$;

revoke all on function public.assert_study_route_payload_v1(jsonb)
from public, anon, authenticated;

create or replace function public.guard_study_route_payload_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_study_route_payload_v1(new.route_payload);
  return new;
end;
$$;

revoke all on function public.guard_study_route_payload_v1()
from public, anon, authenticated;

-- Install the guard before scanning. CREATE TRIGGER's relation lock closes the
-- migration-time race with a writer that passed the old EXECUTE check before
-- this transaction's privilege revocation became visible.
drop trigger if exists study_routes_validate_payload_v1 on public.study_routes;
create trigger study_routes_validate_payload_v1
before insert on public.study_routes
for each row execute function public.guard_study_route_payload_v1();

-- Fail deployment rather than silently grandfathering malformed route rows if
-- migrations 001-009 were briefly live before this boundary was installed.
do $$
declare
  existing_payload jsonb;
begin
  for existing_payload in
    select route.route_payload
    from public.study_routes as route
    order by route.created_at, route.route_revision_id
  loop
    perform public.assert_study_route_payload_v1(existing_payload);
  end loop;
end;
$$;

-- Migration 005 projected deferred target ids into step_data.topicIds. Repair
-- currently executable plans now, and repair an inactive legacy plan just after
-- it becomes active, when the established inactive-parent guard permits the
-- route-authoritative update. Other projection differences were never an
-- intended legacy representation and fail the preflight below.
create or replace function public.reconcile_active_plan_route_topics_v1(
  requested_plan_id uuid,
  requested_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.plan_sessions as session
    join public.study_routes as route
      on route.route_revision_id = session.committed_route_revision_id
      and route.plan_session_id = session.id
      and route.plan_id = session.plan_id
      and route.user_id = session.user_id
    where session.plan_id = requested_plan_id
      and session.user_id = requested_user_id
      and session.step_data ? 'activeSessionCheckpoint'
      and session.step_data -> 'topicIds' is distinct from
        public.study_route_active_topic_ids_v1(route.route_payload)
  ) then
    raise exception using
      errcode = '55000',
      message = 'study_route_topic_reconciliation_checkpointed';
  end if;

  update public.plan_sessions as session
  set step_data = pg_catalog.jsonb_set(
    session.step_data - 'generatedSession',
    '{topicIds}',
    public.study_route_active_topic_ids_v1(route.route_payload),
    true
  )
  from public.study_routes as route
  where session.plan_id = requested_plan_id
    and session.user_id = requested_user_id
    and session.committed_route_revision_id is not null
    and pg_catalog.jsonb_typeof(session.step_data) = 'object'
    and not (session.step_data ? 'activeSessionCheckpoint')
    and route.route_revision_id = session.committed_route_revision_id
    and route.plan_session_id = session.id
    and route.plan_id = session.plan_id
    and route.user_id = session.user_id
    and session.step_data -> 'topicIds' is distinct from
      public.study_route_active_topic_ids_v1(route.route_payload);
end;
$$;

revoke all on function public.reconcile_active_plan_route_topics_v1(uuid, uuid)
from public, anon, authenticated;

do $$
declare
  active_plan record;
begin
  for active_plan in
    select plan.id, plan.user_id
    from public.plans as plan
    where plan.status = 'active'
    order by plan.user_id, plan.id
  loop
    perform public.reconcile_active_plan_route_topics_v1(
      active_plan.id,
      active_plan.user_id
    );
  end loop;
end;
$$;

create or replace function public.reconcile_route_topics_on_plan_activation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and old.status is distinct from new.status then
    perform public.reconcile_active_plan_route_topics_v1(new.id, new.user_id);
  end if;
  return null;
end;
$$;

revoke all on function public.reconcile_route_topics_on_plan_activation_v1()
from public, anon, authenticated;

drop trigger if exists plans_reconcile_route_topics_on_activation_v1
on public.plans;
create trigger plans_reconcile_route_topics_on_activation_v1
after update of status on public.plans
for each row execute function public.reconcile_route_topics_on_plan_activation_v1();

do $$
begin
  if exists (
    select 1
    from public.plan_sessions as session
    join public.plans as plan
      on plan.id = session.plan_id
      and plan.user_id = session.user_id
    join public.learning_items as item
      on item.id = plan.learning_item_id
      and item.user_id = plan.user_id
    join public.study_routes as route
      on route.route_revision_id = session.committed_route_revision_id
      and route.plan_session_id = session.id
      and route.plan_id = session.plan_id
      and route.user_id = session.user_id
    cross join lateral (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(evidence.value ->> 'description')
          order by evidence.ordinality
        ),
        '[]'::jsonb
      ) as completion_evidence
      from pg_catalog.jsonb_array_elements(
        route.route_payload #> '{execution,completionEvidence}'
      ) with ordinality as evidence(value, ordinality)
    ) as projected
    where session.committed_route_revision_id is not null
      and (
        route.lifecycle <> 'committed'
        or route.route_payload #>> '{approach,visibleMethodName}'
          is distinct from session.method
        or route.route_payload #>> '{explanation,shortReason}'
          is distinct from session.method_rationale
        or (route.route_payload #>> '{timing,activeMinutes}')::integer
          is distinct from session.estimated_minutes::integer
        or case route.route_payload #>> '{approach,mode}'
          when 'learn' then 'learn'
          when 'practice' then 'study'
          else null
        end is distinct from session.step_data ->> 'learningMode'
        or route.route_payload #>> '{target,desiredOutcome}'
          is distinct from (
            case
              when pg_catalog.length(coalesce(
                nullif(pg_catalog.btrim(session.objective), ''),
                nullif(pg_catalog.btrim(session.title), ''),
                'Complete this session'
              )) >= 5 then pg_catalog.left(coalesce(
                nullif(pg_catalog.btrim(session.objective), ''),
                nullif(pg_catalog.btrim(session.title), ''),
                'Complete this session'
              ), 500)
              else pg_catalog.left('Learn ' || coalesce(
                nullif(pg_catalog.btrim(session.objective), ''),
                nullif(pg_catalog.btrim(session.title), ''),
                'Complete this session'
              ), 500)
            end
          )
        or (
          session.status in ('ready', 'upcoming')
          and (
            route.route_payload #>> '{approach,executionEnvironment}'
              is distinct from item.study_mode
            or case route.route_payload #>> '{target,sourceRequirements,sourceType}'
              when 'user_materials' then 'user_materials'
              when 'yova_generated' then 'yova_generated'
              when 'trusted_external_source' then 'yova_generated'
              else null
            end is distinct from item.source_mode
          )
        )
        or pg_catalog.jsonb_typeof(session.step_data -> 'completionEvidence')
          is distinct from 'array'
        or projected.completion_evidence
          is distinct from session.step_data -> 'completionEvidence'
        or (
          plan.status = 'active'
          and (
            pg_catalog.jsonb_typeof(session.step_data -> 'topicIds')
              is distinct from 'array'
            or public.study_route_active_topic_ids_v1(route.route_payload)
              is distinct from session.step_data -> 'topicIds'
          )
        )
      )
  ) then
    raise exception using
      errcode = '40001',
      message = 'existing_study_route_projection_invalid';
  end if;
end;
$$;

-- Validate the pointer after it is visible. This complements the existing
-- BEFORE transition guard: the route may be structurally valid and correctly
-- related while still disagreeing with the learner-visible session projection.
create or replace function public.assert_study_route_pointer_projection_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pointed_route public.study_routes%rowtype;
  stored_study_mode text;
  stored_source_mode text;
  expected_source_mode text;
  expected_learning_mode text;
  expected_desired_outcome text;
  projected_topic_ids jsonb;
  projected_completion_evidence jsonb;
begin
  if new.committed_route_revision_id
      is not distinct from old.committed_route_revision_id then
    return null;
  end if;

  select route.*
  into pointed_route
  from public.study_routes as route
  where route.route_revision_id = new.committed_route_revision_id
    and route.plan_session_id = new.id
    and route.plan_id = new.plan_id
    and route.user_id = new.user_id;

  select item.study_mode, item.source_mode
  into stored_study_mode, stored_source_mode
  from public.plans as plan
  join public.learning_items as item
    on item.id = plan.learning_item_id
    and item.user_id = plan.user_id
  where plan.id = new.plan_id
    and plan.user_id = new.user_id;

  expected_learning_mode := case pointed_route.route_payload #>> '{approach,mode}'
    when 'learn' then 'learn'
    when 'practice' then 'study'
    else null
  end;
  -- The legacy learning-item scalar distinguishes learner materials from
  -- everything YOVA sources. A trusted external source therefore projects to
  -- yova_generated without losing the route's more precise provenance.
  expected_source_mode := case
    pointed_route.route_payload #>> '{target,sourceRequirements,sourceType}'
    when 'user_materials' then 'user_materials'
    when 'yova_generated' then 'yova_generated'
    when 'trusted_external_source' then 'yova_generated'
    else null
  end;
  expected_desired_outcome := coalesce(
    nullif(pg_catalog.btrim(new.objective), ''),
    nullif(pg_catalog.btrim(new.title), ''),
    'Complete this session'
  );
  expected_desired_outcome := case
    when pg_catalog.length(expected_desired_outcome) >= 5
      then pg_catalog.left(expected_desired_outcome, 500)
    else pg_catalog.left('Learn ' || expected_desired_outcome, 500)
  end;

  if pointed_route.route_revision_id is null
    or pointed_route.lifecycle <> 'committed'
    or pointed_route.route_payload #>> '{approach,visibleMethodName}'
      is distinct from new.method
    or pointed_route.route_payload #>> '{explanation,shortReason}'
      is distinct from new.method_rationale
    or (pointed_route.route_payload #>> '{timing,activeMinutes}')::integer
      is distinct from new.estimated_minutes::integer
    or expected_learning_mode is distinct from new.step_data ->> 'learningMode'
    or pointed_route.route_payload #>> '{target,desiredOutcome}'
      is distinct from expected_desired_outcome
    or pointed_route.route_payload #>> '{approach,executionEnvironment}'
      is distinct from stored_study_mode
    or expected_source_mode is distinct from stored_source_mode then
    raise exception using
      errcode = '40001',
      message = 'study_route_pointer_projection_conflict';
  end if;

  if pg_catalog.jsonb_typeof(new.step_data -> 'topicIds') is distinct from 'array'
    or pg_catalog.jsonb_typeof(new.step_data -> 'completionEvidence')
      is distinct from 'array' then
    raise exception using
      errcode = '40001',
      message = 'study_route_pointer_projection_conflict';
  end if;

  projected_topic_ids := public.study_route_active_topic_ids_v1(
    pointed_route.route_payload
  );

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(evidence.value ->> 'description')
      order by evidence.ordinality
    ),
    '[]'::jsonb
  )
  into projected_completion_evidence
  from pg_catalog.jsonb_array_elements(
    pointed_route.route_payload #> '{execution,completionEvidence}'
  ) with ordinality as evidence(value, ordinality);

  if projected_topic_ids is distinct from new.step_data -> 'topicIds'
    or projected_completion_evidence
      is distinct from new.step_data -> 'completionEvidence' then
    raise exception using
      errcode = '40001',
      message = 'study_route_pointer_projection_conflict';
  end if;

  return null;
end;
$$;

revoke all on function public.assert_study_route_pointer_projection_v1()
from public, anon, authenticated;

drop trigger if exists plan_sessions_assert_route_projection_v1
on public.plan_sessions;
create trigger plan_sessions_assert_route_projection_v1
after update of committed_route_revision_id on public.plan_sessions
for each row execute function public.assert_study_route_pointer_projection_v1();

-- A plan with committed routes cannot be reparented to a different learning
-- item after those routes have projected their source and execution contracts.
-- Route-free legacy plans retain the historical owner-scoped update behavior.
create or replace function public.guard_routed_plan_learning_item_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.learning_item_id is not distinct from old.learning_item_id then
    return new;
  end if;

  if exists (
    select 1
    from public.plan_sessions as session
    where session.plan_id = old.id
      and session.user_id = old.user_id
      and session.committed_route_revision_id is not null
  ) then
    raise exception using
      errcode = '42501',
      message = 'routed_plan_learning_item_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_routed_plan_learning_item_v1()
from public, anon, authenticated;

drop trigger if exists plans_guard_routed_learning_item_v1 on public.plans;
create trigger plans_guard_routed_learning_item_v1
before update of learning_item_id on public.plans
for each row execute function public.guard_routed_plan_learning_item_v1();

-- Source and execution mode may change only with the complete set of atomic
-- successor routes. Check the final transaction state rather than the UPDATE's
-- intermediate row so route-aware adjustment may update both sides in either
-- statement order.
create or replace function public.assert_learning_item_route_projection_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_study_mode text;
  current_source_mode text;
begin
  -- A row-level deferred trigger runs after the item UPDATE already owns its
  -- row lock. Do not wait here and invert the canonical advisory-before-row
  -- order used by archive, reset, and route-aware writers. Canonical writers
  -- already own this transaction lock (and reacquire it successfully); a
  -- concurrent direct scalar writer instead fails retryably without deadlock.
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(new.user_id::text)
  ) then
    raise exception using
      errcode = '40001',
      message = 'learning_item_study_route_serialization_conflict';
  end if;

  select item.study_mode, item.source_mode
  into current_study_mode, current_source_mode
  from public.learning_items as item
  where item.id = new.id
    and item.user_id = new.user_id;

  if not found then
    return null;
  end if;

  if exists (
    select 1
    from public.plans as plan
    join public.plan_sessions as session
      on session.plan_id = plan.id
      and session.user_id = plan.user_id
      and session.committed_route_revision_id is not null
      and session.status in ('ready', 'upcoming')
    join public.study_routes as route
      on route.route_revision_id = session.committed_route_revision_id
      and route.plan_session_id = session.id
      and route.plan_id = session.plan_id
      and route.user_id = session.user_id
    where plan.learning_item_id = new.id
      and plan.user_id = new.user_id
      and (
        route.route_payload #>> '{approach,executionEnvironment}'
          is distinct from current_study_mode
        or case route.route_payload #>> '{target,sourceRequirements,sourceType}'
          when 'user_materials' then 'user_materials'
          when 'yova_generated' then 'yova_generated'
          when 'trusted_external_source' then 'yova_generated'
          else null
        end is distinct from current_source_mode
      )
  ) then
    raise exception using
      errcode = '40001',
      message = 'learning_item_study_route_projection_conflict';
  end if;
  return null;
end;
$$;

revoke all on function public.assert_learning_item_route_projection_v1()
from public, anon, authenticated;

drop trigger if exists learning_items_assert_route_projection_v1
on public.learning_items;
create constraint trigger learning_items_assert_route_projection_v1
after update of study_mode, source_mode on public.learning_items
deferrable initially deferred
for each row
when (
  old.study_mode is distinct from new.study_mode
  or old.source_mode is distinct from new.source_mode
)
execute function public.assert_learning_item_route_projection_v1();

-- Existing plans predate the mandatory route boundary and may legitimately be
-- wholly route-free. A BEFORE trigger coerces even an explicitly supplied false
-- value to true and makes the cohort marker immutable after insertion.
create or replace function public.guard_plan_route_coverage_marker_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.study_route_coverage_required := true;
    return new;
  end if;

  if new.study_route_coverage_required
      is distinct from old.study_route_coverage_required then
    raise exception using
      errcode = '42501',
      message = 'study_route_coverage_marker_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_plan_route_coverage_marker_v1()
from public, anon, authenticated;

drop trigger if exists plans_guard_route_coverage_marker_v1 on public.plans;
create trigger plans_guard_route_coverage_marker_v1
before insert or update on public.plans
for each row execute function public.guard_plan_route_coverage_marker_v1();

-- Do not grandfather a partially routed plan. The legacy cohort may have no
-- routes or complete coverage, but never a mixture of the two.
do $$
begin
  if exists (
    select 1
    from public.plan_sessions as session
    group by session.plan_id, session.user_id
    having pg_catalog.count(session.committed_route_revision_id) > 0
      and pg_catalog.count(session.committed_route_revision_id)
        < pg_catalog.count(*)
  ) then
    raise exception using
      errcode = '40001',
      message = 'partial_plan_study_route_coverage_forbidden';
  end if;
end;
$$;

-- Enforce route coverage at the actual activation boundary. The deferred
-- trigger permits save_generated_plan_with_routes to insert plan/session rows
-- first and attach every route later in the same transaction. Legacy plans may
-- reactivate with no routes, but partial coverage is rejected for both cohorts.
create or replace function public.assert_active_plan_route_coverage_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  total_sessions integer;
  routed_sessions integer;
begin
  if new.status <> 'active' then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'active' then
      return null;
    end if;
  end if;

  select plan.status
  into current_status
  from public.plans as plan
  where plan.id = new.id
    and plan.user_id = new.user_id;
  if not found or current_status <> 'active' then
    return null;
  end if;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(session.committed_route_revision_id)::integer
  into total_sessions, routed_sessions
  from public.plan_sessions as session
  where session.plan_id = new.id
    and session.user_id = new.user_id;

  if (routed_sessions > 0 and routed_sessions < total_sessions)
    or (
      new.study_route_coverage_required
      and (total_sessions < 1 or routed_sessions <> total_sessions)
    ) then
    raise exception using
      errcode = '40001',
      message = 'active_plan_study_route_coverage_required';
  end if;
  return null;
end;
$$;

revoke all on function public.assert_active_plan_route_coverage_v1()
from public, anon, authenticated;

drop trigger if exists plans_require_route_coverage_v1 on public.plans;
create constraint trigger plans_require_route_coverage_v1
after insert or update on public.plans
deferrable initially deferred
for each row execute function public.assert_active_plan_route_coverage_v1();

-- Planned duration is route-owned evidence. Enforce it below every mature
-- completion/interruption writer so even their internal legacy delegates
-- cannot persist a routed observation under a different time budget.
create or replace function public.guard_routed_attempt_minutes_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  route_revision_id uuid;
  route_active_minutes integer;
  requested_planned_minutes integer;
begin
  select
    session.committed_route_revision_id,
    (route.route_payload #>> '{timing,activeMinutes}')::integer
  into route_revision_id, route_active_minutes
  from public.plan_sessions as session
  left join public.study_routes as route
    on route.route_revision_id = session.committed_route_revision_id
    and route.plan_session_id = session.id
    and route.plan_id = session.plan_id
    and route.user_id = session.user_id
  where session.id = new.plan_session_id
    and session.user_id = new.user_id;

  if route_revision_id is null then
    return new;
  end if;
  requested_planned_minutes := public.study_route_integer_v1(
    new.result_data -> 'plannedMinutes',
    1,
    180,
    'study_route_planned_minutes_conflict'
  );
  if route_active_minutes is null
    or requested_planned_minutes <> route_active_minutes then
    raise exception using
      errcode = '40001',
      message = 'study_route_planned_minutes_conflict';
  end if;
  return new;
end;
$$;

create or replace function public.guard_routed_event_minutes_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  route_revision_id uuid;
  route_active_minutes integer;
  requested_planned_minutes integer;
begin
  if new.event_type not in ('session_completed', 'session_interrupted') then
    return new;
  end if;
  select
    session.committed_route_revision_id,
    (route.route_payload #>> '{timing,activeMinutes}')::integer
  into route_revision_id, route_active_minutes
  from public.plan_sessions as session
  left join public.study_routes as route
    on route.route_revision_id = session.committed_route_revision_id
    and route.plan_session_id = session.id
    and route.plan_id = session.plan_id
    and route.user_id = session.user_id
  where session.id = new.plan_session_id
    and session.user_id = new.user_id;

  if route_revision_id is null then
    return new;
  end if;
  requested_planned_minutes := public.study_route_integer_v1(
    new.event_data -> 'plannedMinutes',
    1,
    180,
    'study_route_planned_minutes_conflict'
  );
  if route_active_minutes is null
    or requested_planned_minutes <> route_active_minutes then
    raise exception using
      errcode = '40001',
      message = 'study_route_planned_minutes_conflict';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_routed_attempt_minutes_v1()
from public, anon, authenticated;
revoke all on function public.guard_routed_event_minutes_v1()
from public, anon, authenticated;

drop trigger if exists session_attempts_guard_route_minutes_v1
on public.session_attempts;
create trigger session_attempts_guard_route_minutes_v1
before insert or update of plan_session_id, user_id, result_data
on public.session_attempts
for each row execute function public.guard_routed_attempt_minutes_v1();

drop trigger if exists learning_events_guard_route_minutes_v1
on public.learning_events;
create trigger learning_events_guard_route_minutes_v1
before insert or update of plan_session_id, user_id, event_type, event_data
on public.learning_events
for each row execute function public.guard_routed_event_minutes_v1();

-- One guard covers the two bounded JSON values stored in plan_sessions. It
-- validates only changed values, so cache invalidation and checkpoint deletion
-- remain available and legacy null-pointer sessions retain their old path.
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
      17,
      'generated_session_cache_shape_invalid'
    );
    if generated_schema_version not in (15, 16, 17)
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
      or pg_catalog.jsonb_array_length(generated_session -> 'activities') not between 3 and 9 then
      raise exception using
        errcode = '22023',
        message = 'generated_session_cache_shape_invalid';
    end if;
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

revoke all on function public.guard_plan_session_private_json_v1()
from public, anon, authenticated;

drop trigger if exists plan_sessions_guard_private_json_v1
on public.plan_sessions;
create trigger plan_sessions_guard_private_json_v1
before update of step_data on public.plan_sessions
for each row execute function public.guard_plan_session_private_json_v1();

-- A post-session route may carry other evidence, but it must contain exactly
-- one route-origin receipt and that one receipt must name the expected route.
create or replace function public.assert_study_route_origin_reference(
  requested_route jsonb,
  requested_plan_id uuid,
  expected_origin_revision_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  evidence_refs jsonb := requested_route #> '{provenance,evidenceRefs}';
  route_reference_count integer;
  expected_reference_count integer;
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'study_route_authentication_required';
  end if;
  if pg_catalog.jsonb_typeof(evidence_refs) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'post_session_study_route_origin_invalid';
  end if;

  select
    pg_catalog.count(*) filter (
      where reference.value #>> '{}' like 'route-revision:%'
    )::integer,
    pg_catalog.count(*) filter (
      where reference.value #>> '{}'
        = 'route-revision:' || expected_origin_revision_id::text
    )::integer
  into route_reference_count, expected_reference_count
  from pg_catalog.jsonb_array_elements(evidence_refs) as reference(value);

  if expected_origin_revision_id is null
    or route_reference_count <> 1
    or expected_reference_count <> 1
    or not exists (
      select 1
      from public.study_routes as origin
      where origin.route_revision_id = expected_origin_revision_id
        and origin.plan_id = requested_plan_id
        and origin.user_id = current_user_id
        and origin.lifecycle = 'committed'
    ) then
    raise exception using
      errcode = '40001',
      message = 'post_session_study_route_origin_conflict';
  end if;
end;
$$;

revoke all on function public.assert_study_route_origin_reference(
  jsonb, uuid, uuid
) from public, anon, authenticated;

comment on function public.assert_study_route_payload_v1(jsonb) is
  'Private canonical semantic validator for schema-version-1 StudyRoute payloads.';
comment on trigger plans_require_route_coverage_v1 on public.plans is
  'Defers new active-plan route coverage validation until the route-aware activation transaction finishes.';
