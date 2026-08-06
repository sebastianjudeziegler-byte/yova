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

Row Level Security checks the signed-in user on every user-owned table. The browser receives only the project URL and publishable key; an administrator key is not used by the application.

Useful checks:

```bash
pnpm exec supabase migration list
pnpm exec supabase db push --dry-run --include-all
pnpm exec supabase db lint --linked --level warning
```

Never edit an already-applied migration. Add a new migration so local history, Git, and the remote database continue to agree.
