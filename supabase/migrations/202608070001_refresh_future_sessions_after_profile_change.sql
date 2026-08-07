-- A generated lesson is personalized using the learner profile that existed at
-- generation time. Clear only unfinished cached lessons when that profile
-- actually changes so the next generation uses the learner's latest context.
-- Re-saving an identical profile must remain a no-op because the application
-- syncs the profile after sign-in as well as after an intentional edit.

create or replace function public.save_learner_profile(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  existing_profile public.learner_profiles%rowtype;
  profile_changed boolean := false;
  next_common_blocker text := nullif(payload ->> 'commonBlocker', '');
  next_guidance_preference text := nullif(payload ->> 'guidancePreference', '');
  next_preferred_session_min smallint := nullif(payload ->> 'preferredSessionMin', '')::smallint;
  next_preferred_session_max smallint := nullif(payload ->> 'preferredSessionMax', '')::smallint;
  next_explanation_preference text := nullif(payload ->> 'explanationPreference', '');
  next_focus_frequency text := nullif(payload ->> 'focusFrequency', '');
  next_starting_pattern text := nullif(payload ->> 'startingPattern', '');
  next_energy_window text := nullif(payload ->> 'energyWindow', '');
  next_primary_improvement_goal text := nullif(payload ->> 'primaryImprovementGoal', '');
  next_additional_context text := nullif(payload ->> 'additionalContext', '');
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  select *
  into existing_profile
  from public.learner_profiles
  where user_id = current_user_id
  for update;

  if not found then
    profile_changed := true;
  else
    profile_changed := existing_profile.common_blocker is distinct from next_common_blocker
      or existing_profile.guidance_preference is distinct from next_guidance_preference
      or existing_profile.preferred_session_min is distinct from next_preferred_session_min
      or existing_profile.preferred_session_max is distinct from next_preferred_session_max
      or existing_profile.explanation_preference is distinct from next_explanation_preference
      or existing_profile.focus_frequency is distinct from next_focus_frequency
      or existing_profile.starting_pattern is distinct from next_starting_pattern
      or existing_profile.energy_window is distinct from next_energy_window
      or existing_profile.primary_improvement_goal is distinct from next_primary_improvement_goal
      or existing_profile.additional_context is distinct from next_additional_context;
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
    next_common_blocker,
    next_guidance_preference,
    next_preferred_session_min,
    next_preferred_session_max,
    next_explanation_preference,
    next_focus_frequency,
    next_starting_pattern,
    next_energy_window,
    next_primary_improvement_goal,
    next_additional_context
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

  if profile_changed then
    update public.plan_sessions
    set step_data = coalesce(step_data, '{}'::jsonb) - 'generatedSession'
    where user_id = current_user_id
      and status in ('ready', 'upcoming')
      and step_data ? 'generatedSession';
  end if;
end;
$$;

revoke all on function public.save_learner_profile(jsonb) from public;
grant execute on function public.save_learner_profile(jsonb) to authenticated;
