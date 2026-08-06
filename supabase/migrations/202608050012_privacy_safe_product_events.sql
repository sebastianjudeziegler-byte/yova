-- First-party product analytics for the private alpha. Events intentionally
-- contain only bounded funnel facts; raw study questions and materials do not
-- belong in this table.

create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null check (event_name in (
    'onboarding_started',
    'onboarding_completed',
    'alpha_entered',
    'plan_created',
    'session_started',
    'session_completed',
    'session_interrupted',
    'tutor_message_sent'
  )),
  event_data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint product_events_data_object check (jsonb_typeof(event_data) = 'object'),
  constraint product_events_data_size check (octet_length(event_data::text) <= 2048)
);

create index product_events_user_time_idx
on public.product_events(user_id, occurred_at desc);

create index product_events_funnel_idx
on public.product_events(event_name, occurred_at desc);

alter table public.product_events enable row level security;

create policy "product_events_owner_insert" on public.product_events
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "product_events_owner_select" on public.product_events
for select to authenticated
using ((select auth.uid()) = user_id);

grant select, insert on public.product_events to authenticated;
revoke update, delete on public.product_events from authenticated;

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

  delete from public.learning_items
  where user_id = current_user_id;

  delete from public.tutor_threads
  where user_id = current_user_id;

  delete from public.material_uploads
  where user_id = current_user_id;

  delete from public.learner_profiles
  where user_id = current_user_id;

  delete from public.product_events
  where user_id = current_user_id;

  update public.profiles
  set onboarding_completed_at = null
  where id = current_user_id;
end;
$$;

revoke all on function public.reset_yova_learning_data() from public;
grant execute on function public.reset_yova_learning_data() to authenticated;
