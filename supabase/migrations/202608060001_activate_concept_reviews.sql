-- Reopen a completed learning goal with one bounded concept-review session.
-- The operation is atomic so cloud state cannot activate the plan without
-- also preserving the exact review that caused the activation.

create or replace function public.activate_concept_review(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_plan public.plans%rowtype;
  review_session jsonb := payload -> 'session';
  requested_plan_id uuid := nullif(payload ->> 'planId', '')::uuid;
  requested_session_id uuid := nullif(review_session ->> 'id', '')::uuid;
  requested_sequence integer := nullif(review_session ->> 'sequence', '')::integer;
  requested_minutes integer := nullif(review_session ->> 'estimatedMinutes', '')::integer;
  requested_time timestamptz := nullif(review_session ->> 'scheduledFor', '')::timestamptz;
  review_concept text := btrim(coalesce(review_session ->> 'reviewConcept', ''));
  review_type text := coalesce(review_session ->> 'reviewType', '');
  latest_sequence integer;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if requested_plan_id is null
    or requested_session_id is null
    or requested_time is null
    or requested_minutes not between 5 and 30
    or length(review_concept) not between 2 and 120
    or review_type not in ('repair_and_retrieve', 'verify', 'maintenance_transfer')
    or coalesce(review_session ->> 'learningMode', '') <> 'study'
    or length(btrim(coalesce(review_session ->> 'title', ''))) not between 3 and 180
    or length(btrim(coalesce(review_session ->> 'objective', ''))) not between 10 and 900
    or length(btrim(coalesce(review_session ->> 'method', ''))) not between 3 and 180
    or length(btrim(coalesce(review_session ->> 'methodReason', ''))) not between 10 and 900
    or length(btrim(coalesce(review_session ->> 'amountLabel', ''))) not between 3 and 180 then
    raise exception 'The concept review is not valid.';
  end if;

  select *
  into requested_plan
  from public.plans
  where id = requested_plan_id
    and user_id = current_user_id
  for update;

  if not found or requested_plan.status <> 'completed' then
    raise exception 'Only a completed learning goal can be reopened for review.';
  end if;

  select coalesce(max(sequence), 0)
  into latest_sequence
  from public.plan_sessions
  where plan_id = requested_plan.id
    and user_id = current_user_id;

  if requested_sequence <> latest_sequence + 1 then
    raise exception 'The concept review sequence is not valid.';
  end if;

  if not exists (
    select 1
    from public.session_attempts attempts
    join public.plan_sessions sessions
      on sessions.id = attempts.plan_session_id
      and sessions.user_id = attempts.user_id
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(attempts.result_data -> 'conceptEvidence') = 'array'
          then attempts.result_data -> 'conceptEvidence'
        else '[]'::jsonb
      end
    ) as evidence
    where sessions.plan_id = requested_plan.id
      and attempts.user_id = current_user_id
      and lower(btrim(coalesce(evidence ->> 'concept', ''))) = lower(review_concept)
  ) then
    raise exception 'The concept review must come from recorded learning evidence.';
  end if;

  insert into public.plan_sessions (
    id,
    user_id,
    plan_id,
    sequence,
    title,
    objective,
    method,
    method_rationale,
    scheduled_for,
    estimated_minutes,
    status,
    step_data
  ) values (
    requested_session_id,
    current_user_id,
    requested_plan.id,
    requested_sequence,
    review_session ->> 'title',
    review_session ->> 'objective',
    review_session ->> 'method',
    review_session ->> 'methodReason',
    requested_time,
    requested_minutes,
    'ready',
    jsonb_build_object(
      'amountLabel', review_session ->> 'amountLabel',
      'learningMode', 'study',
      'adaptationExplanation', coalesce(nullif(review_session ->> 'explanation', ''), review_session ->> 'methodReason'),
      'adaptedAt', requested_time,
      'topicIds', coalesce(review_session -> 'topicIds', '[]'::jsonb),
      'reviewConcept', review_concept,
      'reviewType', review_type
    )
  );

  update public.plans
  set status = 'active'
  where id = requested_plan.id
    and user_id = current_user_id;

  update public.learning_items
  set status = 'active'
  where id = requested_plan.learning_item_id
    and user_id = current_user_id;

  insert into public.learning_events (
    user_id,
    learning_item_id,
    plan_session_id,
    event_type,
    event_data,
    occurred_at
  ) values (
    current_user_id,
    requested_plan.learning_item_id,
    requested_session_id,
    'concept_review_activated',
    jsonb_build_object(
      'concept', review_concept,
      'reviewType', review_type,
      'estimatedMinutes', requested_minutes
    ),
    requested_time
  );

  return requested_session_id;
end;
$$;

revoke all on function public.activate_concept_review(jsonb) from public;
grant execute on function public.activate_concept_review(jsonb) to authenticated;
