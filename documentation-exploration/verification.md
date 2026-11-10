# Verification and review limits

This collection changes research and sample files only. The live documentation sources, generated production documentation, application, dependencies and product rules are unchanged.

## Scope and basis

- Tracking: [#1846](https://github.com/Kevinjohn/capacitylens/issues/1846).
- Repository basis: `ac69d13a1`, the fetched main revision used for this worktree.
- Deliverable: three sets of ten Markdown pages, standalone previews, research, source notes and a comparison entry page.
- Current product instructions were compared with the relevant access, invitation, scheduling, time-off and save-recovery sources. This was source inspection, not new runtime proof of the application's behaviour.
- Existing planning screenshots use fictional identities. Reused captures are labelled illustrative and link to full-size originals. They are not evidence that a tutorial was completed.

## Checks

- **Build:** Node 24.21.0 generated all 30 article previews, three research documents and the comparison index. The builder preflights source presence and metadata and formats output with the repository’s installed renderer and formatter. Preflight is not an atomic-write guarantee.
- **Local links:** 34 generated HTML files were parsed; 1,055 relative link/asset references resolved, with no missing files, missing local HTML fragments or root-relative URLs.
- **Script-free rendering:** all 30 sample articles loaded successfully at 1440 × 1000 with page JavaScript disabled, one H1 per page, no scripts, no broken loaded images, no whole-page horizontal overflow and no page errors.
- **Responsive layout:** the index, research report and overbooking page in each treatment were checked at 320, 768, 1024 and 1440px widths. There was no whole-page horizontal overflow. Wide comparison tables scroll within their own region.
- **Keyboard journey:** with JavaScript disabled at 320px, Tab exposed the skip link with a visible focus outline; Enter moved focus to main content; the native task menu and optional answer explanation opened from the keyboard; following Check your week and switching to B preserved that task.
- **Automated accessibility sample:** axe-core 4.14.0 reported no violations or incomplete checks for WCAG A/AA tags on the index, three research documents, booking pages A/B/C and A’s capacity page at desktop width. This is eight pages and an automated check, not a claim of full accessibility conformance.
- **Editorial review:** all 30 sources received an independent content review. Corrections covered invitation acceptance, Editor access to closures, optimistic save displays, mode-specific reassignment dates, actual form controls, stale-write refusal, draw-mode visibility and optional member linking. Follow-up checks reconciled the affected claims with the owning source. The final samples have no known unresolved factual findings within this journey.
- **Sources:** nine exact external GitHub source paths were also confirmed through the public repository API. Moved, archived or unmatched source arrangements are called out in the source notes.
- **Formatting and syntax:** the sample folder passed the project’s installed formatter and the builder passed Node’s syntax check. All outgoing sample text was inspected for the repository’s public naming/privacy restrictions.

The supported Node runtime was selected in each build/format invocation. The worktree reused existing installed dependencies. The package manager’s per-run dependency synchronisation check was disabled for formatting so it would not replace those shared dependencies; no dependency installation, package-manager migration or lockfile change was made.

Application-wide hooks and suites are outside this standalone editorial investigation’s scoped checks, recorded in the tracking issue. No claim is made that a full application gate or production-documentation build ran.

## Evidence boundaries

- Public documentation research is comparative observation. It does not establish better reader outcomes or a complete accessibility assessment of the external sites.
- The automated inspection browser refused the `file:` protocol, so its checks used a loopback server. A separate native Chrome check then opened the index and an overbooking article directly from disk and visibly loaded its relative screenshot. This confirms representative disk-opened rendering; the full 30-page traversal was performed over loopback.
- No interviews or tests with new product users have taken place. The research describes a small findability comparison to run before replacing live help.
- No application integration or end-to-end suite is needed for these isolated editorial samples. The narrower validation scope is recorded in the investigation issue. No production docs build is required because `docs-src/` and `docs/` have not changed.
- No merge or production documentation replacement is included. Existing live-page issues identified in the research remain for the selected migration.
