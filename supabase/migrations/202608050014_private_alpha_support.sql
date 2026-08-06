-- A real private-alpha support path. Requests are linked to the signed-in
-- account so testers do not need to repeat private account details in a form.

create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in (
    'account', 'plan', 'session', 'materials', 'billing', 'feedback', 'other'
  )),
  subject text not null check (char_length(subject) between 3 and 120),
  message text not null check (char_length(message) between 10 and 4000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  created_at timestamptz not null default now()
);

create index support_requests_user_time_idx
on public.support_requests(user_id, created_at desc);

create index support_requests_status_time_idx
on public.support_requests(status, created_at desc);

alter table public.support_requests enable row level security;

create policy "support_requests_owner_insert" on public.support_requests
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "support_requests_owner_select" on public.support_requests
for select to authenticated
using ((select auth.uid()) = user_id);

grant select, insert on public.support_requests to authenticated;
revoke update, delete on public.support_requests from authenticated;
