# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> finishing a shortened guided lesson keeps every deferred target as exact next work
- Location: e2e/core-learning-loop.spec.ts:2734:5

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator: getByRole('button', { name: 'Start session', exact: true })
Expected: enabled
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeEnabled" with timeout 5000ms
  - waiting for getByRole('button', { name: 'Start session', exact: true })

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
  - text: WEDNESDAY, SEPTEMBER 9
  - heading "Good afternoon, Learner" [level=1]:
    - text: Good afternoon,
    - emphasis: Learner
  - region "Recommended learning plan":
    - text: UP NEXT · SAT 4:00 PM
    - heading "Retrieve cellular respiration stages" [level=2]
    - text: Practice Retrieval practice 20 minutes
    - paragraph:
      - strong: WHY THIS ·
      - text: Attempt the current relationship before reviewing and repairing it.
    - paragraph:
      - strong: "Personalized today:"
      - text: Example first · One step at a time · Hint first
      - button "Why?"
    - button "Checking allowance…" [disabled]
    - text: 0 of 1 sessions complete
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
  - button "Study now Quick, off-plan" [disabled]:
    - strong: Study now
    - text: Quick, off-plan
  - heading "YOVA noticed" [level=3]
  - text: from your recent sessions PERSONALIZATION
  - strong: Complete one guided session so YOVA can compare your profile with real work.
  - text: Onboarding creates a starting hypothesis. Answer accuracy, support use, completion, and feedback are what let YOVA adjust responsibly.
  - emphasis: No completed-session evidence yet
  - button "Checking allowance…" [disabled]
  - heading "Your week" [level=3]
  - text: Sep 9 – 13 WED · TODAY
  - strong: Open
  - text: nothing scheduled THU
  - strong: Open
  - text: nothing scheduled FRI
  - strong: Open
  - text: nothing scheduled SAT
  - strong: Open
  - text: nothing scheduled SUN
  - strong: Open
  - text: nothing scheduled
  - heading "Your learning" [level=3]
  - text: 1 active
  - button "Cellular Respiration Continuation Practice first · Sat 4:00 PM":
    - strong: Cellular Respiration Continuation
    - text: Practice first · Sat 4:00 PM
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
  2729 |   await expect(page.getByRole("heading", { name: "Here is how YOVA plans to start." })).toBeVisible();
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
> 2802 |   await expect(page.getByRole("button", { name: "Start session", exact: true })).toBeEnabled();
       |                                                                                  ^ Error: expect(locator).toBeEnabled() failed
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
  2830 |   await expect.poll(() => page.evaluate((sessionId) => {
  2831 |     const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1") ?? "{}");
  2832 |     return snapshot.sessionCompletions?.find((completion: { planSessionId: string }) => completion.planSessionId === sessionId);
  2833 |   }, planSessionId)).toMatchObject({ feedback: null });
  2834 | 
  2835 |   await expect.poll(() => page.evaluate((seededPlanId) => {
  2836 |     const stored = window.localStorage.getItem("yova.preview.v1");
  2837 |     if (!stored) return null;
  2838 |     const snapshot = JSON.parse(stored) as {
  2839 |       plans?: Array<{
  2840 |         id?: string;
  2841 |         status?: string;
  2842 |         sessions?: Array<{
  2843 |           id?: string;
  2844 |           sequence?: number;
  2845 |           status?: string;
  2846 |           scheduledFor?: string;
  2847 |           topicIds?: string[];
  2848 |           contentTargets?: string[];
  2849 |           completionEvidence?: string[];
  2850 |         }>;
  2851 |       }>;
  2852 |     };
  2853 |     const plan = snapshot.plans?.find((candidate) => candidate.id === seededPlanId);
  2854 |     return plan ? {
  2855 |       status: plan.status,
  2856 |       sessions: plan.sessions?.map((session) => ({
  2857 |         id: session.id,
  2858 |         sequence: session.sequence,
  2859 |         status: session.status,
  2860 |         scheduledFor: session.scheduledFor,
  2861 |         topicIds: session.topicIds,
  2862 |         contentTargets: session.contentTargets,
  2863 |         completionEvidence: session.completionEvidence,
  2864 |       })),
  2865 |     } : null;
  2866 |   }, planId)).toMatchObject({
  2867 |     status: "active",
  2868 |     sessions: [{
  2869 |       id: planSessionId,
  2870 |       sequence: 1,
  2871 |       status: "complete",
  2872 |       scheduledFor: "2030-06-01T15:00:00.000Z",
  2873 |     }, {
  2874 |       sequence: 2,
  2875 |       status: "ready",
  2876 |       topicIds,
  2877 |       contentTargets: [targets[1]],
  2878 |       completionEvidence: [
  2879 |         `Explain or apply this remaining saved target independently: ${targets[1]}`,
  2880 |       ],
  2881 |     }],
  2882 |   });
  2883 | });
  2884 | 
  2885 | test("adjusting ordinary future work preserves the exact scheduled review contract", async ({ page }) => {
  2886 |   await createPreviewAccount(page);
  2887 |   await completeOnboarding(page);
  2888 | 
  2889 |   await page.evaluate(() => {
  2890 |     const stored = window.localStorage.getItem("yova.preview.v1");
  2891 |     if (!stored) throw new Error("Expected a preview snapshot after onboarding.");
  2892 |     const snapshot = JSON.parse(stored) as Record<string, unknown> & { plans: unknown[] };
  2893 |     const topicId = "66000000-0000-4000-8000-000000000003";
  2894 |     snapshot.plans = [{
  2895 |       id: "66000000-0000-4000-8000-000000000001",
  2896 |       learningItemId: "66000000-0000-4000-8000-000000000002",
  2897 |       title: "Plate Boundary Evidence Plan",
  2898 |       topic: "Use geological evidence to explain plate-boundary motion",
  2899 |       kind: "topic",
  2900 |       deadline: null,
  2901 |       status: "active",
  2902 |       sourceMode: "yova_generated",
```