-- Backfill legacy scheduled reviews once, then rely exclusively on explicit
-- reviewType and reviewConcept metadata at runtime.

with legacy_reviews as (
  select
    id,
    case
      when concat_ws(' ', title, method) ~* '(repair and verify|misconception repair and delayed transfer)'
        then 'repair_and_retrieve'
      when concat_ws(' ', title, method) ~* '(verify .+ after a delay|spaced retrieval and error repair)'
        then 'verify'
      else null
    end as review_type,
    nullif(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(title, '^repair and verify\s+', '', 'i'),
            '^verify\s+',
            '',
            'i'
          ),
          '\s+after a delay$',
          '',
          'i'
        )
      ),
      ''
    ) as review_concept
  from public.plan_sessions
  where not (coalesce(step_data, '{}'::jsonb) ? 'reviewType')
), valid_reviews as (
  select id, review_type, review_concept
  from legacy_reviews
  where review_type is not null
    and length(review_concept) between 2 and 120
)
update public.plan_sessions as sessions
set step_data = coalesce(sessions.step_data, '{}'::jsonb) || jsonb_build_object(
  'reviewType', reviews.review_type,
  'reviewConcept', reviews.review_concept
)
from valid_reviews as reviews
where sessions.id = reviews.id;

-- Older deployed versions of complete_plan_session stored the explicit
-- follow-up metadata in result_data but omitted it from plan_sessions. This
-- trigger copies the authoritative fields in the same completion transaction.
create or replace function public.persist_follow_up_review_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  follow_up jsonb := new.result_data -> 'followUpSession';
begin
  if jsonb_typeof(follow_up) = 'object'
    and coalesce(follow_up ->> 'reviewType', '') in ('repair_and_retrieve', 'verify', 'maintenance_transfer')
    and length(btrim(coalesce(follow_up ->> 'reviewConcept', ''))) between 2 and 120 then
    update public.plan_sessions
    set step_data = coalesce(step_data, '{}'::jsonb) || jsonb_build_object(
      'reviewType', follow_up ->> 'reviewType',
      'reviewConcept', follow_up ->> 'reviewConcept'
    )
    where id = (follow_up ->> 'id')::uuid
      and user_id = new.user_id;
  end if;

  return new;
end;
$$;

drop trigger if exists persist_follow_up_review_metadata_after_attempt on public.session_attempts;
create trigger persist_follow_up_review_metadata_after_attempt
after insert on public.session_attempts
for each row execute function public.persist_follow_up_review_metadata();
