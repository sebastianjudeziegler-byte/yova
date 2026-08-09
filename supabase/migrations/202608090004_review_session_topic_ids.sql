-- Keep scheduled review sessions attached to the same stable knowledge-map
-- topics as the evidence that created them. New clients send topicIds
-- explicitly. The trigger also protects review activation from older clients
-- and backfills reviews created before topic mapping shipped.

create or replace function public.ensure_review_session_topic_ids()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  resolved_topic_ids jsonb;
begin
  if coalesce(new.step_data ->> 'reviewType', '') not in ('repair_and_retrieve', 'verify', 'maintenance_transfer')
    or (
      jsonb_typeof(new.step_data -> 'topicIds') = 'array'
      and jsonb_array_length(new.step_data -> 'topicIds') > 0
    ) then
    return new;
  end if;

  select coalesce(jsonb_agg(distinct to_jsonb(evidence.value ->> 'topicId')), '[]'::jsonb)
  into resolved_topic_ids
  from public.session_attempts as attempt
  join public.plan_sessions as prior_session
    on prior_session.id = attempt.plan_session_id
    and prior_session.user_id = attempt.user_id
  cross join lateral jsonb_array_elements(
    coalesce(attempt.result_data -> 'conceptEvidence', '[]'::jsonb)
  ) as evidence(value)
  where prior_session.plan_id = new.plan_id
    and attempt.user_id = new.user_id
    and nullif(evidence.value ->> 'topicId', '') is not null
    and lower(btrim(coalesce(evidence.value ->> 'concept', '')))
      = lower(btrim(coalesce(new.step_data ->> 'reviewConcept', '')));

  if jsonb_array_length(resolved_topic_ids) > 0 then
    new.step_data := coalesce(new.step_data, '{}'::jsonb)
      || jsonb_build_object('topicIds', resolved_topic_ids);
  end if;

  return new;
end;
$$;

drop trigger if exists ensure_review_session_topic_ids_before_insert on public.plan_sessions;
create trigger ensure_review_session_topic_ids_before_insert
before insert on public.plan_sessions
for each row execute function public.ensure_review_session_topic_ids();

with mapped_reviews as (
  select
    review_session.id,
    jsonb_agg(distinct to_jsonb(evidence.value ->> 'topicId')) as topic_ids
  from public.plan_sessions as review_session
  join public.plan_sessions as prior_session
    on prior_session.plan_id = review_session.plan_id
    and prior_session.user_id = review_session.user_id
  join public.session_attempts as attempt
    on attempt.plan_session_id = prior_session.id
    and attempt.user_id = prior_session.user_id
  cross join lateral jsonb_array_elements(
    coalesce(attempt.result_data -> 'conceptEvidence', '[]'::jsonb)
  ) as evidence(value)
  where coalesce(review_session.step_data ->> 'reviewType', '') in ('repair_and_retrieve', 'verify', 'maintenance_transfer')
    and coalesce(jsonb_array_length(review_session.step_data -> 'topicIds'), 0) = 0
    and nullif(evidence.value ->> 'topicId', '') is not null
    and lower(btrim(coalesce(evidence.value ->> 'concept', '')))
      = lower(btrim(coalesce(review_session.step_data ->> 'reviewConcept', '')))
  group by review_session.id
)
update public.plan_sessions as review_session
set step_data = coalesce(review_session.step_data, '{}'::jsonb)
  || jsonb_build_object('topicIds', mapped_reviews.topic_ids)
from mapped_reviews
where review_session.id = mapped_reviews.id;

create or replace function public.persist_follow_up_review_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  follow_up jsonb := new.result_data -> 'followUpSession';
begin
  if jsonb_typeof(follow_up) = 'object'
    and coalesce(follow_up ->> 'reviewType', '') in ('repair_and_retrieve', 'verify', 'maintenance_transfer')
    and length(btrim(coalesce(follow_up ->> 'reviewConcept', ''))) between 2 and 120 then
    update public.plan_sessions
    set step_data = coalesce(step_data, '{}'::jsonb) || jsonb_build_object(
      'reviewType', follow_up ->> 'reviewType',
      'reviewConcept', follow_up ->> 'reviewConcept',
      'topicIds', case
        when jsonb_typeof(follow_up -> 'topicIds') = 'array'
          and jsonb_array_length(follow_up -> 'topicIds') > 0
          then follow_up -> 'topicIds'
        else coalesce(step_data -> 'topicIds', '[]'::jsonb)
      end
    )
    where id = (follow_up ->> 'id')::uuid
      and user_id = new.user_id;
  end if;

  return new;
end;
$$;

revoke all on function public.ensure_review_session_topic_ids() from public;
