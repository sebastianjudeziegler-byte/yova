-- Pin the cross-runtime timestamp and string domains for the dormant Blurting
-- V18 private store. This migration still exposes no resource writer, reader,
-- mint, evaluator, runtime flag, or browser/service-role data path.

begin;

-- Migration 006 created an intentionally empty store. Refuse to install these
-- stricter domains beside a changed or partially exposed predecessor.
do $$
begin
  if pg_catalog.to_regclass(
      'private.blurting_resources_v18'
    ) is null
    or pg_catalog.to_regclass(
      'private.blurting_delivery_receipts_v18'
    ) is null
    or pg_catalog.to_regclass(
      'private.blurting_evaluation_receipts_v18'
    ) is null
    or pg_catalog.to_regprocedure(
      'private.blurting_public_resource_payload_valid_v18(jsonb)'
    ) is null
    or pg_catalog.to_regprocedure(
      'private.blurting_source_snapshot_valid_v1(jsonb,text,text[])'
    ) is null
    or pg_catalog.to_regprocedure(
      'private.guard_blurting_delivery_insert_v18()'
    ) is null
    or pg_catalog.to_regprocedure(
      'private.guard_blurting_delivery_transition_v18()'
    ) is null
    or pg_catalog.to_regprocedure(
      'private.guard_blurting_evaluation_insert_v18()'
    ) is null
    or pg_catalog.to_regprocedure(
      'private.guard_blurting_evaluation_transition_v18()'
    ) is null then
    raise exception using
      errcode = '55000',
      message = 'blurting_canonical_domains_v18_dependency_missing';
  end if;
end;
$$;

-- ECMA-262 TrimString removes exactly WhiteSpace plus LineTerminator code
-- points. Pin the set explicitly instead of relying on PostgreSQL btrim's
-- one-space default, a locale, or a moving Unicode character class:
-- U+0009, U+000A, U+000B, U+000C, U+000D, U+0020, U+00A0, U+1680,
-- U+2000..U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, and U+FEFF.
-- U+0085, U+180E, and U+200B are deliberately absent, matching ECMAScript.
create or replace function private.blurting_ecmascript_trim_v1(
  candidate text
)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select pg_catalog.btrim(
    candidate,
    pg_catalog.chr(9)
      || pg_catalog.chr(10)
      || pg_catalog.chr(11)
      || pg_catalog.chr(12)
      || pg_catalog.chr(13)
      || pg_catalog.chr(32)
      || pg_catalog.chr(160)
      || pg_catalog.chr(5760)
      || pg_catalog.chr(8192)
      || pg_catalog.chr(8193)
      || pg_catalog.chr(8194)
      || pg_catalog.chr(8195)
      || pg_catalog.chr(8196)
      || pg_catalog.chr(8197)
      || pg_catalog.chr(8198)
      || pg_catalog.chr(8199)
      || pg_catalog.chr(8200)
      || pg_catalog.chr(8201)
      || pg_catalog.chr(8202)
      || pg_catalog.chr(8232)
      || pg_catalog.chr(8233)
      || pg_catalog.chr(8239)
      || pg_catalog.chr(8287)
      || pg_catalog.chr(12288)
      || pg_catalog.chr(65279)
  );
$$;

create or replace function private.blurting_bounded_text_valid_v18(
  candidate text,
  minimum_code_points integer,
  maximum_code_points integer
)
returns boolean
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select minimum_code_points >= 0
    and maximum_code_points >= minimum_code_points
    and candidate = private.blurting_ecmascript_trim_v1(candidate)
    -- PostgreSQL char_length counts Unicode code points, not UTF-8 bytes or
    -- UTF-16 code units. This is the pinned V18 persistence length domain.
    and pg_catalog.char_length(candidate)
      between minimum_code_points and maximum_code_points;
$$;

create or replace function private.blurting_json_strings_canonical_v18(
  candidate jsonb
)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  candidate_type text := pg_catalog.jsonb_typeof(candidate);
  child_value jsonb;
  scalar_value text;
begin
  if candidate_type = 'string' then
    scalar_value := candidate #>> '{}';
    return scalar_value = private.blurting_ecmascript_trim_v1(scalar_value);
  end if;

  if candidate_type = 'object' then
    for child_value in
      select entry.value
      from pg_catalog.jsonb_each(candidate) as entry(key, value)
    loop
      if private.blurting_json_strings_canonical_v18(child_value)
        is not true then
        return false;
      end if;
    end loop;
  elsif candidate_type = 'array' then
    for child_value in
      select entry.value
      from pg_catalog.jsonb_array_elements(candidate) as entry(value)
    loop
      if private.blurting_json_strings_canonical_v18(child_value)
        is not true then
        return false;
      end if;
    end loop;
  end if;

  return true;
end;
$$;

create or replace function private.blurting_json_string_array_valid_v18(
  candidate jsonb,
  minimum_items integer,
  maximum_items integer,
  minimum_code_points integer,
  maximum_code_points integer
)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  item jsonb;
begin
  if pg_catalog.jsonb_typeof(candidate) is distinct from 'array' then
    return false;
  end if;
  if pg_catalog.jsonb_array_length(candidate)
    not between minimum_items and maximum_items then
    return false;
  end if;

  for item in
    select entry.value
    from pg_catalog.jsonb_array_elements(candidate) as entry(value)
  loop
    if pg_catalog.jsonb_typeof(item) is distinct from 'string'
      or private.blurting_bounded_text_valid_v18(
        item #>> '{}',
        minimum_code_points,
        maximum_code_points
      ) is not true then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function private.blurting_source_ids_canonical_v18(
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
begin
  if private.blurting_source_ids_valid_v1(source_ids) is not true then
    return false;
  end if;

  foreach source_id in array source_ids loop
    if private.blurting_bounded_text_valid_v18(source_id, 1, 200)
      is not true then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function private.blurting_source_snapshot_text_valid_v18(
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
begin
  if private.blurting_source_snapshot_valid_v1(
      source_snapshot,
      expected_source_type,
      expected_source_ids
    ) is not true
    or private.blurting_json_strings_canonical_v18(source_snapshot)
      is not true
    or private.blurting_json_string_array_valid_v18(
      source_snapshot -> 'requiredSourceIds',
      1,
      20,
      1,
      200
    ) is not true then
    return false;
  end if;

  for manifest_entry in
    select entry.value
    from pg_catalog.jsonb_array_elements(
      source_snapshot -> 'manifest'
    ) as entry(value)
  loop
    if private.blurting_bounded_text_valid_v18(
        manifest_entry ->> 'sourceId', 1, 200
      ) is not true
      or private.blurting_bounded_text_valid_v18(
        manifest_entry ->> 'sourceVersionId', 1, 200
      ) is not true
      or private.blurting_bounded_text_valid_v18(
        manifest_entry ->> 'chunkId', 1, 200
      ) is not true
      or private.blurting_bounded_text_valid_v18(
        manifest_entry ->> 'sourceLabel', 1, 180
      ) is not true
      or private.blurting_bounded_text_valid_v18(
        manifest_entry ->> 'locationLabel', 1, 120
      ) is not true
      or private.blurting_bounded_text_valid_v18(
        manifest_entry ->> 'canonicalText', 1, 7000
      ) is not true then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function private.blurting_public_payload_text_valid_v18(
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
  target_entry jsonb;
begin
  if private.blurting_public_resource_payload_valid_v18(public_payload)
      is not true
    or private.blurting_json_strings_canonical_v18(public_payload)
      is not true
    or private.blurting_bounded_text_valid_v18(
      public_payload #>> '{initialRecall,sourceClosedReminder}', 10, 200
    ) is not true
    or private.blurting_bounded_text_valid_v18(
      public_payload #>> '{initialRecall,prompt}', 3, 320
    ) is not true then
    return false;
  end if;

  for target_entry in
    select entry.value
    from pg_catalog.jsonb_array_elements(
      public_payload -> 'orderedTargets'
    ) as entry(value)
  loop
    if private.blurting_bounded_text_valid_v18(
      target_entry ->> 'displayLabel', 2, 120
    ) is not true then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

-- Validate every transformable text field inside the server-only payload.
-- Fixed literals, UUIDs, digests, and evidence IDs are already exact in 006;
-- the recursive predicate still prevents edge whitespace anywhere in them.
create or replace function private.blurting_server_payload_text_valid_v18(
  server_payload jsonb,
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
  session_payload jsonb := server_payload -> 'session';
  phase_envelopes jsonb;
  runtime_payload jsonb;
  target_entry jsonb;
  reference_entry jsonb;
  checklist_entry jsonb;
begin
  if pg_catalog.jsonb_typeof(server_payload) is distinct from 'object'
    or pg_catalog.jsonb_typeof(session_payload) is distinct from 'object'
    or pg_catalog.jsonb_typeof(server_payload -> 'orderedPublicTargets')
      is distinct from 'array'
    or pg_catalog.jsonb_typeof(
      server_payload -> 'orderedEvaluationReferences'
    ) is distinct from 'array'
    or pg_catalog.jsonb_typeof(session_payload -> 'orderedTargets')
      is distinct from 'array' then
    return false;
  end if;

  if private.blurting_json_strings_canonical_v18(server_payload)
      is not true
    or private.blurting_source_snapshot_text_valid_v18(
      server_payload #> '{sourceAuthority,sourceSnapshot}',
      expected_source_type,
      expected_source_ids
    ) is not true
    or private.blurting_json_string_array_valid_v18(
      server_payload #> '{sourceAuthority,requiredSourceIds}',
      1,
      20,
      1,
      200
    ) is not true
    or private.blurting_bounded_text_valid_v18(
      session_payload ->> 'model', 1, 160
    ) is not true
    or pg_catalog.jsonb_array_length(
      server_payload -> 'orderedPublicTargets'
    ) not between 1 and 3
    or pg_catalog.jsonb_array_length(
      server_payload -> 'orderedEvaluationReferences'
    ) not between 1 and 3
    or pg_catalog.jsonb_array_length(session_payload -> 'orderedTargets')
      not between 1 and 3 then
    return false;
  end if;

  for target_entry in
    select entry.value
    from pg_catalog.jsonb_array_elements(
      server_payload -> 'orderedPublicTargets'
    ) as entry(value)
  loop
    if private.blurting_bounded_text_valid_v18(
      target_entry ->> 'displayLabel', 2, 120
    ) is not true then
      return false;
    end if;
  end loop;

  for reference_entry in
    select entry.value
    from pg_catalog.jsonb_array_elements(
      server_payload -> 'orderedEvaluationReferences'
    ) as entry(value)
  loop
    if private.blurting_bounded_text_valid_v18(
      reference_entry ->> 'referenceAnswer', 1, 1200
    ) is not true then
      return false;
    end if;
  end loop;

  for target_entry in
    select entry.value
    from pg_catalog.jsonb_array_elements(
      session_payload -> 'orderedTargets'
    ) as entry(value)
  loop
    if private.blurting_bounded_text_valid_v18(
        target_entry ->> 'concept', 2, 120
      ) is not true
      or private.blurting_bounded_text_valid_v18(
        target_entry ->> 'comparisonCriterion', 8, 240
      ) is not true
      or private.blurting_bounded_text_valid_v18(
        target_entry ->> 'transferSuccessCriterion', 8, 240
      ) is not true then
      return false;
    end if;
  end loop;

  phase_envelopes := session_payload -> 'phaseEnvelopes';
  if pg_catalog.jsonb_typeof(phase_envelopes) is distinct from 'array' then
    return false;
  end if;
  if pg_catalog.jsonb_array_length(phase_envelopes) <> 3
    or pg_catalog.jsonb_typeof(phase_envelopes -> 0 -> 'runtime')
      is distinct from 'object' then
    return false;
  end if;
  runtime_payload := phase_envelopes -> 0 -> 'runtime';

  if pg_catalog.jsonb_typeof(runtime_payload -> 'prompts')
      is distinct from 'array'
    or pg_catalog.jsonb_typeof(runtime_payload -> 'transferPrompt')
      is distinct from 'object'
    or pg_catalog.jsonb_typeof(runtime_payload -> 'targetBindings')
      is distinct from 'array' then
    return false;
  end if;

  if private.blurting_bounded_text_valid_v18(
      runtime_payload ->> 'sourceClosedReminder', 10, 200
    ) is not true
    or pg_catalog.jsonb_array_length(runtime_payload -> 'prompts') <> 1
    or private.blurting_bounded_text_valid_v18(
      runtime_payload #>> '{prompts,0,prompt}', 3, 320
    ) is not true
    or private.blurting_bounded_text_valid_v18(
      runtime_payload #>> '{prompts,0,expectedAnswer}', 1, 600
    ) is not true
    or private.blurting_bounded_text_valid_v18(
      runtime_payload ->> 'comparisonInstructions', 10, 320
    ) is not true
    or private.blurting_bounded_text_valid_v18(
      runtime_payload ->> 'correctionInstruction', 10, 320
    ) is not true
    or private.blurting_bounded_text_valid_v18(
      runtime_payload #>> '{transferPrompt,sourceClosedReminder}', 10, 200
    ) is not true
    or private.blurting_bounded_text_valid_v18(
      runtime_payload #>> '{transferPrompt,prompt}', 3, 320
    ) is not true
    or private.blurting_bounded_text_valid_v18(
      runtime_payload #>> '{transferPrompt,expectedAnswer}', 1, 600
    ) is not true
    or private.blurting_json_string_array_valid_v18(
      runtime_payload -> 'gapChecklist', 1, 6, 3, 240
    ) is not true
    or pg_catalog.jsonb_array_length(runtime_payload -> 'targetBindings')
      not between 1 and 3 then
    return false;
  end if;

  for checklist_entry in
    select entry.value
    from pg_catalog.jsonb_array_elements(
      runtime_payload -> 'targetBindings'
    ) as entry(value)
  loop
    if private.blurting_bounded_text_valid_v18(
        checklist_entry ->> 'concept', 2, 120
      ) is not true
      or private.blurting_bounded_text_valid_v18(
        checklist_entry ->> 'comparisonCriterion', 8, 240
      ) is not true
      or private.blurting_bounded_text_valid_v18(
        checklist_entry ->> 'transferSuccessCriterion', 8, 240
      ) is not true then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

-- All persisted instants are finite UTC instants, fall in ECMAScript's
-- four-digit year envelope, and carry no precision below one millisecond.
create or replace function private.blurting_timestamp_value_valid_v18(
  candidate timestamptz
)
returns boolean
language sql
stable
strict
security definer
set search_path = ''
as $$
  select pg_catalog.isfinite(candidate)
    and extract(year from candidate at time zone 'UTC') between 1 and 9999
    and candidate = pg_catalog.date_trunc('milliseconds', candidate);
$$;

create or replace function private.blurting_timestamp_text_v18(
  candidate timestamptz
)
returns text
language sql
stable
strict
security definer
set search_path = ''
as $$
  select pg_catalog.to_char(
    candidate at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
$$;

create or replace function private.blurting_timestamp_text_matches_v18(
  candidate text,
  expected_value timestamptz
)
returns boolean
language plpgsql
stable
strict
security definer
set search_path = ''
as $$
declare
  parsed_value timestamptz;
begin
  if candidate !~ '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3}Z$'
    or pg_catalog.substr(candidate, 1, 4)::integer
      not between 1 and 9999 then
    return false;
  end if;

  begin
    parsed_value := candidate::timestamptz;
  exception
    when others then
      return false;
  end;

  return private.blurting_timestamp_value_valid_v18(parsed_value)
    and private.blurting_timestamp_value_valid_v18(expected_value)
    and parsed_value = expected_value
    and private.blurting_timestamp_text_v18(parsed_value) = candidate;
end;
$$;

-- Writers remain absent, but the existing private guards must compare future
-- values with the same database-owned precision required by the constraints.
create or replace function private.blurting_statement_timestamp_ms_v18()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.date_trunc(
    'milliseconds',
    pg_catalog.statement_timestamp()
  );
$$;

-- Abort installation if PostgreSQL cannot reproduce the pinned cross-runtime
-- edge vectors. UTF-8 PostgreSQL text cannot represent NUL or an unpaired UTF-16
-- surrogate; those failures are the database equivalent of the V18 scalar-text
-- rejection performed before JavaScript persistence.
do $$
declare
  nul_rejected boolean := false;
  surrogate_rejected boolean := false;
begin
  begin
    perform pg_catalog.chr(0);
  exception
    when others then
      nul_rejected := true;
  end;

  begin
    perform pg_catalog.chr(55296);
  exception
    when others then
      surrogate_rejected := true;
  end;

  if pg_catalog.getdatabaseencoding() is distinct from 'UTF8'
    or private.blurting_ecmascript_trim_v1(
      pg_catalog.chr(160) || pg_catalog.chr(65279)
        || 'canonical'
        || pg_catalog.chr(65279) || pg_catalog.chr(160)
    ) is distinct from 'canonical'
    or private.blurting_ecmascript_trim_v1(
      pg_catalog.chr(133) || pg_catalog.chr(6158)
        || 'canonical'
        || pg_catalog.chr(8203)
    ) is distinct from
      pg_catalog.chr(133) || pg_catalog.chr(6158)
        || 'canonical'
        || pg_catalog.chr(8203)
    or private.blurting_bounded_text_valid_v18(
      pg_catalog.chr(128512), 1, 1
    ) is not true
    or not nul_rejected
    or not surrogate_rejected
    or private.blurting_timestamp_text_matches_v18(
      '2026-08-25T08:00:00.123Z',
      '2026-08-25 08:00:00.123+00'::timestamptz
    ) is not true
    or private.blurting_timestamp_text_v18(
      '2026-08-25 08:00:00.123+00'::timestamptz
    ) is distinct from '2026-08-25T08:00:00.123Z'
    or private.blurting_timestamp_text_matches_v18(
      '2026-08-25T09:00:00.123+01:00',
      '2026-08-25 08:00:00.123+00'::timestamptz
    ) then
    raise exception using
      errcode = '55000',
      message = 'blurting_canonical_domains_v18_vector_changed';
  end if;
end;
$$;

revoke all on function private.blurting_ecmascript_trim_v1(text)
from public, anon, authenticated, service_role;
revoke all on function private.blurting_bounded_text_valid_v18(
  text, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function private.blurting_json_strings_canonical_v18(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.blurting_json_string_array_valid_v18(
  jsonb, integer, integer, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function private.blurting_source_ids_canonical_v18(text[])
from public, anon, authenticated, service_role;
revoke all on function private.blurting_source_snapshot_text_valid_v18(
  jsonb, text, text[]
) from public, anon, authenticated, service_role;
revoke all on function private.blurting_public_payload_text_valid_v18(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.blurting_server_payload_text_valid_v18(
  jsonb, text, text[]
) from public, anon, authenticated, service_role;
revoke all on function private.blurting_timestamp_value_valid_v18(timestamptz)
from public, anon, authenticated, service_role;
revoke all on function private.blurting_timestamp_text_v18(timestamptz)
from public, anon, authenticated, service_role;
revoke all on function private.blurting_timestamp_text_matches_v18(
  text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.blurting_statement_timestamp_ms_v18()
from public, anon, authenticated, service_role;

-- Hold all three roots while proving that 006 is still dormant. Any row here
-- is unexpected because no migration has installed an insert/update path.
-- Failing is safer than silently grandfathering a value from an unknown path.
lock table private.blurting_resources_v18 in share row exclusive mode;
lock table private.blurting_delivery_receipts_v18
  in share row exclusive mode;
lock table private.blurting_evaluation_receipts_v18
  in share row exclusive mode;

do $$
begin
  if exists (select 1 from private.blurting_resources_v18)
    or exists (select 1 from private.blurting_delivery_receipts_v18)
    or exists (select 1 from private.blurting_evaluation_receipts_v18) then
    raise exception using
      errcode = '55000',
      message = 'blurting_canonical_domains_v18_unexpected_existing_row';
  end if;
end;
$$;

alter table private.blurting_resources_v18
  alter column created_at
  set default private.blurting_statement_timestamp_ms_v18();

alter table private.blurting_resources_v18
  add constraint blurting_resources_v18_canonical_domains_check check ((
    private.blurting_timestamp_value_valid_v18(generated_at)
    and private.blurting_timestamp_value_valid_v18(created_at)
    and (
      retired_at is null
      or private.blurting_timestamp_value_valid_v18(retired_at)
    )
    and (
      retire_after is null
      or private.blurting_timestamp_value_valid_v18(retire_after)
    )
    and private.blurting_timestamp_text_matches_v18(
      public_payload #>> '{identity,resourceGeneratedAt}',
      generated_at
    )
    and private.blurting_timestamp_text_matches_v18(
      server_payload #>> '{session,generatedAt}',
      generated_at
    )
    and private.blurting_source_ids_canonical_v18(required_source_ids)
    and private.blurting_public_payload_text_valid_v18(public_payload)
    and private.blurting_server_payload_text_valid_v18(
      server_payload,
      source_type,
      required_source_ids
    )
  ) is true) not valid;

alter table private.blurting_delivery_receipts_v18
  add constraint blurting_delivery_receipts_v18_canonical_domains_check
  check ((
    private.blurting_timestamp_value_valid_v18(issued_at)
    and private.blurting_timestamp_value_valid_v18(last_seen_at)
    and private.blurting_timestamp_value_valid_v18(expires_at)
    and private.blurting_timestamp_value_valid_v18(recall_disclosed_at)
    and (
      compare_disclosed_at is null
      or private.blurting_timestamp_value_valid_v18(compare_disclosed_at)
    )
    and (
      repair_disclosed_at is null
      or private.blurting_timestamp_value_valid_v18(repair_disclosed_at)
    )
    and (
      transfer_disclosed_at is null
      or private.blurting_timestamp_value_valid_v18(transfer_disclosed_at)
    )
    and (
      complete_disclosed_at is null
      or private.blurting_timestamp_value_valid_v18(complete_disclosed_at)
    )
    and (
      closed_at is null
      or private.blurting_timestamp_value_valid_v18(closed_at)
    )
  ) is true) not valid;

alter table private.blurting_evaluation_receipts_v18
  add constraint blurting_evaluation_receipts_v18_canonical_domains_check
  check ((
    private.blurting_timestamp_value_valid_v18(issued_at)
    and private.blurting_timestamp_value_valid_v18(expires_at)
    and (
      leased_until is null
      or private.blurting_timestamp_value_valid_v18(leased_until)
    )
    and (
      completed_at is null
      or private.blurting_timestamp_value_valid_v18(completed_at)
    )
    and (
      result_vector is null
      or private.blurting_json_strings_canonical_v18(result_vector)
    )
  ) is true) not valid;

-- Replace only the four raw statement-time calls in 006's private guards.
-- pg_get_functiondef preserves the reviewed bodies and trigger OIDs; exact
-- occurrence counts make any upstream drift fail the ordered migration.
do $$
declare
  signature text;
  function_definition text;
  raw_call constant text := 'pg_catalog.statement_timestamp()';
  canonical_call constant text :=
    'private.blurting_statement_timestamp_ms_v18()';
  raw_call_count integer;
begin
  foreach signature in array array[
    'private.guard_blurting_delivery_insert_v18()',
    'private.guard_blurting_delivery_transition_v18()',
    'private.guard_blurting_evaluation_insert_v18()',
    'private.guard_blurting_evaluation_transition_v18()'
  ]::text[] loop
    function_definition := pg_catalog.pg_get_functiondef(
      signature::pg_catalog.regprocedure
    );
    raw_call_count := (
      pg_catalog.length(function_definition)
        - pg_catalog.length(
          pg_catalog.replace(function_definition, raw_call, '')
        )
    ) / pg_catalog.length(raw_call);

    if raw_call_count <> 1
      or function_definition like '%' || canonical_call || '%' then
      raise exception using
        errcode = '55000',
        message = 'blurting_canonical_domains_v18_guard_changed';
    end if;

    execute pg_catalog.replace(
      function_definition,
      raw_call,
      canonical_call
    );
  end loop;
end;
$$;

alter table private.blurting_resources_v18
  validate constraint blurting_resources_v18_canonical_domains_check;
alter table private.blurting_delivery_receipts_v18
  validate constraint blurting_delivery_receipts_v18_canonical_domains_check;
alter table private.blurting_evaluation_receipts_v18
  validate constraint blurting_evaluation_receipts_v18_canonical_domains_check;

comment on function private.blurting_ecmascript_trim_v1(text) is
  'Pinned ECMA-262 TrimString WhiteSpace plus LineTerminator set for dormant V18 persistence.';
comment on function private.blurting_timestamp_text_matches_v18(
  text, timestamptz
) is
  'Exact four-digit UTC V18 timestamp spelling: YYYY-MM-DDTHH:mm:ss.sssZ.';
comment on constraint blurting_resources_v18_canonical_domains_check
  on private.blurting_resources_v18 is
  'Dormant V18 resource timestamps and transformable strings use pinned cross-runtime canonical domains.';

commit;
