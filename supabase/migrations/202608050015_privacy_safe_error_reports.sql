-- First-party error monitoring for the private alpha. Reports intentionally
-- contain bounded technical labels only: no study content, tutor messages,
-- learner answers, arbitrary error messages, or stack traces.

create table public.error_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  surface text not null check (surface in (
    'route_boundary',
    'global_boundary',
    'cloud_sync',
    'plan_generation',
    'session_generation',
    'session_completion',
    'tutor',
    'materials',
    'support'
  )),
  error_code text not null check (error_code ~ '^[a-z0-9_]{3,80}$'),
  error_digest text check (error_digest is null or char_length(error_digest) between 1 and 160),
  route_path text check (
    route_path is null
    or (char_length(route_path) between 1 and 240 and route_path ~ '^/[A-Za-z0-9/_-]*$')
  ),
  request_id text check (request_id is null or char_length(request_id) between 1 and 160),
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  occurred_at timestamptz not null default now()
);

create index error_reports_status_time_idx
on public.error_reports(status, occurred_at desc);

create index error_reports_user_time_idx
on public.error_reports(user_id, occurred_at desc);

alter table public.error_reports enable row level security;

create policy "error_reports_owner_insert" on public.error_reports
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "error_reports_owner_select" on public.error_reports
for select to authenticated
using ((select auth.uid()) = user_id);

grant select, insert on public.error_reports to authenticated;
revoke update, delete on public.error_reports from authenticated;

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

  delete from public.error_reports
  where user_id = current_user_id;

  update public.profiles
  set onboarding_completed_at = null
  where id = current_user_id;
end;
$$;

revoke all on function public.reset_yova_learning_data() from public;
grant execute on function public.reset_yova_learning_data() to authenticated;
