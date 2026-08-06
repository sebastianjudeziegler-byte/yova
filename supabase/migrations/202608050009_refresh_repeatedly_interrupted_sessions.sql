create or replace function public.refresh_repeatedly_interrupted_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  interruption_count integer;
begin
  if new.event_type <> 'session_interrupted' or new.plan_session_id is null then
    return new;
  end if;

  select count(*)
  into interruption_count
  from public.learning_events
  where user_id = new.user_id
    and plan_session_id = new.plan_session_id
    and event_type = 'session_interrupted';

  if interruption_count >= 2 then
    update public.plan_sessions
    set step_data = (
      case when jsonb_typeof(step_data) = 'object' then step_data else '{}'::jsonb end
      - 'generatedSession'
    ) || jsonb_build_object(
      'interruptionCount', interruption_count,
      'regenerateReason', 'repeated_interruption'
    )
    where id = new.plan_session_id
      and user_id = new.user_id
      and status = 'ready';
  end if;

  return new;
end;
$$;

drop trigger if exists learning_events_refresh_interrupted_session on public.learning_events;
create trigger learning_events_refresh_interrupted_session
after insert on public.learning_events
for each row execute function public.refresh_repeatedly_interrupted_session();
