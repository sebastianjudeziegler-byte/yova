-- Bound StudyRoute export work before aggregation and keep the claimed export
-- receipt consistent with the final artifact. Migration 004 introduced the
-- route ledger wrapper; replacing only that public signature preserves its
-- private mature base exporter and the build_account_data_export() facade.

create or replace function public.export_yova_account_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_session_id text := coalesce(auth.jwt() ->> 'session_id', '');
  maximum_payload_bytes constant bigint := 26214400;
  base_export jsonb;
  result jsonb;
  route_history jsonb;
  base_record_count bigint;
  route_count bigint;
  actual_route_count bigint;
  combined_record_count bigint;
  base_payload_bytes bigint;
  remaining_payload_bytes bigint;
  route_serialized_bytes bigint;
  route_array_bytes bigint;
  route_envelope_bytes bigint;
begin
  if current_user_id is null or current_session_id = '' then
    raise exception using
      errcode = '28000',
      message = 'Authentication is required.';
  end if;

  -- The private function retains the export claim check, account advisory
  -- lock, bounded base snapshot, Storage manifest, and initial receipt update.
  -- Its transaction-scoped lock remains held through this wrapper.
  base_export := public.export_yova_account_data_without_study_routes();

  begin
    base_record_count := coalesce((base_export ->> 'recordCount')::bigint, 0);
    base_payload_bytes := pg_catalog.octet_length(base_export::text)::bigint;
  exception when others then
    raise exception using
      errcode = '55000',
      message = 'account_export_record_count_invalid';
  end;

  if base_export is null or base_payload_bytes > maximum_payload_bytes then
    raise exception using
      errcode = '54000',
      message = 'account_export_limit_exceeded';
  end if;
  remaining_payload_bytes := maximum_payload_bytes - base_payload_bytes;

  -- Serialize each route once for a cheap count/byte preflight, but do not
  -- construct the potentially large JSON array until every early bound passes.
  with serialized_routes as materialized (
    select pg_catalog.jsonb_build_object(
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
    ) as serialized_route
    from public.study_routes as route
    where route.user_id = current_user_id
  )
  select
    pg_catalog.count(*)::bigint,
    coalesce(
      pg_catalog.sum(pg_catalog.octet_length(serialized_route::text)::bigint),
      0
    )
  into route_count, route_serialized_bytes
  from serialized_routes;

  combined_record_count := base_record_count + route_count;
  if route_count > 10000 or combined_record_count > 25000 then
    raise exception using
      errcode = '54000',
      message = 'account_export_limit_exceeded';
  end if;

  -- jsonb text separates array members with comma+space. The envelope is
  -- intentionally conservative: it includes the replacement recordCount key
  -- as well as studyRoutes, so aggregation never starts when the final payload
  -- cannot fit inside the bytes left by the mature base export.
  route_array_bytes := case
    when route_count = 0 then 2
    else route_serialized_bytes + ((route_count - 1) * 2) + 2
  end;
  route_envelope_bytes := pg_catalog.octet_length(
    pg_catalog.jsonb_build_object(
      'recordCount', combined_record_count,
      'studyRoutes', '[]'::jsonb
    )::text
  )::bigint;

  if route_array_bytes + route_envelope_bytes > remaining_payload_bytes then
    raise exception using
      errcode = '54000',
      message = 'account_export_limit_exceeded';
  end if;

  -- Aggregate only after record and serialized-byte preflight has passed.
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
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
  into route_history
  from public.study_routes as route
  where route.user_id = current_user_id;

  -- READ COMMITTED permits inserts between the preflight and aggregate. Count
  -- the array that will actually ship, then enforce both record limits again.
  actual_route_count := pg_catalog.jsonb_array_length(route_history)::bigint;
  combined_record_count := base_record_count + actual_route_count;
  if actual_route_count > 10000 or combined_record_count > 25000 then
    raise exception using
      errcode = '54000',
      message = 'account_export_limit_exceeded';
  end if;

  result := base_export || pg_catalog.jsonb_build_object(
    'recordCount', combined_record_count,
    'studyRoutes', route_history
  );

  -- The preflight prevents avoidable oversized aggregation; this exact check
  -- remains authoritative for JSON punctuation and concurrent route inserts.
  if result is null
    or pg_catalog.octet_length(result::text) > maximum_payload_bytes then
    raise exception using
      errcode = '54000',
      message = 'account_export_limit_exceeded';
  end if;

  update public.account_data_exports as export_job
  set
    record_count = combined_record_count::integer,
    updated_at = now()
  where export_job.user_id = current_user_id
    and export_job.session_id = current_session_id
    and export_job.status = 'finalizing';

  if not found then
    raise exception using
      errcode = '55000',
      message = 'account_export_not_claimed';
  end if;

  return result;
end;
$$;

revoke all on function public.export_yova_account_data()
from public, anon, authenticated;
grant execute on function public.export_yova_account_data()
to authenticated;
