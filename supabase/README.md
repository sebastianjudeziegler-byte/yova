# YOVA database

The linked Supabase project is active. Files in `migrations/` are the reviewed, versioned source of truth for its schema.

The database currently stores:

- authenticated profiles and learner preferences
- learning goals, plans, and scheduled sessions
- private material metadata and extracted source text
- completed attempts, interruptions, concept evidence, and adaptations
- contextual tutor conversations
- durable OpenAI usage windows
- privacy-safe product funnel events
- privacy-safe technical error reports with no study content or stack traces
- private support requests linked to the signed-in tester
- public Study Profile leads, versioned responses, private report state, and privacy-bounded funnel events

Row Level Security checks the signed-in user on every user-owned table. The public Study Profile tables expose no browser policies; validated server routes access them with the server-only Supabase secret key. The browser receives only the project URL and publishable key.

Useful checks:

```bash
pnpm exec supabase migration list
pnpm exec supabase db push --dry-run --include-all
pnpm exec supabase db lint --linked --level warning
pnpm exec supabase test db --local
```

Never edit an already-applied migration. Add a new migration so local history, Git, and the remote database continue to agree.
