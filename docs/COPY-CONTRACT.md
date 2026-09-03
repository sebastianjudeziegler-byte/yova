# Copy contract: model prose vs. UI labels

**The rule:** learner goals and model output are *sentences*. UI labels are
*noun phrases*. Never interpolate raw goal/objective/topic prose into the
middle of a template sentence ("Preparing the next part of {topic}") — it
produces broken English whenever the stored text is a sentence or fragment,
which is most of the time.

**How to comply:**
1. Any surface showing a topic, goal, or objective near template copy calls
   `topicDisplayLabel()` from `src/lib/learning/topic-display-label.ts` first.
2. Templates compose by *juxtaposition* (heading + label on its own line, or
   "Heading: {label}"), never by grammatical embedding, unless the slot is a
   validated noun-phrase field.
3. New generated titles (plans, sessions, milestones) should be produced as a
   dedicated structured field with a noun-phrase instruction and validated at
   creation time — display-time cleaning is the safety net, not the plan.

This contract exists because on 2026-09-03 the session-preparation screen
shipped "Preparing the next part of in opposite directions in the two
hemispheres, so I can explain the mechanism in plain language." — a raw goal
fragment embedded mid-sentence. `yova-prototype-copy.test.ts` and
`topic-display-label.test.ts` guard the fix.
