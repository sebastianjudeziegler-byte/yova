# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> adjusting ordinary future work preserves the exact scheduled review contract
- Location: e2e/core-learning-loop.spec.ts:2885:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.reload: Test timeout of 30000ms exceeded.
Call log:
  - waiting for navigation until "load"
    - navigated to "http://127.0.0.1:3100/?qa=preview"

```

# Test source

```ts
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
  2903 |       studyMode: "inside_yova",
  2904 |       learningIntent: "study",
  2905 |       creationIntent: "plan",
  2906 |       sessionArchitectureVersion: "filled_teaching_v1",
  2907 |       rationale: "Keep the delayed evidence check exact while resizing later content practice.",
  2908 |       createdAt: "2026-08-20T12:00:00.000Z",
  2909 |       materials: [],
  2910 |       sessions: [{
  2911 |         id: "66000000-0000-4000-8000-000000000011",
  2912 |         sequence: 1,
  2913 |         title: "Verify the mantle-convection relationship",
  2914 |         objective: "Verify the relationship after a delay without reopening the earlier lesson.",
  2915 |         method: "Three-item closed-note review",
  2916 |         methodReason: "A delayed closed-note check tests whether the repaired relationship now holds.",
  2917 |         scheduledFor: "2030-06-03T15:00:00.000Z",
  2918 |         estimatedMinutes: 5,
  2919 |         amountLabel: "3 quick questions · about 5 min",
  2920 |         learningMode: "study",
  2921 |         topicIds: [topicId],
  2922 |         contentTargets: ["Mantle convection and plate motion"],
  2923 |         completionEvidence: ["Answer exactly 3 closed-note questions about the relationship"],
  2924 |         status: "ready",
  2925 |         reviewConcept: "Mantle convection and plate motion",
  2926 |         reviewType: "verify",
  2927 |       }, {
  2928 |         id: "66000000-0000-4000-8000-000000000012",
  2929 |         sequence: 2,
  2930 |         title: "Apply evidence at contrasting plate boundaries",
  2931 |         objective: "Compare geological evidence from two contrasting plate-boundary settings.",
  2932 |         method: "Case comparison",
  2933 |         methodReason: "Contrasting cases make the transferable evidence rules explicit.",
  2934 |         scheduledFor: "2030-06-04T15:00:00.000Z",
  2935 |         estimatedMinutes: 25,
  2936 |         amountLabel: "Two boundary cases + evidence check · about 25 min",
  2937 |         learningMode: "study",
  2938 |         topicIds: [topicId],
  2939 |         contentTargets: ["Evidence at convergent boundaries", "Evidence at divergent boundaries"],
  2940 |         completionEvidence: ["Compare the evidence and explain what each case supports"],
  2941 |         status: "upcoming",
  2942 |       }],
  2943 |     }];
  2944 |     snapshot.updatedAt = new Date().toISOString();
  2945 |     window.localStorage.setItem("yova.preview.v1", JSON.stringify(snapshot));
  2946 |   });
  2947 | 
> 2948 |   await page.reload();
       |              ^ Error: page.reload: Test timeout of 30000ms exceeded.
  2949 |   await page.getByRole("button", { name: "Learning", exact: true }).click();
  2950 |   const planCard = page.locator(".learning-goal-card").filter({ hasText: "Plate Boundary Evidence Plan" });
  2951 |   await planCard.getByRole("button", { name: "Open goal" }).click();
  2952 |   await page.getByRole("button", { name: "Adjust", exact: true }).click();
  2953 | 
  2954 |   const adjustmentPanel = page.locator(".plan-adjustment-panel");
  2955 |   const futureWindow = adjustmentPanel.getByRole("combobox", { name: "Future session window" });
  2956 |   // The first runnable row is a five-minute scheduled review. The adjustment
  2957 |   // control must take its default from ordinary content, not that review.
  2958 |   await expect(futureWindow).toHaveValue("25");
  2959 |   await expect(adjustmentPanel).toContainText(
  2960 |     "1 scheduled review keeps the original duration, concept, and return time.",
  2961 |   );
  2962 |   await futureWindow.selectOption("15");
  2963 |   await adjustmentPanel.getByRole("button", { name: "Approve and rebuild plan" }).click();
  2964 | 
  2965 |   await expect(adjustmentPanel).toHaveCount(0);
  2966 |   await expect.poll(() => page.evaluate(() => {
  2967 |     const stored = window.localStorage.getItem("yova.preview.v1");
  2968 |     if (!stored) return null;
  2969 |     const snapshot = JSON.parse(stored) as {
  2970 |       plans?: Array<{
  2971 |         title?: string;
  2972 |         sessions?: Array<Record<string, unknown>>;
  2973 |       }>;
  2974 |     };
  2975 |     const sessions = snapshot.plans?.find((plan) => plan.title === "Plate Boundary Evidence Plan")?.sessions ?? [];
  2976 |     const review = sessions.find((session) => session.id === "66000000-0000-4000-8000-000000000011");
  2977 |     const ordinary = sessions.filter((session) => session.id !== "66000000-0000-4000-8000-000000000011");
  2978 |     return review ? {
  2979 |       review: {
  2980 |         id: review.id,
  2981 |         sequence: review.sequence,
  2982 |         title: review.title,
  2983 |         objective: review.objective,
  2984 |         method: review.method,
  2985 |         methodReason: review.methodReason,
  2986 |         scheduledFor: review.scheduledFor,
  2987 |         estimatedMinutes: review.estimatedMinutes,
  2988 |         amountLabel: review.amountLabel,
  2989 |         learningMode: review.learningMode,
  2990 |         topicIds: review.topicIds,
  2991 |         contentTargets: review.contentTargets,
  2992 |         completionEvidence: review.completionEvidence,
  2993 |         status: review.status,
  2994 |         reviewConcept: review.reviewConcept,
  2995 |         reviewType: review.reviewType,
  2996 |       },
  2997 |       ordinary: ordinary.map((session) => ({
  2998 |         sequence: session.sequence,
  2999 |         estimatedMinutes: session.estimatedMinutes,
  3000 |         status: session.status,
  3001 |         originSessionId: session.originSessionId,
  3002 |       })),
  3003 |     } : null;
  3004 |   })).toEqual({
  3005 |     review: {
  3006 |       id: "66000000-0000-4000-8000-000000000011",
  3007 |       sequence: 1,
  3008 |       title: "Verify the mantle-convection relationship",
  3009 |       objective: "Verify the relationship after a delay without reopening the earlier lesson.",
  3010 |       method: "Three-item closed-note review",
  3011 |       methodReason: "A delayed closed-note check tests whether the repaired relationship now holds.",
  3012 |       scheduledFor: "2030-06-03T15:00:00.000Z",
  3013 |       estimatedMinutes: 5,
  3014 |       amountLabel: "3 quick questions · about 5 min",
  3015 |       learningMode: "study",
  3016 |       topicIds: ["66000000-0000-4000-8000-000000000003"],
  3017 |       contentTargets: ["Mantle convection and plate motion"],
  3018 |       completionEvidence: ["Answer exactly 3 closed-note questions about the relationship"],
  3019 |       status: "ready",
  3020 |       reviewConcept: "Mantle convection and plate motion",
  3021 |       reviewType: "verify",
  3022 |     },
  3023 |     ordinary: [{
  3024 |       sequence: 2,
  3025 |       estimatedMinutes: 15,
  3026 |       status: "upcoming",
  3027 |       originSessionId: "66000000-0000-4000-8000-000000000012",
  3028 |     }, {
  3029 |       sequence: 3,
  3030 |       estimatedMinutes: 15,
  3031 |       status: "upcoming",
  3032 |       originSessionId: "66000000-0000-4000-8000-000000000012",
  3033 |     }],
  3034 |   });
  3035 | 
  3036 |   const timeline = page.locator(".plan-timeline");
  3037 |   await expect(timeline).toContainText("Verify the mantle-convection relationship");
  3038 |   await expect(timeline.locator(".timeline-row").filter({ hasText: "Verify the mantle-convection relationship" }))
  3039 |     .toContainText("5 min");
  3040 |   await expect(timeline.locator(".timeline-row").filter({ hasText: "Apply evidence at contrasting plate boundaries" }))
  3041 |     .toHaveCount(2);
  3042 | });
  3043 | 
  3044 | test("scheduled-review setup stays fixed and opens the exact active or Study Now goal", async ({ page }) => {
  3045 |   const generationRequests: Array<Record<string, unknown>> = [];
  3046 |   await page.route("**/api/sessions/allowance", async (route) => {
  3047 |     await route.fulfill({
  3048 |       status: 200,
```