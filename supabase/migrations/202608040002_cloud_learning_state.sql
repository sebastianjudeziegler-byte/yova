-- Completes the first cloud-memory loop for YOVA. These functions keep related
-- writes transactional while still running as the signed-in user, so the Row
-- Level Security policies remain the final ownership boundary.

create or replace function public.save_learner_profile(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  insert into public.profiles (
    id,
    display_name,
    onboarding_completed_at
  ) values (
    current_user_id,
    coalesce(nullif(payload ->> 'displayName', ''), ''),
    nullif(payload ->> 'onboardingCompletedAt', '')::timestamptz
  )
  on conflict (id) do update set
    display_name = case
      when excluded.display_name = '' then public.profiles.display_name
      else excluded.display_name
    end,
    onboarding_completed_at = excluded.onboarding_completed_at;

  insert into public.learner_profiles (
    user_id,
    common_blocker,
    guidance_preference,
    preferred_session_min,
    preferred_session_max,
    explanation_preference,
    focus_frequency,
    starting_pattern,
    energy_window,
    primary_improvement_goal,
    additional_context
  ) values (
    current_user_id,
    nullif(payload ->> 'commonBlocker', ''),
    nullif(payload ->> 'guidancePreference', ''),
    nullif(payload ->> 'preferredSessionMin', '')::smallint,
    nullif(payload ->> 'preferredSessionMax', '')::smallint,
    nullif(payload ->> 'explanationPreference', ''),
    nullif(payload ->> 'focusFrequency', ''),
    nullif(payload ->> 'startingPattern', ''),
    nullif(payload ->> 'energyWindow', ''),
    nullif(payload ->> 'primaryImprovementGoal', ''),
    nullif(payload ->> 'additionalContext', '')
  )
  on conflict (user_id) do update set
    common_blocker = excluded.common_blocker,
    guidance_preference = excluded.guidance_preference,
    preferred_session_min = excluded.preferred_session_min,
    preferred_session_max = excluded.preferred_session_max,
    explanation_preference = excluded.explanation_preference,
    focus_frequency = excluded.focus_frequency,
    starting_pattern = excluded.starting_pattern,
    energy_window = excluded.energy_window,
    primary_improvement_goal = excluded.primary_improvement_goal,
    additional_context = excluded.additional_context;
end;
$$;

create or replace function public.complete_plan_session(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  completed_session public.plan_sessions%rowtype;
  attempt_inserted integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  select *
  into completed_session
  from public.plan_sessions
  where id = (payload ->> 'planSessionId')::uuid
    and user_id = current_user_id
  for update;

  if not found then
    raise exception 'The requested session was not found.';
  end if;

  update public.plan_sessions
  set status = 'complete'
  where id = completed_session.id
    and user_id = current_user_id;

  update public.plan_sessions
  set status = 'ready'
  where plan_id = completed_session.plan_id
    and user_id = current_user_id
    and sequence = completed_session.sequence + 1
    and status = 'upcoming';

  insert into public.session_attempts (
    id,
    user_id,
    plan_session_id,
    completed_at,
    actual_minutes,
    correct_answers,
    total_answers,
    user_feedback,
    result_data
  ) values (
    (payload ->> 'attemptId')::uuid,
    current_user_id,
    completed_session.id,
    (payload ->> 'completedAt')::timestamptz,
    coalesce(
      nullif(payload ->> 'actualMinutes', '')::smallint,
      completed_session.estimated_minutes
    ),
    (payload ->> 'correctAnswers')::smallint,
    (payload ->> 'totalAnswers')::smallint,
    payload ->> 'feedback',
    jsonb_build_object('observedGap', payload ->> 'observedGap')
  )
  on conflict (id) do nothing;

  get diagnostics attempt_inserted = row_count;

  if attempt_inserted > 0 then
    insert into public.learning_events (
      user_id,
      learning_item_id,
      plan_session_id,
      event_type,
      event_data,
      occurred_at
    )
    select
      current_user_id,
      plans.learning_item_id,
      completed_session.id,
      'session_completed',
      jsonb_build_object(
        'attemptId', payload ->> 'attemptId',
        'correctAnswers', (payload ->> 'correctAnswers')::smallint,
        'totalAnswers', (payload ->> 'totalAnswers')::smallint,
        'feedback', payload ->> 'feedback'
      ),
      (payload ->> 'completedAt')::timestamptz
    from public.plans
    where plans.id = completed_session.plan_id
      and plans.user_id = current_user_id;
  end if;

  if not exists (
    select 1
    from public.plan_sessions
    where plan_id = completed_session.plan_id
      and user_id = current_user_id
      and status in ('ready', 'upcoming')
  ) then
    update public.plans
    set status = 'completed'
    where id = completed_session.plan_id
      and user_id = current_user_id;

    update public.learning_items
    set status = 'completed'
    where id = (
      select learning_item_id
      from public.plans
      where id = completed_session.plan_id
        and user_id = current_user_id
    )
      and user_id = current_user_id;
  end if;

  return completed_session.plan_id;
end;
$$;

revoke all on function public.save_learner_profile(jsonb) from public;
revoke all on function public.complete_plan_session(jsonb) from public;
grant execute on function public.save_learner_profile(jsonb) to authenticated;
grant execute on function public.complete_plan_session(jsonb) to authenticated;
