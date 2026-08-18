-- Private, short-lived account-data exports. The browser uploads only its
-- bounded current-device addendum; Postgres produces one atomic cloud snapshot,
-- and the API places the final JSON artifact in this private bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'account-exports',
  'account-exports',
  false,
  26214400,
  array['application/json']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.account_data_exports (
  id uuid primary key,
  -- Deliberately no Auth foreign key: an admin/Auth deletion must not erase
  -- the exact private-object cleanup receipt before Storage cleanup succeeds.
  user_id uuid not null,
  session_id text not null check (char_length(session_id) between 8 and 160),
  status text not null check (status in ('preparing', 'finalizing', 'ready', 'failed', 'cancelled')),
  finalize_grant_digest bytea,
  temp_storage_path text not null,
  final_storage_path text not null,
  download_filename text,
  artifact_size_bytes bigint check (artifact_size_bytes is null or artifact_size_bytes between 1 and 26214400),
  record_count integer check (record_count is null or record_count between 0 and 25000),
  storage_object_count integer check (storage_object_count is null or storage_object_count between 0 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  prepare_expires_at timestamptz not null,
  artifact_expires_at timestamptz,
  cleanup_claimed_at timestamptz,
  cleanup_token uuid,
  storage_cleaned_at timestamptz,
  constraint account_data_exports_temp_path_check check (
    temp_storage_path = user_id::text || '/' || id::text || '/device-state.json'
  ),
  constraint account_data_exports_final_path_check check (
    final_storage_path = user_id::text || '/' || id::text || '/yova-data.json'
  ),
  constraint account_data_exports_grant_check check (
    (
      status = 'preparing'
      and finalize_grant_digest is not null
      and octet_length(finalize_grant_digest) = 32
    )
    or (status <> 'preparing' and finalize_grant_digest is null)
  ),
  constraint account_data_exports_ready_check check (
    status <> 'ready'
    or (
      final_storage_path is not null
      and download_filename is not null
      and artifact_size_bytes is not null
      and completed_at is not null
      and artifact_expires_at is not null
    )
  ),
  constraint account_data_exports_filename_check check (
    download_filename is null
    or (
      char_length(download_filename) between 6 and 160
      and download_filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]*[.]json$'
    )
  ),
  constraint account_data_exports_expiry_check check (prepare_expires_at > created_at),
  constraint account_data_exports_cleanup_lease_check check (
    (cleanup_claimed_at is null and cleanup_token is null)
    or (cleanup_claimed_at is not null and cleanup_token is not null)
  )
);

create unique index account_data_exports_one_active_per_user_idx
on public.account_data_exports(user_id)
where status in ('preparing', 'finalizing');

create index account_data_exports_user_created_idx
on public.account_data_exports(user_id, created_at desc);

create index account_data_exports_cleanup_idx
on public.account_data_exports(
  (coalesce(artifact_expires_at, prepare_expires_at)),
  cleanup_claimed_at
);

create index account_data_exports_receipt_cleanup_idx
on public.account_data_exports(storage_cleaned_at, created_at)
where storage_cleaned_at is not null;

alter table public.account_data_exports enable row level security;
revoke all on table public.account_data_exports from public, anon, authenticated, service_role;

create or replace function public.account_export_constant_time_equal(
  left_digest bytea,
  right_digest bytea
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  difference integer := 0;
  byte_index integer;
begin
  if octet_length(left_digest) <> octet_length(right_digest) then
    return false;
  end if;

  for byte_index in 0..octet_length(left_digest) - 1 loop
    difference := difference | (
      pg_catalog.get_byte(left_digest, byte_index)
      # pg_catalog.get_byte(right_digest, byte_index)
    );
  end loop;

  return difference = 0;
end;
$$;

revoke all on function public.account_export_constant_time_equal(bytea, bytea)
from public, anon, authenticated;

create or replace function public.account_export_has_recent_human_amr()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(auth.jwt() -> 'amr') = 'array'
          then auth.jwt() -> 'amr'
        else '[]'::jsonb
      end
    ) as amr(entry)
    where pg_catalog.jsonb_typeof(entry) = 'object'
      and pg_catalog.jsonb_typeof(entry -> 'method') = 'string'
      and pg_catalog.jsonb_typeof(entry -> 'timestamp') = 'number'
      and lower(entry ->> 'method') in (
        'password',
        'otp',
        'oauth',
        'totp',
        'mfa/totp',
        'mfa/phone',
        'mfa/webauthn',
        'sso/saml',
        'magiclink',
        'web3'
      )
      and (entry ->> 'timestamp') ~ '^[0-9]{1,12}$'
      and (entry ->> 'timestamp')::bigint
        between pg_catalog.floor(extract(epoch from now() - interval '10 minutes'))::bigint
          and pg_catalog.ceil(extract(epoch from now() + interval '1 minute'))::bigint
  );
$$;

revoke all on function public.account_export_has_recent_human_amr()
from public, anon, authenticated;

create or replace function public.begin_account_data_export(requested_export_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_session_id text := coalesce(auth.jwt() ->> 'session_id', '');
  plaintext_finalize_grant text;
  created_export_id uuid;
  created_temp_storage_path text;
  created_prepare_expires_at timestamptz;
  recent_hour_count integer := 0;
  recent_day_count integer := 0;
  retry_after_seconds integer := 0;
begin
  if current_user_id is null
    or current_session_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    or not exists (
      select 1 from auth.users
      where id = current_user_id
        and email is not null
        and email_confirmed_at is not null
        and coalesce(is_anonymous, false) is false
    )
    or public.account_export_has_recent_human_amr() is not true then
    raise exception using
      errcode = '28000',
      message = 'account_export_reauthentication_required';
  end if;

  if requested_export_id is null
    or requested_export_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception using errcode = '22023', message = 'account_export_id_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  -- Expired preparation attempts cannot hold the one-active-job slot forever.
  update public.account_data_exports
  set
    status = 'failed',
    finalize_grant_digest = null,
    updated_at = now()
  where user_id = current_user_id
    and status in ('preparing', 'finalizing')
    and prepare_expires_at <= now();

  if exists (
    select 1 from public.account_data_exports
    where user_id = current_user_id
      and status in ('preparing', 'finalizing')
      and prepare_expires_at > now()
  ) then
    raise exception using
      errcode = 'PXA03',
      message = 'account_export_in_progress';
  end if;

  select count(*) filter (where created_at >= now() - interval '1 hour'),
         count(*) filter (where created_at >= now() - interval '1 day')
  into recent_hour_count, recent_day_count
  from public.account_data_exports
  where user_id = current_user_id;

  if recent_hour_count >= 2 then
    select greatest(
      1,
      pg_catalog.ceil(extract(epoch from (
        min(created_at) + interval '1 hour' - now()
      )))::integer
    )
    into retry_after_seconds
    from public.account_data_exports
    where user_id = current_user_id
      and created_at >= now() - interval '1 hour';

    raise exception using
      errcode = 'PXA01',
      message = 'account_export_hourly_quota_exceeded',
      detail = 'retry_after_seconds=' || retry_after_seconds::text;
  end if;

  if recent_day_count >= 5 then
    select greatest(
      1,
      pg_catalog.ceil(extract(epoch from (
        min(created_at) + interval '1 day' - now()
      )))::integer
    )
    into retry_after_seconds
    from public.account_data_exports
    where user_id = current_user_id
      and created_at >= now() - interval '1 day';

    raise exception using
      errcode = 'PXA02',
      message = 'account_export_daily_quota_exceeded',
      detail = 'retry_after_seconds=' || retry_after_seconds::text;
  end if;

  plaintext_finalize_grant := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.account_data_exports (
    id,
    user_id,
    session_id,
    status,
    finalize_grant_digest,
    temp_storage_path,
    final_storage_path,
    prepare_expires_at
  ) values (
    requested_export_id,
    current_user_id,
    current_session_id,
    'preparing',
    extensions.digest(pg_catalog.convert_to(plaintext_finalize_grant, 'UTF8'), 'sha256'),
    current_user_id::text || '/' || requested_export_id::text || '/device-state.json',
    current_user_id::text || '/' || requested_export_id::text || '/yova-data.json',
    now() + interval '15 minutes'
  )
  returning id, temp_storage_path, prepare_expires_at
  into created_export_id, created_temp_storage_path, created_prepare_expires_at;

  return pg_catalog.jsonb_build_object(
    'exportId', created_export_id,
    'finalizeGrant', plaintext_finalize_grant,
    'tempStoragePath', created_temp_storage_path,
    'prepareExpiresAt', created_prepare_expires_at
  );
end;
$$;

create or replace function public.claim_account_data_export(
  requested_export_id uuid,
  requested_finalize_grant text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_session_id text := coalesce(auth.jwt() ->> 'session_id', '');
  export_job_id uuid;
  stored_finalize_grant_digest bytea;
  stored_temp_storage_path text;
  supplied_digest bytea;
  device_size bigint;
  device_mime text;
begin
  if current_user_id is null or current_session_id = '' then
    return false;
  end if;
  if requested_finalize_grant is null
    or char_length(requested_finalize_grant) <> 64
    or requested_finalize_grant !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  select id, finalize_grant_digest, temp_storage_path
  into export_job_id, stored_finalize_grant_digest, stored_temp_storage_path
  from public.account_data_exports
  where id = requested_export_id
    and user_id = current_user_id
    and session_id = current_session_id
    and status = 'preparing'
    and prepare_expires_at > now()
  for update;

  if not found then
    return false;
  end if;

  supplied_digest := extensions.digest(
    pg_catalog.convert_to(requested_finalize_grant, 'UTF8'),
    'sha256'
  );
  if public.account_export_constant_time_equal(
    supplied_digest,
    stored_finalize_grant_digest
  ) is not true then
    return false;
  end if;

  select
    case
      when coalesce(object.metadata ->> 'size', '') ~ '^[0-9]+$'
        then (object.metadata ->> 'size')::bigint
      else null
    end,
    lower(coalesce(object.metadata ->> 'mimetype', ''))
  into device_size, device_mime
  from storage.objects as object
  where object.bucket_id = 'account-exports'
    and object.name = stored_temp_storage_path;

  if device_size is null
    or device_size not between 1 and 2097152
    or device_mime <> 'application/json' then
    return false;
  end if;

  update public.account_data_exports
  set
    status = 'finalizing',
    finalize_grant_digest = null,
    claimed_at = now(),
    updated_at = now(),
    prepare_expires_at = now() + interval '15 minutes'
  where id = export_job_id;

  return true;
end;
$$;

create or replace function public.complete_account_data_export(
  requested_export_id uuid,
  requested_size_bytes bigint,
  requested_filename text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_session_id text := coalesce(auth.jwt() ->> 'session_id', '');
  export_job_id uuid;
  derived_final_path text;
  stored_size bigint;
  stored_mime text;
begin
  if current_user_id is null
    or current_session_id = ''
    or requested_size_bytes is null
    or requested_size_bytes not between 1 and 26214400
    or requested_filename is null
    or char_length(requested_filename) not between 6 and 160
    or requested_filename !~ '^[A-Za-z0-9][A-Za-z0-9._-]*[.]json$' then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  select id into export_job_id
  from public.account_data_exports
  where id = requested_export_id
    and user_id = current_user_id
    and session_id = current_session_id
    and status = 'finalizing'
    and prepare_expires_at > now()
  for update;

  if not found then
    return false;
  end if;

  derived_final_path := current_user_id::text || '/' || export_job_id::text || '/yova-data.json';
  select
    case
      when coalesce(object.metadata ->> 'size', '') ~ '^[0-9]+$'
        then (object.metadata ->> 'size')::bigint
      else null
    end,
    lower(coalesce(object.metadata ->> 'mimetype', ''))
  into stored_size, stored_mime
  from storage.objects as object
  where object.bucket_id = 'account-exports'
    and object.name = derived_final_path;

  if stored_size is null
    or stored_size <> requested_size_bytes
    or stored_size not between 1 and 26214400
    or stored_mime <> 'application/json' then
    return false;
  end if;

  update public.account_data_exports
  set
    status = 'ready',
    final_storage_path = derived_final_path,
    download_filename = requested_filename,
    artifact_size_bytes = stored_size,
    completed_at = now(),
    artifact_expires_at = now() + interval '40 minutes',
    updated_at = now()
  where id = export_job_id;

  return true;
end;
$$;

create or replace function public.fail_account_data_export(requested_export_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_session_id text := coalesce(auth.jwt() ->> 'session_id', '');
  changed_count integer := 0;
begin
  if current_user_id is null or current_session_id = '' then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  update public.account_data_exports
  set
    status = 'failed',
    finalize_grant_digest = null,
    prepare_expires_at = least(prepare_expires_at, now()),
    artifact_expires_at = case
      when artifact_expires_at is null then null
      else least(artifact_expires_at, now())
    end,
    updated_at = now()
  where id = requested_export_id
    and user_id = current_user_id
    and session_id = current_session_id
    and status in ('preparing', 'finalizing');

  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

create or replace function public.revoke_account_data_export(requested_export_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  export_job_id uuid;
  stored_temp_storage_path text;
  stored_final_storage_path text;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  select id, temp_storage_path, final_storage_path
  into export_job_id, stored_temp_storage_path, stored_final_storage_path
  from public.account_data_exports
  where id = requested_export_id
    and user_id = current_user_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'tempStoragePath', null,
      'finalStoragePath', null
    );
  end if;

  update public.account_data_exports
  set
    status = 'cancelled',
    finalize_grant_digest = null,
    prepare_expires_at = least(prepare_expires_at, now()),
    artifact_expires_at = case
      when artifact_expires_at is null then null
      else least(artifact_expires_at, now())
    end,
    updated_at = now()
  where id = export_job_id;

  return pg_catalog.jsonb_build_object(
    'tempStoragePath', stored_temp_storage_path,
    'finalStoragePath', stored_final_storage_path
  );
end;
$$;

create or replace function public.export_account_operational_records()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := lower(pg_catalog.btrim(coalesce(auth.jwt() ->> 'email', '')));
  result jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;

  select pg_catalog.jsonb_build_object(
    'aiUsageWindows', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'action', usage_window.action,
          'windowKind', usage_window.window_kind,
          'windowStartedAt', usage_window.window_started_at,
          'requestCount', usage_window.request_count,
          'updatedAt', usage_window.updated_at
        ) order by usage_window.window_started_at, usage_window.action, usage_window.window_kind
      )
      from public.ai_usage_windows as usage_window
      where usage_window.user_id = current_user_id
    ), '[]'::jsonb),
    'founderAccess', coalesce((
      select pg_catalog.jsonb_build_object(
        'isFounder', true,
        'createdAt', founder.created_at
      )
      from public.founder_accounts as founder
      where founder.user_id = current_user_id
    ), pg_catalog.jsonb_build_object('isFounder', false, 'createdAt', null)),
    'testerAccess', (
      select pg_catalog.jsonb_build_object(
        'email', invite.email,
        'displayName', invite.display_name,
        'status', invite.status,
        'invitedAt', invite.invited_at,
        'joinedAt', invite.joined_at
      )
      from public.tester_invites as invite
      where invite.auth_user_id = current_user_id
        or (
          invite.auth_user_id is null
          and current_email <> ''
          and invite.email = current_email
          and invite.send_count > 0
        )
      order by (invite.auth_user_id = current_user_id) desc, invite.invited_at desc
      limit 1
    )
  ) into result;

  return coalesce(result, '{}'::jsonb);
end;
$$;

-- One explicit-field statement captures the cloud snapshot while holding the
-- same per-learner transaction lock as Reset and material mapping. No table is
-- fetched through separate HTTP pages, so Reset cannot split the export into
-- a before/after mixture.
create or replace function public.export_yova_account_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_session_id text := coalesce(auth.jwt() ->> 'session_id', '');
  total_record_count bigint := 0;
  largest_section_count bigint := 0;
  owned_storage_object_count bigint := 0;
  result jsonb;
begin
  if current_user_id is null or current_session_id = '' then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  if not exists (
    select 1
    from public.account_data_exports as export_job
    where export_job.user_id = current_user_id
      and export_job.session_id = current_session_id
      and export_job.status = 'finalizing'
      -- Leave enough of the finalization lease for the bounded API request to
      -- upload and complete before cleanup can claim the job.
      and export_job.prepare_expires_at > now() + interval '3 minutes'
  ) then
    raise exception using errcode = '55000', message = 'account_export_not_claimed';
  end if;

  with section_counts(section_count) as (
    select count(*) from public.profiles where id = current_user_id
    union all select count(*) from public.learner_profiles where user_id = current_user_id
    union all select count(*) from public.learning_items where user_id = current_user_id
    union all select count(*) from public.plans where user_id = current_user_id
    union all select count(*) from public.plan_sessions where user_id = current_user_id
    union all select count(*) from public.materials where user_id = current_user_id
    union all select count(*) from public.session_attempts where user_id = current_user_id
    union all select count(*) from public.learning_events where user_id = current_user_id
    union all select count(*) from public.tutor_threads where user_id = current_user_id
    union all select count(*) from public.tutor_messages where user_id = current_user_id
    union all select count(*) from public.material_uploads where user_id = current_user_id
    union all select count(*) from public.product_events where user_id = current_user_id
    union all select count(*) from public.support_requests where user_id = current_user_id
    union all select count(*) from public.error_reports where user_id = current_user_id
    union all select count(*) from public.deadline_milestones where user_id = current_user_id
    union all select count(*) from public.material_chunks where user_id = current_user_id
    union all select count(*) from public.ai_usage_windows where user_id = current_user_id
    union all select count(*) from public.founder_accounts where user_id = current_user_id
    union all select count(*) from public.tester_invites
      where auth_user_id = current_user_id
        or (
          auth_user_id is null
          and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
          and send_count > 0
        )
  )
  select coalesce(sum(section_count), 0),
         coalesce(max(section_count), 0)
  into total_record_count, largest_section_count
  from section_counts;

  select count(*)
  into owned_storage_object_count
  from storage.objects as object
  where object.bucket_id = 'learning-materials'
    and (storage.foldername(object.name))[1] = current_user_id::text;

  if largest_section_count > 10000
    or total_record_count > 25000
    or owned_storage_object_count > 2000 then
    raise exception using
      errcode = '54000',
      message = 'account_export_limit_exceeded';
  end if;

  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'generatedAt', now(),
    'recordCount', total_record_count,
    'storageObjectCount', owned_storage_object_count,
    'profile', (
      select pg_catalog.jsonb_build_object(
        'displayName', profile.display_name,
        'onboardingCompletedAt', profile.onboarding_completed_at,
        'createdAt', profile.created_at,
        'updatedAt', profile.updated_at
      )
      from public.profiles as profile
      where profile.id = current_user_id
    ),
    'learnerProfile', (
      select pg_catalog.jsonb_build_object(
        'commonBlocker', learner.common_blocker,
        'guidancePreference', learner.guidance_preference,
        'preferredSessionMin', learner.preferred_session_min,
        'preferredSessionMax', learner.preferred_session_max,
        'explanationPreference', learner.explanation_preference,
        'focusFrequency', learner.focus_frequency,
        'startingPattern', learner.starting_pattern,
        'energyWindow', learner.energy_window,
        'primaryImprovementGoal', learner.primary_improvement_goal,
        'additionalContext', learner.additional_context,
        'profileVersion', learner.profile_version,
        'createdAt', learner.created_at,
        'updatedAt', learner.updated_at
      )
      from public.learner_profiles as learner
      where learner.user_id = current_user_id
    ),
    'learningItems', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', item.id,
          'title', item.title,
          'kind', item.kind,
          'topic', item.topic,
          'deadline', item.deadline,
          'status', item.status,
          'sourceMode', item.source_mode,
          'studyMode', item.study_mode,
          'createdAt', item.created_at,
          'updatedAt', item.updated_at
        ) order by item.created_at, item.id
      )
      from public.learning_items as item
      where item.user_id = current_user_id
    ), '[]'::jsonb),
    'plans', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', plan.id,
          'learningItemId', plan.learning_item_id,
          'status', plan.status,
          'rationale', plan.rationale,
          'generationInputs', plan.generation_inputs,
          'knowledgeMap', plan.knowledge_map,
          'createdAt', plan.created_at,
          'updatedAt', plan.updated_at
        ) order by plan.created_at, plan.id
      )
      from public.plans as plan
      where plan.user_id = current_user_id
    ), '[]'::jsonb),
    'planSessions', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', session.id,
          'planId', session.plan_id,
          'sequence', session.sequence,
          'title', session.title,
          'objective', session.objective,
          'method', session.method,
          'methodRationale', session.method_rationale,
          'scheduledFor', session.scheduled_for,
          'estimatedMinutes', session.estimated_minutes,
          'status', session.status,
          'stepData', session.step_data,
          'createdAt', session.created_at,
          'updatedAt', session.updated_at
        ) order by session.plan_id, session.sequence, session.id
      )
      from public.plan_sessions as session
      where session.user_id = current_user_id
    ), '[]'::jsonb),
    'materials', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', material.id,
          'learningItemId', material.learning_item_id,
          'filename', material.filename,
          'mimeType', material.mime_type,
          'byteSize', material.byte_size,
          'processingStatus', material.processing_status,
          'metadata', material.metadata,
          'extractedText', material.extracted_text,
          'createdAt', material.created_at
        ) order by material.created_at, material.id
      )
      from public.materials as material
      where material.user_id = current_user_id
    ), '[]'::jsonb),
    'sessionAttempts', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', attempt.id,
          'planSessionId', attempt.plan_session_id,
          'startedAt', attempt.started_at,
          'completedAt', attempt.completed_at,
          'actualMinutes', attempt.actual_minutes,
          'correctAnswers', attempt.correct_answers,
          'totalAnswers', attempt.total_answers,
          'userFeedback', attempt.user_feedback,
          'resultData', attempt.result_data,
          'createdAt', attempt.created_at
        ) order by attempt.created_at, attempt.id
      )
      from public.session_attempts as attempt
      where attempt.user_id = current_user_id
    ), '[]'::jsonb),
    'learningEvents', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', event.id,
          'learningItemId', event.learning_item_id,
          'planSessionId', event.plan_session_id,
          'eventType', event.event_type,
          'eventData', event.event_data,
          'occurredAt', event.occurred_at
        ) order by event.occurred_at, event.id
      )
      from public.learning_events as event
      where event.user_id = current_user_id
    ), '[]'::jsonb),
    'tutorThreads', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', thread.id,
          'learningItemId', thread.learning_item_id,
          'title', thread.title,
          'createdAt', thread.created_at,
          'updatedAt', thread.updated_at
        ) order by thread.created_at, thread.id
      )
      from public.tutor_threads as thread
      where thread.user_id = current_user_id
    ), '[]'::jsonb),
    'tutorMessages', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', message.id,
          'tutorThreadId', message.tutor_thread_id,
          'role', message.role,
          'content', message.content,
          'createdAt', message.created_at
        ) order by message.created_at, message.id
      )
      from public.tutor_messages as message
      where message.user_id = current_user_id
    ), '[]'::jsonb),
    'materialUploads', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', upload.id,
          'filename', upload.filename,
          'mimeType', upload.mime_type,
          'byteSize', upload.byte_size,
          'processingStatus', upload.processing_status,
          'extractedText', upload.extracted_text,
          'metadata', upload.metadata,
          'createdAt', upload.created_at,
          'expiresAt', upload.expires_at
        ) order by upload.created_at, upload.id
      )
      from public.material_uploads as upload
      where upload.user_id = current_user_id
    ), '[]'::jsonb),
    'productEvents', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', event.id,
          'eventName', event.event_name,
          'eventData', event.event_data #- '{diagnostics,lessonRequestId}',
          'occurredAt', event.occurred_at
        ) order by event.occurred_at, event.id
      )
      from public.product_events as event
      where event.user_id = current_user_id
    ), '[]'::jsonb),
    'supportRequests', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', support.id,
          'category', support.category,
          'subject', support.subject,
          'message', support.message,
          'status', support.status,
          'createdAt', support.created_at
        ) order by support.created_at, support.id
      )
      from public.support_requests as support
      where support.user_id = current_user_id
    ), '[]'::jsonb),
    'errorReports', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', report.id,
          'surface', report.surface,
          'errorCode', report.error_code,
          'errorDigest', report.error_digest,
          'routePath', report.route_path,
          'status', report.status,
          'occurredAt', report.occurred_at
        ) order by report.occurred_at, report.id
      )
      from public.error_reports as report
      where report.user_id = current_user_id
    ), '[]'::jsonb),
    'deadlineMilestones', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', milestone.id,
          'title', milestone.title,
          'description', milestone.description,
          'dueAt', milestone.due_at,
          'status', milestone.status,
          'linkedLearningItemId', milestone.linked_learning_item_id,
          'createdAt', milestone.created_at,
          'updatedAt', milestone.updated_at
        ) order by milestone.due_at, milestone.id
      )
      from public.deadline_milestones as milestone
      where milestone.user_id = current_user_id
    ), '[]'::jsonb),
    'materialChunks', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', chunk.id,
          'materialId', chunk.material_id,
          'chunkIndex', chunk.chunk_index,
          'charStart', chunk.char_start,
          'charEnd', chunk.char_end,
          'locationLabel', chunk.location_label,
          'sectionRole', chunk.section_role,
          'chunkText', chunk.chunk_text,
          'createdAt', chunk.created_at
        ) order by chunk.material_id, chunk.chunk_index, chunk.id
      )
      from public.material_chunks as chunk
      where chunk.user_id = current_user_id
    ), '[]'::jsonb),
    'operational', public.export_account_operational_records(),
    'storageManifest', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'relativePath', pg_catalog.substr(object.name, char_length(current_user_id::text) + 2),
          'category', case
            when attached.id is not null then 'attached'
            when staged.id is not null then 'staged'
            else 'orphaned'
          end,
          'linkedRecordId', coalesce(attached.id, staged.id),
          'filename', pg_catalog.regexp_replace(object.name, '^.*/', ''),
          'mimeType', object.metadata ->> 'mimetype',
          'byteSize', case
            when coalesce(object.metadata ->> 'size', '') ~ '^[0-9]+$'
              then (object.metadata ->> 'size')::bigint
            else null
          end,
          'createdAt', object.created_at,
          'updatedAt', object.updated_at,
          'orphaned', attached.id is null and staged.id is null
        ) order by object.name
      )
      from storage.objects as object
      left join public.materials as attached
        on attached.user_id = current_user_id
        and attached.storage_path = object.name
      left join public.material_uploads as staged
        on staged.user_id = current_user_id
        and staged.storage_path = object.name
      where object.bucket_id = 'learning-materials'
        and (storage.foldername(object.name))[1] = current_user_id::text
    ), '[]'::jsonb)
  ) into result;

  -- The preflight above bounds work before aggregation, but READ COMMITTED can
  -- admit writes between statements. Recount the exact JSON snapshot so a
  -- concurrent insert cannot bypass a section/total limit or make the receipt
  -- disagree with the artifact that was actually built.
  with actual_section_counts(section_count) as (
    select case when pg_catalog.jsonb_typeof(result -> 'profile') = 'object' then 1 else 0 end::bigint
    union all select case when pg_catalog.jsonb_typeof(result -> 'learnerProfile') = 'object' then 1 else 0 end::bigint
    union all select pg_catalog.jsonb_array_length(result -> 'learningItems')::bigint
    union all select pg_catalog.jsonb_array_length(result -> 'plans')::bigint
    union all select pg_catalog.jsonb_array_length(result -> 'planSessions')::bigint
    union all select pg_catalog.jsonb_array_length(result -> 'materials')::bigint
    union all select pg_catalog.jsonb_array_length(result -> 'sessionAttempts')::bigint
    union all select pg_catalog.jsonb_array_length(result -> 'learningEvents')::bigint
    union all select pg_catalog.jsonb_array_length(result -> 'tutorThreads')::bigint
    union all select pg_catalog.jsonb_array_length(result -> 'tutorMessages')::bigint
    union all select pg_catalog.jsonb_array_length(result -> 'materialUploads')::bigint
    union all select pg_catalog.jsonb_array_length(result -> 'productEvents')::bigint
    union all select pg_catalog.jsonb_array_length(result -> 'supportRequests')::bigint
    union all select pg_catalog.jsonb_array_length(result -> 'errorReports')::bigint
    union all select pg_catalog.jsonb_array_length(result -> 'deadlineMilestones')::bigint
    union all select pg_catalog.jsonb_array_length(result -> 'materialChunks')::bigint
    union all select pg_catalog.jsonb_array_length(result #> '{operational,aiUsageWindows}')::bigint
    union all select case
      when coalesce((result #>> '{operational,founderAccess,isFounder}')::boolean, false) then 1
      else 0
    end::bigint
    union all select case
      when pg_catalog.jsonb_typeof(result #> '{operational,testerAccess}') = 'object' then 1
      else 0
    end::bigint
  )
  select coalesce(sum(section_count), 0),
         coalesce(max(section_count), 0)
  into total_record_count, largest_section_count
  from actual_section_counts;

  owned_storage_object_count := pg_catalog.jsonb_array_length(result -> 'storageManifest');

  if largest_section_count > 10000
    or total_record_count > 25000
    or owned_storage_object_count > 2000 then
    raise exception using
      errcode = '54000',
      message = 'account_export_limit_exceeded';
  end if;

  result := result || pg_catalog.jsonb_build_object(
    'recordCount', total_record_count,
    'storageObjectCount', owned_storage_object_count
  );

  if result is null or pg_catalog.octet_length(result::text) > 26214400 then
    raise exception using
      errcode = '54000',
      message = 'account_export_limit_exceeded';
  end if;

  update public.account_data_exports
  set
    record_count = total_record_count::integer,
    storage_object_count = owned_storage_object_count::integer,
    updated_at = now()
  where user_id = current_user_id
    and session_id = current_session_id
    and status = 'finalizing';

  return result;
end;
$$;

-- Route-facing name retained as a thin wrapper over the canonical atomic
-- snapshot function.
create or replace function public.build_account_data_export()
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select public.export_yova_account_data();
$$;

-- Cleanup is leased before any Storage deletion. A worker removes only the two
-- server-derived paths returned here, confirms the matching token after both
-- removals succeed, and releases the lease on a retryable Storage failure.
create or replace function public.claim_expired_account_data_exports(
  requested_limit integer default 250
)
returns table (
  export_id uuid,
  user_id uuid,
  temp_storage_path text,
  final_storage_path text,
  cleanup_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role is required.';
  end if;
  if requested_limit is null or requested_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'account_export_cleanup_limit_invalid';
  end if;

  return query
  with cleanup_candidates as (
    select export_job.id
    from public.account_data_exports as export_job
    where (
        (
          export_job.storage_cleaned_at is null
          and (
            export_job.status in ('failed', 'cancelled')
            or coalesce(export_job.artifact_expires_at, export_job.prepare_expires_at) <= now()
          )
        )
        or (
          export_job.storage_cleaned_at is not null
          and export_job.created_at < now() - interval '1 day'
        )
      )
      and (
        export_job.cleanup_claimed_at is null
        or export_job.cleanup_claimed_at <= now() - interval '5 minutes'
      )
    order by
      case
        when export_job.storage_cleaned_at is not null then export_job.created_at + interval '1 day'
        else coalesce(export_job.artifact_expires_at, export_job.prepare_expires_at)
      end,
      export_job.created_at,
      export_job.id
    for update skip locked
    limit requested_limit
  ), claimed as (
    update public.account_data_exports as export_job
    set
      status = case
        when export_job.status in ('preparing', 'finalizing') then 'failed'
        else export_job.status
      end,
      finalize_grant_digest = null,
      cleanup_claimed_at = now(),
      cleanup_token = extensions.gen_random_uuid(),
      updated_at = now()
    from cleanup_candidates
    where export_job.id = cleanup_candidates.id
    returning
      export_job.id,
      export_job.user_id,
      export_job.temp_storage_path,
      export_job.final_storage_path,
      export_job.cleanup_token,
      case
        when export_job.storage_cleaned_at is not null then export_job.created_at + interval '1 day'
        else coalesce(export_job.artifact_expires_at, export_job.prepare_expires_at)
      end as effective_expiry,
      export_job.created_at
  )
  select
    claimed.id,
    claimed.user_id,
    claimed.temp_storage_path,
    claimed.final_storage_path,
    claimed.cleanup_token
  from claimed
  order by claimed.effective_expiry, claimed.created_at, claimed.id;
end;
$$;

create or replace function public.confirm_account_data_export_cleanup(
  requested_export_id uuid,
  requested_cleanup_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_created_at timestamptz;
  changed_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role is required.';
  end if;
  if requested_export_id is null or requested_cleanup_token is null then
    return false;
  end if;

  select export_job.created_at into job_created_at
  from public.account_data_exports as export_job
  where export_job.id = requested_export_id
    and export_job.cleanup_token = requested_cleanup_token
    and export_job.cleanup_claimed_at is not null
  for update;

  if not found then
    return false;
  end if;

  -- Keep a content-free receipt for the rolling daily quota. Once its full
  -- 24-hour quota window has passed, the next leased cleanup deletes the row.
  if job_created_at >= now() - interval '1 day' then
    update public.account_data_exports as export_job
    set
      storage_cleaned_at = now(),
      cleanup_claimed_at = null,
      cleanup_token = null,
      updated_at = now()
    where export_job.id = requested_export_id
      and export_job.cleanup_token = requested_cleanup_token;
  else
    delete from public.account_data_exports as export_job
    where export_job.id = requested_export_id
      and export_job.cleanup_token = requested_cleanup_token;
  end if;

  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

create or replace function public.release_account_data_export_cleanup(
  requested_export_id uuid,
  requested_cleanup_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  released_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role is required.';
  end if;
  if requested_export_id is null or requested_cleanup_token is null then
    return false;
  end if;

  update public.account_data_exports as export_job
  set
    cleanup_claimed_at = null,
    cleanup_token = null,
    updated_at = now()
  where export_job.id = requested_export_id
    and export_job.cleanup_token = requested_cleanup_token;

  get diagnostics released_count = row_count;
  return released_count = 1;
end;
$$;

-- Reset must revoke any in-flight grant and any still-downloadable artifact in
-- the same transaction that removes learning data. The caller removes the
-- returned exact paths through the Storage API; cancelled rows remain
-- immediately eligible for the leased cleanup worker if that removal fails.
drop function public.reset_yova_learning_data();

create function public.reset_yova_learning_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  account_export_paths jsonb := '[]'::jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  select coalesce(pg_catalog.jsonb_agg(path_entry.storage_path order by path_entry.storage_path), '[]'::jsonb)
  into account_export_paths
  from (
    select export_job.temp_storage_path as storage_path
    from public.account_data_exports as export_job
    where export_job.user_id = current_user_id
    union
    select export_job.final_storage_path as storage_path
    from public.account_data_exports as export_job
    where export_job.user_id = current_user_id
  ) as path_entry;

  update public.account_data_exports
  set
    status = 'cancelled',
    finalize_grant_digest = null,
    prepare_expires_at = least(prepare_expires_at, now()),
    artifact_expires_at = case
      when artifact_expires_at is null then null
      else least(artifact_expires_at, now())
    end,
    updated_at = now()
  where user_id = current_user_id;

  delete from public.material_chunks
  where user_id = current_user_id;

  delete from public.deadline_milestones
  where user_id = current_user_id;

  delete from public.learning_events
  where user_id = current_user_id;

  delete from public.learning_items
  where user_id = current_user_id;

  delete from public.tutor_threads
  where user_id = current_user_id;

  delete from public.material_uploads
  where user_id = current_user_id;

  delete from public.learner_profiles
  where user_id = current_user_id;

  delete from public.product_events
  where user_id = current_user_id;

  delete from public.error_reports
  where user_id = current_user_id;

  update public.profiles
  set onboarding_completed_at = null
  where id = current_user_id;

  return pg_catalog.jsonb_build_object(
    'accountExportPaths', account_export_paths
  );
end;
$$;

revoke all on function public.begin_account_data_export(uuid) from public, anon;
revoke all on function public.claim_account_data_export(uuid, text) from public, anon;
revoke all on function public.export_account_operational_records() from public, anon;
revoke all on function public.export_yova_account_data() from public, anon;
revoke all on function public.build_account_data_export() from public, anon;
revoke all on function public.complete_account_data_export(uuid, bigint, text) from public, anon;
revoke all on function public.fail_account_data_export(uuid) from public, anon;
revoke all on function public.revoke_account_data_export(uuid) from public, anon;
revoke all on function public.claim_expired_account_data_exports(integer) from public, anon, authenticated;
revoke all on function public.confirm_account_data_export_cleanup(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_account_data_export_cleanup(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reset_yova_learning_data() from public, anon;

grant execute on function public.begin_account_data_export(uuid) to authenticated;
grant execute on function public.claim_account_data_export(uuid, text) to authenticated;
grant execute on function public.export_account_operational_records() to authenticated;
grant execute on function public.export_yova_account_data() to authenticated;
grant execute on function public.build_account_data_export() to authenticated;
grant execute on function public.complete_account_data_export(uuid, bigint, text) to authenticated;
grant execute on function public.fail_account_data_export(uuid) to authenticated;
grant execute on function public.revoke_account_data_export(uuid) to authenticated;
grant execute on function public.claim_expired_account_data_exports(integer) to service_role;
grant execute on function public.confirm_account_data_export_cleanup(uuid, uuid) to service_role;
grant execute on function public.release_account_data_export_cleanup(uuid, uuid) to service_role;
grant execute on function public.reset_yova_learning_data() to authenticated;
