-- A reviewed topic/calendar delta is materialized by the signing server. The
-- browser can read its own history, but cannot supply a session write payload.
alter table public.plans add column current_revision_id uuid;

-- Activation retains the signed draft's revision, including any reviewed edits.
create function public.initialize_plan_revision_id()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.current_revision_id := coalesce(new.current_revision_id, nullif(new.generation_inputs->>'planRevisionId','')::uuid, new.id);
  return new;
end;
$$;
revoke all on function public.initialize_plan_revision_id() from public, anon, authenticated;
create trigger plans_initial_revision before insert on public.plans
for each row execute function public.initialize_plan_revision_id();

create table public.plan_revisions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  previous_revision_id uuid not null,
  revision_id uuid not null,
  proposal jsonb not null,
  receipt jsonb not null,
  request_fingerprint text not null,
  created_at timestamptz not null default now()
);
alter table public.plan_revisions enable row level security;
revoke all on public.plan_revisions from public, anon, authenticated;
grant select on public.plan_revisions to authenticated;
grant all on public.plan_revisions to service_role;
create policy plan_revisions_owner_read on public.plan_revisions for select to authenticated using (user_id = auth.uid());
create index plan_revisions_plan_history on public.plan_revisions(plan_id, created_at desc);

-- Operational ready/upcoming transitions do not invalidate an unstarted
-- session. Saved work, route identity, copy and scheduling always do.
create function public.plan_revision_session_fingerprint(s public.plan_sessions)
returns text language sql immutable set search_path = '' as $$
  select md5(((to_jsonb(s) - 'updated_at' - 'status') || jsonb_build_object('status',case when s.status in ('ready','upcoming') then 'unstarted' else s.status end))::text);
$$;
revoke all on function public.plan_revision_session_fingerprint(public.plan_sessions) from public, anon, authenticated;

create function public.read_plan_revision_context(target_plan_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.plans%rowtype;
  i public.learning_items%rowtype;
  sessions jsonb;
  fingerprints jsonb;
  protections jsonb;
  materials jsonb;
begin
  select * into p from public.plans where id=target_plan_id and user_id=auth.uid();
  if not found then raise exception using errcode='42501',message='plan_revision_owner_required'; end if;
  select * into i from public.learning_items where id=p.learning_item_id and user_id=p.user_id;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id',s.id,'sequence',s.sequence,'title',s.title,'objective',s.objective,'method',s.method,'methodReason',s.method_rationale,
    'scheduledFor',coalesce(s.scheduled_for,p.created_at),'estimatedMinutes',s.estimated_minutes,'status',s.status,
    'revisionEditedFields',s.step_data->'revisionEditedFields',
    'amountLabel',coalesce(s.step_data->>'amountLabel',s.estimated_minutes||' min'),
    'learningMode',coalesce(s.step_data->>'learningMode','study'),
    'topicIds',coalesce(s.step_data->'topicIds','[]'::jsonb),'contentTargets',coalesce(s.step_data->'contentTargets','[]'::jsonb),
    'completionEvidence',coalesce(s.step_data->'completionEvidence','[]'::jsonb),
    'originSessionId',s.step_data->'originSessionId','originalContentMinutes',s.step_data->'originalContentMinutes',
    'segmentIndex',s.step_data->'segmentIndex','segmentCount',s.step_data->'segmentCount',
    'reviewConcept',s.step_data->'reviewConcept','reviewType',s.step_data->'reviewType',
    'resource',s.step_data->'generatedSession','adaptationNote',s.step_data->'adaptationNote',
    'studyRoute',case when r.route_revision_id is not null then r.route_payload || jsonb_build_object('identity',jsonb_strip_nulls(jsonb_build_object(
      'routeLineageId',r.route_lineage_id,'routeRevisionId',r.route_revision_id,'revisionNumber',r.revision_number,
      'schemaVersion',r.schema_version,'lifecycleStatus',r.lifecycle,'planId',r.plan_id,'sessionId',r.plan_session_id,
      'createdAt',to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'committedAt',to_char(r.committed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'supersedesRevisionId',r.predecessor_revision_id))) else null end
  )) order by s.sequence,s.id),'[]'::jsonb),
  coalesce(jsonb_object_agg(s.id::text,public.plan_revision_session_fingerprint(s)),'{}'::jsonb),
  coalesce(jsonb_agg(jsonb_build_object('sessionId',s.id,
    'savedWork',s.status not in ('ready','upcoming') or s.step_data ?| array['generatedSession','activeSessionCheckpoint']
      or exists(select 1 from public.learning_events e where e.user_id=p.user_id and e.plan_session_id=s.id and e.event_type='session_interrupted'),
    'pinnedTime',coalesce(s.step_data->'revisionEditedFields' ? 'scheduledFor',false) or exists(select 1 from public.learning_events e where e.user_id=p.user_id and e.plan_session_id=s.id and e.event_type='session_rescheduled'),
    'editedFields',coalesce(s.step_data->'revisionEditedFields','[]'::jsonb)
  )),'[]'::jsonb)
  into sessions,fingerprints,protections
  from public.plan_sessions s left join public.study_routes r on r.route_revision_id=s.committed_route_revision_id
  where s.plan_id=p.id and s.user_id=p.user_id
    and not (s.status='skipped' and (coalesce(s.step_data->>'revisionRetired','false')='true' or s.step_data ? 'routeAdjustmentRetiredAt'));
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.filename,'mimeType',m.mime_type,'sizeBytes',m.byte_size,
    'processingStatus','ready','textContent',null,'understanding',m.metadata->'understanding')),'[]'::jsonb) into materials from public.materials m where m.learning_item_id=i.id and m.user_id=p.user_id;
  return jsonb_build_object('plan',jsonb_build_object(
    'id',p.id,'revisionId',coalesce(p.current_revision_id,p.id),'learningItemId',i.id,'title',i.title,'topic',i.topic,'kind',i.kind,
    'deadline',i.deadline,'status',p.status,'sourceMode',i.source_mode,'studyMode',i.study_mode,
    'learningIntent',coalesce(p.generation_inputs->>'learningIntent','learn'),'creationIntent',coalesce(p.generation_inputs->>'intent','plan'),
    'schedulePreferences',jsonb_build_object('timeZone',coalesce(p.generation_inputs->>'timeZone','UTC'),'availability',p.generation_inputs->'availability'),
    'sessionArchitectureVersion',coalesce(p.generation_inputs->>'sessionArchitectureVersion','streamed_teaching_v1'),
    'rationale',p.rationale,'createdAt',p.created_at,'knowledgeMap',p.knowledge_map,'materials',materials,'sessions',sessions),
    'generationRequest',p.generation_inputs,'sessionFingerprints',fingerprints,'protections',protections);
end $$;
revoke all on function public.read_plan_revision_context(uuid) from public, anon;
grant execute on function public.read_plan_revision_context(uuid) to authenticated;

create function public.apply_plan_revision(actor_user_id uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.plans%rowtype;
  s public.plan_sessions%rowtype;
  prior public.plan_revisions%rowtype;
  patch jsonb;
  replacement jsonb;
  next_step jsonb;
  t jsonb;
  old_t jsonb;
  ref jsonb;
  m public.material_uploads%rowtype;
  original_sequence integer;
  next_revision uuid := (payload->>'revisionId')::uuid;
  operation_id uuid := (payload->>'operationId')::uuid;
  expected_revision uuid := (payload->>'expectedRevisionId')::uuid;
  target_id uuid := (payload->>'planId')::uuid;
  source_id uuid;
  write_hash text := md5(payload::text);
begin
  if actor_user_id is null then raise exception using errcode='28000',message='plan_revision_authentication_required'; end if;
  perform pg_advisory_xact_lock(hashtext('yova_learning_data'),hashtext(actor_user_id::text));
  perform set_config('request.jwt.claim.sub',actor_user_id::text,true);
  select * into p from public.plans where id=target_id and user_id=actor_user_id for update;
  if not found then raise exception using errcode='42501',message='plan_revision_owner_required'; end if;
  select * into prior from public.plan_revisions where id=operation_id;
  if found then
    if prior.user_id<>actor_user_id or prior.plan_id<>p.id or prior.request_fingerprint<>write_hash then
      raise exception using errcode='40001',message='plan_revision_retry_changed';
    end if;
    return prior.receipt;
  end if;
  if coalesce(p.current_revision_id,p.id)<>expected_revision or p.status<>'active' or p.knowledge_map is distinct from payload->'expectedMap' then
    raise exception using errcode='40001',message='plan_revision_obsolete_preview';
  end if;
  if jsonb_typeof(payload->'sessions')<>'array' or jsonb_array_length(payload->'sessions')>28 or jsonb_typeof(payload#>'{knowledgeMap,topics}')<>'array' then
    raise exception using errcode='22023',message='plan_revision_invalid_patch';
  end if;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(payload->'sessions')) then
    raise exception using errcode='22023',message='plan_revision_duplicate_patch';
  end if;
  -- The unchecked report may replace its display slot, but never a measured
  -- placement result or the placement ledger. Undo is checked against stored
  -- proposal preimages by the signing server and still cannot erase evidence.
  if p.knowledge_map->'placementCheck' is distinct from payload#>'{knowledgeMap,placementCheck}' then
    raise exception using errcode='22023',message='plan_revision_cannot_write_placement_ledger';
  end if;
  for t in select value from jsonb_array_elements(payload#>'{knowledgeMap,topics}') loop
    select value into old_t from jsonb_array_elements(p.knowledge_map->'topics') where value->>'id'=t->>'id';
    if old_t is not null and old_t->'status' is distinct from t->'status' then
      raise exception using errcode='22023',message='plan_revision_cannot_assert_mastery';
    end if;
    if t#>>'{initialEvidence,source}'='learner_report' and t->'initialEvidence'<>'{"source":"learner_report","outcome":"covered_elsewhere","checked":false}'::jsonb then
      raise exception using errcode='22023',message='plan_revision_unchecked_report_required';
    end if;
    if old_t#>>'{initialEvidence,source}'='placement_check' and old_t->'initialEvidence' is distinct from t->'initialEvidence' and old_t->'initialEvidence' is distinct from t->'placementEvidence' then
      raise exception using errcode='22023',message='plan_revision_must_keep_placement';
    end if;
    for ref in select value from jsonb_array_elements(coalesce(t->'attachedSources','[]'::jsonb)) loop
      source_id := (ref->>'material_id')::uuid;
      if source_id is null then continue; end if;
      if exists(select 1 from public.materials where id=source_id and user_id=actor_user_id and learning_item_id=p.learning_item_id) then continue; end if;
      select * into m from public.material_uploads where id=source_id and user_id=actor_user_id for update;
      if not found or m.processing_status<>'ready' or m.expires_at<=now() then
        raise exception using errcode='40001',message='plan_revision_source_unavailable';
      end if;
      insert into public.materials(id,user_id,learning_item_id,storage_path,filename,mime_type,byte_size,processing_status,extracted_text,metadata)
        values(m.id,m.user_id,p.learning_item_id,m.storage_path,m.filename,m.mime_type,m.byte_size,m.processing_status,m.extracted_text,m.metadata);
      delete from public.material_uploads where id=m.id;
    end loop;
  end loop;
  -- Lock every affected preimage first. No scalar writes until all checks pass.
  for patch in select value from jsonb_array_elements(payload->'sessions') loop
    select * into s from public.plan_sessions where id=(patch->>'id')::uuid for update;
    if found then
      if s.plan_id<>p.id or s.user_id<>actor_user_id or public.plan_revision_session_fingerprint(s) is distinct from patch->>'beforeFingerprint' then
        raise exception using errcode='40001',message='plan_revision_session_changed';
      end if;
      if s.status not in ('ready','upcoming','skipped') or s.step_data ?| array['generatedSession','activeSessionCheckpoint']
        or exists(select 1 from public.learning_events e where e.plan_session_id=s.id and e.user_id=actor_user_id and e.event_type='session_interrupted') then
        raise exception using errcode='40001',message='plan_revision_saved_work';
      end if;
    elsif patch->>'beforeFingerprint' is not null then
      raise exception using errcode='40001',message='plan_revision_session_missing';
    end if;
    replacement := patch->'after';
    if replacement is null or replacement='null'::jsonb or replacement->>'status'='skipped' then continue; end if;
    if replacement->>'id'<>patch->>'id' or replacement->>'status' not in ('ready','upcoming') then
      raise exception using errcode='22023',message='plan_revision_invalid_session';
    end if;
    if exists(select 1 from public.plan_sessions other_s join public.plans other_p on other_p.id=other_s.plan_id
      where other_s.user_id=actor_user_id and other_p.status='active' and other_s.status in ('ready','upcoming')
      and not exists(select 1 from jsonb_array_elements(payload->'sessions') changed where changed->>'id'=other_s.id::text)
      and other_s.scheduled_for<(replacement->>'scheduledFor')::timestamptz+(replacement->>'estimatedMinutes')::integer*interval '1 minute'
      and other_s.scheduled_for+other_s.estimated_minutes*interval '1 minute'>(replacement->>'scheduledFor')::timestamptz)
      or exists(select 1 from jsonb_array_elements(coalesce(payload->'fixedEvents','[]'::jsonb)) e
        where (e->>'startsAt')::timestamptz<(replacement->>'scheduledFor')::timestamptz+(replacement->>'estimatedMinutes')::integer*interval '1 minute'
        and (e->>'endsAt')::timestamptz>(replacement->>'scheduledFor')::timestamptz) then
      raise exception using errcode='40001',message='plan_revision_capacity_changed';
    end if;
  end loop;
  -- Move only changed rows out of the ordinal key; untouched rows are never updated.
  update public.plan_sessions set sequence=sequence+1000
    where plan_id=p.id and user_id=actor_user_id and id in(select (value->>'id')::uuid from jsonb_array_elements(payload->'sessions'));
  for patch in select value from jsonb_array_elements(payload->'sessions') loop
    replacement := patch->'after';
    select * into s from public.plan_sessions where id=(patch->>'id')::uuid;
    original_sequence := s.sequence-1000;
    if replacement is null or replacement='null'::jsonb then
      update public.plan_sessions set status='skipped',sequence=original_sequence,step_data=step_data||jsonb_build_object('revisionRetired',true) where id=s.id;
      continue;
    end if;
    next_step := coalesce(s.step_data,'{}'::jsonb) || (replacement - array['id','sequence','title','objective','method','methodReason','scheduledFor','estimatedMinutes','status','studyRoute','resource']);
    if replacement->>'status'='skipped' then
      update public.plan_sessions set status='skipped',sequence=(replacement->>'sequence')::smallint,step_data=next_step where id=s.id;
      continue;
    end if;
    if s.id is not null then
      update public.plan_sessions set sequence=(replacement->>'sequence')::smallint,title=replacement->>'title',objective=replacement->>'objective',
        method=replacement->>'method',method_rationale=replacement->>'methodReason',scheduled_for=(replacement->>'scheduledFor')::timestamptz,
        estimated_minutes=(replacement->>'estimatedMinutes')::smallint,status=replacement->>'status',step_data=next_step where id=s.id;
    else
      insert into public.plan_sessions(id,user_id,plan_id,sequence,title,objective,method,method_rationale,scheduled_for,estimated_minutes,status,step_data)
        values((replacement->>'id')::uuid,actor_user_id,p.id,(replacement->>'sequence')::smallint,replacement->>'title',replacement->>'objective',
          replacement->>'method',replacement->>'methodReason',(replacement->>'scheduledFor')::timestamptz,(replacement->>'estimatedMinutes')::smallint,replacement->>'status',next_step);
    end if;
    perform public.assert_persisted_session_request(p.id,(replacement->>'id')::uuid,replacement);
    perform public.commit_study_route_revision(replacement->'studyRoute');
    perform public.assert_committed_study_route_projection(replacement->'studyRoute',p.id,(replacement->>'id')::uuid);
  end loop;
  update public.learning_items set deadline=(payload->>'deadline')::timestamptz,
    source_mode=case payload#>>'{generationRequest,materialMode}' when 'upload' then 'user_materials' when 'none' then 'yova_generated' else source_mode end where id=p.learning_item_id and user_id=actor_user_id;
  update public.plans set knowledge_map=payload->'knowledgeMap',current_revision_id=next_revision,
    generation_inputs=coalesce(generation_inputs,'{}'::jsonb)||coalesce(payload->'generationRequest','{}'::jsonb)
    where id=p.id and user_id=actor_user_id;
  insert into public.plan_revisions(id,user_id,plan_id,previous_revision_id,revision_id,proposal,receipt,request_fingerprint)
    values(operation_id,actor_user_id,p.id,expected_revision,next_revision,payload->'proposal',payload->'receipt',write_hash);
  return payload->'receipt';
end $$;
revoke all on function public.apply_plan_revision(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.apply_plan_revision(uuid,jsonb) to service_role;

-- Include the learner-owned plan revisions in the existing bounded, claimed export.
-- Preserve its authorization, transaction lock, receipt and size checks.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('public.export_yova_account_data_without_study_routes()'::regprocedure);
  count_anchor text := 'union all select count(*) from public.session_attempts where user_id = current_user_id';
  actual_anchor text := 'union all select pg_catalog.jsonb_array_length(result -> ''sessionAttempts'')::bigint';
  section_anchor text := '''sessionAttempts'', coalesce((';
begin
  if position(count_anchor in definition)=0 or position(actual_anchor in definition)=0
    or position(section_anchor in definition)=0 then
    raise exception 'Plan revision export patch did not match the protected exporter';
  end if;
  definition := replace(definition, count_anchor, count_anchor || E'\n    union all select count(*) from public.plan_revisions where user_id = current_user_id');
  definition := replace(definition, actual_anchor, actual_anchor || E'\n    union all select pg_catalog.jsonb_array_length(result -> ''planRevisions'')::bigint');
  definition := replace(definition, section_anchor, $section$
    'planRevisions', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', revision.id, 'planId', revision.plan_id,
        'previousRevisionId', revision.previous_revision_id, 'revisionId', revision.revision_id,
        'proposal', revision.proposal, 'receipt', revision.receipt, 'createdAt', revision.created_at
      ) order by revision.created_at, revision.id)
      from public.plan_revisions as revision where revision.user_id = current_user_id
    ), '[]'::jsonb),
    'sessionAttempts', coalesce(($section$);
  -- Bound this prose section before aggregation; the mature exporter checks
  -- exact combined record/byte limits again after creating its snapshot.
  definition := replace(definition, 'with section_counts(section_count) as (', $preflight$
    if (select coalesce(sum(pg_catalog.octet_length(proposal::text) + pg_catalog.octet_length(receipt::text) + 600),0)
      from public.plan_revisions where user_id = current_user_id) > 26214400 then
      raise exception using errcode='54000', message='account_export_limit_exceeded';
    end if;
    with section_counts(section_count) as ($preflight$);
  execute definition;
end;
$migration$;

-- The retired wholesale APIs must not remain reachable as direct browser RPCs.
-- Historical implementations stay available only inside privileged migrations/tests.
revoke all on function public.adjust_learning_plan_with_routes(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.attach_materials_to_plan(jsonb) from public, anon, authenticated, service_role;
