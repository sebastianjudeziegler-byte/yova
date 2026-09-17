-- A packed block is one durable completion with two ordered execution receipts.
-- This validates reported execution against signed, persisted scope. As with
-- existing MCQ completions, client counts are not a proof of learning.
create or replace function public.validate_topic_segment_completion_v1(step_data jsonb, payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  segments jsonb := step_data #> '{workload,segments}';
  receipts jsonb := payload -> 'segmentCompletions';
  segment jsonb;
  receipt jsonb;
  topic_id text;
  previous_topic_id text;
  previous_segment_id text;
  total_count integer := 0;
  correct_count integer := 0;
  index integer;
begin
  if segments is null or segments = 'null'::jsonb then
    if receipts is not null and receipts <> 'null'::jsonb then
      raise exception using errcode='22023', message='topic_segment_completion_unexpected';
    end if;
    return;
  end if;
  if jsonb_typeof(segments) is distinct from 'array'
    or jsonb_typeof(receipts) is distinct from 'array' then
    raise exception using errcode='22023', message='topic_segment_completion_missing';
  end if;
  if jsonb_array_length(segments) <> 2 or jsonb_array_length(receipts) <> 2
    or payload->>'completionVariant' is distinct from 'guided'
    or coalesce(payload->>'completionMode','guided') <> 'guided'
    or coalesce(jsonb_typeof(payload->'nextSessionAdjustment'),'null') <> 'null'
    or coalesce(jsonb_typeof(payload->'followUpSession'),'null') <> 'null'
    or coalesce(jsonb_typeof(payload->'continuationSession'),'null') <> 'null' then
    raise exception using errcode='22023', message='topic_segment_completion_invalid';
  end if;
  for index in 0..1 loop
    segment := segments->index;
    receipt := receipts->index;
    if jsonb_typeof(receipt) is distinct from 'object'
      or nullif(segment->>'segmentId','') is null
      or receipt->>'segmentId' is distinct from segment->>'segmentId'
      or segment->>'segmentId' = previous_segment_id
      or jsonb_typeof(segment #> '{workload,topicSubtopics}') is distinct from 'array' then
      raise exception using errcode='22023', message='topic_segment_completion_identity_invalid';
    end if;
    if jsonb_array_length(segment #> '{workload,topicSubtopics}') <> 1 then
      raise exception using errcode='22023', message='topic_segment_completion_scope_invalid';
    end if;
    topic_id := segment #>> '{workload,topicSubtopics,0,topicId}';
    if topic_id is null or topic_id = previous_topic_id then
      raise exception using errcode='22023', message='topic_segment_completion_scope_invalid';
    end if;
    if jsonb_typeof(receipt->'correctAnswers') is distinct from 'number'
      or jsonb_typeof(receipt->'totalAnswers') is distinct from 'number'
      or jsonb_typeof(receipt->'elapsedSeconds') is distinct from 'number'
      or coalesce(receipt->>'correctAnswers','') !~ '^[0-9]{1,3}$'
      or coalesce(receipt->>'totalAnswers','') !~ '^[0-9]{1,3}$'
      or coalesce(receipt->>'elapsedSeconds','') !~ '^[0-9]{1,5}$' then
      raise exception using errcode='22023', message='topic_segment_completion_values_invalid';
    end if;
    if (select count(*) from jsonb_object_keys(receipt)) <> 4 then
      raise exception using errcode='22023', message='topic_segment_completion_values_invalid';
    end if;
    if (receipt->>'correctAnswers')::integer > (receipt->>'totalAnswers')::integer
      or (receipt->>'totalAnswers')::integer > 192
      or (receipt->>'elapsedSeconds')::integer > 21600
      or (receipt->>'totalAnswers')::integer < coalesce((segment #>> '{workload,questionCount}')::integer,0) then
      raise exception using errcode='22023', message='topic_segment_completion_counts_invalid';
    end if;
    if coalesce((segment #>> '{workload,questionCount}')::integer,0) > 0
      and not exists (
        select 1 from jsonb_array_elements(payload->'conceptEvidence') as evidence(entry)
        where entry->>'topicId' = topic_id
      ) then
      raise exception using errcode='22023', message='topic_segment_completion_evidence_missing';
    end if;
    total_count := total_count + (receipt->>'totalAnswers')::integer;
    correct_count := correct_count + (receipt->>'correctAnswers')::integer;
    previous_topic_id := topic_id;
    previous_segment_id := segment->>'segmentId';
  end loop;
  if total_count is distinct from (payload->>'totalAnswers')::integer
    or correct_count is distinct from (payload->>'correctAnswers')::integer then
    raise exception using errcode='22023', message='topic_segment_completion_totals_invalid';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(payload->'conceptEvidence','[]'::jsonb) || coalesce(payload->'confidenceEvidence','[]'::jsonb)) as evidence(entry)
    where not exists (
      select 1 from jsonb_array_elements(segments) as assigned(segment)
      where assigned.segment #>> '{workload,topicSubtopics,0,topicId}' = evidence.entry->>'topicId'
    )
  ) then
    raise exception using errcode='22023', message='topic_segment_completion_scope_invalid';
  end if;
end;
$$;
revoke all on function public.validate_topic_segment_completion_v1(jsonb,jsonb) from public, anon, authenticated, service_role;

-- Preserve the mature writer and its locking, authorization and replay checks.
-- Fail migration if any insertion point changes instead of silently omitting it.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('public.complete_plan_session_with_route(jsonb)'::regprocedure);
  anchor text;
  replacement text;
begin
  if position('validate_topic_segment_completion_v1(current_session.step_data, payload)' in definition)>0 then return; end if;
  anchor := $anchor$  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(session.committed_route_revision_id)::integer$anchor$;
  replacement := $replacement$  perform public.validate_topic_segment_completion_v1(current_session.step_data, payload);

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(session.committed_route_revision_id)::integer$replacement$;
  if position(anchor in definition)=0 then raise exception 'Segment validation patch did not match locked completion writer'; end if;
  definition := replace(definition,anchor,replacement);
  anchor := $anchor$      or existing_attempt.result_data -> 'confidenceEvidence'
        is distinct from confidence_evidence$anchor$;
  replacement := anchor || $replacement$
      or nullif(existing_attempt.result_data -> 'segmentCompletions', 'null'::jsonb)
        is distinct from nullif(payload -> 'segmentCompletions', 'null'::jsonb)$replacement$;
  if position(anchor in definition)=0 then raise exception 'Segment receipt replay patch did not match'; end if;
  definition := replace(definition,anchor,replacement);
  anchor := $anchor$  select attempt.result_data ->> 'routeRevisionId'
  into stored_route_revision_id$anchor$;
  replacement := $replacement$  if payload ? 'segmentCompletions' then
    update public.session_attempts as attempt
    set result_data = jsonb_set(coalesce(attempt.result_data,'{}'::jsonb), '{segmentCompletions}', payload->'segmentCompletions', true)
    where attempt.id=requested_attempt_id and attempt.plan_session_id=requested_session_id and attempt.user_id=current_user_id;
  end if;

  select attempt.result_data ->> 'routeRevisionId'
  into stored_route_revision_id$replacement$;
  if position(anchor in definition)=0 then raise exception 'Segment receipt storage patch did not match'; end if;
  definition := replace(definition,anchor,replacement);
  execute definition;
end;
$migration$;

-- Extend v6's existing service-only readiness contract without changing its
-- established RLS/read/route checks. A stale deployment must not open new work.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('public.signed_in_generation_readiness_v6()'::regprocedure);
  anchor text := $anchor$'topicPlanWorkloads',workload_ready, 'planSessionReads',coalesce(session_reads_ready,false)$anchor$;
  replacement text := $replacement$'topicPlanWorkloads',workload_ready, 'planSessionReads',coalesce(session_reads_ready,false),
    'topicSegmentCompletions',position('validate_topic_segment_completion_v1(current_session.step_data, payload)' in pg_catalog.pg_get_functiondef('public.complete_plan_session_with_route(jsonb)'::regprocedure))>0$replacement$;
begin
  if position('topicSegmentCompletions' in definition)>0 then return; end if;
  if position(anchor in definition)=0 then raise exception 'Segment readiness patch did not match'; end if;
  definition := replace(definition,anchor,replacement);
  definition := replace(definition,'''20260917170001''','''20260917180001''');
  definition := replace(definition,
    'and coalesce(session_reads_ready,false),',
    'and coalesce(session_reads_ready,false) and position(''validate_topic_segment_completion_v1(current_session.step_data, payload)'' in pg_catalog.pg_get_functiondef(''public.complete_plan_session_with_route(jsonb)''::regprocedure))>0,');
  execute definition;
end;
$migration$;
