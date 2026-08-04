-- Gives each learning item its own durable Ask YOVA conversation. Messages are
-- user-owned and protected by the same Row Level Security boundary as plans.

create table public.tutor_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  learning_item_id uuid,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint tutor_threads_learning_item_owner_fk
    foreign key (learning_item_id, user_id)
    references public.learning_items(id, user_id)
    on delete cascade
);

create table public.tutor_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tutor_thread_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 12000),
  model text,
  response_id text,
  created_at timestamptz not null default now(),
  constraint tutor_messages_thread_owner_fk
    foreign key (tutor_thread_id, user_id)
    references public.tutor_threads(id, user_id)
    on delete cascade
);

create index tutor_threads_user_updated_idx
  on public.tutor_threads(user_id, updated_at desc);
create index tutor_threads_learning_item_idx
  on public.tutor_threads(user_id, learning_item_id, updated_at desc);
create index tutor_messages_thread_created_idx
  on public.tutor_messages(tutor_thread_id, created_at asc);

create trigger tutor_threads_set_updated_at before update on public.tutor_threads
for each row execute function public.set_updated_at();

alter table public.tutor_threads enable row level security;
alter table public.tutor_messages enable row level security;

create policy "tutor_threads_owner_all" on public.tutor_threads
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "tutor_messages_owner_all" on public.tutor_messages
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function public.save_tutor_exchange(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_thread_id uuid := (payload ->> 'threadId')::uuid;
  requested_learning_item_id uuid := nullif(payload ->> 'learningItemId', '')::uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if requested_learning_item_id is not null and not exists (
    select 1
    from public.learning_items
    where id = requested_learning_item_id
      and user_id = current_user_id
  ) then
    raise exception 'The requested learning item was not found.';
  end if;

  insert into public.tutor_threads (
    id,
    user_id,
    learning_item_id,
    title
  ) values (
    requested_thread_id,
    current_user_id,
    requested_learning_item_id,
    left(coalesce(nullif(payload ->> 'title', ''), 'Ask YOVA'), 120)
  )
  on conflict (id) do update set
    updated_at = now()
  where tutor_threads.user_id = current_user_id;

  if not exists (
    select 1
    from public.tutor_threads
    where id = requested_thread_id
      and user_id = current_user_id
  ) then
    raise exception 'The requested tutor thread was not found.';
  end if;

  insert into public.tutor_messages (
    id,
    user_id,
    tutor_thread_id,
    role,
    content
  ) values (
    (payload ->> 'userMessageId')::uuid,
    current_user_id,
    requested_thread_id,
    'user',
    payload ->> 'userMessage'
  )
  on conflict (id) do nothing;

  insert into public.tutor_messages (
    id,
    user_id,
    tutor_thread_id,
    role,
    content,
    model,
    response_id
  ) values (
    (payload ->> 'assistantMessageId')::uuid,
    current_user_id,
    requested_thread_id,
    'assistant',
    payload ->> 'assistantMessage',
    nullif(payload ->> 'model', ''),
    nullif(payload ->> 'responseId', '')
  )
  on conflict (id) do nothing;

  update public.tutor_threads
  set updated_at = now()
  where id = requested_thread_id
    and user_id = current_user_id;

  return requested_thread_id;
end;
$$;

revoke all on function public.save_tutor_exchange(jsonb) from public;
grant execute on function public.save_tutor_exchange(jsonb) to authenticated;
