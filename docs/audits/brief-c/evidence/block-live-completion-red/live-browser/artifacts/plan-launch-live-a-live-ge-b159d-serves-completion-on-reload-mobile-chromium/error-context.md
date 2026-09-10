# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plan-launch-live.spec.ts >> a live-generated deadline lesson streams, finishes unrated and preserves completion on reload
- Location: e2e/plan-launch-live.spec.ts:9:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "complete"
Received: "ready"
```

# Page snapshot

```yaml
- generic [active] [ref=f2e1]:
  - generic [ref=f2e2]:
    - link "Skip to main content" [ref=f2e3] [cursor=pointer]:
      - /url: "#main-content"
    - banner [ref=f2e4]:
      - generic [ref=f2e5]: "Y"
      - navigation "Main navigation" [ref=f2e7]:
        - button "Home" [ref=f2e8] [cursor=pointer]
        - button "Learning" [ref=f2e10] [cursor=pointer]
        - button "Calendar" [ref=f2e12] [cursor=pointer]
        - button "Ask YOVA" [ref=f2e14] [cursor=pointer]
        - button "You" [ref=f2e16] [cursor=pointer]
      - generic [ref=f2e18]:
        - button "Add to YOVA" [ref=f2e19] [cursor=pointer]:
          - generic [ref=f2e21]: Add
        - generic [ref=f2e22]:
          - generic "Learner · Private alpha" [ref=f2e23]: L
          - button "Sign out on this device" [ref=f2e24] [cursor=pointer]
    - main [ref=f2e28]:
      - generic [ref=f2e29]:
        - generic [ref=f2e30]:
          - generic [ref=f2e31]: MONDAY, SEPTEMBER 7
          - heading [level=1] [ref=f2e32]:
            - text: Good afternoon,
            - emphasis [ref=f2e33]: Learner
        - generic [ref=f2e34]:
          - region "Recommended learning plan" [ref=f2e35]:
            - generic [ref=f2e36]:
              - generic [ref=f2e37]: CONTINUE · READY TO FINISH
              - heading "Build ATP and energy transfer" [level=2] [ref=f2e38]
              - generic [ref=f2e39]:
                - generic [ref=f2e40]: Learn
                - generic [ref=f2e41]: Feynman Technique
                - generic [ref=f2e42]: 10 minutes
              - paragraph [ref=f2e43]:
                - strong [ref=f2e44]: WHY THIS ·
                - text: You asked for an example first; Feynman Technique lets you explain the connections for ATP and energy transfer to build understanding in session 1.
              - paragraph [ref=f2e45]:
                - generic [ref=f2e49]:
                  - strong [ref=f2e50]: "Personalized today:"
                  - text: Example first · One step at a time · Hint first
                - button "Why?" [ref=f2e51] [cursor=pointer]
            - generic [ref=f2e52]:
              - button "Review and finish" [ref=f2e53] [cursor=pointer]
              - generic [ref=f2e54]: 0 of 1 sessions complete
          - generic [ref=f2e55]:
            - generic [ref=f2e56]:
              - heading "Today" [level=3] [ref=f2e57]
              - button "Calendar →" [ref=f2e58] [cursor=pointer]
            - generic [ref=f2e59]:
              - generic [ref=f2e60]: PM
              - generic [ref=f2e61]:
                - strong [ref=f2e62]: Build ATP and energy transfer
                - generic [ref=f2e63]: 1 topic + 1 practice check + about 10 min · up next
            - generic [ref=f2e64]:
              - generic [ref=f2e65]:
                - strong [ref=f2e66]: "0"
                - generic [ref=f2e67]: sessions completed
              - generic [ref=f2e68]:
                - strong [ref=f2e69]: "1"
                - generic [ref=f2e70]: active plan
        - generic [ref=f2e71]:
          - generic [ref=f2e72]:
            - textbox "Ask YOVA" [ref=f2e73]:
              - /placeholder: Ask YOVA about anything you're studying…
            - button "Send" [disabled] [ref=f2e74]:
              - generic [ref=f2e75]: Ask
          - button "Add plan Notes, syllabus, link" [ref=f2e76] [cursor=pointer]:
            - generic [ref=f2e77]: +
            - generic [ref=f2e78]:
              - strong [ref=f2e79]: Add plan
              - generic [ref=f2e80]: Notes, syllabus, link
            - generic [ref=f2e81]: ›
          - button "Study now Quick, off-plan" [ref=f2e82] [cursor=pointer]:
            - generic [ref=f2e83]: →
            - generic [ref=f2e84]:
              - strong [ref=f2e85]: Study now
              - generic [ref=f2e86]: Quick, off-plan
            - generic [ref=f2e87]: ›
        - generic [ref=f2e88]:
          - heading "YOVA noticed" [level=3] [ref=f2e89]
          - generic [ref=f2e90]: from your recent sessions
        - generic [ref=f2e92]:
          - generic [ref=f2e93]:
            - generic [ref=f2e94]: "Y"
            - generic [ref=f2e95]: PERSONALIZATION
          - generic [ref=f2e96]:
            - strong [ref=f2e97]: Complete one guided session so YOVA can compare your profile with real work.
            - text: Onboarding creates a starting hypothesis. Answer accuracy, support use, completion, and feedback are what let YOVA adjust responsibly.
            - emphasis [ref=f2e98]: No completed-session evidence yet
          - button "Start the recommended session" [ref=f2e100] [cursor=pointer]
        - generic [ref=f2e101]:
          - heading "Your week" [level=3] [ref=f2e102]
          - generic [ref=f2e103]: Sep 7 – 11
        - generic [ref=f2e104]:
          - generic [ref=f2e105]:
            - generic [ref=f2e106]: MON · TODAY
            - strong [ref=f2e107]: Build ATP and energy transfer
            - generic [ref=f2e108]: 10 min · 1 session
          - generic [ref=f2e109]:
            - generic [ref=f2e110]: TUE
            - strong [ref=f2e111]: Open
            - generic [ref=f2e112]: nothing scheduled
          - generic [ref=f2e113]:
            - generic [ref=f2e114]: WED
            - strong [ref=f2e115]: Open
            - generic [ref=f2e116]: nothing scheduled
          - generic [ref=f2e117]:
            - generic [ref=f2e118]: THU
            - strong [ref=f2e119]: Open
            - generic [ref=f2e120]: nothing scheduled
          - generic [ref=f2e121]:
            - generic [ref=f2e122]: FRI
            - strong [ref=f2e123]: Open
            - generic [ref=f2e124]: nothing scheduled
        - generic [ref=f2e125]:
          - heading "Pick up where you left off" [level=3] [ref=f2e126]
          - generic [ref=f2e127]: 1 open thread
        - generic [ref=f2e129]:
          - generic [ref=f2e130]: TEACH ME CELLULAR RESPIRATION FROM SCRATCH FOR MY TEST, INCLUDING ATP…
          - strong [ref=f2e131]: Build ATP and energy transfer
          - generic [ref=f2e132]: 4 of 4 sections saved
          - generic [ref=f2e133]: 100%
          - button "Resume" [ref=f2e137] [cursor=pointer]
        - generic [ref=f2e138]:
          - heading "Where you stand" [level=3] [ref=f2e139]
          - generic [ref=f2e140]: updates after every session
        - 'button "Teach Me Cellular Respiration From Scratch for My Test, Including ATP… 0% 0 of 1 topics secure · next: atp and energy transfer" [ref=f2e142] [cursor=pointer]':
          - generic [ref=f2e143]:
            - strong [ref=f2e144]: Teach Me Cellular Respiration From Scratch for My Test, Including ATP…
            - generic [ref=f2e145]: 0%
          - generic [ref=f2e146]: "0 of 1 topics secure · next: atp and energy transfer"
        - generic [ref=f2e147]:
          - heading "Your learning" [level=3] [ref=f2e148]
          - generic [ref=f2e149]: 1 active
        - button "Teach Me Cellular Respiration From Scratch for My Test, Including ATP… Continue at section 4" [ref=f2e151] [cursor=pointer]:
          - generic [ref=f2e165]:
            - strong [ref=f2e166]: Teach Me Cellular Respiration From Scratch for My Test, Including ATP…
            - generic [ref=f2e167]: Continue at section 4
    - contentinfo [ref=f2e170]:
      - navigation "Trust and support" [ref=f2e171]:
        - link "Support" [ref=f2e172] [cursor=pointer]:
          - /url: /support
        - link "Privacy" [ref=f2e173] [cursor=pointer]:
          - /url: /privacy
        - link "Terms" [ref=f2e174] [cursor=pointer]:
          - /url: /terms
  - button "Open Next.js Dev Tools" [ref=f2e180] [cursor=pointer]
  - alert [ref=f2e184]
```

# Test source

```ts
  15  |     const path = new URL(response.url()).pathname;
  16  |     if(path.startsWith("/api/"))apiResults.push({path,status:response.status()});
  17  |   });
  18  |   await page.goto("/?qa=preview");
  19  |   await page.getByRole("button",{name:"Build my plan"}).click();
  20  |   await page.getByLabel("First name").fill("Learner");
  21  |   await page.getByLabel("Email address").fill("live-launch-local@example.com");
  22  |   await page.getByRole("button",{name:"Continue",exact:true}).click();
  23  |   await page.getByRole("button",{name:/Personalize YOVA/}).click();
  24  |   const answers = ["Show a short recommendation and alternatives","I delay a little, then get going","20 to 30 minutes","A concrete example before the rule","Recalling it without notes, then checking","I recognize it but cannot recall it","Give me a small hint","Show one step at a time","Clear checkpoints inside the block","No extra support right now","Afternoon"];
  25  |   for(const [index,answer] of answers.entries()){
  26  |     await page.getByRole("button",{name:answer,exact:true}).click();
  27  |     await page.getByRole("button",{name:index===answers.length-1?"Build my setup":"Continue",exact:true}).click();
  28  |   }
  29  |   await page.getByRole("button",{name:"Open YOVA"}).click();
  30  |   await page.evaluate(({plan,resource})=>{
  31  |     const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1")??"{}");
  32  |     snapshot.plans=[{...plan,sessions:plan.sessions.map((session:LearningPlan["sessions"][number],index:number)=>index===0?{...session,status:"ready",resource:resource.block ? undefined : resource}:session)}];
  33  |     localStorage.setItem("yova.preview.v1",JSON.stringify(snapshot));
  34  |   },fixture);
  35  |   await page.reload();
  36  |   await page.getByRole("button",{name:"Learning",exact:true}).click();
  37  |   await page.locator(".learning-goal-card").filter({hasText:fixture.plan.title}).getByRole("button",{name:"Start next"}).click();
  38  |   const early = page.getByRole("button",{name:"Start now, keep dates"});
  39  |   if(await early.isVisible())await early.click();
  40  |   await expect(page.locator(".session-setup-shell, .session-shell")).toBeVisible({timeout:30_000});
  41  |   if(await page.locator(".session-setup-shell").isVisible()){
  42  |     await page.getByRole("button",{name:"Continue",exact:true}).click();
  43  |     await page.getByRole("button",{name:"Continue",exact:true}).click();
  44  |     await page.getByRole("button",{name:"Prepare this session"}).click();
  45  |   }
  46  |   if (fixture.resource.block) {
  47  |     // Prepare through the real server so answer keys stay private. Seeding a
  48  |     // public V19 resource alone cannot create its trusted progress ledger.
  49  |     const block = page.getByRole("region", { name: "Session work block" });
  50  |     await expect(block).toBeVisible({ timeout: 100_000 });
  51  |     await expect(block.getByRole("button", { name: "Continue to practice", exact: true })).toBeVisible();
  52  |     await block.getByRole("button", { name: "Continue to practice", exact: true }).click();
  53  |     for (let index = 0; index < 12; index += 1) {
  54  |       const finish = block.getByRole("button", { name: "Finish block", exact: true });
  55  |       if (await finish.isEnabled()) break;
  56  |       const written = block.getByRole("textbox", { name: "Your answer", exact: true });
  57  |       if (await written.isVisible()) {
  58  |         await written.fill("ATP hydrolysis forms ADP and inorganic phosphate. Its favorable free-energy change can be coupled to cellular work; ATP regeneration requires energy.");
  59  |       } else {
  60  |         await block.locator('button[aria-pressed]').first().click();
  61  |       }
  62  |       await block.getByRole("button", { name: "Check answer", exact: true }).click();
  63  |       const advance = block.getByRole("button", { name: "Continue", exact: true });
  64  |       await expect(advance).toBeVisible({ timeout: 60_000 });
  65  |       await advance.click();
  66  |     }
  67  |     await block.getByRole("button", { name: "Finish block", exact: true }).click();
  68  |     await expect(block.getByRole("heading", { name: "Block finished", exact: true })).toBeVisible();
  69  |     await expect(block.getByRole("status")).toContainText(/demonstrated|check|practice/i);
  70  |   } else {
  71  |   for(let step=0;step<15;step+=1){
  72  |     if(await page.getByText("SESSION COMPLETE",{exact:true}).isVisible())break;
  73  |     const activityHeading = await page.locator(".session-activity-header h1").innerText({timeout:60_000});
  74  |     const currentResource = await page.evaluate(planId=>{
  75  |       const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1")??"{}");
  76  |       return snapshot.plans?.find((plan:LearningPlan)=>plan.id===planId)?.sessions[0]?.resource;
  77  |     },fixture.plan.id) as SessionResource | undefined;
  78  |     // A teaching block and its recall can share the same visible title.
  79  |     // Select the question's answer, not the preceding instruction's fallback.
  80  |     const current = (currentResource??fixture.resource).activities.find(activity=>activity.title===activityHeading && (activity.type==="free_response" || activity.type==="multiple_choice"));
  81  |     const confidence = page.getByRole("button",{name:"Somewhat sure",exact:true});
  82  |     if(await confidence.isVisible() && await confidence.isEnabled())await confidence.click();
  83  |     const written = page.locator(".recall-response textarea");
  84  |     if(await written.isVisible() && await written.isEnabled()){
  85  |       await written.fill(current?.correctAnswer??"ATP hydrolysis forms ADP and inorganic phosphate. This reaction releases free energy that can be coupled to cellular work.");
  86  |       await page.getByRole("button",{name:"Check my answer",exact:true}).click();
  87  |       const selfRating = page.getByRole("button",{name:"I got the key idea",exact:true});
  88  |       const noEvidence = page.getByText("YOVA did not record a correct or incorrect result from this check. Continue after comparing with the model answer.",{exact:true});
  89  |       // Since 1fe44f62 (Aug 31), uncertain/unavailable checks explicitly
  90  |       // continue without a learner rating or manufactured learning evidence.
  91  |       await expect(selfRating.or(noEvidence)).toBeVisible({timeout:60_000});
  92  |       if(await noEvidence.isVisible()){
  93  |         await expect(selfRating).toHaveCount(0);
  94  |         await expect(page.getByText("Your typed answer is not saved, and this uncertain or unavailable check created no concept or method evidence.",{exact:true})).toBeVisible();
  95  |       } else {
  96  |         await selfRating.click();
  97  |       }
  98  |     } else if(current?.correctAnswer && await page.locator(".answer-grid").isVisible()) {
  99  |       await page.locator(".answer-grid").getByRole("button",{name:current.correctAnswer,exact:true}).click();
  100 |     }
  101 |     const advance = page.locator(".session-action-bar").getByRole("button");
  102 |     await expect(advance).toBeEnabled({timeout:75_000});
  103 |     await advance.click();
  104 |   }
  105 |     await expect(page.getByText("SESSION COMPLETE",{exact:true})).toBeVisible();
  106 |   }
  107 |   await expect(page.locator(".completion-feedback .selected")).toHaveCount(0);
  108 |   await page.screenshot({path:test.info().outputPath("lesson-complete.png"),fullPage:true});
  109 |   await page.getByRole("button",{name:"Finish and continue",exact:true}).click();
  110 |   await page.reload();
  111 |   const saved = await page.evaluate(planId=>{
  112 |     const snapshot = JSON.parse(localStorage.getItem("yova.preview.v1")??"{}");
  113 |     return {plan:snapshot.plans?.find((plan:LearningPlan)=>plan.id===planId),completion:snapshot.sessionCompletions?.find((completion:{planId:string})=>completion.planId===planId)};
  114 |   },fixture.plan.id);
> 115 |   expect(saved.plan.sessions[0].status).toBe("complete");
      |                                         ^ Error: expect(received).toBe(expected) // Object.is equality
  116 |   expect(saved.completion.feedback).toBeNull();
  117 |   expect(saved.completion.totalAnswers).toBeGreaterThan(0);
  118 |   expect(apiResults.some(result=>(result.path.includes("/lesson") || result.path === "/api/sessions/block/explanation") && result.status===200)).toBe(true);
  119 |   writeFileSync(test.info().outputPath("completion.json"),JSON.stringify({apiResults,saved},null,2));
  120 | });
  121 | 
```