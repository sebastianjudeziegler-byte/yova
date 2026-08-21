-- Make active-plan material attachment atomic, idempotent and source-grounded.
-- The application computes a conservative reconciliation that keeps every
-- existing topic identity stable; this transaction verifies that only source
-- provenance changed and that every new reference names a durable mapped chunk.

-- Mapping completion is one database truth: chunks, understanding metadata and
-- the learner-visible Ready status commit together. A platform timeout before
-- this transaction leaves the row processing and eligible for compensation;
-- it can never expose a Ready row with no durable map.
create or replace function public.persist_material_mapping_result(
  requested_material_table text,
  requested_material_id uuid,
  requested_metadata_patch jsonb,
  requested_chunks jsonb,
  requested_observation jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  material_exists boolean := false;
  mark_ready boolean := false;
begin
  if current_user_id is null then raise exception 'Authentication is required.'; end if;
  if requested_material_table not in ('material_uploads', 'materials') then
    raise exception 'The material table is not valid.';
  end if;
  if jsonb_typeof(requested_metadata_patch) is distinct from 'object'
    or jsonb_typeof(requested_chunks) is distinct from 'array'
    or jsonb_typeof(requested_observation) is distinct from 'object' then
    raise exception 'The material mapping result is not valid.';
  end if;
  if requested_metadata_patch ->> 'mappingStatus' = 'ready'
    and (
      jsonb_typeof(requested_metadata_patch -> 'materialUnderstanding') is distinct from 'object'
      or jsonb_array_length(requested_chunks) < 1
    ) then
    raise exception 'The material mapping result is incomplete.';
  end if;
  mark_ready := requested_metadata_patch ->> 'mappingStatus' = 'ready';
  if mark_ready and (
    exists (
      select 1
      from jsonb_array_elements(requested_metadata_patch -> 'materialUnderstanding' -> 'topics') as topic(value),
        jsonb_array_elements(topic.value -> 'sourceReferences') as reference(value)
      where (reference.value ->> 'materialId')::uuid <> requested_material_id
        or not exists (
          select 1
          from jsonb_array_elements(requested_chunks) as chunk(value)
          where (chunk.value ->> 'id')::uuid = (reference.value ->> 'chunkId')::uuid
            and (chunk.value ->> 'chunkIndex')::smallint = (reference.value ->> 'chunkIndex')::smallint
            and (chunk.value ->> 'charStart')::integer = (reference.value ->> 'startCharacter')::integer
            and (chunk.value ->> 'charEnd')::integer = (reference.value ->> 'endCharacter')::integer
            and chunk.value ->> 'locationLabel' = reference.value ->> 'locationLabel'
            and chunk.value ->> 'sectionRole' = reference.value ->> 'sectionRole'
        )
    )
    or exists (
      select 1
      from jsonb_array_elements(requested_chunks) as chunk(value)
      where not exists (
        select 1
        from jsonb_array_elements(requested_metadata_patch -> 'materialUnderstanding' -> 'topics') as topic(value),
          jsonb_array_elements(topic.value -> 'sourceReferences') as reference(value)
        where (reference.value ->> 'chunkId')::uuid = (chunk.value ->> 'id')::uuid
      )
    )
  ) then
    raise exception 'The material mapping result is incomplete.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  if requested_material_table = 'material_uploads' then
    select true into material_exists
    from public.material_uploads
    where id = requested_material_id and user_id = current_user_id
    for update;
  else
    select true into material_exists
    from public.materials
    where id = requested_material_id and user_id = current_user_id
    for update;
  end if;
  if material_exists is not true then return false; end if;

  insert into public.material_chunks (
    id, user_id, material_id, chunk_index, char_start, char_end,
    location_label, section_role, chunk_text
  )
  select
    (chunk ->> 'id')::uuid,
    current_user_id,
    requested_material_id,
    (chunk ->> 'chunkIndex')::smallint,
    (chunk ->> 'charStart')::integer,
    (chunk ->> 'charEnd')::integer,
    chunk ->> 'locationLabel',
    chunk ->> 'sectionRole',
    chunk ->> 'chunkText'
  from jsonb_array_elements(requested_chunks) as chunk
  on conflict (material_id, chunk_index) do update set
    id = excluded.id,
    user_id = excluded.user_id,
    char_start = excluded.char_start,
    char_end = excluded.char_end,
    location_label = excluded.location_label,
    section_role = excluded.section_role,
    chunk_text = excluded.chunk_text;

  -- Advance the learner-visible status last. The row lock and transaction
  -- make the chunks, understanding metadata and Ready state one commit.
  if requested_material_table = 'material_uploads' then
    update public.material_uploads
    set
      metadata = metadata || requested_metadata_patch,
      processing_status = case when mark_ready then 'ready' else processing_status end
    where id = requested_material_id and user_id = current_user_id;
  else
    update public.materials
    set
      metadata = metadata || requested_metadata_patch,
      processing_status = case when mark_ready then 'ready' else processing_status end
    where id = requested_material_id and user_id = current_user_id;
  end if;

  insert into public.product_events (user_id, event_name, event_data)
  values (current_user_id, 'generation_observed', requested_observation);

  return true;
end;
$$;

revoke all on function public.persist_material_mapping_result(text, uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.persist_material_mapping_result(text, uuid, jsonb, jsonb, jsonb) to authenticated;

create or replace function public.attach_materials_to_plan(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_plan public.plans%rowtype;
  candidate_map jsonb := payload -> 'knowledgeMap';
  material_id_value jsonb;
  requested_material_id uuid;
  requested_ids uuid[] := '{}';
  attached_count integer := 0;
  existing_count integer := 0;
  new_count integer := 0;
  attached_materials jsonb;
  normalized_topics jsonb;
begin
  if current_user_id is null then raise exception 'Authentication is required.'; end if;
  if jsonb_typeof(payload) is distinct from 'object'
    or jsonb_typeof(payload -> 'planId') is distinct from 'string'
    or (payload ->> 'planId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(payload -> 'materialIds') is distinct from 'array'
    or jsonb_array_length(payload -> 'materialIds') < 1
    or jsonb_array_length(payload -> 'materialIds') > 5 then
    raise exception 'Choose between one and five materials.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(payload -> 'materialIds') as material_id(value)
    where jsonb_typeof(material_id.value) is distinct from 'string'
      or (material_id.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'Choose between one and five materials.';
  end if;
  if jsonb_typeof(candidate_map) is distinct from 'object'
    or jsonb_typeof(candidate_map -> 'version') is distinct from 'number'
    or candidate_map ->> 'version' is distinct from '1'
    or jsonb_typeof(candidate_map -> 'topics') is distinct from 'array'
    or jsonb_array_length(candidate_map -> 'topics') < 1 then
    raise exception 'material_plan_rebuild_required';
  end if;

  for material_id_value in select value from jsonb_array_elements(payload -> 'materialIds') loop
    requested_material_id := trim(both '"' from material_id_value::text)::uuid;
    if requested_material_id = any(requested_ids) then
      raise exception 'Each material may only be attached once.';
    end if;
    requested_ids := array_append(requested_ids, requested_material_id);
  end loop;

  select * into requested_plan
  from public.plans
  where id = (payload ->> 'planId')::uuid
    and user_id = current_user_id
  for update;
  if not found then raise exception 'The requested plan was not found.'; end if;
  if requested_plan.status <> 'active' then raise exception 'Materials can only be added to an active plan.'; end if;
  if jsonb_typeof(requested_plan.knowledge_map) is distinct from 'object'
    or jsonb_typeof(requested_plan.knowledge_map -> 'topics') is distinct from 'array'
    or jsonb_array_length(requested_plan.knowledge_map -> 'topics') < 1 then
    raise exception 'material_plan_rebuild_required';
  end if;

  -- Zod supplies these non-semantic defaults when older knowledge maps are
  -- read. Normalize the locked comparison copy the same way so a legacy plan
  -- is not falsely treated as a topic rewrite merely because its JSON omitted
  -- a default key.
  select jsonb_agg(
    topic.value
      || case when topic.value ? 'subtopics' then '{}'::jsonb else '{"subtopics":[]}'::jsonb end
      || case when topic.value ? 'prerequisiteTopicIds' then '{}'::jsonb else '{"prerequisiteTopicIds":[]}'::jsonb end
      || case when topic.value ? 'status' then '{}'::jsonb else '{"status":"not_started"}'::jsonb end
      || case when topic.value ? 'initialEvidence' then '{}'::jsonb else '{"initialEvidence":null}'::jsonb end
      || case when topic.value ? 'sourceReferences' then '{}'::jsonb else '{"sourceReferences":[]}'::jsonb end
      || case when topic.value ? 'deferred' then '{}'::jsonb else '{"deferred":null}'::jsonb end
    order by topic.position
  ) into normalized_topics
  from jsonb_array_elements(requested_plan.knowledge_map -> 'topics')
    with ordinality as topic(value, position);
  requested_plan.knowledge_map := jsonb_set(
    requested_plan.knowledge_map,
    '{topics}',
    normalized_topics
  );
  if not (requested_plan.knowledge_map ? 'placementCheck') then
    requested_plan.knowledge_map := requested_plan.knowledge_map || jsonb_build_object(
      'placementCheck',
      jsonb_build_object(
        'status', 'available',
        'completedAt', null,
        'demonstratedTopicIds', '[]'::jsonb,
        'gapTopicIds', '[]'::jsonb
      )
    );
  end if;

  -- Serialize with cache/checkpoint writers before inspecting saved work. The
  -- plan lock alone is insufficient because those writers lock session rows.
  perform session.id
  from public.plan_sessions as session
  where session.plan_id = requested_plan.id
    and session.user_id = current_user_id
    and session.status in ('ready', 'upcoming')
  for update;

  -- A source change invalidates generated lesson content and recovery
  -- fingerprints. Refuse it when any unfinished row has material or progress,
  -- matching the plan-adjustment protection boundary.
  if exists (
    select 1
    from public.plan_sessions as session
    where session.plan_id = requested_plan.id
      and session.user_id = current_user_id
      and session.status in ('ready', 'upcoming')
      and (
        (
          jsonb_typeof(session.step_data) = 'object'
          and (
            session.step_data ? 'generatedSession'
            or session.step_data ? 'activeSessionCheckpoint'
          )
        )
        or exists (
          select 1 from public.learning_events as event
          where event.user_id = current_user_id
            and event.plan_session_id = session.id
            and event.event_type = 'session_interrupted'
        )
      )
  ) then
    raise exception 'material_attachment_saved_work_protected';
  end if;

  -- The app may add sourceReferences and change origin to material. Topic ids,
  -- ordering, scope, evidence, status and learner-reviewed wording are fixed.
  if (candidate_map - 'topics') is distinct from (requested_plan.knowledge_map - 'topics')
    or jsonb_array_length(candidate_map -> 'topics')
      <> jsonb_array_length(requested_plan.knowledge_map -> 'topics')
    or exists (
      select 1
      from jsonb_array_elements(requested_plan.knowledge_map -> 'topics') with ordinality as stored(topic, position)
      join jsonb_array_elements(candidate_map -> 'topics') with ordinality as candidate(topic, position)
        using (position)
      where candidate.topic ->> 'id' is distinct from stored.topic ->> 'id'
    )
    or exists (
      select 1
      from jsonb_array_elements(requested_plan.knowledge_map -> 'topics') as stored(topic)
      where not exists (
        select 1
        from jsonb_array_elements(candidate_map -> 'topics') as candidate(topic)
        where candidate.topic ->> 'id' = stored.topic ->> 'id'
          and (candidate.topic - 'sourceReferences' - 'origin')
            = (stored.topic - 'sourceReferences' - 'origin')
      )
    )
    or exists (
      select 1
      from jsonb_array_elements(candidate_map -> 'topics') as candidate(topic)
      where not exists (
        select 1
        from jsonb_array_elements(requested_plan.knowledge_map -> 'topics') as stored(topic)
        where stored.topic ->> 'id' = candidate.topic ->> 'id'
      )
  ) then
    raise exception 'material_plan_rebuild_required';
  end if;

  -- Keep the persisted map schema-valid even for a direct authenticated RPC
  -- caller. Existing references must remain a byte-for-byte ordered prefix;
  -- only canonical, unique additions may follow them.
  if exists (
    select 1
    from jsonb_array_elements(candidate_map -> 'topics') as candidate(topic)
    where jsonb_typeof(candidate.topic) is distinct from 'object'
      or jsonb_typeof(candidate.topic -> 'sourceReferences') is distinct from 'array'
      or coalesce(candidate.topic ->> 'origin', '') not in ('material', 'ai_generated')
  ) then
    raise exception 'material_source_reference_invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(candidate_map -> 'topics') as candidate(topic)
    where exists (
        select 1
        from jsonb_array_elements(candidate.topic -> 'sourceReferences') as reference(value)
        where jsonb_typeof(reference.value) is distinct from 'object'
      )
      or jsonb_array_length(candidate.topic -> 'sourceReferences') > 40
      or (
        select count(*)
        from jsonb_array_elements(candidate.topic -> 'sourceReferences') as reference(value)
      ) <> (
        select count(distinct reference.value)
        from jsonb_array_elements(candidate.topic -> 'sourceReferences') as reference(value)
      )
  ) then
    raise exception 'material_source_reference_invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(requested_plan.knowledge_map -> 'topics') as stored(topic)
    join jsonb_array_elements(candidate_map -> 'topics') as candidate(topic)
      on candidate.topic ->> 'id' = stored.topic ->> 'id'
    join lateral jsonb_array_elements(coalesce(stored.topic -> 'sourceReferences', '[]'::jsonb))
      with ordinality as stored_reference(value, position) on true
    where candidate.topic -> 'sourceReferences' -> ((stored_reference.position - 1)::integer)
      is distinct from stored_reference.value
  ) then
    raise exception 'material_source_reference_invalid';
  end if;

  -- Completed-only topic provenance is learner history, not attachment scope.
  -- Only a topic used by an unfinished session may receive new references.
  if exists (
    select 1
    from jsonb_array_elements(requested_plan.knowledge_map -> 'topics') as stored(topic)
    join jsonb_array_elements(candidate_map -> 'topics') as candidate(topic)
      on candidate.topic ->> 'id' = stored.topic ->> 'id'
    where not exists (
      select 1
      from public.plan_sessions as session,
        jsonb_array_elements_text(coalesce(session.step_data -> 'topicIds', '[]'::jsonb)) as session_topic(id)
      where session.plan_id = requested_plan.id
        and session.user_id = current_user_id
        and session.status in ('ready', 'upcoming')
        and session_topic.id = stored.topic ->> 'id'
    )
      and (
        candidate.topic -> 'sourceReferences' is distinct from stored.topic -> 'sourceReferences'
        or candidate.topic -> 'origin' is distinct from stored.topic -> 'origin'
      )
  ) then
    raise exception 'material_plan_rebuild_required';
  end if;

  -- Existing provenance is append-only at this boundary. A direct RPC caller
  -- must not be able to remove, edit, or move a previously accepted reference
  -- while asking to attach an unrelated material.
  if exists (
    select 1
    from jsonb_array_elements(requested_plan.knowledge_map -> 'topics') as stored(topic),
      jsonb_array_elements(coalesce(stored.topic -> 'sourceReferences', '[]'::jsonb)) as stored_reference(value)
    where not exists (
      select 1
      from jsonb_array_elements(candidate_map -> 'topics') as candidate(topic),
        jsonb_array_elements(coalesce(candidate.topic -> 'sourceReferences', '[]'::jsonb)) as candidate_reference(value)
      where candidate.topic ->> 'id' = stored.topic ->> 'id'
        and candidate_reference.value = stored_reference.value
    )
  ) then
    raise exception 'material_source_reference_invalid';
  end if;

  -- Every newly added reference must come from this request. An existing
  -- attached material cannot introduce a new location unless explicitly
  -- selected as one of requested_ids.
  if exists (
    select 1
    from jsonb_array_elements(candidate_map -> 'topics') as candidate(topic),
      jsonb_array_elements(coalesce(candidate.topic -> 'sourceReferences', '[]'::jsonb)) as candidate_reference(value)
    where not exists (
      select 1
      from jsonb_array_elements(requested_plan.knowledge_map -> 'topics') as stored(topic),
        jsonb_array_elements(coalesce(stored.topic -> 'sourceReferences', '[]'::jsonb)) as stored_reference(value)
      where stored.topic ->> 'id' = candidate.topic ->> 'id'
        and stored_reference.value = candidate_reference.value
    )
      and (candidate_reference.value ->> 'materialId')::uuid <> all(requested_ids)
  ) then
    raise exception 'material_source_reference_invalid';
  end if;

  -- Origin may only become material on a topic that receives a verified new
  -- reference. With no new reference, the stored origin is immutable.
  if exists (
    select 1
    from jsonb_array_elements(candidate_map -> 'topics') as candidate(topic)
    join jsonb_array_elements(requested_plan.knowledge_map -> 'topics') as stored(topic)
      on stored.topic ->> 'id' = candidate.topic ->> 'id'
    where case
      when exists (
        select 1
        from jsonb_array_elements(coalesce(candidate.topic -> 'sourceReferences', '[]'::jsonb)) as candidate_reference(value)
        where (candidate_reference.value ->> 'materialId')::uuid = any(requested_ids)
          and not exists (
            select 1
            from jsonb_array_elements(coalesce(stored.topic -> 'sourceReferences', '[]'::jsonb)) as stored_reference(value)
            where stored_reference.value = candidate_reference.value
          )
      ) then candidate.topic ->> 'origin' <> 'material'
      else (candidate.topic -> 'origin') is distinct from (stored.topic -> 'origin')
    end
  ) then
    raise exception 'material_source_reference_invalid';
  end if;

  select count(*) into existing_count
  from public.materials
  where learning_item_id = requested_plan.learning_item_id
    and user_id = current_user_id;
  select count(*) into new_count
  from unnest(requested_ids) as requested(id)
  where not exists (
    select 1 from public.materials as material
    where material.id = requested.id
      and material.learning_item_id = requested_plan.learning_item_id
      and material.user_id = current_user_id
  );
  if existing_count + new_count > 5 then
    raise exception 'A learning goal can use up to five materials.';
  end if;

  -- Every selected row, including an idempotent retry, must have a complete
  -- understanding plus at least one durable chunk before it can be Ready.
  if exists (
    select 1 from unnest(requested_ids) as requested(id)
    where not exists (
      select 1 from public.material_uploads as upload
      where upload.id = requested.id
        and upload.user_id = current_user_id
        and upload.processing_status = 'ready'
        and upload.metadata ->> 'mappingStatus' = 'ready'
        and jsonb_typeof(upload.metadata -> 'materialUnderstanding') = 'object'
        and exists (
          select 1 from public.material_chunks as chunk
          where chunk.material_id = upload.id and chunk.user_id = current_user_id
        )
      union all
      select 1 from public.materials as material
      where material.id = requested.id
        and material.user_id = current_user_id
        and material.learning_item_id = requested_plan.learning_item_id
        and material.processing_status = 'ready'
        and material.metadata ->> 'mappingStatus' = 'ready'
        and jsonb_typeof(material.metadata -> 'materialUnderstanding') = 'object'
        and exists (
          select 1 from public.material_chunks as chunk
          where chunk.material_id = material.id and chunk.user_id = current_user_id
        )
    )
  ) then
    raise exception 'material_mapping_incomplete';
  end if;

  -- Every candidate reference, including preserved provenance, must agree with
  -- a user-owned durable chunk. Its material must already belong to this
  -- learning item or be one of the staged/requested attachments.
  if exists (
    select 1
    from jsonb_array_elements(candidate_map -> 'topics') as topic(value),
      jsonb_array_elements(topic.value -> 'sourceReferences') as reference(value)
    where not exists (
        select 1 from public.material_chunks as chunk
        where chunk.user_id = current_user_id
          and chunk.material_id = (reference.value ->> 'materialId')::uuid
          and chunk.id = (reference.value ->> 'chunkId')::uuid
          and chunk.chunk_index = (reference.value ->> 'chunkIndex')::smallint
          and chunk.char_start = (reference.value ->> 'startCharacter')::integer
          and chunk.char_end = (reference.value ->> 'endCharacter')::integer
          and chunk.location_label = reference.value ->> 'locationLabel'
          and chunk.section_role = reference.value ->> 'sectionRole'
          and (
            exists (
              select 1 from public.materials as material
              where material.id = chunk.material_id
                and material.user_id = current_user_id
                and material.learning_item_id = requested_plan.learning_item_id
            )
            or (
              chunk.material_id = any(requested_ids)
              and exists (
                select 1 from public.material_uploads as upload
                where upload.id = chunk.material_id
                  and upload.user_id = current_user_id
              )
            )
          )
      )
  ) then
    raise exception 'material_source_reference_invalid';
  end if;
  if exists (
    select 1 from unnest(requested_ids) as requested(id)
    where not exists (
      select 1
      from jsonb_array_elements(candidate_map -> 'topics') as topic(value),
        jsonb_array_elements(topic.value -> 'sourceReferences') as reference(value)
      where (reference.value ->> 'materialId')::uuid = requested.id
    )
  ) then
    raise exception 'material_plan_rebuild_required';
  end if;
  if exists (
    select 1 from unnest(requested_ids) as requested(id)
    where not exists (
      select 1
      from public.plan_sessions as session,
        jsonb_array_elements_text(coalesce(session.step_data -> 'topicIds', '[]'::jsonb)) as session_topic(id),
        jsonb_array_elements(candidate_map -> 'topics') as topic(value),
        jsonb_array_elements(topic.value -> 'sourceReferences') as reference(value)
      where session.plan_id = requested_plan.id
        and session.user_id = current_user_id
        and session.status in ('ready', 'upcoming')
        and topic.value ->> 'id' = session_topic.id
        and (reference.value ->> 'materialId')::uuid = requested.id
    )
  ) then
    raise exception 'material_plan_rebuild_required';
  end if;

  for requested_material_id in select unnest(requested_ids) loop
    if exists (
      select 1 from public.materials
      where id = requested_material_id
        and user_id = current_user_id
        and learning_item_id = requested_plan.learning_item_id
    ) then
      continue;
    end if;

    insert into public.materials (
      id, user_id, learning_item_id, filename, storage_path, mime_type,
      byte_size, processing_status, extracted_text, metadata
    )
    select upload.id, current_user_id, requested_plan.learning_item_id,
      upload.filename, upload.storage_path, upload.mime_type, upload.byte_size,
      'ready', upload.extracted_text,
      upload.metadata || jsonb_build_object('stagedAt', upload.created_at, 'attachedAt', now())
    from public.material_uploads as upload
    where upload.id = requested_material_id
      and upload.user_id = current_user_id
      and upload.processing_status = 'ready'
      and upload.metadata ->> 'mappingStatus' = 'ready';
    if not found then raise exception 'material_attachment_source_missing'; end if;
    delete from public.material_uploads
    where id = requested_material_id and user_id = current_user_id;
    attached_count := attached_count + 1;
  end loop;

  update public.learning_items
  set source_mode = 'user_materials'
  where id = requested_plan.learning_item_id and user_id = current_user_id;
  if not found then raise exception 'material_attachment_source_missing'; end if;
  update public.plans
  set knowledge_map = candidate_map
  where id = requested_plan.id and user_id = current_user_id;
  if not found then raise exception 'The requested plan was not found.'; end if;

  if attached_count > 0 then
    insert into public.learning_events (
      user_id, learning_item_id, event_type, event_data, occurred_at
    ) values (
      current_user_id, requested_plan.learning_item_id, 'materials_attached',
      jsonb_build_object(
        'planId', requested_plan.id,
        'attachedCount', attached_count,
        'materialIds', payload -> 'materialIds',
        'knowledgeMapReconciled', true
      ),
      now()
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'name', filename,
    'mimeType', mime_type,
    'sizeBytes', byte_size,
    'textContent', null,
    'processingStatus', 'ready'
  ) order by created_at), '[]'::jsonb)
  into attached_materials
  from public.materials
  where learning_item_id = requested_plan.learning_item_id
    and user_id = current_user_id;

  return jsonb_build_object(
    'planId', requested_plan.id,
    'sourceMode', 'user_materials',
    'materials', attached_materials,
    'knowledgeMap', candidate_map
  );
end;
$$;

revoke all on function public.attach_materials_to_plan(jsonb) from public;
grant execute on function public.attach_materials_to_plan(jsonb) to authenticated;

-- A generation request can be in flight while a learner attaches a source.
-- Lock the parent plan before the session and compare the exact generation
-- context before caching so an old AI result cannot land after a source or
-- plan adjustment. The complete fence remains optional for legacy
-- YOVA-generated calls during the DB-first rollout. Material-grounded calls
-- must always provide it; the updated application provides it for every call.
create or replace function public.cache_generated_session(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_session_id uuid := (payload ->> 'planSessionId')::uuid;
  requested_plan_id uuid;
  requested_learning_item_id uuid;
  stored_knowledge_map jsonb;
  stored_source_mode text;
  stored_plan_updated_at timestamptz;
  stored_session_updated_at timestamptz;
  stored_learning_item_updated_at timestamptz;
  stored_generated_session jsonb;
  has_expected_context boolean := payload ? 'expectedKnowledgeMap';
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if has_expected_context <> (payload ? 'expectedSourceMode')
    or has_expected_context <> (payload ? 'expectedPlanUpdatedAt')
    or has_expected_context <> (payload ? 'expectedSessionUpdatedAt')
    or has_expected_context <> (payload ? 'expectedLearningItemUpdatedAt') then
    raise exception using errcode = '40001', message = 'session_generation_context_changed';
  end if;

  -- Keep lock order aligned with attachment: plan, learning item, session.
  select session.plan_id into requested_plan_id
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.user_id = current_user_id;
  if not found then raise exception 'The requested session was not found.'; end if;

  -- Use separate row-locking statements so the ordering is explicit rather
  -- than relying on executor order for two row marks in one joined SELECT.
  select plan.knowledge_map, plan.updated_at, plan.learning_item_id
  into stored_knowledge_map, stored_plan_updated_at, requested_learning_item_id
  from public.plans as plan
  where plan.id = requested_plan_id
    and plan.user_id = current_user_id
  for share;
  if not found then raise exception 'The requested session was not found.'; end if;

  select item.source_mode, item.updated_at
  into stored_source_mode, stored_learning_item_updated_at
  from public.learning_items as item
  where item.id = requested_learning_item_id
    and item.user_id = current_user_id
  for share;
  if not found then raise exception 'The requested session was not found.'; end if;

  select session.updated_at, session.step_data -> 'generatedSession'
  into stored_session_updated_at, stored_generated_session
  from public.plan_sessions as session
  where session.id = requested_session_id
    and session.plan_id = requested_plan_id
    and session.user_id = current_user_id
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'session_generation_context_changed';
  end if;

  -- A lost RPC response may cause the route to send the exact cache write a
  -- second time. Treat that retry as success even though the first write
  -- advanced session.updated_at.
  if jsonb_typeof(stored_generated_session) = 'object'
    and stored_generated_session is not distinct from payload -> 'generatedSession' then
    return;
  end if;

  if stored_source_mode = 'user_materials' and not has_expected_context then
    raise exception using errcode = '40001', message = 'session_generation_context_changed';
  end if;
  if has_expected_context and (
    stored_knowledge_map is distinct from payload -> 'expectedKnowledgeMap'
    or stored_source_mode is distinct from payload ->> 'expectedSourceMode'
    or stored_plan_updated_at is distinct from (payload ->> 'expectedPlanUpdatedAt')::timestamptz
    or stored_session_updated_at is distinct from (payload ->> 'expectedSessionUpdatedAt')::timestamptz
    or stored_learning_item_updated_at is distinct from (payload ->> 'expectedLearningItemUpdatedAt')::timestamptz
  ) then
    raise exception using errcode = '40001', message = 'session_generation_context_changed';
  end if;

  update public.plan_sessions
  set step_data = coalesce(step_data, '{}'::jsonb)
    || jsonb_build_object('generatedSession', payload -> 'generatedSession')
  where id = requested_session_id
    and plan_id = requested_plan_id
    and user_id = current_user_id
    and updated_at = stored_session_updated_at;

  if not found then
    raise exception using errcode = '40001', message = 'session_generation_context_changed';
  end if;
end;
$$;

revoke all on function public.cache_generated_session(jsonb) from public;
grant execute on function public.cache_generated_session(jsonb) to authenticated;
