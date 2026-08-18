# YOVA

YOVA is a personalized learning planner and guided study system. A learner can describe a goal, optionally upload source material, receive a structured plan, complete guided sessions, ask a contextual tutor for help, and have later recommendations adjust using actual results.

## What works now

- Passwordless Supabase accounts and per-user cloud data
- Ten-question onboarding and editable learning preferences
- One-off Study Now sessions and multi-session learning plans
- In-flow clarification when a class label such as “Calc Unit 3” does not identify the actual topic
- Plan-alignment review before a generated draft becomes an active learning goal
- Optional private PDF, TXT, and Markdown uploads, public article imports, and YouTube transcript sources with server-side extraction
- OpenAI-generated plans, guided sessions, explanations, retrieval, quizzes, and tutor responses
- Server-side educational quality gates that reject or repair plans with impossible timing, mismatched methods, passive completion rules, broken learning progression, or unsupported learner claims
- Subject-aware session interactions, including a step-by-step quantitative workpad that checks both reasoning and the final result
- Inside-YOVA and outside-YOVA study modes
- Content-based plan resizing when the learner’s available session time changes
- Home recommendations, Learning, a workload-aware Agenda, Ask YOVA, and You
- Session timing, interruptions, resumable progress, concept evidence, and lightweight next-session adaptation
- Plan adjustments, rescheduling, archiving, material attachment, and learning-data reset
- Durable OpenAI usage protection and server rate limits
- Privacy-safe first-party product analytics
- Branded metadata, recovery screens, security headers, and automated tests

The linked Supabase project is active and migrations in `supabase/migrations/` are the database source of truth. Without Supabase configuration, YOVA deliberately switches to browser-preview mode. Without an OpenAI key, plan creation uses a clearly labeled deterministic preview engine.

## Run locally

```bash
pnpm install
pnpm readiness
pnpm dev
```

Open `http://localhost:3000`.

Quality checks:

```bash
pnpm test
pnpm lint
pnpm build
```

An optional live plan-quality suite is also available. It sends five representative cases to OpenAI and therefore consumes API credits:

```bash
pnpm eval:plans
```

See [`docs/QUALITY-EVALUATION.md`](docs/QUALITY-EVALUATION.md) before running it.

Before a production deployment:

```bash
pnpm readiness:production
```

After Vercel provides a public URL:

```bash
pnpm smoke:production -- https://YOUR-YOVA-DOMAIN
```

See [`docs/VERCEL-CHECKLIST.md`](docs/VERCEL-CHECKLIST.md) for the production environment, Supabase redirect, and sign-in email checklist.

The readiness command reports whether required connections exist without printing secret values.

## Configuration

Copy `.env.example` to `.env.local` and configure:

- `NEXT_PUBLIC_SUPABASE_URL`: public Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: browser-safe Supabase key
- `SUPABASE_SECRET_KEY`: server-only Supabase secret for invitations and private export storage operations
- `CRON_SECRET`: server-only random value of at least 32 characters for the scheduled export cleanup route
- `AUTH_EMAIL_CODE_VERIFICATION`: enables the 6-digit email-code form after custom SMTP and the matching Supabase email template are configured
- `OPENAI_API_KEY`: server-only OpenAI credential
- `OPENAI_PLAN_MODEL`: primary structured-generation model
- `OPENAI_SESSION_MODEL`: optional guided-session override; defaults to the faster `gpt-5.4-mini`
- `OPENAI_LESSON_MODEL`: optional full streamed-lesson override; defaults to `OPENAI_PLAN_MODEL`
- `OPENAI_TUTOR_MODEL`: optional tutor override
- `SITE_URL`: canonical public origin for production metadata and auth redirects

Never prefix the OpenAI key with `NEXT_PUBLIC_`. Variables with that prefix are bundled into browser code.

`GET /api/system/status` reports only safe capability modes; it never returns credentials.

## Architecture in one sentence

The browser renders the product, YOVA route handlers enforce the rules, OpenAI generates validated learning content, and Supabase provides identity, private storage, and durable memory.

Founder-oriented explanations and the living launch timeline are in:

- `docs/TECH-BIRDSEYE.md`
- `docs/BUILD-STATUS.md`
