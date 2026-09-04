-- AI usage windows and reservation claims are implementation ledgers. Every
-- supported caller now enters through a SECURITY DEFINER RPC, so no PostgREST
-- role needs direct table mutation. RLS happened to deny the stale grants in
-- production, but retaining them would make a later policy change silently
-- reopen caller-controlled quota and reservation writes.
revoke all on table public.ai_usage_windows
from public, anon, authenticated, service_role;

revoke all on table public.ai_usage_claims
from public, anon, authenticated, service_role;

-- The production lifecycle canary uses the trusted admin client to prove the
-- account-deletion cascade removed usage windows. Keep that read-only audit
-- capability without exposing either ledger to untrusted clients or allowing
-- the service role to bypass the RPC mutation contracts.
grant select on table public.ai_usage_windows to service_role;
