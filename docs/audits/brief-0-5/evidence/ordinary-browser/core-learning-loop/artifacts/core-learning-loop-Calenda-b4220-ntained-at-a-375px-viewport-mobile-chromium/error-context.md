# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> Calendar Agenda stays first and contained at a 375px viewport
- Location: e2e/core-learning-loop.spec.ts:2188:5

# Error details

```
Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=f1e1]:
  - generic [ref=f1e2]:
    - link "Skip to main content" [ref=f1e3] [cursor=pointer]:
      - /url: "#main-content"
    - banner [ref=f1e4]:
      - generic [ref=f1e5]: "Y"
      - navigation "Main navigation" [ref=f1e7]:
        - button "Home" [ref=f1e8] [cursor=pointer]
        - button "Learning" [ref=f1e10] [cursor=pointer]
        - button "Calendar" [active] [ref=f1e12] [cursor=pointer]
        - button "Ask YOVA" [ref=f1e14] [cursor=pointer]
        - button "You" [ref=f1e16] [cursor=pointer]
      - generic [ref=f1e18]:
        - button "Add to YOVA" [ref=f1e19] [cursor=pointer]:
          - generic [ref=f1e21]: Add
        - generic [ref=f1e22]:
          - generic "Learner · Private alpha" [ref=f1e23]: L
          - button "Sign out on this device" [ref=f1e24] [cursor=pointer]
    - main [ref=f1e28]:
      - generic [ref=f1e29]:
        - generic [ref=f1e30]:
          - generic [ref=f1e31]:
            - text: CALENDAR
            - heading "Plan the work that gets you there" [level=1] [ref=f1e32]
            - paragraph [ref=f1e33]: 0 open blocks · 0 upcoming outcomes · manual changes stay under your control.
          - button "Add to YOVA" [ref=f1e34] [cursor=pointer]
        - generic [ref=f1e36]:
          - complementary "Calendar tools and today" [ref=f1e37]:
            - region [ref=f1e38]:
              - generic [ref=f1e39]:
                - generic [ref=f1e40]:
                  - text: QUICK ADD
                  - heading "Put something on your calendar" [level=2] [ref=f1e41]
                - generic [ref=f1e42]: ⌘K
              - generic [ref=f1e43]:
                - textbox "Quick add a calendar item" [ref=f1e44]:
                  - /placeholder: Communications class every Mon and Wed, 11:30–12
                - button "Parse quick add" [ref=f1e45] [cursor=pointer]
              - generic [ref=f1e48]: Describe the item in your own words. YOVA shows what it understood before saving. Manual items stay on this device; learning plans and deadlines keep their existing sync.
            - region [ref=f1e49]:
              - generic [ref=f1e50]:
                - generic [ref=f1e51]:
                  - text: YOUR DAY
                  - heading "Wednesday, Sep 9" [level=2] [ref=f1e52]
                - generic [ref=f1e53]: 0 open
              - paragraph [ref=f1e54]: Nothing is scheduled today. Add a fixed event or leave the space open.
            - generic [ref=f1e55]:
              - generic [ref=f1e56]: NEAREST DEADLINE
              - heading "No open outcome yet" [level=3] [ref=f1e57]
              - paragraph [ref=f1e58]: Add a due date when you want the calendar to connect work to a result.
            - group [ref=f1e59]:
              - generic "Adjust today’s available time Opt in, review the safe change, then approve it." [ref=f1e60] [cursor=pointer]:
                - generic [ref=f1e65]:
                  - strong [ref=f1e66]: Adjust today’s available time
                  - generic [ref=f1e67]: Opt in, review the safe change, then approve it.
            - region [ref=f1e70]:
              - generic [ref=f1e72]:
                - text: NEXT UP
                - heading "Your order of business" [level=3] [ref=f1e73]
                - paragraph [ref=f1e74]: What to do next, most urgent first.
              - paragraph [ref=f1e75]: Nothing waiting right now. Add a plan or a deadline and YOVA will queue the work here.
          - generic [ref=f1e76]:
            - region [ref=f1e77]:
              - generic [ref=f1e78]:
                - generic [ref=f1e79]:
                  - text: SCHEDULE
                  - heading "September 7 – September 13, 2026" [level=2] [ref=f1e80]
                - generic [ref=f1e81]:
                  - button "Agenda" [pressed] [ref=f1e82] [cursor=pointer]
                  - button "Week" [ref=f1e83] [cursor=pointer]
              - generic [ref=f1e84]:
                - button "Previous calendar period" [ref=f1e85] [cursor=pointer]
                - button "Today" [ref=f1e88] [cursor=pointer]
                - button "Next calendar period" [ref=f1e89] [cursor=pointer]
                - generic [ref=f1e92]:
                  - text: Jump to date
                  - textbox "Jump to date" [ref=f1e93]: 2026-09-09
              - generic "Agenda" [ref=f1e94]:
                - paragraph [ref=f1e95]: No work scheduled this week. Add a deadline or calendar item below.
            - region [ref=f1e96]:
              - paragraph [ref=f1e97]: Your week is on track.
            - region [ref=f1e100]:
              - generic [ref=f1e101]:
                - generic [ref=f1e102]:
                  - heading "Retrieval queue" [level=2] [ref=f1e103]
                  - paragraph [ref=f1e104]: Concepts return only when completed checks support another attempt.
                - generic [ref=f1e105]: 1 due
              - article [ref=f1e107]:
                - generic [ref=f1e112]:
                  - generic [ref=f1e113]: Due for retrieval
                  - strong [ref=f1e114]: Photosynthetic electron transport chain redox carrier relationships
                  - generic [ref=f1e115]: Ocean circulation systems and climate interactions · Retrieve the concept without the previous answer, repair any miss, then use one different application.
                - button "Start short check" [ref=f1e116] [cursor=pointer]
            - region [ref=f1e117]:
              - generic [ref=f1e118]:
                - generic [ref=f1e119]:
                  - heading "Coming up" [level=2] [ref=f1e120]
                  - paragraph [ref=f1e121]: Major outcomes and the preparation blocks that lead to them.
                - generic [ref=f1e122]: 0 open
              - generic [ref=f1e123]:
                - generic [ref=f1e124]:
                  - text: Search deadlines
                  - searchbox "Search deadlines" [ref=f1e125]
                - generic [ref=f1e126]:
                  - text: Deadline status
                  - combobox "Deadline status" [ref=f1e127]:
                    - option "Open" [selected]
                    - option "Complete"
                    - option "All"
              - paragraph [ref=f1e128]: Add an exam, paper, or deadline to connect this week’s work to an outcome.
            - region [ref=f1e129]:
              - generic [ref=f1e131]:
                - heading "Why this week looks like this" [level=2] [ref=f1e132]
                - paragraph [ref=f1e133]: Only stored profile, completion, availability, plan-order, and deadline evidence appears here.
              - list [ref=f1e137]:
                - listitem [ref=f1e138]:
                  - text: Your profile
                  - paragraph [ref=f1e139]: You told YOVA that afternoons usually offer the most usable energy, so that period may be recommended for flexible work but nothing moves without your approval.
                - listitem [ref=f1e140]:
                  - text: Your profile
                  - paragraph [ref=f1e141]: You described 20–30 minutes as a realistic session length, so YOVA should keep optional work near that range unless the task or deadline requires a different size.
              - button "Show all" [ref=f1e142] [cursor=pointer]
              - group [ref=f1e145]:
                - generic "Profile evidence available to YOVA" [ref=f1e146] [cursor=pointer]
              - button "Ask YOVA to adjust" [ref=f1e147] [cursor=pointer]
              - group [ref=f1e151]:
                - generic "Recent schedule changes 0" [ref=f1e152] [cursor=pointer]:
                  - text: Recent schedule changes
                  - generic [ref=f1e157]: "0"
    - contentinfo [ref=f1e158]:
      - navigation "Trust and support" [ref=f1e159]:
        - link "Support" [ref=f1e160] [cursor=pointer]:
          - /url: /support
        - link "Privacy" [ref=f1e161] [cursor=pointer]:
          - /url: /privacy
        - link "Terms" [ref=f1e162] [cursor=pointer]:
          - /url: /terms
  - button "Open Next.js Dev Tools" [ref=f1e168] [cursor=pointer]
  - alert [ref=f1e172]
```