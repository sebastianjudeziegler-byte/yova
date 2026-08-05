-- Adds a private staging area for files used while a learner is creating a
-- plan. A staged upload becomes a permanent learning-item material only when
-- the generated plan is saved successfully.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'learning-materials',
  'learning-materials',
  false,
  10485760,
  array['application/pdf', 'text/plain', 'text/markdown']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "learning_material_objects_owner_insert" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'learning-materials'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "learning_material_objects_owner_select" on storage.objects
for select to authenticated
using (
  bucket_id = 'learning-materials'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "learning_material_objects_owner_delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'learning-materials'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create table public.material_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'text/plain', 'text/markdown')),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  processing_status text not null default 'processing'
    check (processing_status in ('processing', 'ready', 'failed')),
  extracted_text text check (char_length(extracted_text) <= 50000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index material_uploads_user_id_idx on public.material_uploads(user_id);
create index material_uploads_expires_at_idx on public.material_uploads(expires_at);

alter table public.material_uploads enable row level security;

create policy "material_uploads_owner_all" on public.material_uploads
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

alter table public.materials
add column extracted_text text check (char_length(extracted_text) <= 50000);

-- Extend the existing transactional plan save so all uploaded sources become
-- attached to the newly-created learning item or none of the plan is saved.
create or replace function public.save_generated_plan(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  learning_item_id uuid := (payload ->> 'learningItemId')::uuid;
  generated_plan_id uuid := (payload ->> 'id')::uuid;
  session jsonb;
  material jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  insert into public.learning_items (
    id, user_id, title, kind, topic, deadline, status, source_mode, study_mode
  ) values (
    learning_item_id,
    current_user_id,
    payload ->> 'title',
    payload ->> 'kind',
    payload ->> 'topic',
    nullif(payload ->> 'deadline', '')::timestamptz,
    'active',
    payload ->> 'sourceMode',
    payload ->> 'studyMode'
  );

  insert into public.plans (
    id, user_id, learning_item_id, status, rationale, generation_inputs
  ) values (
    generated_plan_id,
    current_user_id,
    learning_item_id,
    payload ->> 'status',
    payload ->> 'rationale',
    coalesce(payload -> 'generationInputs', '{}'::jsonb)
  );

  for session in select value from jsonb_array_elements(payload -> 'sessions')
  loop
    insert into public.plan_sessions (
      id, user_id, plan_id, sequence, title, objective, method,
      method_rationale, scheduled_for, estimated_minutes, status, step_data
    ) values (
      (session ->> 'id')::uuid,
      current_user_id,
      generated_plan_id,
      (session ->> 'sequence')::smallint,
      session ->> 'title',
      session ->> 'objective',
      session ->> 'method',
      session ->> 'methodReason',
      (session ->> 'scheduledFor')::timestamptz,
      (session ->> 'estimatedMinutes')::smallint,
      session ->> 'status',
      jsonb_build_object('amountLabel', session ->> 'amountLabel')
    );
  end loop;

  for material in
    select value
    from jsonb_array_elements(coalesce(payload -> 'generationInputs' -> 'materials', '[]'::jsonb))
  loop
    insert into public.materials (
      id,
      user_id,
      learning_item_id,
      filename,
      storage_path,
      mime_type,
      byte_size,
      processing_status,
      extracted_text,
      metadata
    )
    select
      upload.id,
      current_user_id,
      learning_item_id,
      upload.filename,
      upload.storage_path,
      upload.mime_type,
      upload.byte_size,
      'ready',
      upload.extracted_text,
      upload.metadata || jsonb_build_object('stagedAt', upload.created_at)
    from public.material_uploads as upload
    where upload.id = (material ->> 'id')::uuid
      and upload.user_id = current_user_id
      and upload.processing_status = 'ready';

    if not found then
      raise exception 'A requested learning material is missing or not ready.';
    end if;

    delete from public.material_uploads
    where id = (material ->> 'id')::uuid
      and user_id = current_user_id;
  end loop;

  return generated_plan_id;
end;
$$;

revoke all on function public.save_generated_plan(jsonb) from public;
grant execute on function public.save_generated_plan(jsonb) to authenticated;
