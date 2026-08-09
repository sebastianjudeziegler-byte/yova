-- Keep the durable knowledge map in sync with completed teaching and evidence.
-- The trigger runs in the same transaction as complete_plan_session, so a
-- completed session and its topic progression cannot diverge.

create or replace function public.refresh_plan_knowledge_map_topic_statuses(
  requested_plan_id uuid,
  requested_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_map jsonb;
  refreshed_topics jsonb;
begin
  select knowledge_map
  into current_map
  from public.plans
  where id = requested_plan_id
    and user_id = requested_user_id
  for update;

  if not found or jsonb_typeof(current_map -> 'topics') <> 'array' then
    return;
  end if;

  select coalesce(jsonb_agg(
    topic.value || jsonb_build_object(
      'status', case
        when coalesce(topic.value ->> 'status', 'not_started') = 'secure' then 'secure'
        when evidence.secure_count >= 2 and evidence.latest_outcome = 'secure' then 'secure'
        when coalesce(topic.value ->> 'status', 'not_started') = 'evidenced' then 'evidenced'
        when evidence.evidence_count > 0 then 'evidenced'
        when coalesce(topic.value ->> 'status', 'not_started') = 'taught' then 'taught'
        when completion.was_taught then 'taught'
        else 'not_started'
      end
    )
    order by topic.ordinality
  ), '[]'::jsonb)
  into refreshed_topics
  from jsonb_array_elements(current_map -> 'topics') with ordinality as topic(value, ordinality)
  left join lateral (
    select exists (
      select 1
      from public.plan_sessions as session
      where session.plan_id = requested_plan_id
        and session.user_id = requested_user_id
        and session.status = 'complete'
        and coalesce(session.step_data -> 'topicIds', '[]'::jsonb) ? (topic.value ->> 'id')
    ) as was_taught
  ) as completion on true
  left join lateral (
    select
      count(*)::integer as evidence_count,
      count(*) filter (where item.value ->> 'outcome' = 'secure')::integer as secure_count,
      (
        array_agg(
          item.value ->> 'outcome'
          order by attempt.completed_at desc, item.ordinality desc
        )
      )[1] as latest_outcome
    from public.session_attempts as attempt
    join public.plan_sessions as session
      on session.id = attempt.plan_session_id
      and session.plan_id = requested_plan_id
      and session.user_id = requested_user_id
    cross join lateral jsonb_array_elements(
      coalesce(attempt.result_data -> 'conceptEvidence', '[]'::jsonb)
    ) with ordinality as item(value, ordinality)
    where item.value ->> 'topicId' = topic.value ->> 'id'
  ) as evidence on true;

  update public.plans
  set knowledge_map = jsonb_set(current_map, '{topics}', refreshed_topics, false)
  where id = requested_plan_id
    and user_id = requested_user_id;
end;
$$;

create or replace function public.refresh_plan_knowledge_map_after_attempt()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attempt_plan_id uuid;
begin
  select plan_id
  into attempt_plan_id
  from public.plan_sessions
  where id = new.plan_session_id
    and user_id = new.user_id;

  if attempt_plan_id is not null then
    perform public.refresh_plan_knowledge_map_topic_statuses(attempt_plan_id, new.user_id);
  end if;

  return new;
end;
$$;

drop trigger if exists refresh_plan_knowledge_map_after_attempt on public.session_attempts;
create trigger refresh_plan_knowledge_map_after_attempt
after insert or update of result_data on public.session_attempts
for each row execute function public.refresh_plan_knowledge_map_after_attempt();

-- Bring plans completed before this migration onto the same durable status
-- rules once. Future progress is maintained by the trigger above.
do $$
declare
  owned_plan record;
begin
  for owned_plan in select id, user_id from public.plans loop
    perform public.refresh_plan_knowledge_map_topic_statuses(owned_plan.id, owned_plan.user_id);
  end loop;
end;
$$;

revoke all on function public.refresh_plan_knowledge_map_topic_statuses(uuid, uuid) from public;
revoke all on function public.refresh_plan_knowledge_map_after_attempt() from public;
