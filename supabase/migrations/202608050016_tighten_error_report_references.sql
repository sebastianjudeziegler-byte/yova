-- Technical references should remain machine-generated identifiers rather than
-- becoming an accidental channel for arbitrary browser text.

alter table public.error_reports
drop constraint error_reports_error_digest_check,
add constraint error_reports_error_digest_check
check (error_digest is null or error_digest ~ '^[A-Za-z0-9_-]{1,64}$');

alter table public.error_reports
drop constraint error_reports_request_id_check,
add constraint error_reports_request_id_check
check (
  request_id is null
  or request_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
);
