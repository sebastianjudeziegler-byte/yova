create or replace function public.reset_yova_learning_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  -- Learning items own plans, plan sessions, attempts, events, permanent
  -- materials, and goal-specific tutor threads through cascading keys.
  delete from public.learning_items
  where user_id = current_user_id;

  -- General tutor conversations are not attached to a learning item.
  delete from public.tutor_threads
  where user_id = current_user_id;

  -- Staged uploads are not yet attached to a learning item.
  delete from public.material_uploads
  where user_id = current_user_id;

  delete from public.learner_profiles
  where user_id = current_user_id;

  update public.profiles
  set onboarding_completed_at = null
  where id = current_user_id;
end;
$$;

revoke all on function public.reset_yova_learning_data() from public;
grant execute on function public.reset_yova_learning_data() to authenticated;
