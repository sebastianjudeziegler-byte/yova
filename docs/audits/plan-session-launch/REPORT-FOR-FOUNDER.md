# What this work changes

Status: implemented candidate with passing local checks; full CI and live review pending. Not deployed.

The long-session problem needs both halves: Brief 2 must plan enough worthwhile work, and the session must actually deliver that work. The new queue carries question counts, reading/production work and an honest estimate into the session. Study Now uses the same workload estimator. A clean first round can still finish; missed points get targeted retries. This does not force learners to wait out a timer.

The visual map stays deliberately small. Learners name concepts, choose which concepts a relationship connects, and edit the relationship. A deterministic diagram updates alongside accessible controls. Renaming keeps links connected. Drafts, corrections and feedback survive exit/reload. Submitting a correction performs a real recheck.

Personalization remains central. Saved profile answers affect workload, support, methods, question mix, scheduling and what the learner sees first. A regression that had lost priority for a learner's stated difficult topic was caught and corrected. Visible reasons must describe what actually happened.

Saving now keeps one pending completion on the device and reconciles an uncertain server reply. This makes recovery testable; it does not establish why the earlier production RPC timed out. CI includes an actual database commit whose reply arrives after the browser deadline.

The integrated local suite passed 4,453 tests. The recorded map recovery journey passed too, and I checked that the video plays. It uses controlled responses to test recovery; live generated questions and feedback still need review through CI.

One limit remains explicit: a factual block can run out of legitimate planned work before a long allowance—for example, a 33-minute estimate within 60 minutes. It shows the shorter estimate and can offer the next eligible learning block. It does not yet combine another topic into the same ordinary block. That part of Brief 2 is deferred to keep this release bounded and reliable.

Before calling this launch-ready, review the full CI/database results and the actual generated questions. Browser recordings can reduce the time spent checking flows, but they cannot establish whether real learners find the app engaging or learn from it. Undo remains deferred, as requested. Existing plans remain usable; the new model applies to newly generated plans.
