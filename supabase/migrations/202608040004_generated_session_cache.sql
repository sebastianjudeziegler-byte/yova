-- Caches generated guided-session activities on the plan session itself. This
-- prevents repeated API charges and keeps the same session stable when reopened.

create or replace function public.cache_generated_session(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_session_id uuid := (payload ->> 'planSessionId')::uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  update public.plan_sessions
  set step_data = coalesce(step_data, '{}'::jsonb)
    || jsonb_build_object('generatedSession', payload -> 'generatedSession')
  where id = requested_session_id
    and user_id = current_user_id;

  if not found then
    raise exception 'The requested session was not found.';
  end if;
end;
$$;

revoke all on function public.cache_generated_session(jsonb) from public;
grant execute on function public.cache_generated_session(jsonb) to authenticated;
