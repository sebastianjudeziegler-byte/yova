# YOVA Technical Bird’s-Eye Guide

This document grows alongside the product. It explains the technology at the level a technical founder should understand before worrying about syntax.

## 1. The layers

### Interface layer

What the user sees: onboarding, Home, plans, questions, sessions, Agenda, Ask YOVA, and You. In this repository, React components render that experience.

### Application-logic layer

The rules connecting actions to outcomes. Examples: selecting an onboarding answer, deciding that a question can advance, or showing a changed recommendation after a session.

### Data layer

The durable memory of the application: users, learning profiles, learning items, plans, materials, sessions, answers, and results. The first prototype uses local sample data. A later phase will replace this with a hosted database.

### AI layer

The model analyzes material and generates structured content. The application—not the model—decides what information it receives, validates the response, stores results, and controls what the user can do.

### Infrastructure layer

Authentication, file storage, deployment, monitoring, billing, and secrets. These make the product reliable and available online.

## 2. Why sample data comes first

Sample data lets us validate the product model before paying the cost of database and AI integration. The interface is not disposable: its data is kept behind clear component boundaries so live data can replace the sample objects later.

## 3. The first vertical slice

The initial slice proves this sequence:

1. A user creates an account.
2. They answer the ten onboarding questions.
3. They reach Home.
4. YOVA recommends an AP Biology retrieval session.
5. They complete the required content.
6. YOVA records a gap and visibly updates the next session.

When this experience feels right, we will connect one real layer at a time: authentication and database, then AI plan generation, then material processing, then billing.

## 4. Vocabulary worth knowing

- **Frontend:** the interface running in the browser.
- **Backend:** server-side logic and data access.
- **Database:** structured, durable product memory.
- **API:** a defined way for two software systems to communicate.
- **Component:** a reusable interface building block.
- **State:** information the current interface remembers, such as the active onboarding question.
- **Schema:** the agreed shape of stored or generated data.
- **Environment variable:** a secure configuration value, such as an API key, kept outside source code.
- **Deployment:** publishing a tested version so other people can use it.
- **Vertical slice:** one complete user journey through every necessary layer.

## 5. Components and separation

The plan-creation journey lives in its own component rather than inside the main application shell. This is separation of concerns: each system has one clear responsibility. The main application decides when plan creation opens; the plan-creation component manages its own temporary answers and screens; later, a backend service will receive the confirmed information and return a generated plan.

## 6. What persistence means

Persistence means information survives after the page closes. YOVA now has a versioned preview store for the private alpha. It remembers the account identity, onboarding answers, generated plans, plan sessions, and session results in the current browser.

This is not yet cloud storage and it is not a replacement for secure authentication. It proves that the product uses real structured objects instead of disconnected screen text. When Supabase is connected, those same objects will be written to a hosted Postgres database.

## 7. Account versus profile

An account answers, “Who is allowed into this data?” A learner profile answers, “How should YOVA initially help this person?” They are deliberately separate.

The account will ultimately be verified by Supabase Auth. The learner profile stores study-relevant preferences such as desired guidance, realistic session length, explanation preference, and common blockers. Observed patterns come from completed sessions and learning events rather than unsupported personality labels.

## 8. The durable hierarchy

```text
Account
  ├── Learner profile
  ├── Learning item
  │     ├── Plan
  │     │     └── Sessions
  │     │            └── Attempts/results
  │     └── Materials
  └── Learning events
```

A learning event is a small factual record such as “session completed,” “hint requested,” or “answer incorrect.” This event history lets YOVA form cautious observations later without rewriting the core tables every time we add a new interaction.

## 9. Database security

The Supabase migration uses Row Level Security. In plain language, the database checks the signed-in user’s ID on every read and write. Even if somebody manipulates the browser, the database should refuse access to rows belonging to another account.

The browser will receive only the public project key. An administrator-level service key must never be placed in browser code.

## 10. The AI boundary

The browser should never talk directly to OpenAI. If it did, the private API key would be visible to anyone using the site.

The safe flow is:

```text
Plan form in the browser
        ↓
YOVA server validates the request
        ↓
Plan generator returns a strict plan shape
        ↓
YOVA server validates the generated plan
        ↓
Browser validates it once more and displays it
```

Plan creation now crosses that real internal server boundary. The browser sends a typed request to `/api/plans/generate`; the server rejects missing or malformed inputs and returns a validated plan object.

The strict shape is the contract. It defines the fields YOVA needs—such as session title, method, reason, duration, and scheduled time—so a model cannot return an attractive paragraph that the product does not know how to use.

Until an OpenAI server key is connected, the route uses a deterministic preview generator. This keeps the whole journey usable without pretending that sample content came from a live model.

The product prompt lives in code next to that contract. That makes changes reviewable and testable instead of hiding important product behavior in an external dashboard.

### What is now connected

The server now uses the official OpenAI JavaScript SDK and the Responses API. It requests a Structured Output, which means the model must return the plan fields YOVA expects rather than an unpredictable paragraph. A second Zod validation still runs before the result reaches the interface.

The live path has:

- a 45-second provider timeout and two automatic retries;
- a strict 5,000-token output ceiling;
- a basic six-requests-per-minute alpha rate limit;
- a unique request ID for debugging without logging uploaded notes;
- safe user-facing errors when the provider refuses, times out, or returns an invalid plan;
- `store: false` on the OpenAI request;
- an explicit live-versus-preview generation status.

The server uses `gpt-5.6` by default and lets the deployment override that model through `OPENAI_PLAN_MODEL`. Model choice belongs in server configuration, not in browser code.

### What remains to make generation live on this machine

1. Add a server-only `OPENAI_API_KEY` to `.env.local`.
2. Restart the development server so it reads the new credential.
3. Run a representative set of plan-generation examples and compare their quality, latency, and cost.

The app never sends the OpenAI key to the browser. The browser calls YOVA's `/api/plans/generate` route, and that server route calls OpenAI.

## 11. Material intake: what is real now

Plan creation now has a real optional file picker instead of a pretend sample-material button. A user may add up to five PDF, TXT, or Markdown files, with a 10 MB limit per file, or continue without uploading anything.

The browser handles the two current file types differently:

- TXT and Markdown files are read locally and their text is attached to the plan-generation request. Text is capped at 50,000 characters per file so an unexpectedly large document cannot overwhelm the application.
- PDF files are accepted and marked as **staged**. YOVA does not yet claim to understand their contents, because reliable PDF extraction and storage have not been connected.

This distinction is important: a polished filename in the interface does not mean the AI has read the file. The product records an honest processing status so later infrastructure can move a material from uploaded, to processing, to ready, or to failed.

The production flow will become:

```text
User chooses a file
        ↓
YOVA validates its type, size, and ownership
        ↓
The original file is stored privately in Supabase Storage
        ↓
A material record is saved in the database
        ↓
Text is extracted and cleaned on the server
        ↓
Only relevant source text is sent to the plan generator
```

Uploaded text is treated as untrusted source material, not as instructions for YOVA. This is a basic prompt-injection defense: if a document says, “ignore your rules,” the model should analyze those words as course content rather than obey them.

For plan generation, YOVA sends at most 12,000 characters from one material and 45,000 characters across all materials. This is a deliberate cost and reliability boundary. Later retrieval can select the most relevant portions instead of sending whole libraries to the model.

Raw TXT and Markdown contents are not returned in the saved plan object. Only the file name, type, size, and processing status remain. This prevents the current browser store from quietly becoming a second copy of a learner's notes.

The behavioral profile sent to plan generation excludes the onboarding question about diagnosed conditions. That information is especially sensitive and is not required for the first planning router. YOVA uses behavior such as starting friction, desired structure, session duration, and explanation preference instead.

## 12. Private-alpha reset

The You screen now contains a private-alpha reset control. It clears the account, onboarding answers, plans, sessions, and results stored by this prototype in the current browser. It requires an explicit second confirmation because the action cannot be undone.

This reset does not delete a real cloud account—there is no connected cloud account yet. When Supabase is live, account deletion and local-browser cleanup will be separate operations with separate safeguards.

## 13. Generation versus persistence

Generation and persistence are different backend jobs:

- **Generation** decides what the plan should contain.
- **Persistence** saves that plan so it survives across devices and sessions.

YOVA exposes `/api/system/status` during development. It reports only safe readiness information:

```json
{
  "planGeneration": "preview",
  "persistence": "browser"
}
```

It never reveals credentials. When configuration is connected, those values become `openai` and `supabase`.

## 14. Durable plan saving

The Supabase server client is now prepared to read the signed-in user's secure session cookie. A second database migration adds `save_generated_plan`, an authenticated database function that saves the learning item, plan, and sessions in one transaction.

“One transaction” means all related records are committed together. If session four is invalid, the database does not leave behind a learning item with half a plan.

The generated plan now uses standard UUID identifiers so the same objects fit the Postgres schema. The repository strips raw material text from generation inputs before saving them.

This cloud path is dormant until a Supabase project, migrations, and real authentication are connected. The current account form still creates a browser-only private-alpha identity. We preserve that boundary rather than pretending an email field is authentication.

## 15. The next backend milestone

The next complete vertical slice is:

```text
Real Supabase sign-up
        ↓
Verified session cookie
        ↓
Onboarding profile saved under that user
        ↓
Plan generated through YOVA's server
        ↓
Plan transaction saved under that user
        ↓
Home reloads the plan from Postgres
```

That requires a real Supabase project URL and publishable key. After those credentials exist, YOVA can replace browser-only identity and storage without rewriting the plan generator.
