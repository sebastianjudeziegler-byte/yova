# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accessibility-regression.spec.ts >> form placeholder text keeps AA contrast on public surfaces
- Location: e2e/accessibility-regression.spec.ts:40:5

# Error details

```
Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e2]:
    - generic [ref=e3]:
      - link "Return to YOVA" [ref=e4] [cursor=pointer]:
        - /url: /
        - generic [ref=e5]: YOVA
      - link "Back to YOVA" [ref=e8] [cursor=pointer]:
        - /url: /
    - article [ref=e11]:
      - generic [ref=e12]:
        - text: YOVA SUPPORT
        - heading "Help us see what you saw." [level=1] [ref=e13]
        - paragraph [ref=e14]: Signed-in alpha users can send a problem or product suggestion directly to the YOVA support queue.
        - generic [ref=e15]: Alpha version · Updated August 16, 2026
      - generic [ref=e16]:
        - generic [ref=e17]:
          - heading "Before sending" [level=2] [ref=e18]
          - generic [ref=e19]:
            - article [ref=e20]:
              - strong [ref=e21]: Account access
              - paragraph [ref=e22]: Use your password, or choose the email-code option and use the newest YOVA email. If a password reset link expired, request a fresh one.
            - article [ref=e23]:
              - strong [ref=e24]: Uploaded materials
              - paragraph [ref=e25]: YOVA currently accepts readable PDF, TXT, and Markdown files. Scanned image-only PDFs may not contain extractable text.
            - article [ref=e26]:
              - strong [ref=e27]: AI output
              - paragraph [ref=e28]: Plans and explanations can be wrong. Include the goal and the specific output that was unhelpful, but do not paste sensitive school records.
        - region [ref=e29]:
          - generic [ref=e30]:
            - text: PRIVATE SUPPORT
            - heading "Tell us what happened." [level=2] [ref=e31]
            - paragraph [ref=e32]: Send the steps you took, what you expected, and what happened instead. Do not include passwords, API keys, or sensitive school records.
          - generic [ref=e33]:
            - generic [ref=e34]: Area
            - combobox "Area" [ref=e35]:
              - option "Account or sign-in" [selected]
              - option "Plan or recommendation"
              - option "Guided session"
              - option "Uploaded material"
              - option "Product feedback"
              - option "Something else"
          - generic [ref=e36]:
            - generic [ref=e37]: Short subject
            - textbox "Short subject" [ref=e38]:
              - /placeholder: "Example: My study plan would not open"
          - generic [ref=e39]:
            - generic [ref=e40]: What happened?
            - textbox "What happened?" [ref=e41]:
              - /placeholder: Include the screen, button, and any error message you saw.
          - generic [ref=e42]: 0 / 4,000 characters
          - button "Send support request" [disabled] [ref=e43]
    - navigation "YOVA trust and support" [ref=e47]:
      - link "Privacy" [ref=e48] [cursor=pointer]:
        - /url: /privacy
      - link "Terms" [ref=e49] [cursor=pointer]:
        - /url: /terms
      - link "Support" [ref=e50] [cursor=pointer]:
        - /url: /support
  - button "Open Next.js Dev Tools" [ref=e56] [cursor=pointer]
  - alert [ref=e60]
```
