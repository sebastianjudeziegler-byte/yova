# Production Undo prerequisite — passed 17 September 2026

This checks the deployed standalone fix from PR #98, not the unmerged Brief 2 implementation in PR #97.

Vercel deployment `53z6LG2NuShBnaQaZSdmhWTYqJPZ` showed **Ready**, **Production**, and current domain `www.yovaapp.com`, from main commit `0ce2292b71f7ca53a5978d637280e71d913debb7` (merge of PR #98). [Deployment details](https://vercel.com/yova/yova/53z6LG2NuShBnaQaZSdmhWTYqJPZ).

At approximately 17:20 UTC, the signed-in release test account completed the required browser sequence on a newly created plan, **Moon Phases Undo Check 17 September**. The existing Water Cycle Quiz Foundations plan was not used or modified.

| Step | Observed production result |
| --- | --- |
| Fresh plan | Five astronomy topics, six sessions, zero completed. First session: “Why the Moon Changes Appearance”, Feynman Technique, Thursday 7:00 PM, 25 minutes. Sun-Earth-Moon Geometry had no learned-elsewhere marker. |
| Change | Selected “I already learned this” on Sun-Earth-Moon Geometry and reviewed the generated preview. |
| Confirm | Saved successfully. The plan displayed seven sessions, including “Map the Sun-Earth-Moon Geometry” and a separate “Explain Why Moon Phases Happen”. The topic displayed “Learned elsewhere · practice will check what you know”. |
| Receipt | “Practice Sun-Earth-Moon Geometry: you learned it elsewhere; everything else unchanged.” Undo was available. |
| Undo | “Previous revision restored; everything else unchanged.” Six original sessions returned and the learned-elsewhere marker disappeared. No stale-session refusal appeared. |
| Full reload | Navigated to the production root, waited for the signed-in Home screen, and reopened the named plan. It still displayed zero of six complete, all original titles/methods/dates/durations, and no learned-elsewhere marker. |

The six restored sessions, all 25 minutes, were:

1. Why the Moon Changes Appearance — Feynman Technique — Thursday 7:00 PM.
2. Principal Phases and Eclipses — Feynman Technique — Friday 7:00 PM.
3. Explaining Astronomy Quiz Diagrams — Feynman Technique — Saturday 7:00 PM.
4. Map the Causes of Moon Phases — Concept Mapping — Monday 7:00 PM.
5. Map Phases to Eclipses — Concept Mapping — Tuesday 7:00 PM.
6. Connect the Full Quiz Picture — Concept Mapping — the following Thursday 7:00 PM.

Evidence is the observed production browser flow and visible state before/after reload. No API responses or database successes were mocked; no production settings or schema were changed. No video was captured for this particular manual check. The separate real-database red/green reproduction remains in [Brief 2 evidence](../brief-2/EVIDENCE.md).

The founder's later instruction restoring Undo as a prerequisite supersedes earlier documents that deferred it. This prerequisite is now satisfied. Brief 2's own revised editing and workload behavior still requires its independent CI/browser/database evidence.
