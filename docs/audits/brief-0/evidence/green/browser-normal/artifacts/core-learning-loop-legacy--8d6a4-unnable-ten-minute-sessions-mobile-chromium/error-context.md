# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> legacy split work reopens as an active plan with runnable ten-minute sessions
- Location: e2e/core-learning-loop.spec.ts:2613:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Here is how YOVA plans to start.' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: 'Here is how YOVA plans to start.' })

```

```yaml
- link "Skip to main content":
  - /url: "#main-content"
- banner:
  - navigation "Main navigation":
    - button "Home"
    - button "Learning"
    - button "Calendar"
    - button "Ask YOVA"
    - button "You"
  - button "Add to YOVA": Add
  - text: L
  - button "Sign out on this device"
- main:
  - text: TUESDAY, SEPTEMBER 8
  - heading "Good afternoon, Learner" [level=1]:
    - text: Good afternoon,
    - emphasis: Learner
  - region "Recommended learning plan":
    - text: UP NEXT · SAT 8:00 AM
    - heading "Explain mantle convection · Part 1 of 2" [level=2]
    - text: Practice Self-explanation 10 minutes
    - paragraph:
      - strong: WHY THIS ·
      - text: A causal explanation makes the plate-motion model visible.
    - paragraph:
      - strong: "Personalized today:"
      - text: Example first · One step at a time · Hint first
      - button "Why?"
    - button "Start session"
    - text: 0 of 2 sessions complete
  - heading "Today" [level=3]
  - button "Calendar →"
  - paragraph: Nothing else scheduled today.
  - strong: "0"
  - text: sessions completed
  - strong: "1"
  - text: active plan
  - textbox "Ask YOVA":
    - /placeholder: Ask YOVA about anything you're studying…
  - button "Send" [disabled]: Ask
  - button "Add plan Notes, syllabus, link":
    - strong: Add plan
    - text: Notes, syllabus, link
  - button "Study now Quick, off-plan":
    - strong: Study now
    - text: Quick, off-plan
  - heading "YOVA noticed" [level=3]
  - text: from your recent sessions PERSONALIZATION
  - strong: Complete one guided session so YOVA can compare your profile with real work.
  - text: Onboarding creates a starting hypothesis. Answer accuracy, support use, completion, and feedback are what let YOVA adjust responsibly.
  - emphasis: No completed-session evidence yet
  - button "Start the recommended session"
  - heading "Your week" [level=3]
  - text: Sep 8 – 12 TUE · TODAY
  - strong: Open
  - text: nothing scheduled WED
  - strong: Open
  - text: nothing scheduled THU
  - strong: Open
  - text: nothing scheduled FRI
  - strong: Open
  - text: nothing scheduled SAT
  - strong: Open
  - text: nothing scheduled
  - heading "Your learning" [level=3]
  - text: 1 active
  - button "Plate Tectonics and Mantle Convection Practice first · Sat 8:00 AM":
    - strong: Plate Tectonics and Mantle Convection
    - text: Practice first · Sat 8:00 AM
- contentinfo:
  - navigation "Trust and support":
    - link "Support":
      - /url: /support
    - link "Privacy":
      - /url: /privacy
    - link "Terms":
      - /url: /terms
- alert
```

# Test source

```ts
  2629 |       // Old split/start races could leave this lifecycle value behind even
  2630 |       // though both generated parts were still runnable.
  2631 |       status: "completed",
  2632 |       sourceMode: "yova_generated",
  2633 |       studyMode: "inside_yova",
  2634 |       learningIntent: "study",
  2635 |       creationIntent: "plan",
  2636 |       sessionArchitectureVersion: "filled_teaching_v1",
  2637 |       rationale: "Recover the unfinished explanation and application work without losing either part.",
  2638 |       createdAt: "2026-08-20T12:00:00.000Z",
  2639 |       materials: [],
  2640 |       sessions: [{
  2641 |         id: "65000000-0000-4000-8000-000000000011",
  2642 |         sequence: 1,
  2643 |         title: "Explain mantle convection · Part 1 of 2",
  2644 |         objective: "Explain how temperature and density differences drive mantle convection.",
  2645 |         method: "Self-explanation",
  2646 |         methodReason: "A causal explanation makes the plate-motion model visible.",
  2647 |         scheduledFor: "2030-06-01T15:00:00.000Z",
  2648 |         estimatedMinutes: 8,
  2649 |         amountLabel: "One focused target · about 8 min",
  2650 |         learningMode: "study",
  2651 |         topicIds: [topicId],
  2652 |         contentTargets: ["Temperature, density, and mantle circulation"],
  2653 |         completionEvidence: ["Explain the convection relationship in your own words"],
  2654 |         originSessionId: "65000000-0000-4000-8000-000000000010",
  2655 |         originalContentMinutes: 15,
  2656 |         segmentIndex: 1,
  2657 |         segmentCount: 2,
  2658 |         status: "ready",
  2659 |       }, {
  2660 |         id: "65000000-0000-4000-8000-000000000012",
  2661 |         sequence: 2,
  2662 |         title: "Explain mantle convection · Part 2 of 2",
  2663 |         objective: "Apply the convection model to divergent and convergent plate boundaries.",
  2664 |         method: "Scenario application",
  2665 |         methodReason: "A new boundary scenario checks whether the causal model transfers.",
  2666 |         scheduledFor: "2030-06-02T15:00:00.000Z",
  2667 |         estimatedMinutes: 7,
  2668 |         amountLabel: "One focused target · about 7 min",
  2669 |         learningMode: "study",
  2670 |         topicIds: [topicId],
  2671 |         contentTargets: ["Mantle convection and plate-boundary motion"],
  2672 |         completionEvidence: ["Apply the model to one unfamiliar plate-boundary scenario"],
  2673 |         originSessionId: "65000000-0000-4000-8000-000000000010",
  2674 |         originalContentMinutes: 15,
  2675 |         segmentIndex: 2,
  2676 |         segmentCount: 2,
  2677 |         status: "upcoming",
  2678 |       }],
  2679 |     }];
  2680 |     snapshot.updatedAt = new Date().toISOString();
  2681 |     window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  2682 |   });
  2683 |
  2684 |   await page.reload();
  2685 |   await page.getByRole("button", { name: "Learning", exact: true }).click();
  2686 |
  2687 |   const recoveredPlan = page.locator(".learning-goal-card").filter({
  2688 |     hasText: "Plate Tectonics and Mantle Convection",
  2689 |   });
  2690 |   await expect(recoveredPlan).toBeVisible();
  2691 |   await expect(recoveredPlan).toContainText("0 of 2 sessions complete");
  2692 |   await expect(recoveredPlan).toContainText("10 min");
  2693 |   await expect(recoveredPlan.getByRole("button", { name: "Start next" })).toBeVisible();
  2694 |   await expect(page.locator(".tabs").getByRole("button", { name: /Active/ })).toContainText("1");
  2695 |   await expect(page.locator(".tabs").getByRole("button", { name: /Recent/ })).toContainText("0");
  2696 |
  2697 |   await expect.poll(() => page.evaluate(() => {
  2698 |     const stored = window.localStorage.getItem("yova.preview.v1");
  2699 |     if (!stored) return null;
  2700 |     const snapshot = JSON.parse(stored) as {
  2701 |       plans?: Array<{
  2702 |         title?: string;
  2703 |         status?: string;
  2704 |         sessions?: Array<{ estimatedMinutes?: number; amountLabel?: string }>;
  2705 |       }>;
  2706 |     };
  2707 |     const plan = snapshot.plans?.find((candidate) => candidate.title === "Plate Tectonics and Mantle Convection");
  2708 |     return plan ? {
  2709 |       status: plan.status,
  2710 |       minutes: plan.sessions?.map((session) => session.estimatedMinutes),
  2711 |       labels: plan.sessions?.map((session) => session.amountLabel),
  2712 |     } : null;
  2713 |   })).toEqual({
  2714 |     status: "active",
  2715 |     minutes: [10, 10],
  2716 |     labels: [
  2717 |       "One focused target · about 10 min",
  2718 |       "One focused target · about 10 min",
  2719 |     ],
  2720 |   });
  2721 |
  2722 |   await recoveredPlan.getByRole("button", { name: "Start next" }).click();
  2723 |   const earlyStartDialog = page.getByRole("dialog", {
  2724 |     name: "Start Explain mantle convection · Part 1 of 2 now?",
  2725 |   });
  2726 |   if (await earlyStartDialog.isVisible()) {
  2727 |     await earlyStartDialog.getByRole("button", { name: "Start now, keep dates" }).click();
  2728 |   }
> 2729 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
       |                                                                                         ^ Error: expect(locator).toBeVisible() failed
  2730 |   await expect(page.locator(".session-current-assumption")).toContainText("about 10 minutes");
  2731 |   await expect(page.locator(".session-current-assumption")).not.toContainText("about 8 minutes");
  2732 | });
  2733 |
  2734 | test("finishing a shortened guided lesson keeps every deferred target as exact next work", async ({ page }) => {
  2735 |   test.setTimeout(60_000);
  2736 |   const planId = "67000000-0000-4000-8000-000000000001";
  2737 |   const planSessionId = "67000000-0000-4000-8000-000000000011";
  2738 |   const topicIds = [
  2739 |     "67000000-0000-4000-8000-000000000021",
  2740 |     "67000000-0000-4000-8000-000000000022",
  2741 |   ];
  2742 |   const targets = [
  2743 |     "Glycolysis inputs and outputs",
  2744 |     "Electron transport chain mechanism",
  2745 |   ];
  2746 |   const evidence = [
  2747 |     "Explain glycolysis inputs and outputs independently",
  2748 |     "Explain the electron transport chain mechanism independently",
  2749 |   ];
  2750 |   await page.route("**/api/sessions/generate", async (route) => {
  2751 |     await route.fulfill({
  2752 |       status: 200,
  2753 |       contentType: "application/json",
  2754 |       body: JSON.stringify(deferredGuidedSessionResponse(planSessionId, topicIds[0]!, targets, evidence)),
  2755 |     });
  2756 |   });
  2757 |   await createPreviewAccount(page);
  2758 |   await completeOnboarding(page);
  2759 |
  2760 |   await page.evaluate(({ planId: seededPlanId, planSessionId: seededSessionId, seededTopicIds, seededTargets, seededEvidence }) => {
  2761 |     const stored = window.localStorage.getItem("yova.preview.v1");
  2762 |     if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
  2763 |     const snapshot = JSON.parse(stored) as Record<string, unknown> & { plans: unknown[] };
  2764 |     snapshot.plans = [{
  2765 |       id: seededPlanId,
  2766 |       learningItemId: "67000000-0000-4000-8000-000000000002",
  2767 |       title: "Cellular Respiration Continuation",
  2768 |       topic: "Stages, locations, and outputs of cellular respiration",
  2769 |       kind: "topic",
  2770 |       deadline: "2030-06-02T18:00:00.000Z",
  2771 |       status: "active",
  2772 |       sourceMode: "yova_generated",
  2773 |       studyMode: "inside_yova",
  2774 |       learningIntent: "study",
  2775 |       creationIntent: "plan",
  2776 |       sessionArchitectureVersion: "filled_teaching_v1",
  2777 |       rationale: "Use a bounded retrieval attempt while preserving every later target.",
  2778 |       createdAt: "2026-08-21T12:00:00.000Z",
  2779 |       materials: [],
  2780 |       sessions: [{
  2781 |         id: seededSessionId,
  2782 |         sequence: 1,
  2783 |         title: "Retrieve cellular respiration stages",
  2784 |         objective: "Retrieve the stages, locations, and outputs of cellular respiration.",
  2785 |         method: "Retrieval practice",
  2786 |         methodReason: "Attempt the current relationship before reviewing and repairing it.",
  2787 |         scheduledFor: "2030-06-01T15:00:00.000Z",
  2788 |         estimatedMinutes: 20,
  2789 |         amountLabel: "Two focused targets · about 20 min",
  2790 |         learningMode: "study",
  2791 |         topicIds: seededTopicIds,
  2792 |         contentTargets: seededTargets,
  2793 |         completionEvidence: seededEvidence,
  2794 |         status: "ready",
  2795 |       }],
  2796 |     }];
  2797 |     snapshot.updatedAt = new Date().toISOString();
  2798 |     window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  2799 |   }, { planId, planSessionId, seededTopicIds: topicIds, seededTargets: targets, seededEvidence: evidence });
  2800 |
  2801 |   await page.reload();
  2802 |   await expect(page.getByRole("button", { name: "Start session", exact: true })).toBeEnabled();
  2803 |   await page.getByRole("button", { name: "Learning", exact: true }).click();
  2804 |   const planCard = page.locator(".learning-goal-card").filter({
  2805 |     hasText: "Cellular Respiration Continuation",
  2806 |   });
  2807 |   await planCard.getByRole("button", { name: "Start next" }).click();
  2808 |   const earlyStartDialog = page.getByRole("dialog", {
  2809 |     name: "Start Retrieve cellular respiration stages now?",
  2810 |   });
  2811 |   if (await earlyStartDialog.isVisible()) {
  2812 |     await earlyStartDialog.getByRole("button", { name: "Start now, keep dates" }).click();
  2813 |   }
  2814 |   await confirmSessionSetup(page);
  2815 |
  2816 |   await expect(page.getByRole("heading", { name: "Recall glycolysis" })).toBeVisible();
  2817 |   await page.getByRole("button", { name: "Somewhat sure" }).click();
  2818 |   await page.getByRole("button", { name: "Glucose becomes pyruvate in the cytosol" }).click();
  2819 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  2820 |   await expect(page.getByRole("heading", { name: "Repair the glycolysis model" })).toBeVisible();
  2821 |   await page.getByRole("button", { name: "Connect glucose conversion to pyruvate and ATP production" }).click();
  2822 |   await page.getByRole("button", { name: "Continue", exact: true }).click();
  2823 |   await expect(page.getByRole("heading", { name: "Name what should return" })).toBeVisible();
  2824 |   await page.getByRole("button", { name: "Finish this content" }).click();
  2825 |   await expect(page.getByText("SESSION COMPLETE", { exact: true })).toBeVisible();
  2826 |   await expect(page.locator(".completion-feedback .selected")).toHaveCount(0);
  2827 |   await expect(page.getByText("Challenge felt: About right.", { exact: true })).toHaveCount(0);
  2828 |   await page.getByRole("button", { name: "Finish and continue" }).click();
  2829 |
```
