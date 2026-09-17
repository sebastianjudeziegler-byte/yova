# PowerPoint upload deployment

Native `.pptx` uploads require both the application release and
`supabase/migrations/202609170001_powerpoint_material_uploads.sql`. Apply the
migration before releasing the application that advertises PowerPoint support.
Without it, Storage, the staging-table constraint, and the upload RPC all reject
the PowerPoint MIME type even when the file picker accepts the file.

The migration adds
`application/vnd.openxmlformats-officedocument.presentationml.presentation` to
those three allowlists. It preserves private storage, the 10 MiB file limit,
existing PDF/text/Markdown support, per-account and daily quotas, RLS, and the
receipt-based cancellation/reset lifecycle. Legacy `.ppt` and arbitrary ZIP
files remain unsupported. Existing application versions remain compatible.

The migration takes its table locks with `NOWAIT`; if deployment reports
`lock_not_available`, retry during a quiet deployment window. No old migration
needs to be edited, and existing uploads require no backfill.

Validation completed locally on 17 September 2026:

- 176 affected tests passed across extraction, browser intake, upload routes,
  upload UI, mapping, and database migration contracts. TypeScript and targeted
  ESLint checks passed.
- The supplied 17-slide course deck passed native extraction and the upload
  route integration test without truncation. The route test uses the real
  parser and response schemas with mocked Auth, Storage, database, and AI
  services; it does not claim a live production upload or quiz-generation test.
- 26 focused Vitest assertions passed across the new migration, upload quotas,
  and late-upload cleanup receipt contracts.
- All 119 migrations replayed in an isolated PGlite database, then all 20 new
  pgTAP assertions passed. These exercise authenticated PPTX creation, owner
  isolation, MIME/size rejection, quota accounting and cancellation receipts.
  This local runner used fixture Supabase Auth/Storage schemas and built-in
  UUID/SHA-256 aliases because PGlite does not ship `pgcrypto`.

The repository quality workflow also discovers the new transactional test at
`supabase/tests/database/20260917_powerpoint_material_uploads.test.sql` during
`pnpm exec supabase test db --local`, after full native Supabase migration
replay. Run that release gate and a signed-in upload smoke test against the
deployed application; the local SQL test does not exercise Storage HTTP uploads
or signed URLs. No remote database was changed during implementation.

Native PowerPoint extraction reads slide text, tables, and speaker notes in
presentation order. It retains slide markers for source references. It does not
interpret pictures, charts, or linked videos; imports disclose this limitation.
Image-only decks receive an actionable PDF-export message for the existing PDF
recovery path. A mixed text/image PDF is not guaranteed to trigger that recovery,
so notes or transcripts remain necessary for content that exists only in media.
