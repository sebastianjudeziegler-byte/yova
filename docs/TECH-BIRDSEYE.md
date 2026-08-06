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

Supabase provides authentication, Postgres data, and private file storage. GitHub preserves code history. Vercel builds and runs the Next.js server at YOVA's public URL. Monitoring and billing are still separate future systems.

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
  └── privacy-safe product events
```

A learning item is a meaningful goal such as an exam, topic, book, course, or skill. A plan is the sequence for reaching that goal. A session is one bounded unit of work. An attempt is what actually happened when the user studied.

## 4. Authentication versus the learner profile

Authentication answers: **Who is allowed to access these rows and files?**

The learner profile answers: **How should YOVA initially structure help?**

Supabase sends passwordless email links and maintains a secure cookie session. Row Level Security compares that account’s ID with every user-owned row. The learner profile separately stores study-relevant preferences. Diagnosed-condition answers are deliberately excluded from OpenAI planning context.

## 5. Generation versus persistence

Generation creates content. Persistence saves it.

These are intentionally separate because a good AI response that fails to save should not appear as an active plan. YOVA saves authenticated plans through a database transaction: the learning item, plan, and sessions either succeed together or fail together.

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
5. supplies only bounded source excerpts to generation;
6. stops source-grounded sessions if a readable source is unavailable.

Uploaded text is treated as untrusted content, not as instructions to the system.

## 8. Personalization in Lite

YOVA combines four categories of evidence:

- **Profile:** declared blockers, desired structure, explanation preference, and session length.
- **Task:** memorization, conceptual learning, problem solving, reading, writing, or another goal.
- **Context:** available time, deadline, source mode, and starting knowledge.
- **Observed evidence:** answers, concept outcomes, actual duration, interruptions, and feedback.

Code decides what evidence is safe and relevant. OpenAI uses that bounded context to create the teaching language and activity sequence. A single interruption is not treated as a personality trait, and one correct answer is not called mastery.

When a completed session justifies changing the next one, YOVA stores the explanation with that future session. The same evidence is restored after sign-in and shown on Home and inside the plan. This makes adaptation inspectable: the user can see which result changed the plan instead of being asked to trust a vague “personalized” label.

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

YOVA currently has automated unit tests plus repeated manual end-to-end walkthroughs. Broader automated end-to-end coverage remains launch work.

## 13. The next technical systems

The most important remaining layers are:

1. public deployment and production environment configuration;
2. reliable transactional email for authentication;
3. automated end-to-end tests and subject-quality evaluation;
4. production error monitoring and support workflows;
5. privacy/terms pages;
6. Stripe and server-enforced entitlements when payment validation begins.

See `BUILD-STATUS.md` for the current percentages and timeline.
