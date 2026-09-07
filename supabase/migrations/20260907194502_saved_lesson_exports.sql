-- Include the new learner-owned prose in the existing bounded, claimed export.
-- Preserve its authorization, transaction lock, receipt and size checks.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('public.export_yova_account_data_without_study_routes()'::regprocedure);
  count_anchor text := 'union all select count(*) from public.session_attempts where user_id = current_user_id';
  actual_anchor text := 'union all select pg_catalog.jsonb_array_length(result -> ''sessionAttempts'')::bigint';
  section_anchor text := '''sessionAttempts'', coalesce((';
begin
  if position(count_anchor in definition)=0 or position(actual_anchor in definition)=0
    or position(section_anchor in definition)=0 then
    raise exception 'Saved lesson export patch did not match the protected exporter';
  end if;
  definition := replace(definition, count_anchor, count_anchor || E'\n    union all select count(*) from public.session_lesson_deliveries where user_id = current_user_id');
  definition := replace(definition, actual_anchor, actual_anchor || E'\n    union all select pg_catalog.jsonb_array_length(result -> ''savedLessons'')::bigint');
  definition := replace(definition, section_anchor, $section$
    'savedLessons', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'planId', lesson.plan_id, 'planSessionId', lesson.plan_session_id,
        'resourceFingerprint', lesson.resource_fingerprint, 'activityIndex', lesson.activity_index,
        'content', lesson.content, 'deliveryMode', lesson.delivery_mode,
        'model', lesson.model, 'createdAt', lesson.created_at
      ) order by lesson.created_at, lesson.id)
      from public.session_lesson_deliveries as lesson where lesson.user_id = current_user_id
    ), '[]'::jsonb),
    'sessionAttempts', coalesce(($section$);
  -- Bound this prose section before aggregation; the mature exporter checks
  -- exact combined record/byte limits again after creating its snapshot.
  definition := replace(definition, 'with section_counts(section_count) as (', $preflight$
    if (select coalesce(sum(pg_catalog.octet_length(content) + 600),0)
      from public.session_lesson_deliveries where user_id = current_user_id) > 26214400 then
      raise exception using errcode='54000', message='account_export_limit_exceeded';
    end if;
    with section_counts(section_count) as ($preflight$);
  execute definition;
end;
$migration$;
