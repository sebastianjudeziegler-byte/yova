# YOVA Lite

YOVA Lite is a personalized learning planner and guided study system. A learner can describe a goal, optionally upload source material, receive a structured plan, complete guided sessions, ask a contextual tutor for help, and have later recommendations adjust using actual results.

## What works now

- Passwordless Supabase accounts and per-user cloud data
- Ten-question onboarding and editable learning preferences
- One-off Study Now sessions and multi-session learning plans
- Optional private PDF, TXT, and Markdown uploads with server-side extraction
- OpenAI-generated plans, guided sessions, explanations, retrieval, quizzes, and tutor responses
- Inside-YOVA and outside-YOVA study modes
- Home recommendations, Learning, Agenda, Ask YOVA, and You
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

Before a production deployment:

```bash
pnpm readiness:production
```

The readiness command reports whether required connections exist without printing secret values.

## Configuration

Copy `.env.example` to `.env.local` and configure:

- `NEXT_PUBLIC_SUPABASE_URL`: public Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: browser-safe Supabase key
- `OPENAI_API_KEY`: server-only OpenAI credential
- `OPENAI_PLAN_MODEL`: primary structured-generation model
- `OPENAI_SESSION_MODEL`: optional guided-session override
- `OPENAI_TUTOR_MODEL`: optional tutor override
- `SITE_URL`: canonical public origin for production metadata and auth redirects

Never prefix the OpenAI key with `NEXT_PUBLIC_`. Variables with that prefix are bundled into browser code.

`GET /api/system/status` reports only safe capability modes; it never returns credentials.

## Architecture in one sentence

The browser renders the product, YOVA route handlers enforce the rules, OpenAI generates validated learning content, and Supabase provides identity, private storage, and durable memory.

Founder-oriented explanations and the living launch timeline are in:

- `docs/TECH-BIRDSEYE.md`
- `docs/BUILD-STATUS.md`
