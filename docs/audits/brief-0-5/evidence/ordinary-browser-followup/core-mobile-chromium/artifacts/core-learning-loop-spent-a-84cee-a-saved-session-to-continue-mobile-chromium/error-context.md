# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> spent allowance still permits a saved session to continue
- Location: e2e/core-learning-loop.spec.ts:2356:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Tearing down "context" exceeded the test timeout of 30000ms.
```

# Page snapshot

```yaml
- main [ref=f1e2]:
  - generic [ref=f1e3]:
    - generic [ref=f1e4]: YOVA
    - link "Free Study Profile" [ref=f1e7] [cursor=pointer]:
      - /url: /study-profile
  - region [ref=f1e8]:
    - generic [ref=f1e9]:
      - generic [ref=f1e10]: A study plan built around you
      - heading "Know what to study next." [level=1] [ref=f1e14]
      - paragraph [ref=f1e15]: Bring your notes, or just name the topic. YOVA builds the plan, chooses the learning method, and guides you through the work.
      - generic [ref=f1e16]:
        - link "Try the free Study Profile" [ref=f1e17] [cursor=pointer]:
          - /url: /study-profile
        - link "Get support" [ref=f1e20] [cursor=pointer]:
          - /url: /support
    - status [ref=f1e21]:
      - generic [ref=f1e23]:
        - strong [ref=f1e24]: Checking for your YOVA account
        - generic [ref=f1e25]: Your saved work is not being changed.
  - region [ref=f1e26]:
    - generic [ref=f1e27]:
      - text: HOW YOVA WORKS
      - heading "From a goal to one clear next step." [level=2] [ref=f1e28]
    - list [ref=f1e29]:
      - listitem [ref=f1e30]: Name the goal and deadline.
      - listitem [ref=f1e31]: Add materials only when they help.
      - listitem [ref=f1e32]: Follow a method YOVA explains.
  - generic [ref=f1e33]:
    - generic [ref=f1e34]: YOVA public alpha
    - navigation "Trust and support" [ref=f1e35]:
      - link "Privacy" [ref=f1e36] [cursor=pointer]:
        - /url: /privacy
      - link "Terms" [ref=f1e37] [cursor=pointer]:
        - /url: /terms
      - link "Support" [ref=f1e38] [cursor=pointer]:
        - /url: /support
```