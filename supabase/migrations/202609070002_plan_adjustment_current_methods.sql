-- Use the maintained catalog rather than a pre-expansion method allowlist.
-- All identity, projection, saved-work and semantic route checks still apply.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('public.adjust_learning_plan_with_routes(jsonb)'::regprocedure);
  previous text := $before$    if coalesce(
        requested_route #>> '{approach,primaryMethodId}',
        ''
      ) not in (
        'retrieval_practice',
        'spaced_retrieval',
        'self_explanation',
        'worked_example_fading',
        'interleaved_practice',
        'read_recall_review',
        'retrieval_based_outlining',
        'scaffolded_coding',
        'practice_test_error_repair'
      )
      or$before$;
begin
  if position(previous in definition)=0 then raise exception 'plan adjustment catalog patch did not match'; end if;
  execute replace(definition, previous, $after$    perform public.assert_study_route_method_catalog_v2(requested_route - 'identity');
    if$after$);
end;
$migration$;
alter function public.adjust_learning_plan_with_routes(jsonb) set lock_timeout = '5s';
