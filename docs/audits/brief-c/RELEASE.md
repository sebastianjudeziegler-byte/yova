# Brief C release

The founder explicitly authorized merge and deployment, then confirmed that the GitHub Actions provider secret was replaced and the exposed old key revoked. All verification remains in GitHub Actions.

## Prerequisites observed before release

- Vercel project `yova/yova` is connected to this repository; pushing `main` creates the production deployment. Its current Ready production is main `80323614fec32563a340528fb558a84657a00773` (Brief B), observed through the deployment dashboard on September 10, 2026.
- Supabase production project `sbntgjvrvazcnlppnbzs` records migrations only through `202609080001_study_profile_report_confirmation_gate`. Its public function list does not contain `apply_plan_revision` or `read_plan_revision_context`. The already-merged Brief B migration `202609090001_living_plan_revisions.sql` therefore remains a deployment prerequisite, in addition to C's two migrations. No database mutation has been performed during this inspection.
- Apply the existing, CI-replayed migrations in order: `202609090001_living_plan_revisions.sql`, `20260910130000_work_block_runtime.sql`, then `20260910140000_topic_scoped_source_projection.sql`. Recheck installed state immediately before applying; do not replay an already-applied non-idempotent migration. Preserve migration history. These are existing release migrations, not new product fixes.

## Release sequence

1. Finish the scoped live verification and the one combined full gate; compare failures with retained exact-main evidence under the founder's regression-only release rule.
2. Open the single Brief C PR with the evidence, profile printouts, founder captures and default-generation inventory. Confirm its head SHA and base before merging.
3. Apply the pending, tested database migrations before the new application starts serving V19 blocks, and merge the verified PR. Leave production access and personalization settings unchanged.
4. Confirm Vercel production is Ready at the resulting main SHA. Read the invitation-only and personalization-0 settings without changing them.
5. Dispatch `Production public smoke` on main with that full SHA as `expected_sha`. It runs the existing ordinary public smoke once in GitHub Actions; no local test process or provider key is required. It deliberately does not run the account-mutating lifecycle suite. Retain its CI link and result.

No deployment completion is claimed until the migration, Ready-source and public-smoke results are recorded.
