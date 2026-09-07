-- Keep hashes rather than questions or answers. Expired rows are removed by
-- subsequent scoring or account deletion. Exact retries are allowed; a second
-- answer set cannot fish for the sealed answer key.
create table private.placement_scoring_receipts (
  challenge_hash text primary key check (challenge_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  answers_hash text not null check (answers_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null
);
create index placement_scoring_receipts_expiry on private.placement_scoring_receipts(expires_at);
alter table private.placement_scoring_receipts enable row level security;
revoke all on private.placement_scoring_receipts from public, anon, authenticated, service_role;

create function public.claim_placement_scoring_v1(
  requested_user_id uuid, requested_challenge_hash text,
  requested_answers_hash text, requested_expires_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  stored private.placement_scoring_receipts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501', message='server_scoring_required';
  end if;
  if requested_user_id is null
    or requested_challenge_hash is null or requested_challenge_hash !~ '^[0-9a-f]{64}$'
    or requested_answers_hash is null or requested_answers_hash !~ '^[0-9a-f]{64}$'
    or requested_expires_at is null or requested_expires_at <= now()
    or requested_expires_at > now() + interval '31 minutes' then
    raise exception 'placement_scoring_receipt_invalid';
  end if;
  delete from private.placement_scoring_receipts where expires_at < now();
  insert into private.placement_scoring_receipts(challenge_hash,user_id,answers_hash,expires_at)
  values(requested_challenge_hash,requested_user_id,requested_answers_hash,requested_expires_at)
  on conflict (challenge_hash) do update set challenge_hash=excluded.challenge_hash
  returning * into stored;
  return stored.user_id=requested_user_id and stored.answers_hash=requested_answers_hash;
end;
$$;
revoke all on function public.claim_placement_scoring_v1(uuid,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_placement_scoring_v1(uuid,text,text,timestamptz) to service_role;
