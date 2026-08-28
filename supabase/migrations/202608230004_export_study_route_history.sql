-- StudyRoute history is learner-owned personalization data. Extend the mature
-- account export transaction without copying its large, security-sensitive
-- implementation: the renamed function keeps its claim, advisory-lock,
-- storage-manifest, and bounded-table behavior, while this wrapper adds the
-- immutable route ledger under the same PostgreSQL transaction.

alter function public.export_yova_account_data()
rename to export_yova_account_data_without_study_routes;

revoke all on function public.export_yova_account_data_without_study_routes()
from public, anon, authenticated;

create or replace function public.export_yova_account_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  base_export jsonb;
  route_count bigint;
  base_record_count bigint;
  route_history jsonb;
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'Authentication is required.';
  end if;

  -- This call claims and locks the same export job used by Reset. The
  -- transaction-scoped advisory lock remains held until this wrapper returns.
  base_export := public.export_yova_account_data_without_study_routes();

  select count(*), coalesce(jsonb_agg(
    jsonb_build_object(
      'routeRevisionId', route.route_revision_id,
      'routeLineageId', route.route_lineage_id,
      'revisionNumber', route.revision_number,
      'schemaVersion', route.schema_version,
      'lifecycleStatus', route.lifecycle,
      'planId', route.plan_id,
      'planSessionId', route.plan_session_id,
      'supersedesRevisionId', route.predecessor_revision_id,
      'route', route.route_payload,
      'routeFingerprint', route.route_fingerprint,
      'createdAt', route.created_at,
      'committedAt', route.committed_at
    ) order by route.plan_id, route.plan_session_id, route.revision_number
  ), '[]'::jsonb)
  into route_count, route_history
  from public.study_routes as route
  where route.user_id = current_user_id;

  begin
    base_record_count := coalesce((base_export ->> 'recordCount')::bigint, 0);
  exception when others then
    raise exception using
      errcode = '55000',
      message = 'account_export_record_count_invalid';
  end;

  if route_count > 10000 or base_record_count + route_count > 25000 then
    raise exception using
      errcode = '54000',
      message = 'account_export_limit_exceeded';
  end if;

  return base_export || jsonb_build_object(
    'recordCount', base_record_count + route_count,
    'studyRoutes', route_history
  );
end;
$$;

revoke all on function public.export_yova_account_data()
from public, anon, authenticated;
grant execute on function public.export_yova_account_data()
to authenticated;
