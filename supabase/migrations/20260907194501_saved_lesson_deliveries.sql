-- Keep delivered prose separate from the immutable generated-session contract
-- so saving a lesson cannot invalidate checkpoints or change assessed content.
create table public.session_lesson_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  plan_session_id uuid not null references public.plan_sessions(id) on delete cascade,
  resource_fingerprint text not null check (resource_fingerprint ~ '^[a-f0-9]{64}$'),
  activity_index integer not null check (activity_index between 0 and 40),
  content text not null check (length(btrim(content)) between 1 and 12000),
  delivery_mode text not null check (delivery_mode in ('generated','bounded_fallback')),
  model text not null check (length(btrim(model)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (plan_session_id, resource_fingerprint, activity_index)
);
create index session_lesson_deliveries_owner on public.session_lesson_deliveries(user_id);
alter table public.session_lesson_deliveries enable row level security;
revoke all on public.session_lesson_deliveries from public, anon, authenticated, service_role;
grant select on public.session_lesson_deliveries to authenticated;
grant select, insert on public.session_lesson_deliveries to service_role;
create policy "Owners can read delivered lessons" on public.session_lesson_deliveries
  for select to authenticated using (user_id = (select auth.uid()));

-- The trusted server may insert only a consistent owner/plan/session tuple.
create function public.check_lesson_delivery_owner_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.plan_sessions s join public.plans p on p.id = s.plan_id
    where s.id = new.plan_session_id and s.plan_id = new.plan_id
      and s.user_id = new.user_id and p.user_id = new.user_id
  ) then
    raise exception using errcode='23503', message='lesson_delivery_owner_mismatch';
  end if;
  return new;
end;
$$;
revoke all on function public.check_lesson_delivery_owner_v1() from public, anon, authenticated, service_role;
create trigger check_lesson_delivery_owner before insert on public.session_lesson_deliveries
  for each row execute function public.check_lesson_delivery_owner_v1();
