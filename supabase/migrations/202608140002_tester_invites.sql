-- Founder-managed access for YOVA's invite-only tester alpha.
-- The browser cannot query or directly mutate this ledger. Supabase Auth remains the
-- identity boundary, while this table records only invitations created by a
-- trusted founder route using the server-only secret key.

create table public.tester_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  invited_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'joined')),
  send_count integer not null default 0 check (send_count >= 0),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tester_invites_normalized_email_check
    check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  constraint tester_invites_display_name_check
    check (display_name is null or char_length(display_name) between 1 and 80),
  constraint tester_invites_joined_state_check
    check (
      (status = 'pending' and joined_at is null)
      or (status = 'joined' and joined_at is not null)
    )
);

create unique index tester_invites_normalized_email_idx
on public.tester_invites (lower(email));

create index tester_invites_status_time_idx
on public.tester_invites (status, invited_at desc);

create trigger tester_invites_set_updated_at
before update on public.tester_invites
for each row execute function public.set_updated_at();

alter table public.tester_invites enable row level security;
revoke all on table public.tester_invites from public, anon, authenticated;
grant select, insert, update, delete on table public.tester_invites to service_role;

-- This check exposes only a boolean. Founder identities and the invitation
-- ledger remain unavailable through PostgREST to ordinary authenticated users.
create or replace function public.is_yova_founder()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.founder_accounts
      where user_id = auth.uid()
    );
$$;

revoke all on function public.is_yova_founder() from public, anon;
grant execute on function public.is_yova_founder() to authenticated;

-- Every signed-in request in invite-only mode calls this narrow boolean RPC.
-- A matching, successfully sent invitation is claimed on first sign-in so
-- approved pre-existing Auth users can join without exposing the ledger.
create or replace function public.claim_yova_tester_access()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  claimed_invite_id uuid;
begin
  if current_user_id is null then
    return false;
  end if;

  if exists (
    select 1
    from public.founder_accounts
    where user_id = current_user_id
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.tester_invites
    where auth_user_id = current_user_id
      and status = 'joined'
  ) then
    return true;
  end if;

  update public.tester_invites
  set
    auth_user_id = current_user_id,
    status = 'joined',
    joined_at = coalesce(joined_at, now())
  where status = 'pending'
    and send_count > 0
    and current_email <> ''
    and email = current_email
    and (auth_user_id is null or auth_user_id = current_user_id)
  returning id into claimed_invite_id;

  return claimed_invite_id is not null;
end;
$$;

revoke all on function public.claim_yova_tester_access() from public, anon;
grant execute on function public.claim_yova_tester_access() to authenticated;

-- Invitation confirmation can happen through a link or a later email code.
-- Recording acceptance at the Auth boundary keeps the ledger authoritative
-- even if the browser closes before YOVA's confirmation route completes.
create or replace function public.mark_tester_invite_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null
    and old.email_confirmed_at is null
    and new.email is not null then
    update public.tester_invites
    set
      auth_user_id = new.id,
      status = 'joined',
      joined_at = coalesce(new.email_confirmed_at, now())
    where email = lower(btrim(new.email));
  end if;

  return new;
end;
$$;

revoke all on function public.mark_tester_invite_joined() from public, anon, authenticated;

create trigger on_invited_user_email_confirmed
after update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function public.mark_tester_invite_joined();
