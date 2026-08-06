# YOVA build status and launch map

Updated: August 5, 2026

## Honest progress snapshot

YOVA is no longer a visual prototype. The complete core loop works across the interface, backend, OpenAI, and Supabase:

```text
Account → onboarding → goal/material → plan → guided session
        → result → saved evidence → adjusted next recommendation
```

Estimated completion depends on which finish line is meant:

| Finish line | Current estimate | Meaning |
|---|---:|---|
| Functional product core | 88% | The differentiated YOVA learning loop works |
| Invite-only private alpha | 82% | Deployment is connected; reliable email delivery and focused end-to-end testing remain |
| Credible public beta | 58% | Also needs monitoring, broader QA, support/privacy pages, and tester-driven polish |
| Paid polished launch | 35% | Also needs billing, entitlements, cost controls by plan, and more operational maturity |

These percentages are directional, not engineering math. A product can have most features built and still need significant reliability work before strangers should pay for it.

## Current deployment status

Public deployment: `https://yova-roan.vercel.app`

The public page, YOVA identity, security headers, cache policy, OpenAI generation routes, Supabase persistence, private material storage, and authentication configuration pass the automated production smoke test. Vercel environment variables and Supabase production redirect URLs are configured.

A real production passwordless email was delivered successfully. The first return test did not establish a session in the original browser, most likely because the email link opened in a different browser context from the one that requested it. YOVA now gives explicit same-browser guidance, a session recheck action, and useful recovery messages.

A cross-browser six-digit email-code flow is implemented and tested behind a server-controlled feature switch. It will remain hidden until custom SMTP is connected and the Supabase email template includes the code. Supabase's default email service is limited to two emails per hour and does not allow template editing, so custom SMTP is still required before outside testing.

## What is complete

### Product experience

- Branded landing and account journey
- Ten-question personalization onboarding
- Home, Learning, Agenda, Ask YOVA, and You
- Missed-session recovery with start-now, shorter-session, or move-to-tomorrow choices
- Study Now and multi-session plans
- Optional materials or YOVA-created content
- Guided teaching, multiple choice, typed recall, and feedback
- Generated explanations and practice remain reusable inside their learning goal
- Contextual tutoring inside and outside sessions
- Visible reasons for methods and recommendations

### Personalization and adaptation

- Explicit preferences shape plan and session generation
- Diagnostics communicate current knowledge to the planner
- Session accuracy and self-feedback influence the next session
- Evidence-based plan adjustments remain visible after reload on Home and inside the learning goal
- Concept-level evidence distinguishes early signals, review needs, and repeated strength
- Actual duration and repeated interruptions cautiously influence future work
- Completed sessions are grouped by method so YOVA can show early, promising, or support-needed signals without claiming a fixed learning style
- Diagnosed-condition answers are excluded from model personalization context

### Backend and infrastructure

- Supabase passwordless authentication and cookie sessions
- Row-level database security and private file storage
- Atomic plan persistence and reload from the cloud
- Cached session resources reload from Supabase without another OpenAI request
- OpenAI Structured Outputs for plans and guided sessions
- Durable AI usage limits and short-window rate limits
- Offline retry queues for completions and interruptions
- Privacy-safe product analytics
- Production build, security headers, error screens, and social metadata

## What remains

### Required before inviting outside testers

1. Complete a same-browser production authentication return test and then run the full plan-and-session journey.
2. Configure reliable authentication email delivery through a custom SMTP provider.
3. Run complete journeys on mobile and desktop with several real accounts.
4. Test representative biology, math, writing, coding, and general-learning goals.
5. Test good, poor, scanned, and oversized source files.
6. Add production error monitoring and a simple support path.

### Required before a broad public beta

1. Privacy policy, terms, clear AI/source limitations, and support documentation.
2. Accessibility and mobile interaction audit.
3. Structured quality evaluation for plan and session outputs.
4. Cost and latency measurements from real usage.
5. A founder/admin workflow for reviewing errors and funnel analytics.
6. Two or three product iterations based on tester behavior.

### Required before charging broadly

1. Stripe checkout and subscription state.
2. Server-enforced feature entitlements and usage allowances.
3. Billing recovery, cancellation, and customer-support flows.
4. Stronger abuse prevention and cost alerts.
5. Evidence that users return and complete sessions.

## Realistic timeline from here

Assuming focused daily work with Codex and fast product decisions:

### Next 1–2 days: deployable alpha

- finish the real production sign-in journey
- configure a reliable email provider
- verify a saved plan and completed session through the deployed environment
- add production monitoring and founder-visible error reporting

### Following 3–5 days: trustworthy private alpha

- complete mobile/desktop journeys
- subject and material quality tests
- fix the highest-impact failures
- add monitoring, privacy/support basics, and tester instructions

### Days 8–14: real-user iteration

- invite a small group
- inspect onboarding → plan → session completion funnel
- interview users who finish and users who leave
- simplify friction and improve weak AI outputs

At the end of two focused weeks, a good target is a real invite-only alpha or carefully limited public beta—not a perfectly finished paid product.

### After that

- A credible public beta: roughly 2–4 additional weeks, depending on tester findings.
- A dependable paid launch: roughly 4–8 additional weeks, especially because billing and support create operational work beyond the interface.

## Tech-literacy curriculum attached to the build

Learn these concepts when the related work happens, rather than through a disconnected course:

| Build phase | Concept to understand | Practical question you should be able to answer |
|---|---|---|
| Current architecture | Frontend vs backend | Which code runs in the user's browser, and which code protects secrets? |
| Supabase | Database, authentication, storage | How are identity, structured rows, and files different? |
| API routes | API contracts and validation | Why can the app reject a malformed AI or browser response? |
| Personalization | Rules, evidence, and model context | Which decisions belong to code, and which belong to the language model? |
| Git/GitHub | Version control | What does a commit preserve, and why is it different from deployment? |
| Deployment | Local vs production environments | Why does localhost work without making the product public? |
| Testing | Unit, integration, and end-to-end tests | What kind of failure can each test catch? |
| Monitoring | Logs, errors, and product events | How do we know what broke and where users leave? |
| Billing | Payments vs entitlements | Why is charging a card different from deciding what the account may use? |

The goal is not to turn you into a syntax expert. It is to make you capable of understanding system boundaries, evaluating technical decisions, noticing risk, and directing Codex or a future engineering team intelligently.
