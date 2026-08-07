# YOVA build status and launch map

Updated: August 6, 2026

## Honest progress snapshot

YOVA is no longer a visual prototype. The complete core loop works across the interface, backend, OpenAI, and Supabase:

```text
Account → onboarding → goal/material → plan → guided session
        → result → saved evidence → adjusted next recommendation
```

Estimated completion depends on which finish line is meant:

| Finish line | Current estimate | Meaning |
|---|---:|---|
| Functional product core | 99% | The differentiated loop now routes readiness, visibly teaches method-specific activity sequences, repairs misses, schedules and launches concept-level returns, controls how thin learner sources are supplemented, and uses repeated plan-specific method outcomes to adjust support |
| Invite-only private alpha | 94% | Deployment, safeguards, atomic learning-state updates, and automated teaching and practice journeys on desktop and mobile are connected; reliable email delivery and authenticated production testing remain |
| Credible public beta | 75% | Trust, monitoring, five-path live quality gates, CI, phone-sized coverage, and reload persistence checks exist; human output review, more device coverage, external alerts, policy review, and tester-driven polish remain |
| Paid polished launch | 35% | Also needs billing, entitlements, cost controls by plan, and more operational maturity |

These percentages are directional, not engineering math. A product can have most features built and still need significant reliability work before strangers should pay for it.

## Current deployment status

Public deployment: `https://yova-roan.vercel.app`

The public page, YOVA identity, security headers, cache policy, OpenAI generation routes, Supabase persistence, private material storage, and authentication configuration pass the automated production smoke test. Vercel environment variables and Supabase production redirect URLs are configured.

A real production passwordless email was delivered successfully. The first return test did not establish a session in the original browser, most likely because the email link opened in a different browser context from the one that requested it. YOVA now gives explicit same-browser guidance, a session recheck action, and useful recovery messages.

A cross-browser six-digit email-code flow is implemented and tested behind a server-controlled feature switch. It will remain hidden until custom SMTP is connected and the Supabase email template includes the code. Supabase's default email service is limited to two emails per hour and does not allow template editing, so custom SMTP is still required before outside testing.

## What is complete

### Product experience

- Rebuilt visual foundation using the real YOVA app icon, a reusable brand mark, a calmer light product shell, consistent navigation, and responsive mobile bottom navigation
- Reworked landing page around one clear promise and one primary action, with a realistic in-product session preview instead of a presentation-style hero
- Reworked Home around the three foundational paths: follow YOVA's recommended next session, create a learning plan, or study something now
- Rebuilt Learning as a scalable goal library: users now see compact active, completed, and archived goal cards before opening a focused plan detail
- Learning goal details now put the actual session sequence first, followed by adaptations, sources, generated resources, and concept evidence
- Simplified multi-session plan creation to one consistent five-step journey and the same three source choices used by Study Now: use uploaded materials, let YOVA create the teaching, or receive guidance while studying elsewhere
- Branded landing and account journey
- Ten-question personalization onboarding
- Home, Learning, Agenda, Ask YOVA, and You
- Missed-session recovery with start-now, shorter-session, or move-to-tomorrow choices
- Study Now and multi-session plans
- Optional materials or YOVA-created content
- Guided teaching, multiple choice, typed recall, and feedback
- Typed explanations receive a bounded AI-assisted formative check against the activity's reference answer and rubric; the learner can correct YOVA's judgment, and the typed response is not saved in YOVA's database
- Formative answer judgment is protected by a repeatable human-labeled benchmark spanning correct paraphrases, confident misconceptions, incomplete causal explanations, equivalent math notation, concise programming answers, and genuinely ambiguous prompts
- Safe built-in biology, calculus, and finance sessions now provide real instruction and worked examples when teaching must come before independent performance
- Generated explanations and practice remain reusable inside their learning goal
- Contextual tutoring inside and outside sessions
- Visible reasons for methods and recommendations
- Upload guidance now names useful source examples: teacher study guides, PDF lecture slides, class notes, review sheets, and readable textbook excerpts

### Personalization and adaptation

- Explicit preferences shape plan and session generation
- Diagnostics communicate current knowledge to the planner
- Session accuracy and self-feedback influence the next session
- Evidence-based plan adjustments remain visible after reload on Home and inside the learning goal
- Concept-level evidence distinguishes early signals, review needs, and repeated strength
- Actual duration and repeated interruptions cautiously influence future work
- A learner can interrupt the same session more than once and resume from the latest saved content step instead of losing the newer resume point
- Paused sessions preserve completed concept, accuracy, and confidence evidence without storing typed answers; if a learner leaves during a required repair, that repair returns before new work
- Completed sessions are grouped by method so YOVA can show early, promising, or support-needed signals without claiming a fixed learning style
- Diagnosed-condition answers are excluded from model personalization context
- A task-first learning-science router now bounds OpenAI to nine named methods instead of relying on a free-form “personalized plan” prompt
- Every new guided session must explain what the selected method is, why it fits, how to execute it, and what completion means
- Learner tendencies are treated as delivery modifiers rather than fixed brain types or replacements for task-appropriate methods
- YOVA infers whether to teach first or practice first from concrete starting-point evidence; plans can transition between the two and weak results can switch the next session back to targeted teaching
- Teaching-first sessions must begin with instruction or a model, while practice-first sessions must begin with an unsupported attempt before explanation
- Knowledge checks capture confidence before the answer, allowing YOVA to distinguish possible misconceptions from correct-but-uncertain knowledge
- Confidence evidence is stored without the learner’s typed response, shown transparently at completion, and used to choose misconception repair versus independent confirmation
- A missed check now creates an immediate explain-back before the session can finish, but that retry is explicitly excluded from accuracy and mastery evidence
- When a typed explanation misses a key relationship, YOVA now carries the evaluator's specific missing ideas into the explain-back instead of giving a generic retry; the correction is checked for meaning while remaining excluded from durable mastery evidence
- A last-session miss creates a short delayed verification session instead of allowing the learning goal to appear complete
- High-confidence misses use a teaching-first misconception-repair follow-up; ordinary misses use practice-first spaced retrieval and error repair
- Session evidence counts only completed checks, preventing unfinished questions in a resumed session from being silently scored as wrong
- Every stated essential idea in a generated session must now map to a named required knowledge check; the server rejects or repairs sessions that teach a target without collecting evidence for it, and learners can inspect the mapping inside the session guide
- Rough study guides and outline-style uploads can define the factual scope while YOVA supplies only the missing explanation or example needed to teach an in-scope idea
- Substantial explanatory uploads stay material-only by default, preventing YOVA from adding outside content merely because it can
- Source-based sessions now carry verified text anchors and disclose every AI-supplied teaching addition to the learner
- Every generated activity now carries a learning-phase role, and the backend rejects sessions that only name a method without executing its required sequence
- Worked-example fading must move from a complete model to reduced support to independent performance; interleaving must mix distinct categories; reading, outlining, coding, retrieval, spacing, and practice-test methods each have their own enforced progression
- Guided sessions now turn those internal roles into a learner-facing method roadmap, showing the support progression before the work begins
- Every activity explains its current phase—such as model, retrieve, repair, or transfer—and whether the answer, source, feedback, or scaffold should be visible
- Completed concept evidence now records whether success or difficulty occurred during guided practice, independent retrieval, or transfer instead of treating every correct answer as equivalent
- YOVA uses that phase-specific history to restore a model after difficulty, fade guidance after an initial secure check, or require a different independent transfer after repeated unsupported success
- Every newly generated session shows a plain-language Support Progression card explaining how much help is available and which completed evidence justified that decision
- Safe built-in fallback sessions use the same phase model, so a failed generation request cannot silently turn YOVA into an unstructured generic quiz
- Future guided sessions now receive the actual method, result, and difficulty feedback from earlier sessions in the same plan instead of seeing scores without method context
- YOVA waits for repeated comparable evidence before changing method delivery, then adds support after repeated difficulty or cautiously fades support after promising results
- The backend rejects generated sessions that ignore a meaningful method-outcome signal or turn observational results into a fixed “best method” or learning-style claim
- Every observed concept now receives a transparent next-return policy: quick retrieval and repair after a miss, verification after an early success, or a lighter transfer check after repeated secure evidence
- Concept return intervals are visible inside the learning goal and explicitly described as review heuristics rather than permanent mastery predictions
- Due review concepts are sent to the session generator with their exact stored names, and the backend rejects a generated session that skips the highest-priority return for lower-priority work
- Agenda now includes a retrieval queue derived from completed concept evidence, rather than from a generic repetition counter
- A due concept in an active plan is forced into the next session; a due concept in a completed plan can reopen the original goal with one bounded five- or ten-minute verification session

### Honest scientific-product status

The software loop is close to private-alpha readiness, but the broader learning-science vision is earlier. The catalog, router, teaching/practice separation, visible method phases, confidence calibration, immediate repair, actionable concept-level review scheduling, phase-specific support fading, and first behavior-based method adaptations establish the correct architecture; specialized interactions and longer-term controlled outcome comparisons remain. “Private alpha 94%” therefore means the product can be tested safely—not that 94% of the long-term adaptive-learning system is complete.

### Backend and infrastructure

- Supabase passwordless authentication and cookie sessions
- Row-level database security and private file storage
- Atomic plan persistence and reload from the cloud
- Cached session resources reload from Supabase without another OpenAI request
- OpenAI Structured Outputs for plans and guided sessions
- Durable AI usage limits and short-window rate limits
- Answer checks have their own server-enforced allowance, preventing a useful formative interaction from becoming an uncontrolled OpenAI cost path
- Offline retry queues for completions and interruptions
- Atomic completion plus delayed-follow-up persistence, so the cloud cannot save “goal complete” while losing the required verification session
- Atomic completed-goal review activation, so the cloud cannot reopen a learning goal without also preserving the evidence-based retrieval session that caused it
- Playwright now verifies both fundamental paths: teaching a genuinely new topic before testing it, and repairing a confident misconception before delayed verification
- Playwright also verifies that all five primary destinations and both creation paths remain reachable on desktop and mobile
- Playwright verifies repeated stop-and-return behavior on desktop and mobile, including two interruptions inside the same unfinished session
- Preview mode now has a safe service boundary for Ask YOVA, so the product shell does not crash merely because Supabase is unavailable
- Both paths run at desktop and Pixel-sized mobile viewports; the adaptive path also reloads the app to prove that the adjusted learning state persists
- GitHub Actions now runs unit tests, lint, the production build, and the complete browser journey on every push to `main` and every pull request
- Failed browser checks preserve screenshots, video, and traces for diagnosis instead of relying on a tester to describe what happened
- Privacy-safe product analytics
- Privacy-safe production error reports with a documented founder triage workflow
- Private support-request workflow with validation, ownership rules, and spam limits
- Material-quality checks that reject unreadable sources and warn when coverage is short or truncated
- Source-grounding validation rejects invented filenames, unverifiable quotations, and unnecessary AI supplementation before a session reaches the learner
- Five-case plan-quality evaluation covering biology, math, writing, coding, and general learning
- First live OpenAI plan suite passed: five student and general-learning paths scored 100/100 against the required rubric
- Guided-session quality evaluation checks active effort, feedback, task fit, source grounding, weak-concept priority, and personalization restraint
- The five-case live session suite now also verifies method fidelity; biology, calculus, outside-app writing, beginner coding, and general finance each passed the stricter contracts at 100/100
- First live OpenAI guided-session suite passed across biology, calculus, outside-app writing, beginner coding, and general finance
- The first live OpenAI answer-judgment suite matched all seven human labels, including accepting equivalent wording while rejecting keyword-rich misconceptions and withholding judgment when the activity itself lacked enough context
- A live source-grounded biology generation passed the stricter completion contract at 100/100, with all three essential ideas attached to required checks before the session could count as complete
- The session evaluator exposed and verified a repair to cross-session concept naming before the suite passed
- Private-alpha Privacy, Terms, Support, and clear AI/source limitation pages
- Production build, security headers, error screens, and social metadata

## What remains

### Required before inviting outside testers

1. Complete a same-browser production authentication return test and then run the full plan-and-session journey.
2. Configure reliable authentication email delivery through a custom SMTP provider.
3. Run complete journeys on mobile and desktop with several real accounts.
4. Manually review representative generated plans for wording, factual usefulness, and educational judgment; all five paths now pass the automated rubric.
5. Manually review representative session explanations, distractors, feedback, tone, and factual usefulness; all five paths now pass the automated rubric.
6. Manually verify source handling with complete notes, a rough study guide, scanned files, and oversized real files—including whether supplementation is accurate and appropriately limited.
7. Practice the founder error and support-review workflow with real alpha failures.

### Required before a broad public beta

1. External review of the private-alpha privacy and terms drafts before broad distribution.
2. Accessibility and mobile interaction audit.
3. Complete human review of representative plan and guided-session outputs.
4. Cost and latency measurements from real usage.
5. External error alerts and a dedicated founder/admin workflow as tester volume grows.
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
- practice the new founder error-review workflow with a controlled failure

### Following 3–5 days: trustworthy private alpha

- complete mobile/desktop journeys
- subject and material quality tests
- fix the highest-impact failures
- add concise tester instructions and external alerts if the invite group grows

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
