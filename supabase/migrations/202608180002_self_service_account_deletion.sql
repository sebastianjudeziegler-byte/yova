-- Self-service account deletion is deliberately split into two durable phases:
-- one transaction removes the Auth identity and every FK-owned database row,
-- while an ownerless cleanup receipt preserves the exact private Storage paths
-- until the scheduled worker confirms their removal.

alter table public.tester_invites
  alter column invited_by drop not null;

alter table public.tester_invites
  drop constraint if exists tester_invites_invited_by_fkey;

alter table public.tester_invites
  add constraint tester_invites_invited_by_fkey
  foreign key (invited_by)
  references auth.users(id)
  on delete set null;

create table public.account_deletion_cleanup_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  -- No Auth FK: the receipt must outlive the identity it is cleaning up.
  user_id uuid not null,
  learning_material_paths text[] not null default '{}'::text[],
  account_export_paths text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  cleanup_claimed_at timestamptz,
  cleanup_token uuid,
  constraint account_deletion_cleanup_jobs_lease_check check (
    (cleanup_claimed_at is null and cleanup_token is null)
    or (cleanup_claimed_at is not null and cleanup_token is not null)
  ),
  constraint account_deletion_cleanup_jobs_learning_path_count_check check (
    cardinality(learning_material_paths) <= 10000
  ),
  constraint account_deletion_cleanup_jobs_export_path_count_check check (
    cardinality(account_export_paths) <= 10000
  )
);

create index account_deletion_cleanup_jobs_claim_idx
on public.account_deletion_cleanup_jobs(created_at, cleanup_claimed_at);

alter table public.account_deletion_cleanup_jobs enable row level security;
revoke all on table public.account_deletion_cleanup_jobs from public, anon, authenticated, service_role;

create or replace function public.delete_yova_account(expected_account_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  cleanup_job_id uuid := extensions.gen_random_uuid();
  learning_paths text[] := '{}'::text[];
  export_paths text[] := '{}'::text[];
  confirmed_at timestamptz;
begin
  if current_user_id is null
    or expected_account_id is null
    or current_user_id <> expected_account_id then
    raise exception using
      errcode = '42501',
      message = 'account_deletion_identity_mismatch';
  end if;

  if public.account_export_has_recent_human_amr() is not true then
    raise exception using
      errcode = 'PXD01',
      message = 'account_deletion_reauthentication_required';
  end if;

  select auth_user.email_confirmed_at
  into confirmed_at
  from auth.users as auth_user
  where auth_user.id = current_user_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'account_deletion_identity_missing';
  end if;
  if confirmed_at is null then
    raise exception using
      errcode = 'PXD02',
      message = 'account_deletion_email_unverified';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  select coalesce(array_agg(object.name order by object.name), '{}'::text[])
  into learning_paths
  from storage.objects as object
  where object.bucket_id = 'learning-materials'
    and object.name like current_user_id::text || '/%';

  select coalesce(array_agg(path_entry.path order by path_entry.path), '{}'::text[])
  into export_paths
  from (
    select object.name as path
    from storage.objects as object
    where object.bucket_id = 'account-exports'
      and object.name like current_user_id::text || '/%'
    union
    select export_job.temp_storage_path as path
    from public.account_data_exports as export_job
    where export_job.user_id = current_user_id
    union
    select export_job.final_storage_path as path
    from public.account_data_exports as export_job
    where export_job.user_id = current_user_id
  ) as path_entry;

  if cardinality(learning_paths) > 10000 or cardinality(export_paths) > 10000 then
    raise exception using
      errcode = '54000',
      message = 'account_deletion_cleanup_limit_exceeded';
  end if;

  if exists (
    select 1 from unnest(learning_paths) as path(value)
    where path.value not like current_user_id::text || '/%'
      or path.value like '%/../%'
  ) or exists (
    select 1 from unnest(export_paths) as path(value)
    where path.value not like current_user_id::text || '/%'
      or path.value like '%/../%'
  ) then
    raise exception using
      errcode = '22023',
      message = 'account_deletion_cleanup_path_invalid';
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
  where user_id = current_user_id;

  insert into public.account_deletion_cleanup_jobs (
    id,
    user_id,
    learning_material_paths,
    account_export_paths
  ) values (
    cleanup_job_id,
    current_user_id,
    learning_paths,
    export_paths
  );

  -- The deletion receipt above now owns exact Storage cleanup. Remove export
  -- quota/receipt rows so no account-export metadata survives the account.
  delete from public.account_data_exports
  where user_id = current_user_id;

  -- Founder-created invitation records remain as operational history without
  -- retaining a deleted founder identity. Joined self-invites are detached by
  -- their ON DELETE SET NULL relationship below.
  update public.tester_invites
  set invited_by = null
  where invited_by = current_user_id;

  delete from auth.users
  where id = current_user_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'account_deletion_not_completed';
  end if;

  return pg_catalog.jsonb_build_object(
    'deletedAccountId', current_user_id,
    'cleanupJobId', cleanup_job_id
  );
end;
$$;

create or replace function public.claim_account_deletion_cleanup_jobs(requested_limit integer default 100)
returns table (
  cleanup_job_id uuid,
  user_id uuid,
  learning_material_paths text[],
  account_export_paths text[],
  cleanup_token uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;

  return query
  with candidates as (
    select job.id
    from public.account_deletion_cleanup_jobs as job
    where job.cleanup_claimed_at is null
      or job.cleanup_claimed_at < now() - interval '10 minutes'
    order by job.created_at, job.id
    for update skip locked
    limit greatest(1, least(coalesce(requested_limit, 100), 500))
  ), claimed as (
    update public.account_deletion_cleanup_jobs as job
    set cleanup_claimed_at = now(), cleanup_token = extensions.gen_random_uuid()
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select
    claimed.id,
    claimed.user_id,
    claimed.learning_material_paths,
    claimed.account_export_paths,
    claimed.cleanup_token
  from claimed
  order by claimed.created_at, claimed.id;
end;
$$;

create or replace function public.confirm_account_deletion_cleanup(
  requested_cleanup_job_id uuid,
  requested_cleanup_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;

  delete from public.account_deletion_cleanup_jobs
  where id = requested_cleanup_job_id
    and cleanup_token = requested_cleanup_token;
  return found;
end;
$$;

create or replace function public.release_account_deletion_cleanup(
  requested_cleanup_job_id uuid,
  requested_cleanup_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;

  update public.account_deletion_cleanup_jobs
  set cleanup_claimed_at = null, cleanup_token = null
  where id = requested_cleanup_job_id
    and cleanup_token = requested_cleanup_token;
  return found;
end;
$$;

revoke all on function public.delete_yova_account(uuid) from public, anon;
revoke all on function public.claim_account_deletion_cleanup_jobs(integer) from public, anon, authenticated;
revoke all on function public.confirm_account_deletion_cleanup(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_account_deletion_cleanup(uuid, uuid) from public, anon, authenticated;

grant execute on function public.delete_yova_account(uuid) to authenticated;
grant execute on function public.claim_account_deletion_cleanup_jobs(integer) to service_role;
grant execute on function public.confirm_account_deletion_cleanup(uuid, uuid) to service_role;
grant execute on function public.release_account_deletion_cleanup(uuid, uuid) to service_role;
