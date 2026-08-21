-- Keep the deployed material-attachment function identical while making its
-- empty UUID accumulator explicit. PostgreSQL accepts the original literal at
-- runtime, but plpgsql_check correctly warns that the text literal has no
-- assignment cast to uuid[]. Patch the already-deployed function definition
-- defensively and fail the migration if its expected source is not present.

do $migration$
declare
  current_definition text;
  patched_definition text;
  original_declaration constant text := 'requested_ids uuid[] := ''{}'';';
  corrected_declaration constant text := 'requested_ids uuid[] := array[]::uuid[];';
begin
  select pg_catalog.pg_get_functiondef(
    'public.attach_materials_to_plan(jsonb)'::pg_catalog.regprocedure
  )
  into current_definition;

  if current_definition is null
    or pg_catalog.position(original_declaration in current_definition) = 0 then
    raise exception 'The expected material-attachment UUID accumulator was not found.';
  end if;

  patched_definition := pg_catalog.replace(
    current_definition,
    original_declaration,
    corrected_declaration
  );

  execute patched_definition;
end;
$migration$;

revoke all on function public.attach_materials_to_plan(jsonb) from public, anon;
grant execute on function public.attach_materials_to_plan(jsonb) to authenticated;
