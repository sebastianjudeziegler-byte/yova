-- Store full-document location-aware material maps and make the plan topic map
-- durable. Chunk rows intentionally outlive the short staging row because the
-- same material id moves from material_uploads into materials at activation.

alter table public.material_uploads drop constraint if exists material_uploads_extracted_text_check;
alter table public.material_uploads add constraint material_uploads_extracted_text_check
  check (char_length(extracted_text) <= 288000);
alter table public.materials drop constraint if exists materials_extracted_text_check;
alter table public.materials add constraint materials_extracted_text_check
  check (char_length(extracted_text) <= 288000);

create table public.material_chunks (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null,
  chunk_index smallint not null check (chunk_index >= 0),
  char_start integer not null check (char_start >= 0),
  char_end integer not null check (char_end > char_start),
  location_label text not null,
  section_role text not null check (section_role in ('content_source', 'scope_outline')),
  chunk_text text not null check (char_length(chunk_text) between 1 and 7000),
  created_at timestamptz not null default now(),
  unique (material_id, chunk_index)
);

create index material_chunks_user_material_idx on public.material_chunks(user_id, material_id, chunk_index);
alter table public.material_chunks enable row level security;
create policy "material_chunks_owner_all" on public.material_chunks
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on table public.material_chunks to authenticated;

alter table public.plans add column if not exists knowledge_map jsonb not null default '{"version":1,"topics":[]}'::jsonb;

-- Existing plans get a one-time structural map from their durable sessions.
-- This is deliberately not title parsing: each stored session becomes one
-- explicit topic until the learner creates a new, model-mapped plan.
update public.plans as plan
set knowledge_map = jsonb_build_object(
  'version', 1,
  'scopeJudgment', jsonb_build_object(
    'band', case when counts.session_count <= 2 then 'focused_skill' when counts.session_count <= 7 then 'unit_or_exam' else 'broad_course' end,
    'label', 'Existing plan map',
    'minimumSessions', greatest(1, counts.session_count),
    'recommendedSessions', greatest(1, counts.session_count),
    'maximumSessions', greatest(1, counts.session_count),
    'minimumTeachingSessions', 0,
    'explanation', 'This map was created once from the sessions already saved in the plan so future evidence can attach to explicit topics.'
  ),
  'topics', counts.topics
)
from (
  select
    sessions.plan_id,
    count(*)::integer as session_count,
    jsonb_agg(jsonb_build_object(
      'id', sessions.id,
      'title', sessions.title,
      'description', sessions.objective,
      'subtopics', coalesce(sessions.step_data -> 'contentTargets', '[]'::jsonb),
      'prerequisiteTopicIds', case when sessions.previous_id is null then '[]'::jsonb else jsonb_build_array(sessions.previous_id) end,
      'status', case when sessions.status = 'complete' then 'taught' else 'not_started' end,
      'sourceReferences', '[]'::jsonb,
      'origin', 'ai_generated',
      'deferred', null
    ) order by sessions.sequence) as topics
  from (
    select current_session.*, lag(current_session.id) over (partition by current_session.plan_id order by current_session.sequence) as previous_id
    from public.plan_sessions as current_session
  ) as sessions
  group by sessions.plan_id
) as counts
where counts.plan_id = plan.id
  and jsonb_array_length(coalesce(plan.knowledge_map -> 'topics', '[]'::jsonb)) = 0;

update public.plan_sessions
set step_data = coalesce(step_data, '{}'::jsonb) || jsonb_build_object('topicIds', jsonb_build_array(id))
where jsonb_array_length(coalesce(step_data -> 'topicIds', '[]'::jsonb)) = 0;

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
  if current_user_id is null then raise exception 'Authentication is required.'; end if;

  insert into public.learning_items (
    id, user_id, title, kind, topic, deadline, status, source_mode, study_mode
  ) values (
    learning_item_id, current_user_id, payload ->> 'title', payload ->> 'kind', payload ->> 'topic',
    nullif(payload ->> 'deadline', '')::timestamptz, 'active', payload ->> 'sourceMode', payload ->> 'studyMode'
  );

  insert into public.plans (
    id, user_id, learning_item_id, status, rationale, generation_inputs, knowledge_map
  ) values (
    generated_plan_id, current_user_id, learning_item_id, payload ->> 'status', payload ->> 'rationale',
    coalesce(payload -> 'generationInputs', '{}'::jsonb), coalesce(payload -> 'knowledgeMap', '{"version":1,"topics":[]}'::jsonb)
  );

  for session in select value from jsonb_array_elements(payload -> 'sessions') loop
    insert into public.plan_sessions (
      id, user_id, plan_id, sequence, title, objective, method,
      method_rationale, scheduled_for, estimated_minutes, status, step_data
    ) values (
      (session ->> 'id')::uuid, current_user_id, generated_plan_id, (session ->> 'sequence')::smallint,
      session ->> 'title', session ->> 'objective', session ->> 'method', session ->> 'methodReason',
      (session ->> 'scheduledFor')::timestamptz, (session ->> 'estimatedMinutes')::smallint, session ->> 'status',
      jsonb_build_object(
        'amountLabel', session ->> 'amountLabel',
        'learningMode', session ->> 'learningMode',
        'topicIds', coalesce(session -> 'topicIds', '[]'::jsonb),
        'contentTargets', coalesce(session -> 'contentTargets', '[]'::jsonb),
        'completionEvidence', coalesce(session -> 'completionEvidence', '[]'::jsonb)
      )
    );
  end loop;

  for material in select value from jsonb_array_elements(coalesce(payload -> 'generationInputs' -> 'materials', '[]'::jsonb)) loop
    insert into public.materials (
      id, user_id, learning_item_id, filename, storage_path, mime_type, byte_size,
      processing_status, extracted_text, metadata
    )
    select upload.id, current_user_id, learning_item_id, upload.filename, upload.storage_path,
      upload.mime_type, upload.byte_size, 'ready', upload.extracted_text,
      upload.metadata || jsonb_build_object('stagedAt', upload.created_at)
    from public.material_uploads as upload
    where upload.id = (material ->> 'id')::uuid and upload.user_id = current_user_id
      and upload.processing_status = 'ready';
    if not found then raise exception 'A requested learning material is missing or not ready.'; end if;
    delete from public.material_uploads where id = (material ->> 'id')::uuid and user_id = current_user_id;
  end loop;

  return generated_plan_id;
end;
$$;

revoke all on function public.save_generated_plan(jsonb) from public;
grant execute on function public.save_generated_plan(jsonb) to authenticated;
