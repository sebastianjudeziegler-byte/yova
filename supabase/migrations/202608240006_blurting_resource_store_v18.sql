-- Reserve the dedicated, server-private Blurting V18 resource store without
-- enabling generation, issuance, delivery, evaluation, or runtime use. The
-- generic generatedSession slot remains protected by migration 005 and must
-- never contain the full V18 candidate, which includes answer-bearing and
-- evaluator-only fields.

-- This migration depends on migration 005's unconditional broad-resource
-- containment and its current Reset wrapper. Fail the ordered migration chain
-- instead of installing a private store beside an older browser-writable
-- generic cache boundary.
do $$
declare
  cache_guard_definition text;
  reset_definition text;
begin
  if pg_catalog.to_regclass(
      'public.generated_resource_authority_permits'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.generated_resource_digest_v1(jsonb)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.guard_generated_resource_authority_v1()'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.reset_yova_learning_data()'
    ) is null then
    raise exception using
      errcode = '55000',
      message = 'blurting_resource_store_v18_dependency_missing';
  end if;

  cache_guard_definition := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.guard_generated_resource_authority_v1()'::pg_catalog.regprocedure
  ));
  reset_definition := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.reset_yova_learning_data()'::pg_catalog.regprocedure
  ));

  if cache_guard_definition not like
      '%generated_resource_authority_unavailable%'
    or cache_guard_definition not like
      '%generated_session_has_broad_recall_v1%'
    or reset_definition not like
      '%generated_resource_authority_permits%'
    or exists (
      select 1
      from public.generated_resource_authority_permits
    )
    or pg_catalog.has_table_privilege(
      'anon', 'public.generated_resource_authority_permits', 'SELECT'
    )
    or pg_catalog.has_table_privilege(
      'anon', 'public.generated_resource_authority_permits', 'INSERT'
    )
    or pg_catalog.has_table_privilege(
      'anon', 'public.generated_resource_authority_permits', 'UPDATE'
    )
    or pg_catalog.has_table_privilege(
      'anon', 'public.generated_resource_authority_permits', 'DELETE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.generated_resource_authority_permits',
      'SELECT'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.generated_resource_authority_permits',
      'INSERT'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.generated_resource_authority_permits',
      'UPDATE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.generated_resource_authority_permits',
      'DELETE'
    )
    or pg_catalog.has_table_privilege(
      'service_role',
      'public.generated_resource_authority_permits',
      'SELECT'
    )
    or pg_catalog.has_table_privilege(
      'service_role',
      'public.generated_resource_authority_permits',
      'INSERT'
    )
    or pg_catalog.has_table_privilege(
      'service_role',
      'public.generated_resource_authority_permits',
      'UPDATE'
    )
    or pg_catalog.has_table_privilege(
      'service_role',
      'public.generated_resource_authority_permits',
      'DELETE'
    ) then
    raise exception using
      errcode = '55000',
      message = 'blurting_resource_store_v18_dependency_changed';
  end if;
end;
$$;

-- Supabase exposes the public schema through PostgREST. Keeping canonical
-- resources in an unexposed schema is stronger than relying on a public-table
-- policy alone. No client or service role receives direct schema usage.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

-- Bounded ordered source identifiers are part of the resource identity. They
-- remain opaque because a trusted external source need not use a UUID.
create or replace function private.blurting_source_ids_valid_v1(
  source_ids text[]
)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  source_id text;
  seen_ids text[] := '{}'::text[];
begin
  if pg_catalog.array_ndims(source_ids) is distinct from 1
    or pg_catalog.array_lower(source_ids, 1) is distinct from 1
    or pg_catalog.cardinality(source_ids) not between 1 and 20 then
    return false;
  end if;

  foreach source_id in array source_ids loop
    if source_id is null
      or source_id is distinct from pg_catalog.btrim(source_id)
      or pg_catalog.length(source_id) not between 1 and 200
      or source_id = any(seen_ids) then
      return false;
    end if;
    seen_ids := pg_catalog.array_append(seen_ids, source_id);
  end loop;

  return true;
end;
$$;

revoke all on function private.blurting_source_ids_valid_v1(text[])
from public, anon, authenticated, service_role;

-- Strict object roots prevent a future reader from silently accepting a
-- caller-added delivery identity, secret-bearing field, or digest input that
-- is outside the reviewed TypeScript contract.
create or replace function private.jsonb_has_exact_keys_v1(
  candidate jsonb,
  expected_keys text[]
)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  actual_key_count integer;
begin
  if pg_catalog.jsonb_typeof(candidate) is distinct from 'object'
    or pg_catalog.cardinality(expected_keys) < 1
    or not (candidate ?& expected_keys) then
    return false;
  end if;

  select pg_catalog.count(*)::integer
  into actual_key_count
  from pg_catalog.jsonb_object_keys(candidate) as object_key(key);

  return actual_key_count = pg_catalog.cardinality(expected_keys);
end;
$$;

revoke all on function private.jsonb_has_exact_keys_v1(jsonb, text[])
from public, anon, authenticated, service_role;

-- A strict public projection must not hide an answer key, rubric, source
-- snapshot, learner draft, or server receipt inside a nested object. Key
-- comparison is case-insensitive so casing cannot bypass this defense-in-depth
-- scan. Exact nested object keys remain the primary allow-list. This helper is
-- used only by CHECK constraints; it exposes no read capability.
create or replace function private.jsonb_contains_any_key_v1(
  candidate jsonb,
  forbidden_keys text[]
)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  object_entry record;
  array_entry jsonb;
  candidate_type text := pg_catalog.jsonb_typeof(candidate);
begin
  if candidate_type = 'object' then
    for object_entry in
      select entry.key, entry.value
      from pg_catalog.jsonb_each(candidate) as entry(key, value)
    loop
      if exists (
        select 1
        from pg_catalog.unnest(forbidden_keys) as forbidden_key(key)
        where pg_catalog.lower(forbidden_key.key)
          = pg_catalog.lower(object_entry.key)
      )
        or private.jsonb_contains_any_key_v1(
          object_entry.value,
          forbidden_keys
        ) then
        return true;
      end if;
    end loop;
  elsif candidate_type = 'array' then
    for array_entry in
      select entry.value
      from pg_catalog.jsonb_array_elements(candidate) as entry(value)
    loop
      if private.jsonb_contains_any_key_v1(
        array_entry,
        forbidden_keys
      ) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

revoke all on function private.jsonb_contains_any_key_v1(jsonb, text[])
from public, anon, authenticated, service_role;

-- Cross-language digest inputs use one explicit compact canonical JSON form:
-- object keys sort by their ASCII bytes, arrays retain order, and no layout
-- whitespace is emitted. All contract keys are ASCII and every contract
-- number is an integer, so a future TypeScript writer can reproduce this with
-- recursive key sorting plus JSON.stringify instead of depending on
-- PostgreSQL's presentation-oriented jsonb::text spacing and key order.
create or replace function private.canonical_json_v1(
  candidate jsonb
)
returns text
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  candidate_type text := pg_catalog.jsonb_typeof(candidate);
  canonical_value text;
begin
  if candidate_type = 'object' then
    select '{' || coalesce(
      pg_catalog.string_agg(
        pg_catalog.to_jsonb(entry.key)::text
          || ':'
          || private.canonical_json_v1(entry.value),
        ',' order by entry.key collate "C"
      ),
      ''
    ) || '}'
    into canonical_value
    from pg_catalog.jsonb_each(candidate) as entry(key, value);
    return canonical_value;
  end if;

  if candidate_type = 'array' then
    select '[' || coalesce(
      pg_catalog.string_agg(
        private.canonical_json_v1(entry.value),
        ',' order by entry.ordinality
      ),
      ''
    ) || ']'
    into canonical_value
    from pg_catalog.jsonb_array_elements(candidate)
      with ordinality as entry(value, ordinality);
    return canonical_value;
  end if;

  return candidate::text;
end;
$$;

revoke all on function private.canonical_json_v1(jsonb)
from public, anon, authenticated, service_role;

-- Every digest has its own domain. Callers never supply the domain and cannot
-- reinterpret one digest as another receipt type.
create or replace function private.blurting_public_payload_digest_v18(
  public_payload jsonb
)
returns bytea
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select extensions.digest(
    pg_catalog.convert_to(
      'yova.blurting.public.v18|'
        || private.canonical_json_v1(public_payload),
      'UTF8'
    ),
    'sha256'
  );
$$;

create or replace function private.blurting_server_payload_digest_v18(
  server_payload jsonb
)
returns bytea
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select extensions.digest(
    pg_catalog.convert_to(
      'yova.blurting.server.v18|'
        || private.canonical_json_v1(server_payload),
      'UTF8'
    ),
    'sha256'
  );
$$;

create or replace function private.blurting_source_snapshot_digest_v1(
  source_snapshot jsonb
)
returns bytea
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select extensions.digest(
    pg_catalog.convert_to(
      'yova.blurting.source_snapshot.v1|'
        || private.canonical_json_v1(source_snapshot),
      'UTF8'
    ),
    'sha256'
  );
$$;

create or replace function private.blurting_source_chunk_digest_v1(
  canonical_text text
)
returns bytea
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select extensions.digest(
    pg_catalog.convert_to(
      'yova.blurting.source_chunk.v1|'
        || private.canonical_json_v1(pg_catalog.to_jsonb(canonical_text)),
      'UTF8'
    ),
    'sha256'
  );
$$;

create or replace function private.blurting_resource_digest_v18(
  resource_claim jsonb
)
returns bytea
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select extensions.digest(
    pg_catalog.convert_to(
      'yova.blurting.resource.v18|'
        || private.canonical_json_v1(resource_claim),
      'UTF8'
    ),
    'sha256'
  );
$$;

create or replace function private.blurting_delivery_receipt_digest_v18(
  delivery_claim jsonb
)
returns bytea
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select extensions.digest(
    pg_catalog.convert_to(
      'yova.blurting.delivery_receipt.v18|'
        || private.canonical_json_v1(delivery_claim),
      'UTF8'
    ),
    'sha256'
  );
$$;

create or replace function private.blurting_evaluation_request_digest_v18(
  request_claim jsonb
)
returns bytea
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select extensions.digest(
    pg_catalog.convert_to(
      'yova.blurting.evaluation_request.v18|'
        || private.canonical_json_v1(request_claim),
      'UTF8'
    ),
    'sha256'
  );
$$;

create or replace function private.blurting_evaluation_result_digest_v18(
  result_claim jsonb
)
returns bytea
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select extensions.digest(
    pg_catalog.convert_to(
      'yova.blurting.evaluation_result.v18|'
        || private.canonical_json_v1(result_claim),
      'UTF8'
    ),
    'sha256'
  );
$$;

revoke all on function private.blurting_public_payload_digest_v18(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.blurting_server_payload_digest_v18(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.blurting_source_snapshot_digest_v1(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.blurting_source_chunk_digest_v1(text)
from public, anon, authenticated, service_role;
revoke all on function private.blurting_resource_digest_v18(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.blurting_delivery_receipt_digest_v18(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.blurting_evaluation_request_digest_v18(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.blurting_evaluation_result_digest_v18(jsonb)
from public, anon, authenticated, service_role;

-- Pinned cross-language vector for the only scalar digest input. The exact
-- canonical bytes after the domain are JSON.stringify('Blurting "A"\nB'):
-- "Blurting \"A\"\nB". Abort installation if PostgreSQL ever produces a
-- different byte contract.
do $$
begin
  if private.canonical_json_v1(
      pg_catalog.jsonb_build_object(
        'z', 2,
        'a', pg_catalog.jsonb_build_array('x', 1)
      )
    ) is distinct from '{"a":["x",1],"z":2}'
    or pg_catalog.encode(
      private.blurting_source_chunk_digest_v1(E'Blurting "A"\nB'),
      'hex'
    ) is distinct from
      '86fd9b600999bd40b16fb5cdc84f34adcd344996a8ff5780369263273f6e8c2c' then
    raise exception using
      errcode = '55000',
      message = 'blurting_canonical_digest_contract_changed';
  end if;
end;
$$;

-- The snapshot is a bounded immutable copy of the exact server-loaded source
-- used for generation. A browser-writable source row may change while the
-- model is running; a later writer must re-read it and submit this exact
-- manifest, whose content digests are independently checked here.
create or replace function private.blurting_source_snapshot_valid_v1(
  source_snapshot jsonb,
  expected_source_type text,
  expected_source_ids text[]
)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  manifest_entry jsonb;
  source_id text;
  source_version_id text;
  chunk_id text;
  source_label text;
  location_label text;
  canonical_text text;
  content_digest text;
  root_key_count integer;
  entry_key_count integer;
  seen_pairs text[] := '{}'::text[];
  seen_source_ids text[] := '{}'::text[];
  pair_identity text;
  required_source_id text;
begin
  if pg_catalog.jsonb_typeof(source_snapshot) is distinct from 'object' then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(source_snapshot -> 'manifest')
    is distinct from 'array' then
    return false;
  end if;

  select pg_catalog.count(*)::integer
  into root_key_count
  from pg_catalog.jsonb_object_keys(source_snapshot) as root_key(key);

  if root_key_count <> 4
    or not (source_snapshot ?& array[
      'sourceSnapshotId',
      'sourceType',
      'requiredSourceIds',
      'manifest'
    ])
    or pg_catalog.jsonb_typeof(source_snapshot -> 'sourceSnapshotId')
      is distinct from 'string'
    or (source_snapshot ->> 'sourceSnapshotId')
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or source_snapshot ->> 'sourceType' is distinct from expected_source_type
    or source_snapshot -> 'requiredSourceIds'
      is distinct from pg_catalog.to_jsonb(expected_source_ids)
    or pg_catalog.jsonb_array_length(source_snapshot -> 'manifest')
      not between 1 and 24 then
    return false;
  end if;

  for manifest_entry in
    select entry.value
    from pg_catalog.jsonb_array_elements(
      source_snapshot -> 'manifest'
    ) as entry(value)
  loop
    if pg_catalog.jsonb_typeof(manifest_entry) is distinct from 'object' then
      return false;
    end if;

    select pg_catalog.count(*)::integer
    into entry_key_count
    from pg_catalog.jsonb_object_keys(manifest_entry) as entry_key(key);

    if entry_key_count <> 7
      or not (manifest_entry ?& array[
        'sourceId',
        'sourceVersionId',
        'chunkId',
        'sourceLabel',
        'locationLabel',
        'contentDigest',
        'canonicalText'
      ])
      or exists (
        select 1
        from pg_catalog.jsonb_each(manifest_entry) as field(key, value)
        where pg_catalog.jsonb_typeof(field.value) is distinct from 'string'
      ) then
      return false;
    end if;

    source_id := manifest_entry ->> 'sourceId';
    source_version_id := manifest_entry ->> 'sourceVersionId';
    chunk_id := manifest_entry ->> 'chunkId';
    source_label := manifest_entry ->> 'sourceLabel';
    location_label := manifest_entry ->> 'locationLabel';
    content_digest := manifest_entry ->> 'contentDigest';
    canonical_text := manifest_entry ->> 'canonicalText';
    pair_identity := pg_catalog.jsonb_build_array(source_id, chunk_id)::text;

    if source_id is distinct from pg_catalog.btrim(source_id)
      or pg_catalog.length(source_id) not between 1 and 200
      or not (source_id = any(expected_source_ids))
      or source_version_id is distinct from pg_catalog.btrim(source_version_id)
      or pg_catalog.length(source_version_id) not between 1 and 200
      or chunk_id is distinct from pg_catalog.btrim(chunk_id)
      or pg_catalog.length(chunk_id) not between 1 and 200
      or source_label is distinct from pg_catalog.btrim(source_label)
      or pg_catalog.length(source_label) not between 1 and 180
      or location_label is distinct from pg_catalog.btrim(location_label)
      or pg_catalog.length(location_label) not between 1 and 120
      or canonical_text is distinct from pg_catalog.btrim(canonical_text)
      or pg_catalog.length(canonical_text) not between 1 and 7000
      or content_digest !~ '^[0-9a-f]{64}$'
      or content_digest is distinct from pg_catalog.encode(
        private.blurting_source_chunk_digest_v1(canonical_text),
        'hex'
      )
      or pair_identity = any(seen_pairs) then
      return false;
    end if;

    seen_pairs := pg_catalog.array_append(seen_pairs, pair_identity);
    if not (source_id = any(seen_source_ids)) then
      seen_source_ids := pg_catalog.array_append(seen_source_ids, source_id);
    end if;
  end loop;

  foreach required_source_id in array expected_source_ids loop
    if not (required_source_id = any(seen_source_ids)) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function private.blurting_source_snapshot_valid_v1(
  jsonb,
  text,
  text[]
) from public, anon, authenticated, service_role;

-- Evaluation receipts retain only the ordered target/evidence/result vector.
-- Learner text is neither valid here nor present in any table column.
create or replace function private.blurting_result_vector_valid_v18(
  result_vector jsonb
)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  result_entry jsonb;
  target_id text;
  evidence_id text;
  target_ids text[] := '{}'::text[];
  evidence_ids text[] := '{}'::text[];
  result_key_count integer;
begin
  if pg_catalog.jsonb_typeof(result_vector) is distinct from 'array' then
    return false;
  end if;
  if pg_catalog.jsonb_array_length(result_vector) not between 1 and 3 then
    return false;
  end if;

  for result_entry in
    select entry.value
    from pg_catalog.jsonb_array_elements(result_vector) as entry(value)
  loop
    if pg_catalog.jsonb_typeof(result_entry) is distinct from 'object' then
      return false;
    end if;

    select pg_catalog.count(*)::integer
    into result_key_count
    from pg_catalog.jsonb_object_keys(result_entry) as result_key(key);

    target_id := result_entry ->> 'targetId';
    evidence_id := result_entry ->> 'evidenceId';
    if result_key_count <> 3
      or not (result_entry ?& array['targetId', 'evidenceId', 'result'])
      or target_id is null
      or target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or evidence_id is distinct from 'blurting-final-check:' || target_id
      or result_entry ->> 'result' is null
      or result_entry ->> 'result' not in (
        'secure',
        'needs_review',
        'unverified'
      )
      or target_id = any(target_ids)
      or evidence_id = any(evidence_ids) then
      return false;
    end if;

    target_ids := pg_catalog.array_append(target_ids, target_id);
    evidence_ids := pg_catalog.array_append(evidence_ids, evidence_id);
  end loop;

  return true;
end;
$$;

create or replace function private.blurting_result_vector_all_unverified_v18(
  result_vector jsonb
)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  result_entry jsonb;
begin
  if not private.blurting_result_vector_valid_v18(result_vector) then
    return false;
  end if;

  for result_entry in
    select entry.value
    from pg_catalog.jsonb_array_elements(result_vector) as entry(value)
  loop
    if result_entry ->> 'result' is distinct from 'unverified' then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

-- Terminal results must retain the exact resource-owned target/evidence order.
-- A caller-supplied well-shaped vector for another target is never authority.
create or replace function private.blurting_result_vector_matches_resource_v18(
  result_vector jsonb,
  public_payload jsonb
)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  ordered_targets jsonb;
  target_entry jsonb;
  result_entry jsonb;
  entry_index integer;
begin
  ordered_targets := public_payload #> '{orderedTargets}';
  if private.blurting_result_vector_valid_v18(result_vector) is not true then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(ordered_targets) is distinct from 'array' then
    return false;
  end if;
  if pg_catalog.jsonb_array_length(ordered_targets)
    is distinct from pg_catalog.jsonb_array_length(result_vector) then
    return false;
  end if;

  for entry_index in 0..pg_catalog.jsonb_array_length(result_vector) - 1
  loop
    target_entry := ordered_targets -> entry_index;
    result_entry := result_vector -> entry_index;
    if target_entry ->> 'targetId' is null
      or target_entry ->> 'evidenceId' is null
      or target_entry ->> 'targetId'
        is distinct from result_entry ->> 'targetId'
      or target_entry ->> 'evidenceId'
        is distinct from result_entry ->> 'evidenceId' then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function private.blurting_result_vector_valid_v18(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.blurting_result_vector_all_unverified_v18(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.blurting_result_vector_matches_resource_v18(
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;

-- The browser projection is answer-free by construction, not by a finite
-- deny-list. This validator mirrors the strict V18 public resource template
-- so a future internal writer cannot self-digest an extra secret-bearing key.
create or replace function private.blurting_public_resource_payload_valid_v18(
  public_payload jsonb
)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  identity_payload jsonb;
  initial_recall jsonb;
  target_entry jsonb;
  phase_entry jsonb;
  phase_target_entry jsonb;
  target_id text;
  evidence_id text;
  display_label text;
  phase_index integer := 0;
  phase_target_index integer;
  target_ids text[] := '{}'::text[];
  expected_phase_ids text[] := array[
    'method-1-retrieve',
    'method-2-repair',
    'method-3-transfer'
  ]::text[];
  expected_phase_names text[] := array[
    'retrieve',
    'repair',
    'transfer'
  ]::text[];
begin
  if pg_catalog.jsonb_typeof(public_payload) is distinct from 'object'
    or not private.jsonb_has_exact_keys_v1(
      public_payload,
      array[
        'schemaVersion',
        'boundaryStatus',
        'identity',
        'orderedTargets',
        'phaseMetadata',
        'gapCount',
        'initialRecall'
      ]::text[]
    )
    or public_payload -> 'schemaVersion' is distinct from '18'::jsonb
    or public_payload ->> 'boundaryStatus'
      is distinct from 'disabled_public_resource_template_only'
    or pg_catalog.jsonb_typeof(public_payload -> 'gapCount')
      is distinct from 'number'
    or (public_payload ->> 'gapCount') !~ '^[1-6]$' then
    return false;
  end if;

  identity_payload := public_payload -> 'identity';
  if pg_catalog.jsonb_typeof(identity_payload) is distinct from 'object'
    or not private.jsonb_has_exact_keys_v1(
      identity_payload,
      array[
        'planId',
        'sessionId',
        'routeRevisionId',
        'resourceFingerprint',
        'resourceGeneratedAt'
      ]::text[]
    )
    or pg_catalog.jsonb_typeof(identity_payload -> 'planId')
      is distinct from 'string'
    or pg_catalog.jsonb_typeof(identity_payload -> 'sessionId')
      is distinct from 'string'
    or pg_catalog.jsonb_typeof(identity_payload -> 'routeRevisionId')
      is distinct from 'string'
    or identity_payload ->> 'planId'
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or identity_payload ->> 'sessionId'
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or identity_payload ->> 'routeRevisionId'
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(identity_payload -> 'resourceFingerprint')
      is distinct from 'string'
    or identity_payload ->> 'resourceFingerprint' !~ '^sr1:[0-9a-f]{16}$'
    or pg_catalog.jsonb_typeof(identity_payload -> 'resourceGeneratedAt')
      is distinct from 'string'
    or pg_catalog.length(identity_payload ->> 'resourceGeneratedAt')
      not between 20 and 64 then
    return false;
  end if;

  initial_recall := public_payload -> 'initialRecall';
  if pg_catalog.jsonb_typeof(initial_recall) is distinct from 'object'
    or not private.jsonb_has_exact_keys_v1(
      initial_recall,
      array['sourceClosedReminder', 'prompt']::text[]
    )
    or pg_catalog.jsonb_typeof(initial_recall -> 'sourceClosedReminder')
      is distinct from 'string'
    or initial_recall ->> 'sourceClosedReminder'
      is distinct from pg_catalog.btrim(
        initial_recall ->> 'sourceClosedReminder'
      )
    or pg_catalog.length(initial_recall ->> 'sourceClosedReminder')
      not between 10 and 200
    or pg_catalog.jsonb_typeof(initial_recall -> 'prompt')
      is distinct from 'string'
    or initial_recall ->> 'prompt'
      is distinct from pg_catalog.btrim(initial_recall ->> 'prompt')
    or pg_catalog.length(initial_recall ->> 'prompt') not between 3 and 320 then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(public_payload -> 'orderedTargets')
      is distinct from 'array'
    or pg_catalog.jsonb_array_length(public_payload -> 'orderedTargets')
      not between 1 and 3 then
    return false;
  end if;

  for target_entry in
    select entry.value
    from pg_catalog.jsonb_array_elements(
      public_payload -> 'orderedTargets'
    ) as entry(value)
  loop
    if pg_catalog.jsonb_typeof(target_entry) is distinct from 'object'
      or not private.jsonb_has_exact_keys_v1(
        target_entry,
        array['targetId', 'evidenceId', 'displayLabel']::text[]
      )
      or pg_catalog.jsonb_typeof(target_entry -> 'targetId')
        is distinct from 'string'
      or pg_catalog.jsonb_typeof(target_entry -> 'evidenceId')
        is distinct from 'string'
      or pg_catalog.jsonb_typeof(target_entry -> 'displayLabel')
        is distinct from 'string' then
      return false;
    end if;

    target_id := target_entry ->> 'targetId';
    evidence_id := target_entry ->> 'evidenceId';
    display_label := target_entry ->> 'displayLabel';
    if target_id
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or evidence_id is distinct from 'blurting-final-check:' || target_id
      or pg_catalog.length(evidence_id) not between 1 and 200
      or display_label is distinct from pg_catalog.btrim(display_label)
      or pg_catalog.length(display_label) not between 2 and 120
      or target_id = any(target_ids) then
      return false;
    end if;
    target_ids := pg_catalog.array_append(target_ids, target_id);
  end loop;

  if pg_catalog.jsonb_typeof(public_payload -> 'phaseMetadata')
      is distinct from 'array'
    or pg_catalog.jsonb_array_length(public_payload -> 'phaseMetadata') <> 3 then
    return false;
  end if;

  for phase_entry in
    select entry.value
    from pg_catalog.jsonb_array_elements(
      public_payload -> 'phaseMetadata'
    ) as entry(value)
  loop
    phase_index := phase_index + 1;
    if pg_catalog.jsonb_typeof(phase_entry) is distinct from 'object'
      or not private.jsonb_has_exact_keys_v1(
        phase_entry,
        array[
          'phaseId',
          'methodPhase',
          'activeMinutes',
          'targetIds'
        ]::text[]
      )
      or pg_catalog.jsonb_typeof(phase_entry -> 'phaseId')
        is distinct from 'string'
      or phase_entry ->> 'phaseId'
        is distinct from expected_phase_ids[phase_index]
      or pg_catalog.jsonb_typeof(phase_entry -> 'methodPhase')
        is distinct from 'string'
      or phase_entry ->> 'methodPhase'
        is distinct from expected_phase_names[phase_index]
      or pg_catalog.jsonb_typeof(phase_entry -> 'activeMinutes')
        is distinct from 'number'
      or phase_entry ->> 'activeMinutes' !~ '^(?:[1-9]|1[0-9]|20)$'
      or pg_catalog.jsonb_typeof(phase_entry -> 'targetIds')
        is distinct from 'array'
      or pg_catalog.jsonb_array_length(phase_entry -> 'targetIds')
        is distinct from pg_catalog.array_length(target_ids, 1) then
      return false;
    end if;

    phase_target_index := 0;
    for phase_target_entry in
      select entry.value
      from pg_catalog.jsonb_array_elements(
        phase_entry -> 'targetIds'
      ) as entry(value)
    loop
      phase_target_index := phase_target_index + 1;
      if pg_catalog.jsonb_typeof(phase_target_entry) is distinct from 'string'
        or phase_target_entry #>> '{}'
          is distinct from target_ids[phase_target_index] then
        return false;
      end if;
    end loop;
  end loop;

  return true;
end;
$$;

revoke all on function private.blurting_public_resource_payload_valid_v18(
  jsonb
) from public, anon, authenticated, service_role;

-- Canonical resources contain two deliberately separate JSON values. The
-- public projection is answer-free. The server payload may retain the current
-- full V18 candidate, source snapshot, criteria, and answer keys, but no role
-- can read this table directly.
--
-- Every retention window below is an elapsed-time TTL. The 192-hour and
-- 720-hour literals are intentional: PostgreSQL `days` use local-calendar
-- arithmetic for timestamptz values and can vary across daylight-saving
-- boundaries. Delivery authority therefore lasts exactly 192 elapsed hours;
-- resource/evaluation retention lasts exactly 720 elapsed hours.
create table private.blurting_resources_v18 (
  id uuid primary key default extensions.gen_random_uuid(),
  generation_key uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null,
  plan_session_id uuid not null,
  route_revision_id uuid not null,
  route_lineage_id uuid not null,
  resource_fingerprint text not null,
  schema_version smallint not null default 18,
  resource_kind text not null default 'blurting_v1',
  state text not null,
  source_type text not null,
  required_source_ids text[] not null,
  source_snapshot_id uuid not null,
  generated_at timestamptz not null,
  public_payload jsonb not null,
  server_payload jsonb not null,
  public_payload_digest bytea not null,
  server_payload_digest bytea not null,
  source_snapshot_digest bytea not null,
  resource_digest bytea not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  retired_at timestamptz,
  retire_after timestamptz,
  constraint blurting_resources_v18_generation_unique
    unique (user_id, generation_key),
  constraint blurting_resources_v18_exact_content_unique
    unique (
      user_id,
      plan_session_id,
      route_revision_id,
      resource_digest
    ),
  constraint blurting_resources_v18_delivery_scope_key
    unique (
      id,
      user_id,
      plan_id,
      plan_session_id,
      route_revision_id,
      public_payload_digest,
      resource_digest
    ),
  constraint blurting_resources_v18_plan_owner_fk foreign key (
    plan_id,
    user_id
  ) references public.plans(id, user_id) on delete cascade,
  constraint blurting_resources_v18_session_owner_fk foreign key (
    plan_session_id,
    plan_id,
    user_id
  ) references public.plan_sessions(id, plan_id, user_id) on delete cascade,
  constraint blurting_resources_v18_route_owner_fk foreign key (
    route_revision_id,
    route_lineage_id,
    plan_session_id,
    plan_id,
    user_id
  ) references public.study_routes(
    route_revision_id,
    route_lineage_id,
    plan_session_id,
    plan_id,
    user_id
  ) on delete cascade,
  constraint blurting_resources_v18_schema_check check ((
    schema_version = 18
    and resource_kind = 'blurting_v1'
    and resource_fingerprint ~ '^sr1:[0-9a-f]{16}$'
  ) is true),
  constraint blurting_resources_v18_state_check check ((
    state in ('ready', 'superseded', 'retired')
    and (
      (
        state = 'ready'
        and retired_at is null
        and retire_after is null
      )
      or (
        state in ('superseded', 'retired')
        and retired_at is not null
        and retire_after is not null
        and retire_after = retired_at + interval '720 hours'
      )
    )
  ) is true),
  constraint blurting_resources_v18_source_check check ((
    source_type in ('user_materials', 'trusted_external_source')
    and private.blurting_source_ids_valid_v1(required_source_ids)
    and server_payload #>> '{sourceAuthority,version}'
      is not distinct from 'blurting_source_authority_v1'
    and server_payload #>> '{sourceAuthority,state}'
      is not distinct from 'server_bound'
    and server_payload #>> '{sourceAuthority,sourceSnapshotId}'
      is not distinct from source_snapshot_id::text
    and server_payload #>> '{sourceAuthority,sourceType}'
      is not distinct from source_type
    and server_payload
      #>> '{sourceAuthority,sourceSnapshot,sourceSnapshotId}'
      is not distinct from source_snapshot_id::text
    and server_payload #>> '{sourceAuthority,sourceSnapshot,sourceType}'
      is not distinct from source_type
    and server_payload #> '{sourceAuthority,requiredSourceIds}'
      is not distinct from pg_catalog.to_jsonb(required_source_ids)
    and private.blurting_source_snapshot_valid_v1(
      server_payload #> '{sourceAuthority,sourceSnapshot}',
      source_type,
      required_source_ids
    )
  ) is true),
  constraint blurting_resources_v18_payload_bounds_check check ((
    pg_catalog.jsonb_typeof(public_payload) = 'object'
    and pg_catalog.octet_length(public_payload::text) between 2 and 65536
    and pg_catalog.jsonb_typeof(server_payload) = 'object'
    and pg_catalog.octet_length(server_payload::text) between 2 and 262144
    and pg_catalog.octet_length(
      (server_payload #> '{sourceAuthority,sourceSnapshot}')::text
    ) between 2 and 196608
  ) is true),
  constraint blurting_resources_v18_public_identity_check check ((
    private.blurting_public_resource_payload_valid_v18(public_payload)
    and private.jsonb_has_exact_keys_v1(
      public_payload,
      array[
        'schemaVersion',
        'boundaryStatus',
        'identity',
        'orderedTargets',
        'phaseMetadata',
        'gapCount',
        'initialRecall'
      ]::text[]
    )
    and public_payload -> 'schemaVersion' is not distinct from '18'::jsonb
    and public_payload ->> 'boundaryStatus'
      is not distinct from 'disabled_public_resource_template_only'
    and private.jsonb_has_exact_keys_v1(
      public_payload -> 'identity',
      array[
        'planId',
        'sessionId',
        'routeRevisionId',
        'resourceFingerprint',
        'resourceGeneratedAt'
      ]::text[]
    )
    and private.jsonb_has_exact_keys_v1(
      public_payload -> 'initialRecall',
      array['sourceClosedReminder', 'prompt']::text[]
    )
    and pg_catalog.jsonb_typeof(public_payload -> 'orderedTargets')
      is not distinct from 'array'
    and pg_catalog.jsonb_array_length(public_payload -> 'orderedTargets')
      between 1 and 3
    and pg_catalog.jsonb_typeof(public_payload -> 'phaseMetadata')
      is not distinct from 'array'
    and pg_catalog.jsonb_array_length(public_payload -> 'phaseMetadata') = 3
    and pg_catalog.jsonb_typeof(public_payload -> 'gapCount')
      is not distinct from 'number'
    and (public_payload ->> 'gapCount') ~ '^[1-6]$'
    and public_payload #>> '{identity,planId}'
      is not distinct from plan_id::text
    and public_payload #>> '{identity,sessionId}'
      is not distinct from plan_session_id::text
    and public_payload #>> '{identity,routeRevisionId}'
      is not distinct from route_revision_id::text
    and public_payload #>> '{identity,resourceFingerprint}'
      is not distinct from resource_fingerprint
    and public_payload #>> '{identity,resourceGeneratedAt}' is not null
    and pg_catalog.length(
      public_payload #>> '{identity,resourceGeneratedAt}'
    ) between 20 and 64
    and (
      public_payload #>> '{identity,resourceGeneratedAt}'
    )::timestamptz = generated_at
    and not private.jsonb_contains_any_key_v1(
      public_payload,
      array[
        'expectedAnswer',
        'comparisonCriterion',
        'transferSuccessCriterion',
        'referenceAnswer',
        'canonicalConcept',
        'sourceAnchors',
        'sourceSnapshot',
        'storedTargetContracts',
        'serverContext',
        'learnerAnswer',
        'recallDraft',
        'correctionDraft',
        'transferDraft'
      ]::text[]
    )
  ) is true),
  constraint blurting_resources_v18_server_identity_check check ((
    private.jsonb_has_exact_keys_v1(
      server_payload,
      array[
        'serverContractVersion',
        'boundaryStatus',
        'issuanceState',
        'canonicalDigests',
        'sourceAuthority',
        'orderedPublicTargets',
        'orderedEvaluationReferences',
        'session'
      ]::text[]
    )
    and private.jsonb_has_exact_keys_v1(
      server_payload -> 'canonicalDigests',
      array[
        'publicPayloadDigest',
        'serverPayloadDigest',
        'sourceSnapshotDigest',
        'resourceDigest'
      ]::text[]
    )
    and private.jsonb_has_exact_keys_v1(
      server_payload -> 'sourceAuthority',
      array[
        'version',
        'state',
        'sourceSnapshotId',
        'sourceType',
        'requiredSourceIds',
        'sourceSnapshot'
      ]::text[]
    )
    and private.jsonb_has_exact_keys_v1(
      server_payload -> 'session',
      array[
        'schemaVersion',
        'boundaryStatus',
        'sourceReadiness',
        'model',
        'generatedAt',
        'routeIdentity',
        'deliveryIdentity',
        'orderedTargets',
        'phaseEnvelopes',
        'completionContract'
      ]::text[]
    )
    and server_payload ->> 'serverContractVersion'
      is not distinct from 'blurting_server_resource_v18'
    and server_payload ->> 'boundaryStatus'
      is not distinct from 'disabled_server_private_resource_only'
    and server_payload ->> 'issuanceState' is not distinct from 'disabled'
    and server_payload #>> '{session,schemaVersion}'
      is not distinct from '18'
    and server_payload #>> '{session,routeIdentity,planId}'
      is not distinct from plan_id::text
    and server_payload #>> '{session,routeIdentity,sessionId}'
      is not distinct from plan_session_id::text
    and server_payload #>> '{session,routeIdentity,routeRevisionId}'
      is not distinct from route_revision_id::text
    and server_payload
      #>> '{session,deliveryIdentity,visibleSupportingTechniqueId}'
      is not distinct from 'blurting_v1'
    and server_payload #>> '{session,generatedAt}'
      is not distinct from public_payload
        #>> '{identity,resourceGeneratedAt}'
    and server_payload -> 'orderedPublicTargets'
      is not distinct from public_payload -> 'orderedTargets'
    and pg_catalog.jsonb_typeof(
      server_payload -> 'orderedEvaluationReferences'
    ) is not distinct from 'array'
    and pg_catalog.jsonb_array_length(
      server_payload -> 'orderedEvaluationReferences'
    ) = pg_catalog.jsonb_array_length(public_payload -> 'orderedTargets')
  ) is true),
  constraint blurting_resources_v18_digest_length_check check ((
    pg_catalog.octet_length(public_payload_digest) = 32
    and pg_catalog.octet_length(server_payload_digest) = 32
    and pg_catalog.octet_length(source_snapshot_digest) = 32
    and pg_catalog.octet_length(resource_digest) = 32
  ) is true),
  -- canonicalDigests is a redundant private-envelope copy, never the source
  -- of truth. These predicates recompute public_payload and the server-only
  -- payload (with that redundant object removed), plus the exact embedded
  -- snapshot and route/resource claim. A future writer and row reader must do
  -- the same comparison; this migration provides neither operation.
  constraint blurting_resources_v18_digest_check check ((
    public_payload_digest
      = private.blurting_public_payload_digest_v18(public_payload)
    and server_payload_digest
      = private.blurting_server_payload_digest_v18(
        server_payload - 'canonicalDigests'
      )
    and source_snapshot_digest = private.blurting_source_snapshot_digest_v1(
      server_payload #> '{sourceAuthority,sourceSnapshot}'
    )
    and server_payload #>> '{canonicalDigests,publicPayloadDigest}'
      is not distinct from pg_catalog.encode(public_payload_digest, 'hex')
    and server_payload #>> '{canonicalDigests,serverPayloadDigest}'
      is not distinct from pg_catalog.encode(server_payload_digest, 'hex')
    and server_payload #>> '{canonicalDigests,sourceSnapshotDigest}'
      is not distinct from pg_catalog.encode(source_snapshot_digest, 'hex')
    and resource_digest = private.blurting_resource_digest_v18(
      pg_catalog.jsonb_build_object(
        'userId', user_id::text,
        'routeIdentity', pg_catalog.jsonb_build_object(
          'planId', plan_id::text,
          'sessionId', plan_session_id::text,
          'routeRevisionId', route_revision_id::text
        ),
        'resourceFingerprint', resource_fingerprint,
        'resourceGeneratedAt',
          public_payload #>> '{identity,resourceGeneratedAt}',
        'publicPayloadDigest', pg_catalog.encode(public_payload_digest, 'hex'),
        'serverPayloadDigest', pg_catalog.encode(server_payload_digest, 'hex'),
        'sourceSnapshotDigest', pg_catalog.encode(source_snapshot_digest, 'hex')
      )
    )
    and server_payload #>> '{canonicalDigests,resourceDigest}'
      is not distinct from pg_catalog.encode(resource_digest, 'hex')
  ) is true)
);

-- A route revision UUID alone is unique, but source authority also has to be
-- the exact committed route requirement at the moment a future owner-only
-- writer stores a row. The trigger is a guard, not a write path. Its SHARE
-- locks explicitly follow the app's session-then-route order and prevent the
-- pointer or lifecycle changing before the row insert. The trigger itself
-- first takes the established account advisory lock, which is reentrant. A
-- future writer that also needs a plan row lock must take the same account
-- lock, then the plan lock, before inserting; the trigger then safely repeats
-- the account lock before session followed by route.
create or replace function private.guard_blurting_resource_route_source_v18()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  committed_route_revision_id uuid;
  route_lifecycle text;
  route_technique_id text;
  route_source_type text;
  route_required_source_ids jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(new.user_id::text)
  );

  select session.committed_route_revision_id
  into committed_route_revision_id
  from public.plan_sessions as session
  where session.id = new.plan_session_id
    and session.plan_id = new.plan_id
    and session.user_id = new.user_id
  for share;

  if not found
    or committed_route_revision_id is distinct from new.route_revision_id then
    raise exception using
      errcode = '23514',
      message = 'blurting_resource_route_source_mismatch';
  end if;

  select
    route.lifecycle,
    route.route_payload
      #>> '{approach,visibleSupportingTechniqueId}',
    route.route_payload
      #>> '{target,sourceRequirements,sourceType}',
    route.route_payload
      #> '{target,sourceRequirements,requiredSourceIds}'
  into
    route_lifecycle,
    route_technique_id,
    route_source_type,
    route_required_source_ids
  from public.study_routes as route
  where route.route_revision_id = new.route_revision_id
    and route.route_lineage_id = new.route_lineage_id
    and route.plan_session_id = new.plan_session_id
    and route.plan_id = new.plan_id
    and route.user_id = new.user_id
  for share;

  if not found
    or route_lifecycle is distinct from 'committed'
    or route_technique_id is distinct from 'blurting_v1'
    or route_source_type is distinct from new.source_type
    or route_required_source_ids is distinct from
      pg_catalog.to_jsonb(new.required_source_ids) then
    raise exception using
      errcode = '23514',
      message = 'blurting_resource_route_source_mismatch';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_blurting_resource_route_source_v18()
from public, anon, authenticated, service_role;

create trigger blurting_resources_v18_guard_route_source
before insert or update of
  user_id,
  plan_id,
  plan_session_id,
  route_revision_id,
  route_lineage_id,
  source_type,
  required_source_ids
on private.blurting_resources_v18
for each row execute function
  private.guard_blurting_resource_route_source_v18();

-- Canonical resource content and identity are append-only. A later lifecycle
-- function may retire a row, but it cannot rewrite a resource in place and
-- thereby evade the committed-route/source lock that guarded insertion. Any
-- future lifecycle writer must take the account advisory lock before issuing
-- UPDATE; this row trigger then repeats that lock reentrantly.
create or replace function private.guard_blurting_resource_immutability_v18()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(new.user_id::text)
  );

  if new.id is distinct from old.id
    or new.generation_key is distinct from old.generation_key
    or new.user_id is distinct from old.user_id
    or new.plan_id is distinct from old.plan_id
    or new.plan_session_id is distinct from old.plan_session_id
    or new.route_revision_id is distinct from old.route_revision_id
    or new.route_lineage_id is distinct from old.route_lineage_id
    or new.resource_fingerprint is distinct from old.resource_fingerprint
    or new.schema_version is distinct from old.schema_version
    or new.resource_kind is distinct from old.resource_kind
    or new.source_type is distinct from old.source_type
    or new.required_source_ids is distinct from old.required_source_ids
    or new.source_snapshot_id is distinct from old.source_snapshot_id
    or new.generated_at is distinct from old.generated_at
    or new.public_payload is distinct from old.public_payload
    or new.server_payload is distinct from old.server_payload
    or new.public_payload_digest is distinct from old.public_payload_digest
    or new.server_payload_digest is distinct from old.server_payload_digest
    or new.source_snapshot_digest is distinct from old.source_snapshot_digest
    or new.resource_digest is distinct from old.resource_digest
    or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'blurting_resource_content_immutable';
  end if;

  if new.state is not distinct from old.state
    and new.retired_at is not distinct from old.retired_at
    and new.retire_after is not distinct from old.retire_after then
    return new;
  end if;

  if old.state = 'ready'
    and new.state in ('superseded', 'retired') then
    return new;
  end if;

  if old.state = 'superseded'
    and new.state = 'retired'
    and new.retired_at is not distinct from old.retired_at
    and new.retire_after is not distinct from old.retire_after then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'blurting_resource_lifecycle_transition_invalid';
end;
$$;

revoke all on function private.guard_blurting_resource_immutability_v18()
from public, anon, authenticated, service_role;

create trigger blurting_resources_v18_guard_immutability
before update on private.blurting_resources_v18
for each row execute function
  private.guard_blurting_resource_immutability_v18();

create unique index blurting_resources_v18_one_ready_route_idx
on private.blurting_resources_v18(user_id, plan_session_id, route_revision_id)
where state = 'ready';

create index blurting_resources_v18_cleanup_idx
on private.blurting_resources_v18(state, retire_after, id)
where state in ('superseded', 'retired');

create index blurting_resources_v18_user_session_idx
on private.blurting_resources_v18(
  user_id,
  plan_session_id,
  route_revision_id,
  generated_at desc
);

alter table private.blurting_resources_v18 enable row level security;
revoke all on table private.blurting_resources_v18
from public, anon, authenticated, service_role;

-- A delivery receipt is an opaque, non-bearer handle. Its private row binds
-- the authenticated owner, exact resource, run, and activity. Disclosure
-- authority is an exact, monotonic prefix: a compare-stage row cannot disclose
-- repair or transfer material, and a later-stage row cannot be replayed through
-- an earlier projector. The snake_case timestamp columns map exactly to the
-- server-only camelCase context fields `recallDisclosedAt` through
-- `completeDisclosedAt`. No function in this migration can create, advance, or
-- return a receipt.
create table private.blurting_delivery_receipts_v18 (
  id uuid primary key,
  resource_id uuid not null,
  user_id uuid not null,
  plan_id uuid not null,
  plan_session_id uuid not null,
  route_revision_id uuid not null,
  resource_public_digest bytea not null,
  resource_digest bytea not null,
  run_id uuid not null,
  activity_index smallint not null,
  state text not null,
  disclosure_stage text not null,
  receipt_digest bytea not null,
  issued_at timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at timestamptz not null,
  recall_disclosed_at timestamptz not null,
  compare_disclosed_at timestamptz,
  repair_disclosed_at timestamptz,
  transfer_disclosed_at timestamptz,
  complete_disclosed_at timestamptz,
  closed_at timestamptz,
  constraint blurting_delivery_receipts_v18_run_unique unique (
    user_id,
    plan_session_id,
    route_revision_id,
    run_id,
    activity_index
  ),
  constraint blurting_delivery_receipts_v18_evaluation_scope_key
    unique (
      id,
      resource_id,
      user_id,
      plan_id,
      plan_session_id,
      route_revision_id,
      run_id,
      activity_index
    ),
  constraint blurting_delivery_receipts_v18_resource_fk foreign key (
    resource_id,
    user_id,
    plan_id,
    plan_session_id,
    route_revision_id,
    resource_public_digest,
    resource_digest
  ) references private.blurting_resources_v18(
    id,
    user_id,
    plan_id,
    plan_session_id,
    route_revision_id,
    public_payload_digest,
    resource_digest
  ) on delete cascade,
  constraint blurting_delivery_receipts_v18_activity_check check ((
    activity_index between 0 and 23
  ) is true),
  constraint blurting_delivery_receipts_v18_digest_check check ((
    pg_catalog.octet_length(resource_public_digest) = 32
    and pg_catalog.octet_length(resource_digest) = 32
    and pg_catalog.octet_length(receipt_digest) = 32
    and receipt_digest = private.blurting_delivery_receipt_digest_v18(
      pg_catalog.jsonb_build_object(
        'receiptId', id::text,
        'resourceId', resource_id::text,
        'userId', user_id::text,
        'planId', plan_id::text,
        'planSessionId', plan_session_id::text,
        'routeRevisionId', route_revision_id::text,
        'runId', run_id::text,
        'activityIndex', activity_index,
        'publicPayloadDigest', pg_catalog.encode(
          resource_public_digest,
          'hex'
        ),
        'resourceDigest', pg_catalog.encode(
          resource_digest,
          'hex'
        )
      )
    )
  ) is true),
  constraint blurting_delivery_receipts_v18_ttl_check check ((
    expires_at = issued_at + interval '192 hours'
    and recall_disclosed_at >= issued_at
    and recall_disclosed_at < expires_at
    and last_seen_at >= case disclosure_stage
      when 'recall' then recall_disclosed_at
      when 'compare' then compare_disclosed_at
      when 'repair' then repair_disclosed_at
      when 'transfer' then transfer_disclosed_at
      when 'complete' then complete_disclosed_at
    end
    and last_seen_at < expires_at
    and (
      compare_disclosed_at is null
      or (
        compare_disclosed_at >= recall_disclosed_at
        and compare_disclosed_at < expires_at
      )
    )
    and (
      repair_disclosed_at is null
      or (
        compare_disclosed_at is not null
        and repair_disclosed_at >= compare_disclosed_at
        and repair_disclosed_at < expires_at
      )
    )
    and (
      transfer_disclosed_at is null
      or (
        repair_disclosed_at is not null
        and transfer_disclosed_at >= repair_disclosed_at
        and transfer_disclosed_at < expires_at
      )
    )
    and (
      complete_disclosed_at is null
      or (
        transfer_disclosed_at is not null
        and complete_disclosed_at >= transfer_disclosed_at
        and complete_disclosed_at < expires_at
      )
    )
  ) is true),
  constraint blurting_delivery_receipts_v18_stage_check check ((
    disclosure_stage in ('recall', 'compare', 'repair', 'transfer', 'complete')
    and (
      (
        disclosure_stage = 'recall'
        and compare_disclosed_at is null
        and repair_disclosed_at is null
        and transfer_disclosed_at is null
        and complete_disclosed_at is null
      )
      or (
        disclosure_stage = 'compare'
        and compare_disclosed_at is not null
        and repair_disclosed_at is null
        and transfer_disclosed_at is null
        and complete_disclosed_at is null
      )
      or (
        disclosure_stage = 'repair'
        and compare_disclosed_at is not null
        and repair_disclosed_at is not null
        and transfer_disclosed_at is null
        and complete_disclosed_at is null
      )
      or (
        disclosure_stage = 'transfer'
        and compare_disclosed_at is not null
        and repair_disclosed_at is not null
        and transfer_disclosed_at is not null
        and complete_disclosed_at is null
      )
      or (
        disclosure_stage = 'complete'
        and compare_disclosed_at is not null
        and repair_disclosed_at is not null
        and transfer_disclosed_at is not null
        and complete_disclosed_at is not null
      )
    )
  ) is true),
  constraint blurting_delivery_receipts_v18_state_check check ((
    state in ('active', 'completed', 'revoked')
    and (
      (
        state = 'active'
        and disclosure_stage in ('recall', 'compare', 'repair', 'transfer')
        and closed_at is null
      )
      or (
        state = 'completed'
        and disclosure_stage = 'complete'
        and closed_at is not distinct from complete_disclosed_at
      )
      or (
        state = 'revoked'
        and closed_at is not null
        and closed_at >= case disclosure_stage
          when 'recall' then recall_disclosed_at
          when 'compare' then compare_disclosed_at
          when 'repair' then repair_disclosed_at
          when 'transfer' then transfer_disclosed_at
          when 'complete' then complete_disclosed_at
        end
        and closed_at < expires_at
      )
    )
  ) is true)
);

-- This trigger reserves the only valid future transition contract without
-- exposing an updater. Identity and receipt digests are immutable. Disclosures
-- advance exactly one database-timed stage at a time against the current route;
-- complete additionally requires the exact terminal evaluation row. Terminal
-- state and disclosed timestamps cannot be rewritten. The account lock composes
-- with Reset only when every future writer takes it before issuing UPDATE; the
-- row trigger then repeats it reentrantly.
create or replace function private.guard_blurting_delivery_insert_v18()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  committed_route_revision_id uuid;
  route_lifecycle text;
  route_technique_id text;
  resource_state text;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(new.user_id::text)
  );

  select session.committed_route_revision_id
  into committed_route_revision_id
  from public.plan_sessions as session
  where session.id = new.plan_session_id
    and session.plan_id = new.plan_id
    and session.user_id = new.user_id
  for share;

  if not found
    or committed_route_revision_id is distinct from new.route_revision_id then
    raise exception using
      errcode = '55000',
      message = 'blurting_delivery_route_unavailable';
  end if;

  select
    route.lifecycle,
    route.route_payload #>> '{approach,visibleSupportingTechniqueId}'
  into route_lifecycle, route_technique_id
  from public.study_routes as route
  where route.route_revision_id = new.route_revision_id
    and route.plan_session_id = new.plan_session_id
    and route.plan_id = new.plan_id
    and route.user_id = new.user_id
  for share;

  if not found
    or route_lifecycle is distinct from 'committed'
    or route_technique_id is distinct from 'blurting_v1' then
    raise exception using
      errcode = '55000',
      message = 'blurting_delivery_route_unavailable';
  end if;

  select resource.state
  into resource_state
  from private.blurting_resources_v18 as resource
  where resource.id = new.resource_id
    and resource.user_id = new.user_id
    and resource.plan_id = new.plan_id
    and resource.plan_session_id = new.plan_session_id
    and resource.route_revision_id = new.route_revision_id
    and resource.public_payload_digest = new.resource_public_digest
    and resource.resource_digest = new.resource_digest
  for share;

  if not found or resource_state is distinct from 'ready' then
    raise exception using
      errcode = '55000',
      message = 'blurting_delivery_resource_unavailable';
  end if;

  if new.issued_at is distinct from pg_catalog.statement_timestamp()
    or new.recall_disclosed_at is distinct from new.issued_at
    or new.state is distinct from 'active'
    or new.disclosure_stage is distinct from 'recall'
    or new.compare_disclosed_at is not null
    or new.repair_disclosed_at is not null
    or new.transfer_disclosed_at is not null
    or new.complete_disclosed_at is not null
    or new.closed_at is not null
    or new.last_seen_at is distinct from new.recall_disclosed_at then
    raise exception using
      errcode = '55000',
      message = 'blurting_delivery_initial_stage_invalid';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_blurting_delivery_insert_v18()
from public, anon, authenticated, service_role;

create trigger blurting_delivery_receipts_v18_guard_insert
before insert on private.blurting_delivery_receipts_v18
for each row execute function
  private.guard_blurting_delivery_insert_v18();

create or replace function private.guard_blurting_delivery_transition_v18()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  old_stage_index smallint;
  new_stage_index smallint;
  committed_route_revision_id uuid;
  route_lifecycle text;
  route_technique_id text;
  resource_state text;
  evaluation_state text;
  evaluation_completed_at timestamptz;
  evaluation_expires_at timestamptz;
  statement_at timestamptz;
  checked_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(old.user_id::text)
  );

  statement_at := pg_catalog.statement_timestamp();

  if new.id is distinct from old.id
    or new.resource_id is distinct from old.resource_id
    or new.user_id is distinct from old.user_id
    or new.plan_id is distinct from old.plan_id
    or new.plan_session_id is distinct from old.plan_session_id
    or new.route_revision_id is distinct from old.route_revision_id
    or new.resource_public_digest is distinct from old.resource_public_digest
    or new.resource_digest is distinct from old.resource_digest
    or new.run_id is distinct from old.run_id
    or new.activity_index is distinct from old.activity_index
    or new.receipt_digest is distinct from old.receipt_digest
    or new.issued_at is distinct from old.issued_at
    or new.expires_at is distinct from old.expires_at then
    raise exception using
      errcode = '55000',
      message = 'blurting_delivery_identity_immutable';
  end if;

  if new.recall_disclosed_at is distinct from old.recall_disclosed_at
    or (
      old.compare_disclosed_at is not null
      and new.compare_disclosed_at is distinct from old.compare_disclosed_at
    )
    or (
      old.repair_disclosed_at is not null
      and new.repair_disclosed_at is distinct from old.repair_disclosed_at
    )
    or (
      old.transfer_disclosed_at is not null
      and new.transfer_disclosed_at is distinct from old.transfer_disclosed_at
    )
    or (
      old.complete_disclosed_at is not null
      and new.complete_disclosed_at is distinct from old.complete_disclosed_at
    ) then
    raise exception using
      errcode = '55000',
      message = 'blurting_delivery_disclosure_timestamp_immutable';
  end if;

  old_stage_index := case old.disclosure_stage
    when 'recall' then 1
    when 'compare' then 2
    when 'repair' then 3
    when 'transfer' then 4
    when 'complete' then 5
  end;
  new_stage_index := case new.disclosure_stage
    when 'recall' then 1
    when 'compare' then 2
    when 'repair' then 3
    when 'transfer' then 4
    when 'complete' then 5
  end;

  if old.state in ('completed', 'revoked') then
    if new.state is distinct from old.state
      or new.disclosure_stage is distinct from old.disclosure_stage
      or new.last_seen_at is distinct from old.last_seen_at
      or new.recall_disclosed_at is distinct from old.recall_disclosed_at
      or new.compare_disclosed_at is distinct from old.compare_disclosed_at
      or new.repair_disclosed_at is distinct from old.repair_disclosed_at
      or new.transfer_disclosed_at is distinct from old.transfer_disclosed_at
      or new.complete_disclosed_at is distinct from old.complete_disclosed_at
      or new.closed_at is distinct from old.closed_at then
      raise exception using
        errcode = '55000',
        message = 'blurting_delivery_terminal_state_immutable';
    end if;
    return new;
  end if;

  if new.state = 'revoked'
    and new.disclosure_stage is not distinct from old.disclosure_stage
    and new.last_seen_at is not distinct from statement_at
    and new.closed_at is not distinct from statement_at
    and pg_catalog.clock_timestamp() < old.expires_at then
    return new;
  end if;

  select session.committed_route_revision_id
  into committed_route_revision_id
  from public.plan_sessions as session
  where session.id = old.plan_session_id
    and session.plan_id = old.plan_id
    and session.user_id = old.user_id
  for share;

  if not found
    or committed_route_revision_id is distinct from old.route_revision_id then
    raise exception using
      errcode = '55000',
      message = 'blurting_delivery_route_unavailable';
  end if;

  select
    route.lifecycle,
    route.route_payload #>> '{approach,visibleSupportingTechniqueId}'
  into route_lifecycle, route_technique_id
  from public.study_routes as route
  where route.route_revision_id = old.route_revision_id
    and route.plan_session_id = old.plan_session_id
    and route.plan_id = old.plan_id
    and route.user_id = old.user_id
  for share;

  if not found
    or route_lifecycle is distinct from 'committed'
    or route_technique_id is distinct from 'blurting_v1' then
    raise exception using
      errcode = '55000',
      message = 'blurting_delivery_route_unavailable';
  end if;

  select resource.state
  into resource_state
  from private.blurting_resources_v18 as resource
  where resource.id = old.resource_id
    and resource.user_id = old.user_id
    and resource.plan_id = old.plan_id
    and resource.plan_session_id = old.plan_session_id
    and resource.route_revision_id = old.route_revision_id
    and resource.public_payload_digest = old.resource_public_digest
    and resource.resource_digest = old.resource_digest
  for share;

  checked_at := pg_catalog.clock_timestamp();

  if not found
    or resource_state is distinct from 'ready'
    or checked_at < statement_at
    or checked_at >= old.expires_at then
    raise exception using
      errcode = '55000',
      message = 'blurting_delivery_resource_unavailable';
  end if;

  if new.state = 'active'
    and new.disclosure_stage is not distinct from old.disclosure_stage
    and new.last_seen_at is not distinct from statement_at
    and new.closed_at is null then
    return new;
  end if;

  if new_stage_index = old_stage_index + 1
    and new.last_seen_at is not distinct from statement_at
    and (
      (
        new.disclosure_stage = 'compare'
        and new.state = 'active'
        and new.compare_disclosed_at is not distinct from statement_at
        and new.closed_at is null
      )
      or (
        new.disclosure_stage = 'repair'
        and new.state = 'active'
        and new.repair_disclosed_at is not distinct from statement_at
        and new.closed_at is null
      )
      or (
        new.disclosure_stage = 'transfer'
        and new.state = 'active'
        and new.transfer_disclosed_at is not distinct from statement_at
        and new.closed_at is null
      )
    ) then
    return new;
  end if;

  if old.disclosure_stage = 'transfer'
    and new.disclosure_stage = 'complete'
    and new_stage_index = old_stage_index + 1
    and new.state = 'completed'
    and new.last_seen_at is not distinct from statement_at
    and new.complete_disclosed_at is not distinct from statement_at
    and new.closed_at is not distinct from statement_at then
    select
      evaluation.state,
      evaluation.completed_at,
      evaluation.expires_at
    into
      evaluation_state,
      evaluation_completed_at,
      evaluation_expires_at
    from private.blurting_evaluation_receipts_v18 as evaluation
    where evaluation.delivery_receipt_id = old.id
      and evaluation.resource_id = old.resource_id
      and evaluation.user_id = old.user_id
      and evaluation.plan_id = old.plan_id
      and evaluation.plan_session_id = old.plan_session_id
      and evaluation.route_revision_id = old.route_revision_id
      and evaluation.run_id = old.run_id
      and evaluation.activity_index = old.activity_index
    for share;

    -- The evaluation row lock may have blocked past either expiry. Refresh the
    -- wall clock after that lock instead of relying on the pre-lock snapshot.
    checked_at := pg_catalog.clock_timestamp();

    if found
      and evaluation_state in ('succeeded', 'unavailable')
      and evaluation_completed_at is not null
      and evaluation_completed_at >= old.transfer_disclosed_at
      and evaluation_completed_at <= statement_at
      and evaluation_completed_at < old.expires_at
      and evaluation_completed_at < evaluation_expires_at
      and checked_at < old.expires_at
      and checked_at < evaluation_expires_at then
      return new;
    end if;

    raise exception using
      errcode = '55000',
      message = 'blurting_delivery_evaluation_unavailable';
  end if;

  raise exception using
    errcode = '55000',
    message = 'blurting_delivery_transition_invalid';
end;
$$;

revoke all on function private.guard_blurting_delivery_transition_v18()
from public, anon, authenticated, service_role;

create trigger blurting_delivery_receipts_v18_guard_transition
before update on private.blurting_delivery_receipts_v18
for each row execute function
  private.guard_blurting_delivery_transition_v18();

create index blurting_delivery_receipts_v18_cleanup_idx
on private.blurting_delivery_receipts_v18(expires_at, id);

create index blurting_delivery_receipts_v18_user_run_idx
on private.blurting_delivery_receipts_v18(
  user_id,
  plan_session_id,
  run_id,
  activity_index
);

alter table private.blurting_delivery_receipts_v18 enable row level security;
revoke all on table private.blurting_delivery_receipts_v18
from public, anon, authenticated, service_role;

-- Evaluation receipts contain only privacy-bounded keyed answer tags and ordered
-- results. They never contain learner text, source text, criteria, or answer
-- keys. `answer_hmac` must be HMAC-SHA-256 under a server-only key over the
-- domain `yova.blurting.answer_hmac.v18|`, exact owner/receipt/route/run/request
-- identity, and the transient learner answer. A plain or unsalted answer hash
-- is never acceptable because short answers are enumerable. The fixed
-- 720-hour bound supports retry/audit after the fixed 192-hour delivery TTL.
create table private.blurting_evaluation_receipts_v18 (
  id uuid primary key,
  delivery_receipt_id uuid not null,
  resource_id uuid not null,
  user_id uuid not null,
  plan_id uuid not null,
  plan_session_id uuid not null,
  route_revision_id uuid not null,
  run_id uuid not null,
  activity_index smallint not null,
  request_token uuid not null,
  answer_hmac bytea not null,
  evaluator_version text not null,
  state text not null,
  result_vector jsonb,
  request_digest bytea not null,
  result_digest bytea,
  issued_at timestamptz not null,
  leased_until timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null,
  -- One delivery/run has one canonical outcome. A retry with another token
  -- conflicts instead of minting a second result vector, while replaying one
  -- token under another learner is independently impossible.
  constraint blurting_evaluation_receipts_v18_delivery_unique
    unique (delivery_receipt_id),
  constraint blurting_evaluation_receipts_v18_user_request_unique
    unique (user_id, request_token),
  constraint blurting_evaluation_receipts_v18_delivery_fk foreign key (
    delivery_receipt_id,
    resource_id,
    user_id,
    plan_id,
    plan_session_id,
    route_revision_id,
    run_id,
    activity_index
  ) references private.blurting_delivery_receipts_v18(
    id,
    resource_id,
    user_id,
    plan_id,
    plan_session_id,
    route_revision_id,
    run_id,
    activity_index
  ) on delete cascade,
  constraint blurting_evaluation_receipts_v18_contract_check check ((
    activity_index between 0 and 23
    and evaluator_version = 'blurting_target_evaluator_v1'
    and pg_catalog.octet_length(answer_hmac) = 32
    and pg_catalog.octet_length(request_digest) = 32
    and (
      result_digest is null
      or pg_catalog.octet_length(result_digest) = 32
    )
    and expires_at = issued_at + interval '720 hours'
  ) is true),
  constraint blurting_evaluation_receipts_v18_digest_check check ((
    request_digest = private.blurting_evaluation_request_digest_v18(
      pg_catalog.jsonb_build_object(
        'evaluationReceiptId', id::text,
        'deliveryReceiptId', delivery_receipt_id::text,
        'resourceId', resource_id::text,
        'userId', user_id::text,
        'routeIdentity', pg_catalog.jsonb_build_object(
          'planId', plan_id::text,
          'sessionId', plan_session_id::text,
          'routeRevisionId', route_revision_id::text
        ),
        'runId', run_id::text,
        'activityIndex', activity_index,
        'requestToken', request_token::text,
        'answerHmac', pg_catalog.encode(answer_hmac, 'hex'),
        'evaluatorVersion', evaluator_version
      )
    )
    and (
      (
        state in ('pending', 'failed')
        and result_digest is null
      )
      or (
        state in ('succeeded', 'unavailable')
        and result_digest = private.blurting_evaluation_result_digest_v18(
          pg_catalog.jsonb_build_object(
            'evaluationReceiptId', id::text,
            'requestDigest', pg_catalog.encode(request_digest, 'hex'),
            'resolution', case state
              when 'succeeded' then 'evaluated'
              else 'evaluator_unavailable'
            end,
            'orderedResults', result_vector
          )
        )
      )
    )
  ) is true),
  constraint blurting_evaluation_receipts_v18_result_bounds_check check ((
    result_vector is null
    or (
      private.blurting_result_vector_valid_v18(result_vector) is true
      and pg_catalog.octet_length(result_vector::text) between 2 and 2048
    )
  ) is true),
  constraint blurting_evaluation_receipts_v18_state_check check ((
    state in ('pending', 'succeeded', 'unavailable', 'failed')
    and (
      (
        state = 'pending'
        and result_vector is null
        and result_digest is null
        and completed_at is null
        and leased_until is not null
        and leased_until > issued_at
        and leased_until <= issued_at + interval '5 minutes'
      )
      or (
        state = 'succeeded'
        and private.blurting_result_vector_valid_v18(result_vector) is true
        and result_digest is not null
        and completed_at >= issued_at
        and completed_at < expires_at
        and leased_until is null
      )
      or (
        state = 'unavailable'
        and private.blurting_result_vector_all_unverified_v18(result_vector)
          is true
        and result_digest is not null
        and completed_at >= issued_at
        and completed_at < expires_at
        and leased_until is null
      )
      or (
        state = 'failed'
        and result_vector is null
        and result_digest is null
        and completed_at >= issued_at
        and completed_at < expires_at
        and leased_until is null
      )
    )
  ) is true)
);

-- Evaluation authority starts only from an exact live transfer disclosure.
-- There is no writer in this migration; any future security-definer writer
-- must take the same account lock before entering this trigger. The explicit
-- session-then-route-then-resource-then-delivery SHARE locks compose with
-- Reset's parent-first order.
create or replace function private.guard_blurting_evaluation_insert_v18()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  committed_route_revision_id uuid;
  route_lifecycle text;
  route_technique_id text;
  resource_state text;
  delivery_state text;
  delivery_stage text;
  delivery_issued_at timestamptz;
  delivery_expires_at timestamptz;
  transfer_disclosed_at timestamptz;
  checked_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(new.user_id::text)
  );

  select session.committed_route_revision_id
  into committed_route_revision_id
  from public.plan_sessions as session
  where session.id = new.plan_session_id
    and session.plan_id = new.plan_id
    and session.user_id = new.user_id
  for share;

  if not found
    or committed_route_revision_id is distinct from new.route_revision_id then
    raise exception using
      errcode = '55000',
      message = 'blurting_evaluation_route_unavailable';
  end if;

  select
    route.lifecycle,
    route.route_payload #>> '{approach,visibleSupportingTechniqueId}'
  into route_lifecycle, route_technique_id
  from public.study_routes as route
  where route.route_revision_id = new.route_revision_id
    and route.plan_session_id = new.plan_session_id
    and route.plan_id = new.plan_id
    and route.user_id = new.user_id
  for share;

  if not found
    or route_lifecycle is distinct from 'committed'
    or route_technique_id is distinct from 'blurting_v1' then
    raise exception using
      errcode = '55000',
      message = 'blurting_evaluation_route_unavailable';
  end if;

  select resource.state
  into resource_state
  from private.blurting_resources_v18 as resource
  where resource.id = new.resource_id
    and resource.user_id = new.user_id
    and resource.plan_id = new.plan_id
    and resource.plan_session_id = new.plan_session_id
    and resource.route_revision_id = new.route_revision_id
  for share;

  if not found or resource_state is distinct from 'ready' then
    raise exception using
      errcode = '55000',
      message = 'blurting_evaluation_resource_unavailable';
  end if;

  select
    delivery.state,
    delivery.disclosure_stage,
    delivery.issued_at,
    delivery.expires_at,
    delivery.transfer_disclosed_at
  into
    delivery_state,
    delivery_stage,
    delivery_issued_at,
    delivery_expires_at,
    transfer_disclosed_at
  from private.blurting_delivery_receipts_v18 as delivery
  where delivery.id = new.delivery_receipt_id
    and delivery.resource_id = new.resource_id
    and delivery.user_id = new.user_id
    and delivery.plan_id = new.plan_id
    and delivery.plan_session_id = new.plan_session_id
    and delivery.route_revision_id = new.route_revision_id
    and delivery.run_id = new.run_id
    and delivery.activity_index = new.activity_index
  for share;

  checked_at := pg_catalog.clock_timestamp();

  if not found
    or delivery_state is distinct from 'active'
    or delivery_stage is distinct from 'transfer'
    or transfer_disclosed_at is null
    or checked_at < transfer_disclosed_at
    or checked_at < delivery_issued_at
    or checked_at >= delivery_expires_at
    or new.issued_at is distinct from pg_catalog.statement_timestamp()
    or new.issued_at < transfer_disclosed_at
    or new.issued_at < delivery_issued_at
    or new.issued_at >= delivery_expires_at then
    raise exception using
      errcode = '55000',
      message = 'blurting_evaluation_delivery_unavailable';
  end if;

  if new.state is distinct from 'pending'
    or new.result_vector is not null
    or new.result_digest is not null
    or new.completed_at is not null
    or new.leased_until is null then
    raise exception using
      errcode = '55000',
      message = 'blurting_evaluation_initial_state_invalid';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_blurting_evaluation_insert_v18()
from public, anon, authenticated, service_role;

create trigger blurting_evaluation_receipts_v18_guard_insert
before insert on private.blurting_evaluation_receipts_v18
for each row execute function
  private.guard_blurting_evaluation_insert_v18();

-- Result receipts resolve once. A future updater must acquire the account
-- advisory lock before issuing UPDATE (the trigger then repeats it reentrantly)
-- so row-lock acquisition follows the same account-first order as Reset.
create or replace function private.guard_blurting_evaluation_transition_v18()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  committed_route_revision_id uuid;
  route_lifecycle text;
  route_technique_id text;
  resource_state text;
  resource_public_payload jsonb;
  delivery_state text;
  delivery_stage text;
  delivery_expires_at timestamptz;
  transfer_disclosed_at timestamptz;
  checked_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(old.user_id::text)
  );

  if new.id is distinct from old.id
    or new.delivery_receipt_id is distinct from old.delivery_receipt_id
    or new.resource_id is distinct from old.resource_id
    or new.user_id is distinct from old.user_id
    or new.plan_id is distinct from old.plan_id
    or new.plan_session_id is distinct from old.plan_session_id
    or new.route_revision_id is distinct from old.route_revision_id
    or new.run_id is distinct from old.run_id
    or new.activity_index is distinct from old.activity_index
    or new.request_token is distinct from old.request_token
    or new.answer_hmac is distinct from old.answer_hmac
    or new.evaluator_version is distinct from old.evaluator_version
    or new.request_digest is distinct from old.request_digest
    or new.issued_at is distinct from old.issued_at
    or new.expires_at is distinct from old.expires_at then
    raise exception using
      errcode = '55000',
      message = 'blurting_evaluation_identity_immutable';
  end if;

  if old.state = 'pending' then
    select session.committed_route_revision_id
    into committed_route_revision_id
    from public.plan_sessions as session
    where session.id = old.plan_session_id
      and session.plan_id = old.plan_id
      and session.user_id = old.user_id
    for share;

    if not found
      or committed_route_revision_id is distinct from old.route_revision_id then
      raise exception using
        errcode = '55000',
        message = 'blurting_evaluation_route_unavailable';
    end if;

    select
      route.lifecycle,
      route.route_payload #>> '{approach,visibleSupportingTechniqueId}'
    into route_lifecycle, route_technique_id
    from public.study_routes as route
    where route.route_revision_id = old.route_revision_id
      and route.plan_session_id = old.plan_session_id
      and route.plan_id = old.plan_id
      and route.user_id = old.user_id
    for share;

    if not found
      or route_lifecycle is distinct from 'committed'
      or route_technique_id is distinct from 'blurting_v1' then
      raise exception using
        errcode = '55000',
        message = 'blurting_evaluation_route_unavailable';
    end if;

    select resource.state, resource.public_payload
    into resource_state, resource_public_payload
    from private.blurting_resources_v18 as resource
    where resource.id = old.resource_id
      and resource.user_id = old.user_id
      and resource.plan_id = old.plan_id
      and resource.plan_session_id = old.plan_session_id
      and resource.route_revision_id = old.route_revision_id
    for share;

    if not found or resource_state is distinct from 'ready' then
      raise exception using
        errcode = '55000',
        message = 'blurting_evaluation_resource_unavailable';
    end if;

    select
      delivery.state,
      delivery.disclosure_stage,
      delivery.expires_at,
      delivery.transfer_disclosed_at
    into
      delivery_state,
      delivery_stage,
      delivery_expires_at,
      transfer_disclosed_at
    from private.blurting_delivery_receipts_v18 as delivery
    where delivery.id = old.delivery_receipt_id
      and delivery.resource_id = old.resource_id
      and delivery.user_id = old.user_id
      and delivery.plan_id = old.plan_id
      and delivery.plan_session_id = old.plan_session_id
      and delivery.route_revision_id = old.route_revision_id
      and delivery.run_id = old.run_id
      and delivery.activity_index = old.activity_index
    for share;

    checked_at := pg_catalog.clock_timestamp();

    if not found
      or delivery_state is distinct from 'active'
      or delivery_stage is distinct from 'transfer'
      or transfer_disclosed_at is null
      or checked_at < transfer_disclosed_at
      or checked_at >= delivery_expires_at then
      raise exception using
        errcode = '55000',
        message = 'blurting_evaluation_delivery_unavailable';
    end if;

    -- leased_until is evaluator authority, not scheduling metadata. An
    -- expired worker may neither publish a late result nor revive its lease.
    -- Because one delivery has one evaluation row, recovery requires a later
    -- fenced-writer migration (lease epoch/token or delivery revocation and a
    -- new run). Migration 006 deliberately exposes no writer for this table.
    if old.leased_until is null or checked_at >= old.leased_until then
      raise exception using
        errcode = '55000',
        message = 'blurting_evaluation_lease_expired';
    end if;
  end if;

  if old.state = 'pending' and new.state = 'pending' then
    if new.result_vector is not null
      or new.result_digest is not null
      or new.completed_at is not null
      or new.leased_until is null
      or new.leased_until < old.leased_until then
      raise exception using
        errcode = '55000',
        message = 'blurting_evaluation_pending_transition_invalid';
    end if;
    return new;
  end if;

  if old.state = 'pending'
    and new.state in ('succeeded', 'unavailable', 'failed') then
    if new.leased_until is not null
      or new.completed_at is null
      or new.completed_at < transfer_disclosed_at
      or new.completed_at < pg_catalog.statement_timestamp()
      or new.completed_at > checked_at
      or new.completed_at >= old.leased_until
      or new.completed_at >= delivery_expires_at then
      raise exception using
        errcode = '55000',
        message = 'blurting_evaluation_completion_time_invalid';
    end if;
    if new.state in ('succeeded', 'unavailable')
      and private.blurting_result_vector_matches_resource_v18(
        new.result_vector,
        resource_public_payload
      ) is not true then
      raise exception using
        errcode = '55000',
        message = 'blurting_evaluation_target_binding_mismatch';
    end if;
    return new;
  end if;

  if old.state in ('succeeded', 'unavailable', 'failed')
    and new.state is not distinct from old.state
    and new.result_vector is not distinct from old.result_vector
    and new.result_digest is not distinct from old.result_digest
    and new.leased_until is not distinct from old.leased_until
    and new.completed_at is not distinct from old.completed_at then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'blurting_evaluation_terminal_state_immutable';
end;
$$;

revoke all on function private.guard_blurting_evaluation_transition_v18()
from public, anon, authenticated, service_role;

create trigger blurting_evaluation_receipts_v18_guard_transition
before update on private.blurting_evaluation_receipts_v18
for each row execute function
  private.guard_blurting_evaluation_transition_v18();

create index blurting_evaluation_receipts_v18_cleanup_idx
on private.blurting_evaluation_receipts_v18(expires_at, id);

create index blurting_evaluation_receipts_v18_delivery_idx
on private.blurting_evaluation_receipts_v18(
  delivery_receipt_id,
  issued_at desc
);

alter table private.blurting_evaluation_receipts_v18 enable row level security;
revoke all on table private.blurting_evaluation_receipts_v18
from public, anon, authenticated, service_role;

-- Deletion-only hygiene. This is the sole service-role operation introduced by
-- the migration: it cannot create, mutate, inspect, or return resource data.
-- Lock candidates in the same parent-to-child order as future delivery and
-- evaluation work: resource, delivery, then evaluation. A parent that becomes
-- orphaned during this call is intentionally collected by the next call.
create or replace function public.cleanup_blurting_resource_store_v18(
  requested_limit integer default 500
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  deleted_evaluation_receipts integer;
  deleted_delivery_receipts integer;
  deleted_resources integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'blurting_resource_store_cleanup_service_role_required';
  end if;
  if requested_limit is null or requested_limit not between 1 and 2000 then
    raise exception using
      errcode = '22023',
      message = 'blurting_resource_store_cleanup_limit_invalid';
  end if;

  with candidates as (
    select resource.id
    from private.blurting_resources_v18 as resource
    where resource.state in ('superseded', 'retired')
      and resource.retire_after <= pg_catalog.clock_timestamp()
      and not exists (
        select 1
        from private.blurting_delivery_receipts_v18 as delivery
        where delivery.resource_id = resource.id
      )
    order by resource.retire_after, resource.id
    for update skip locked
    limit requested_limit
  ), deleted as (
    delete from private.blurting_resources_v18 as resource
    using candidates as candidate
    where resource.id = candidate.id
    returning resource.id
  )
  select pg_catalog.count(*)::integer
  into deleted_resources
  from deleted;

  with candidates as (
    select receipt.id
    from private.blurting_delivery_receipts_v18 as receipt
    where receipt.expires_at <= pg_catalog.clock_timestamp()
      and not exists (
        select 1
        from private.blurting_evaluation_receipts_v18 as evaluation
        where evaluation.delivery_receipt_id = receipt.id
      )
    order by receipt.expires_at, receipt.id
    for update skip locked
    limit requested_limit
  ), deleted as (
    delete from private.blurting_delivery_receipts_v18 as receipt
    using candidates as candidate
    where receipt.id = candidate.id
    returning receipt.id
  )
  select pg_catalog.count(*)::integer
  into deleted_delivery_receipts
  from deleted;

  with candidates as (
    select receipt.id
    from private.blurting_evaluation_receipts_v18 as receipt
    where receipt.expires_at <= pg_catalog.clock_timestamp()
    order by receipt.expires_at, receipt.id
    for update skip locked
    limit requested_limit
  ), deleted as (
    delete from private.blurting_evaluation_receipts_v18 as receipt
    using candidates as candidate
    where receipt.id = candidate.id
    returning receipt.id
  )
  select pg_catalog.count(*)::integer
  into deleted_evaluation_receipts
  from deleted;

  return pg_catalog.jsonb_build_object(
    'deletedEvaluationReceipts', deleted_evaluation_receipts,
    'deletedDeliveryReceipts', deleted_delivery_receipts,
    'deletedResources', deleted_resources
  );
end;
$$;

revoke all on function public.cleanup_blurting_resource_store_v18(integer)
from public, anon, authenticated, service_role;
grant execute on function public.cleanup_blurting_resource_store_v18(integer)
to service_role;

-- Reset removes the private resource root while holding the established
-- account advisory lock. Both receipt families disappear through FK cascade;
-- the migration-005 delegate then clears its still-empty reservation table and
-- all mature learning data in the same transaction.
alter function public.reset_yova_learning_data()
rename to reset_yova_learning_data_without_blurting_resource_store_v18;

revoke all on function public.reset_yova_learning_data_without_blurting_resource_store_v18()
from public, anon, authenticated, service_role;

create or replace function public.reset_yova_learning_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  );

  delete from private.blurting_resources_v18 as resource
  where resource.user_id = current_user_id;

  return public.reset_yova_learning_data_without_blurting_resource_store_v18();
end;
$$;

revoke all on function public.reset_yova_learning_data()
from public, anon, authenticated, service_role;
grant execute on function public.reset_yova_learning_data()
to authenticated;

comment on table private.blurting_resources_v18 is
  'Dormant server-private Blurting V18 store. The full canonical candidate and assessment material never belong in plan_sessions.step_data or a browser response.';
comment on table private.blurting_delivery_receipts_v18 is
  'Dormant opaque delivery-handle authority; no mint or read function exists in migration 006.';
comment on table private.blurting_evaluation_receipts_v18 is
  'Dormant privacy-bounded evaluation receipt store; no evaluator or result writer exists in migration 006.';
comment on column private.blurting_evaluation_receipts_v18.answer_hmac is
  'Server-keyed HMAC-SHA-256 only: yova.blurting.answer_hmac.v18 plus exact owner/receipt/route/run/request identity and transient answer. Never a plain answer digest; key and answer are not stored.';
comment on function public.cleanup_blurting_resource_store_v18(integer) is
  'Service-only deletion of expired dormant Blurting V18 receipts and retired resources; never creates, updates, reads, or returns resource content.';

-- Static contract tests cannot prove PostgreSQL lock, FK, RLS, CHECK-function,
-- or replay behavior. The ordered 001-006 chain must still execute against a
-- real PostgreSQL instance before release. Reload only the two public function
-- signatures; no private schema or table is exposed through PostgREST.
notify pgrst, 'reload schema';
