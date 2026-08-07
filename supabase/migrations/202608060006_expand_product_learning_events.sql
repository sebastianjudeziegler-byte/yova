-- Keep analytics bounded to product behavior. No learner answers, concepts, or
-- uploaded content are recorded in these events.

alter table public.product_events
drop constraint if exists product_events_event_name_check;

alter table public.product_events
add constraint product_events_event_name_check check (event_name in (
  'onboarding_started',
  'onboarding_completed',
  'alpha_entered',
  'plan_created',
  'session_started',
  'session_generated',
  'session_completed',
  'session_interrupted',
  'session_repair_adapted',
  'tutor_message_sent'
));
