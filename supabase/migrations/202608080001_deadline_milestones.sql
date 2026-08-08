-- Deadline-only items belong in Agenda without becoming fake learning plans.
create table public.deadline_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'completed')),
  linked_learning_item_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint deadline_milestones_linked_item_owner_fk
    foreign key (linked_learning_item_id, user_id)
    references public.learning_items(id, user_id)
    on delete cascade
);

create index deadline_milestones_user_due_idx
on public.deadline_milestones(user_id, due_at);

create trigger deadline_milestones_set_updated_at
before update on public.deadline_milestones
for each row execute function public.set_updated_at();

alter table public.deadline_milestones enable row level security;

create policy "deadline_milestones_owner_all" on public.deadline_milestones
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
