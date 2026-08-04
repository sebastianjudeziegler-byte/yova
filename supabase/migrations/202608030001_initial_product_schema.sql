-- YOVA's first durable product schema.
-- Every user-owned table includes user_id so Row Level Security stays simple,
-- visible, and fast as the product grows.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.learner_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  common_blocker text,
  guidance_preference text,
  preferred_session_min smallint check (preferred_session_min between 5 and 180),
  preferred_session_max smallint check (preferred_session_max between 5 and 180),
  explanation_preference text,
  focus_frequency text,
  starting_pattern text,
  energy_window text,
  primary_improvement_goal text,
  additional_context text,
  profile_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.learning_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  kind text not null check (kind in ('test', 'topic', 'course', 'book', 'skill')),
  topic text not null,
  deadline timestamptz,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  source_mode text not null check (source_mode in ('user_materials', 'yova_generated')),
  study_mode text not null check (study_mode in ('inside_yova', 'outside_yova')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  learning_item_id uuid not null,
  status text not null default 'active' check (status in ('draft', 'active', 'completed', 'archived')),
  rationale text not null,
  generation_inputs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint plans_learning_item_owner_fk
    foreign key (learning_item_id, user_id)
    references public.learning_items(id, user_id)
    on delete cascade
);

create table public.plan_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null,
  sequence smallint not null check (sequence > 0),
  title text not null,
  objective text not null,
  method text not null,
  method_rationale text not null,
  scheduled_for timestamptz,
  estimated_minutes smallint not null check (estimated_minutes between 1 and 360),
  status text not null default 'upcoming' check (status in ('ready', 'upcoming', 'complete', 'skipped')),
  step_data jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (plan_id, sequence),
  constraint plan_sessions_plan_owner_fk
    foreign key (plan_id, user_id)
    references public.plans(id, user_id)
    on delete cascade
);

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  learning_item_id uuid not null,
  filename text not null,
  storage_path text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  processing_status text not null default 'uploaded'
    check (processing_status in ('uploaded', 'processing', 'ready', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint materials_learning_item_owner_fk
    foreign key (learning_item_id, user_id)
    references public.learning_items(id, user_id)
    on delete cascade
);

create table public.session_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_session_id uuid not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  actual_minutes smallint check (actual_minutes between 0 and 720),
  correct_answers smallint check (correct_answers >= 0),
  total_answers smallint check (total_answers >= 0),
  user_feedback text check (user_feedback in ('too_easy', 'about_right', 'too_difficult')),
  result_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint session_attempts_session_owner_fk
    foreign key (plan_session_id, user_id)
    references public.plan_sessions(id, user_id)
    on delete cascade
);

create table public.learning_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  learning_item_id uuid,
  plan_session_id uuid,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint learning_events_item_owner_fk
    foreign key (learning_item_id, user_id)
    references public.learning_items(id, user_id)
    on delete cascade,
  constraint learning_events_session_owner_fk
    foreign key (plan_session_id, user_id)
    references public.plan_sessions(id, user_id)
    on delete cascade
);

create index learning_items_user_id_idx on public.learning_items(user_id);
create index plans_user_id_idx on public.plans(user_id);
create index plan_sessions_user_id_idx on public.plan_sessions(user_id);
create index materials_user_id_idx on public.materials(user_id);
create index session_attempts_user_id_idx on public.session_attempts(user_id);
create index learning_events_user_id_idx on public.learning_events(user_id);
create index learning_events_user_time_idx on public.learning_events(user_id, occurred_at desc);

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger learner_profiles_set_updated_at before update on public.learner_profiles
for each row execute function public.set_updated_at();
create trigger learning_items_set_updated_at before update on public.learning_items
for each row execute function public.set_updated_at();
create trigger plans_set_updated_at before update on public.plans
for each row execute function public.set_updated_at();
create trigger plan_sessions_set_updated_at before update on public.plan_sessions
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.learner_profiles enable row level security;
alter table public.learning_items enable row level security;
alter table public.plans enable row level security;
alter table public.plan_sessions enable row level security;
alter table public.materials enable row level security;
alter table public.session_attempts enable row level security;
alter table public.learning_events enable row level security;

create policy "profiles_owner_all" on public.profiles
for all to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "learner_profiles_owner_all" on public.learner_profiles
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "learning_items_owner_all" on public.learning_items
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "plans_owner_all" on public.plans
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "plan_sessions_owner_all" on public.plan_sessions
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "materials_owner_all" on public.materials
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "session_attempts_owner_all" on public.session_attempts
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "learning_events_owner_all" on public.learning_events
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
