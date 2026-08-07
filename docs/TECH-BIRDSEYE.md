# YOVA technical bird’s-eye guide

This is the founder-level explanation of the running YOVA system. It focuses on boundaries and decisions rather than syntax.

## 1. The five layers

### Interface

React components render onboarding, Home, Learning, Agenda, Ask YOVA, You, plan creation, and guided sessions. This is the **frontend**: code that runs in the user’s browser.

### Application logic

TypeScript functions decide which session is ready, how results update the next session, what should be saved, and what the interface shows. This layer turns product rules into repeatable behavior.

### Backend

Next.js Route Handlers under `src/app/api/` are YOVA’s private server doorways. The browser calls them for plans, sessions, tutoring, materials, scheduling, account-data reset, and product events. They authenticate users, validate input, enforce limits, and decide which outside service may be called.

### AI

OpenAI generates structured plans, learning activities, explanations, questions, and tutor replies. OpenAI is an engine inside the product—not the product’s database, account system, or source of every decision.

### Data and infrastructure

Supabase provides authentication, Postgres data, and private file storage. GitHub preserves code history. Vercel builds and runs the Next.js server at YOVA's public URL. YOVA now has a narrow first-party error-monitoring layer; external alerting and billing are still future systems.

### Trust and support

Privacy, private-alpha terms, and support are public pages with their own URLs and metadata. A signed-in support submission crosses a validated API boundary, is rate-limited, and becomes a private Supabase row tied to the tester's account. This means support is an operational data workflow, not merely a mail link. Founder review currently happens in Supabase; a dedicated admin console is later work.

## 2. The core request flow

```text
Browser interaction
      ↓
YOVA API route validates the request and signed-in account
      ↓
YOVA loads only the relevant profile, plan, evidence, and source excerpts
      ↓
OpenAI returns a strict structured object
      ↓
YOVA validates the object again
      ↓
Supabase saves the durable result
      ↓
The browser renders the confirmed result
```

The browser never receives `OPENAI_API_KEY`. Anything beginning with `NEXT_PUBLIC_` is considered browser-visible configuration.

## 3. The durable data hierarchy

```text
Authenticated account
  ├── profile
  ├── learner profile
  ├── learning item
  │     ├── plan
  │     │     └── plan sessions
  │     │            └── attempts and results
  │     ├── materials
  │     └── tutor thread
  ├── learning events
  ├── AI usage windows
  ├── privacy-safe product events
  └── privacy-safe error reports
```

A learning item is a meaningful goal such as an exam, topic, book, course, or skill. A plan is the sequence for reaching that goal. A session is one bounded unit of work. An attempt is what actually happened when the user studied.

## 4. Authentication versus the learner profile

Authentication answers: **Who is allowed to access these rows and files?**

The learner profile answers: **How should YOVA initially structure help?**

Supabase sends passwordless email links and maintains a secure cookie session. Row Level Security compares that account’s ID with every user-owned row. The learner profile separately stores study-relevant preferences. Diagnosed-condition answers are deliberately excluded from OpenAI planning context.

## 5. Generation versus persistence

Generation creates content. Persistence saves it.

These are intentionally separate because a good AI response that fails to save should not appear as an active plan. `/api/plans/generate` now returns an unsaved draft. The learner can inspect the content, source, starting approach, and pace without creating database rows. Only `/api/plans/activate`, called after the learner confirms the draft, changes its status to active and saves it.

YOVA saves authenticated plans through a database transaction: the learning item, plan, and sessions either succeed together or fail together. Study Now uses the same two server steps, but performs confirmation immediately because the learner explicitly asked to build and start one focused session. This is a useful backend principle: the server lifecycle matches the promise made by the interface.

Activation is also retry-safe. If Supabase completes the transaction but the response is lost, YOVA checks for that exact user-owned plan before reporting failure. Repeating the same activation therefore returns the original plan instead of creating another one. This property is called **idempotency**.

## 6. Why schemas matter

A schema is a machine-checkable contract. YOVA uses Zod schemas around browser requests and OpenAI responses.

Without a schema, a model could return an attractive paragraph when the product needs six session objects. With a schema, each session must include fields such as objective, method, duration, and schedule. Invalid content is stopped before it becomes product state.

### Reusing generated session resources

When YOVA first builds a guided session, it already saves that structured session with the plan session in the database. The Learning screen now reads that same saved content and presents its explanations, active-recall prompts, and questions as a reusable resource pack.

This avoids a second OpenAI call and avoids creating a disconnected copy of the content. If the user changes the future session setup or adds new source material, YOVA clears the affected cached pack so outdated practice is not presented as current.

## 7. Material handling

Authenticated users may upload PDF, TXT, and Markdown files. YOVA:

1. checks file type, count, size, and ownership;
2. stores the original privately in Supabase Storage;
3. extracts bounded text on the server;
4. stores processing status and extracted text in protected rows;
5. checks whether the extracted content is substantial enough to use;
6. supplies only bounded source excerpts to generation;
7. stops source-grounded sessions if a readable source is unavailable.

Uploaded text is treated as untrusted content, not as instructions to the system.

Material quality has three practical states. **Ready** means YOVA found substantial readable content. **Limited** means the file is usable but short or reached the 50,000-character extraction boundary, so the user sees a warning. **Unusable** means the file is scanned without selectable text, damaged, binary, or contains too little readable content; YOVA removes the failed staged upload and asks for a clearer source instead of pretending it can generate a grounded plan.

## 8. Personalization in Lite

YOVA combines four categories of evidence:

- **Profile:** declared blockers, desired structure, explanation preference, and session length.
- **Task:** memorization, conceptual learning, problem solving, reading, writing, or another goal.
- **Context:** available time, deadline, source mode, and starting knowledge.
- **Observed evidence:** answers, concept outcomes, actual duration, interruptions, and feedback.

Code decides what evidence is safe and relevant. OpenAI uses that bounded context to create the teaching language and activity sequence. A single interruption is not treated as a personality trait, and one correct answer is not called mastery.

### The learning-science engine

YOVA now has a formal catalog of nine core methods and a task-first router. Ordinary TypeScript classifies the learning job and current knowledge stage, selects a bounded set of scientifically appropriate methods, and derives cautious delivery adjustments. OpenAI then chooses within those boundaries and composes the actual session.

There is a second boundary around **teaching versus practice**. The interface asks what the learner can currently do, ordinary application code translates that into teaching-first or practice-first, and OpenAI must follow the matching activity order. This is a useful example of product architecture: the language model writes the subject-specific content, while YOVA’s code decides the educational rules it is allowed to follow.

Every generated session must return a structured method briefing:

```text
what the learner is doing
why the method fits this task and current knowledge
how to execute it
what completion means
```

This division matters. The model has room for subject-specific judgment, but it cannot silently replace a problem-solving method with a productivity trick merely because the user mentioned procrastination. See `docs/LEARNING-SCIENCE-ENGINE.md` for the catalog, evidence tiers, and remaining scientific work.

When a completed session justifies changing the next one, YOVA stores the explanation with that future session. The same evidence is restored after sign-in and shown on Home and inside the plan. This makes adaptation inspectable: the user can see which result changed the plan instead of being asked to trust a vague “personalized” label.

The You screen also groups completed sessions into broad method families such as retrieval, guided explanation, and application practice. Ordinary TypeScript—not OpenAI—calculates completion counts, check accuracy, difficulty feedback, and interruptions. YOVA labels one session as early evidence, requires repeated comparable checks before showing a promising signal, and never turns this history into a fixed “learning style.”

## 9. Reliability systems already present

- validated server and AI contracts
- overdue-session recovery composed from the existing secure scheduling and duration APIs
- short-window API rate limits
- durable per-account OpenAI allowances
- atomic plan saving
- generated-session caching
- browser fallback state and cloud reload
- retry queues for completions and interruptions
- request IDs and safe user-facing errors
- security headers and private storage
- automated tests for core adaptation and evidence rules
- privacy-safe funnel events
- privacy-safe error signals with route, surface, time, and request references

### Error monitoring versus product analytics

Product analytics answers questions such as: **Did a tester finish onboarding or complete a session?** Error monitoring answers: **Which product surface failed, when, and can the founder connect it to a server request?**

YOVA's browser sends a stable error code rather than a raw JavaScript error. The API authenticates the tester, validates a strict schema, rate-limits reports, and stores a private Supabase row. Query strings, study content, tutor text, learner answers, arbitrary messages, and stack traces are excluded by design. If monitoring itself fails, it returns silently so it cannot trap the user in a second error.

This is first-party monitoring: it is enough for a small private alpha and teaches the architecture clearly. A larger beta should add external alerts and automated grouping rather than expecting the founder to watch a database table continuously.

## 10. Preview mode versus cloud mode

Without Supabase settings, YOVA can run in browser-preview mode for development. Without OpenAI, plan generation can use a clearly labeled deterministic preview.

The connected private-alpha configuration uses:

```text
authentication: Supabase email
persistence: Supabase Postgres
materials: private Supabase Storage
plans: OpenAI
guided sessions: OpenAI
tutor: OpenAI
```

`GET /api/system/status` reports those safe capability modes without returning credentials.

## 11. Git is not deployment

A **commit** is a named snapshot of code history. A **push** copies commits to GitHub. A **deployment** takes a commit, installs dependencies, injects production environment variables, builds the app, and runs it on a public server.

This is why pushing to GitHub does not automatically make `localhost:3000` available to users unless a deployment provider is connected.

## 12. Testing levels

- **Unit test:** checks one rule, such as next-session adaptation.
- **Integration test:** checks multiple connected pieces, such as an authenticated API writing a valid row.
- **End-to-end test:** acts like a user from account entry through session completion.
- **Production smoke test:** checks the deployed system with its real configuration.
- **AI quality evaluation:** scores real generated plans against product-specific learning, timing, safety, and personalization criteria.

YOVA currently has 177 passing unit tests, ten foundational browser journeys exercised at desktop and phone-sized viewports, and opt-in live OpenAI evaluations for plans, sessions, and typed-answer judgment. The live evaluations consume API credits, so ordinary builds never trigger them. Real authenticated production journeys and broader human output review remain launch work.

## 13. The next technical systems

The most important remaining layers are:

1. reliable transactional email and a complete authenticated production journey;
2. real learner testing plus human review of plan, session, and source quality;
3. accessibility and broader device interaction review;
4. external error alerts and a more efficient founder-support workflow as tester volume grows;
5. external review of the privacy/terms drafts;
6. Stripe and server-enforced entitlements when payment validation begins.

See `BUILD-STATUS.md` for the current percentages and timeline.
