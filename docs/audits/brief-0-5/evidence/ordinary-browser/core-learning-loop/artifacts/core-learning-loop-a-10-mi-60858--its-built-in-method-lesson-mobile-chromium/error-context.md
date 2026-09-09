# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> a 10-minute outside teaching-first session loads its built-in method lesson
- Location: e2e/core-learning-loop.spec.ts:1062:5

# Error details

```
Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - button "Open Next.js Dev Tools" [ref=f1e7] [cursor=pointer]
  - alert [ref=f1e11]
  - main [ref=f1e12]:
    - generic [ref=f1e13]:
      - generic [ref=f1e16]:
        - generic [ref=f1e17]: Understand How the Krebs Cycle Actually Produces NADH and FADH2 · Session 1 of 2
        - strong [ref=f1e18]: Learn I want to understand how the Krebs cycle actually... · Part 1 of 2
      - generic [ref=f1e19]:
        - button "Change direction" [ref=f1e20] [cursor=pointer]
        - button "Exit" [ref=f1e23] [cursor=pointer]
    - generic [ref=f1e24]:
      - complementary [ref=f1e25]:
        - text: · current step only
        - group [ref=f1e26]:
          - generic "Feynman Technique Teaching first · Step 1 of 3 · 3 learning phases" [ref=f1e27] [cursor=pointer]:
            - generic [ref=f1e28]:
              - strong [ref=f1e29]: Feynman Technique
              - generic [ref=f1e30]: Teaching first · Step 1 of 3 · 3 learning phases
          - text: · current step only
      - generic [ref=f1e33]:
        - generic [ref=f1e34]: "Live generation did not produce a guided session that passed YOVA's learning checks. A safe built-in session was loaded instead. Reference: b35ec063-e092-49ed-8066-18290fbeef31."
        - region "How YOVA adapted this session" [ref=f1e38]:
          - generic [ref=f1e42]:
            - strong [ref=f1e43]: The method comes from the task. This delivery change comes from your context.
            - paragraph [ref=f1e44]: You asked for concrete examples before rules, so YOVA will make the first explanation example-led.
        - region "Study-method workpad" [ref=f1e45]:
          - region "How to study this" [ref=f1e46]:
            - generic [ref=f1e47]:
              - paragraph [ref=f1e48]: HOW TO STUDY THIS
              - generic [ref=f1e49]:
                - heading "Feynman Technique" [level=2] [ref=f1e50]
                - generic [ref=f1e51]: Teaching first
              - paragraph [ref=f1e52]: Explain an idea in plain language, compare it with an accurate source, repair the gaps, and explain it again.
            - generic [ref=f1e53]:
              - region [ref=f1e54]:
                - paragraph [ref=f1e55]: TODAY'S TARGET
                - heading "Open your chosen source and work through I want to understand how the Krebs cycle actually.... Close the source, then return to YOVA and show what you produced or understood. Complete only this bounded part; the remaining content stays in the later parts." [level=3] [ref=f1e56]
                - generic [ref=f1e57]:
                  - heading "What this covers" [level=4] [ref=f1e58]
                  - list [ref=f1e59]:
                    - listitem [ref=f1e60]: Open your chosen source and work through I want to understand how the Krebs cycle actually.... Close the source, then return to YOVA and show what you produced or understood.
                - generic [ref=f1e61]:
                  - heading "Finished means" [level=4] [ref=f1e62]
                  - paragraph [ref=f1e63]: Explain or apply each mapped topic after the model is hidden
              - region [ref=f1e64]:
                - paragraph [ref=f1e65]: WHY THIS METHOD
                - heading "Why it works" [level=3] [ref=f1e66]
                - paragraph [ref=f1e67]: Feynman Technique fits this task and your starting point. It helps you build understanding before you try it yourself.
                - heading "Use it like this" [level=4] [ref=f1e68]
                - list [ref=f1e69]:
                  - listitem [ref=f1e70]:
                    - generic [ref=f1e71]: Study one concise explanation or example.
                  - listitem [ref=f1e72]:
                    - generic [ref=f1e73]: Close it and explain the idea in your own words.
                  - listitem [ref=f1e74]:
                    - generic [ref=f1e75]: Name the cause, relationship, or reason behind each important step.
                  - listitem [ref=f1e76]:
                    - generic [ref=f1e77]: Compare with the source, repair the explanation, then teach it back again without copying.
            - region [ref=f1e78]:
              - heading "Why this fits today" [level=3] [ref=f1e79]
              - list [ref=f1e80]:
                - listitem [ref=f1e81]: "You can continue with your chosen method: Feynman Technique."
                - listitem [ref=f1e82]: Your outside source remains the source of truth; YOVA provides the sequence and evidence check.
                - listitem [ref=f1e83]: You asked for concrete examples before rules, so YOVA will make the first explanation example-led.
          - generic [ref=f1e84]:
            - generic [ref=f1e90]:
              - paragraph [ref=f1e91]: METHOD WORKPAD
              - heading "Do the work, then check it against the saved target." [level=2] [ref=f1e92]
              - generic [ref=f1e93]: Your notes stay in this screen and are not saved or graded.
            - generic [ref=f1e94] [cursor=pointer]:
              - checkbox "I studied an explanation or complete example in my own source first. A teaching-first session needs an initial subject model before unsupported practice." [ref=f1e95]
              - generic [ref=f1e96]:
                - strong [ref=f1e97]: I studied an explanation or complete example in my own source first.
                - generic [ref=f1e98]: A teaching-first session needs an initial subject model before unsupported practice.
            - generic [ref=f1e99]:
              - generic [ref=f1e100]: Your workpad
              - textbox "Your workpad" [ref=f1e101]:
                - /placeholder: Work through the method here. Capture your recall, explanation, outline, calculation, or application before checking it.
            - group "Check each covered topic" [ref=f1e102]:
              - paragraph [ref=f1e104]:
                - text: "Compare your work with this completion criterion:"
                - strong [ref=f1e105]: Explain or apply each mapped topic after the model is hidden
              - generic [ref=f1e107] [cursor=pointer]:
                - checkbox "Open your chosen source and work through I want to understand how the Krebs cycle actually.... Close the source, then return to YOVA and show what you produced or understood." [ref=f1e108]
                - generic [ref=f1e109]: Open your chosen source and work through I want to understand how the Krebs cycle actually.... Close the source, then return to YOVA and show what you produced or understood.
            - paragraph [ref=f1e113]:
              - strong [ref=f1e114]: This completes practice, not a knowledge check.
              - text: The session will count as done, but no topic will become taught, evidenced, or secure until YOVA verifies it later.
            - button "Finish as ungraded practice" [disabled] [ref=f1e115]
        - region "Method phase 1 of 3" [ref=f1e118]:
          - generic [ref=f1e119]:
            - generic [ref=f1e120]: METHOD PHASE 1 OF 3
            - strong [ref=f1e121]: See a complete model
            - paragraph [ref=f1e122]: Study the explanation or worked example and notice why each important part is there.
          - emphasis [ref=f1e123]: Full support
        - generic [ref=f1e124]:
          - generic [ref=f1e125]:
            - generic [ref=f1e126]:
              - generic [ref=f1e127]: STEP 1 OF 3
              - strong [ref=f1e128]: METHOD COACHING
            - generic [ref=f1e129]: About 3 min
          - heading "How to use Feynman Technique" [level=1] [ref=f1e133]
          - paragraph [ref=f1e135]: Learn the short method sequence first. It will keep your work on I want to understand how the Krebs cycle actually produces NADH and FADH2 focused when you move to your own source.
        - region "Guided teaching sequence" [ref=f1e136]:
          - generic [ref=f1e137]:
            - generic [ref=f1e138]:
              - generic [ref=f1e139]: GUIDED EXPLANATION
              - strong [ref=f1e140]: Part 1 of 3
            - list [ref=f1e141]:
              - listitem [ref=f1e142]:
                - generic [ref=f1e143]: "1"
                - text: Worked example
              - listitem [ref=f1e144]:
                - generic [ref=f1e145]: "2"
                - text: Core idea
              - listitem [ref=f1e146]:
                - generic [ref=f1e147]: "3"
                - text: Explore the model
          - generic [ref=f1e148]:
            - text: WORKED EXAMPLE
            - 'heading "Use one bounded source section to work toward this objective: Open your chosen source and work through I want to understand how the Krebs cycle actually.... Close the source, then." [level=3] [ref=f1e149]'
            - list [ref=f1e150]:
              - listitem [ref=f1e151]:
                - paragraph [ref=f1e153]: Turn the objective into one question or result you can produce.
              - listitem [ref=f1e154]:
                - paragraph [ref=f1e156]: Use the source, then write the answer or worked result in your own words.
              - listitem [ref=f1e157]:
                - paragraph [ref=f1e159]: Mark the first uncertain idea or step before returning to YOVA.
            - generic [ref=f1e160]:
              - strong [ref=f1e161]: "What this shows:"
              - generic [ref=f1e162]: Bring back your own attempt plus one specific gap, not a copied page of notes.
        - 'button "Next: Core idea" [ref=f1e164] [cursor=pointer]'
    - complementary [ref=f1e167]:
      - button "Ask YOVA" [ref=f1e168] [cursor=pointer]
```