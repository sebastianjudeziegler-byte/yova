# YOVA Lite

YOVA Lite is a personalized learning planner and guided study system. This repository begins with a realistic sample-data alpha so the product experience can be validated before database, AI, file-processing, and billing integrations are added.

## Current slice

- Landing and account-entry simulation
- Ten-question personalization onboarding
- Starting-profile explanation
- Paywall preview
- Five-destination application shell
- AP Biology learning plan
- Complete sample plan-creation journey
- Real optional PDF, TXT, and Markdown material picker with validation
- No-material path for AI-generated learning content
- Inside-YOVA and outside-YOVA study modes
- Starting-point diagnostic and generated plan preview
- Local private-alpha account entry and returning-user sign-in
- Versioned browser persistence for onboarding, plans, sessions, and results
- Production-oriented Supabase schema with per-user security policies
- Official OpenAI SDK and Responses API integration with Structured Outputs
- Honest automatic preview/live generation mode
- Server-side generation timeouts, retry limits, rate limiting, and request IDs
- Database-ready UUIDs and atomic authenticated plan persistence
- Backend readiness endpoint at `/api/system/status`
- Guided retrieval session
- Completion and adaptation feedback
- Confirmed private-alpha data reset

## Data modes

The app currently runs in local private-alpha mode, so the browser remembers the account and product data between visits. The production data boundary, server client, and transactional plan save are prepared for Supabase; connecting a project URL, publishable key, migrations, and real authentication is a separate, explicit step.

TXT and Markdown materials are read locally for the current plan request. PDFs are accepted but only staged until server-side storage and extraction are connected; the app does not pretend that staged PDFs have been analyzed.

## Local development

```bash
pnpm install
pnpm dev
```

Then open `http://localhost:3000`.

## AI plan generation

The plan-creation UI calls a real internal endpoint and validates both sides of the exchange. That endpoint is connected to the official OpenAI JavaScript SDK, Responses API, and Structured Outputs. When `OPENAI_API_KEY` is absent, it deliberately returns deterministic preview plans and labels them as previews.

Copy `.env.example` to `.env.local` and add a server-only `OPENAI_API_KEY` when the OpenAI provider is connected. Never expose this key in a variable beginning with `NEXT_PUBLIC_`.

`GET /api/system/status` safely reports whether this running copy is using OpenAI or the preview generator, and Supabase or browser persistence.

See `docs/TECH-BIRDSEYE.md` for the founder-oriented technical explanation.
