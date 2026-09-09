# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: core-learning-loop.spec.ts >> a fallback method workpad resumes its timer and checked targets after reload
- Location: e2e/core-learning-loop.spec.ts:930:5

# Error details

```
Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [active] [ref=f3e1]:
  - button "Open Next.js Dev Tools" [ref=f3e7] [cursor=pointer]
  - alert [ref=f3e11]
  - main [ref=f3e12]:
    - generic [ref=f3e13]:
      - generic [ref=f3e16]:
        - generic [ref=f3e17]: Review How Thermohaline Circulation Moves Heat…
        - strong [ref=f3e18]: Retrieve and apply Review how thermohaline circulation moves heat us...
      - generic [ref=f3e19]: 0:02 elapsed
      - button "Exit" [ref=f3e20] [cursor=pointer]
    - generic [ref=f3e21]:
      - generic [ref=f3e22]: Your session was recovered. Completed sections are saved; an unfinished answer was not stored.
      - region "Study-method workpad" [ref=f3e26]:
        - region "How to study this" [ref=f3e27]:
          - generic [ref=f3e28]:
            - paragraph [ref=f3e29]: HOW TO STUDY THIS
            - generic [ref=f3e30]:
              - heading "Concept Mapping" [level=2] [ref=f3e31]
              - generic [ref=f3e32]: Practice first
            - paragraph [ref=f3e33]: Retrieve the important concepts, state labeled relationships between them, verify those links, and repair the map.
          - generic [ref=f3e34]:
            - region [ref=f3e35]:
              - paragraph [ref=f3e36]: TODAY'S TARGET
              - heading "Open your chosen source and work through Review how thermohaline circulation moves heat us.... Close the source, then return to YOVA and show what you produced or understood." [level=3] [ref=f3e37]
              - generic [ref=f3e38]:
                - heading "What this covers" [level=4] [ref=f3e39]
                - list [ref=f3e40]:
                  - listitem [ref=f3e41]: Review how thermohaline circulation moves heat using my oceanography textbook
              - generic [ref=f3e42]:
                - heading "Finished means" [level=4] [ref=f3e43]
                - paragraph [ref=f3e44]: Attempt each target without notes and correct any exposed gap
            - region [ref=f3e45]:
              - paragraph [ref=f3e46]: WHY THIS METHOD
              - heading "Why it works" [level=3] [ref=f3e47]
              - paragraph [ref=f3e48]: Concept Mapping fits this task and your starting point. It helps you practise using what you know and find gaps to work on.
              - heading "Use it like this" [level=4] [ref=f3e49]
              - list [ref=f3e50]:
                - listitem [ref=f3e51]:
                  - generic [ref=f3e52]: Retrieve the key concepts before reopening the source.
                - listitem [ref=f3e53]:
                  - generic [ref=f3e54]: Connect each pair with a short relationship phrase, not a decorative line.
                - listitem [ref=f3e55]:
                  - generic [ref=f3e56]: Check every important link against the source or accurate model.
                - listitem [ref=f3e57]:
                  - generic [ref=f3e58]: Repair unsupported or missing links and explain one connection in words.
          - region [ref=f3e59]:
            - heading "Why this fits today" [level=3] [ref=f3e60]
            - list [ref=f3e61]:
              - listitem [ref=f3e62]: "You can continue with your chosen method: Concept Mapping."
              - listitem [ref=f3e63]: Your outside source remains the source of truth; YOVA provides the sequence and evidence check.
              - listitem [ref=f3e64]: You asked for concrete examples before rules, so YOVA will make the first explanation example-led.
        - generic [ref=f3e65]:
          - generic [ref=f3e71]:
            - paragraph [ref=f3e72]: METHOD WORKPAD
            - heading "Do the work, then check it against the saved target." [level=2] [ref=f3e73]
            - generic [ref=f3e74]: Your notes stay in this screen and are not saved or graded.
          - generic [ref=f3e75]:
            - generic [ref=f3e76]: Your workpad
            - textbox "Your workpad" [ref=f3e77]:
              - /placeholder: Work through the method here. Capture your recall, explanation, outline, calculation, or application before checking it.
          - group "Check each covered topic" [ref=f3e78]:
            - paragraph [ref=f3e80]:
              - text: "Compare your work with this completion criterion:"
              - strong [ref=f3e81]: Attempt each target without notes and correct any exposed gap
            - generic [ref=f3e83] [cursor=pointer]:
              - checkbox "Review how thermohaline circulation moves heat using my oceanography textbook" [checked] [ref=f3e84]
              - generic [ref=f3e85]: Review how thermohaline circulation moves heat using my oceanography textbook
          - paragraph [ref=f3e89]:
            - strong [ref=f3e90]: This completes practice, not a knowledge check.
            - text: The session will count as done, but no topic will become taught, evidenced, or secure until YOVA verifies it later.
          - button "Finish as ungraded practice" [disabled] [ref=f3e91]
```