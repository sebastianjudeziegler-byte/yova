-- Plans activated after 202609090001 stored "revisionEditedFields": null for
-- every session without reviewed edits: jsonb_build_object turns an absent
-- draft field into a JSON null, and coalesce() does not treat a JSON null as
-- absent. The revision context then returned editedFields:null, and every such
-- plan failed to preview. Stored rows are left as they are; both sides below
-- treat a JSON null as "no reviewed edits".

-- The reader returns an empty list for a stored JSON null.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('public.read_plan_revision_context(uuid)'::regprocedure);
  anchor text := $anchor$'editedFields',coalesce(s.step_data->'revisionEditedFields','[]'::jsonb)$anchor$;
  fixed text := $fixed$'editedFields',coalesce(nullif(s.step_data->'revisionEditedFields','null'::jsonb),'[]'::jsonb)$fixed$;
begin
  if position(fixed in definition)>0 then return; end if;
  if position(anchor in definition)=0 then raise exception 'Revision context reader did not match the reviewed protections shape'; end if;
  execute replace(definition, anchor, fixed);
end;
$migration$;

-- The activation writer stores an empty list instead of a JSON null.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('public.save_generated_plan(jsonb)'::regprocedure);
  anchor text := $anchor$'revisionEditedFields', session -> 'revisionEditedFields',$anchor$;
  fixed text := $fixed$'revisionEditedFields', coalesce(nullif(session -> 'revisionEditedFields', 'null'::jsonb), '[]'::jsonb),$fixed$;
begin
  if position(fixed in definition)>0 then return; end if;
  if position(anchor in definition)=0 then raise exception 'Plan activation writer did not match the reviewed protections shape'; end if;
  execute replace(definition, anchor, fixed);
end;
$migration$;
