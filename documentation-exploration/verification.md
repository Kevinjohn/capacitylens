# Verification and review limits

This collection changes research and sample files only. The live documentation sources, generated production documentation, application, dependencies and product rules are unchanged.

## Scope and basis

- Tracking: [#1846](https://github.com/Kevinjohn/capacitylens/issues/1846).
- Repository basis: `ac69d13a1`, the fetched main revision used for this worktree.
- Deliverable: three sets of ten Markdown pages, a comprehensive FAQ appendix, a separate story-coverage reference, standalone previews, research, source notes and a comparison entry page.
- Current product instructions were compared with the relevant access, invitation, scheduling, time-off and save-recovery sources. This was source inspection, not new runtime proof of the application's behaviour.
- Existing planning screenshots use fictional identities. Reused captures are labelled illustrative and link to full-size originals. They are not evidence that a tutorial was completed.

## Original comparison checks

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

## FAQ appendix checks

The appendix adds **114 reader questions** covering **179 of 179 catalogue stories** across 14 subjects. The source catalogue is the unmerged expanded proposal in PR #1848, pinned to `0d961752a0bb682b1348addf1ae621ae70abe57d`; the mapping and availability labels are visible in the separate coverage reference. It is not a claim that all 179 application journeys were run.

- The coverage builder checks every source identifier, prevents duplicate story records and question anchors, and validates primary and related answer destinations. New identifiers in the local catalogue require refreshing the snapshot. All 132 story identifiers in this checkout are included in the broader snapshot.
- Eight focused Node tests passed, covering successful assembly, missing coverage, duplicate mappings, missing/duplicate/untracked question anchors, catalogue growth, installation placement at the end, and multiple answers without inflating story counts.
- The regenerated collection contains 36 HTML pages. Relative links, assets and fragments were checked, including target anchors in linked production HTML and links in the editable FAQ parts.
- The FAQ, coverage reference and comparison index rendered without page scripts or whole-page horizontal overflow at 320, 768, 1024 and 1440px. Reader copy contained no story identifiers.
- The keyboard journey from the task guide to the FAQ, then a topic jump and Back to the guide succeeded at 320px with page scripts disabled.
- Automated WCAG A/AA-tagged checks on the FAQ, coverage reference and updated index reported no violations or incomplete checks. This remains limited automated evidence, not full accessibility conformance.
- HTML and assembled FAQ Markdown were byte-identical across a rebuild. Source formatting, builder syntax and whitespace checks passed.
- The FAQ received independent source-based content review, including access restrictions, current controls, hidden/demo availability, optional member linking, date navigation, Work/Time off mode, save uncertainty, archive/restore and calendar rules. New-booking starts were traced through the form submit and server write checks rather than inferred from an override-aware move helper. All review findings were reconciled, and no known factual findings remain within the reviewed FAQ scope.

Original browser evidence remains applicable to unchanged content and layout. The three booking sample pages now also name the Work draw-mode prerequisite. The source story catalogue, application and production documentation inputs remain unchanged.

## Evidence boundaries

- Public documentation research is comparative observation. It does not establish better reader outcomes or a complete accessibility assessment of the external sites.
- The automated inspection browser refused the `file:` protocol, so its checks used a loopback server. A separate native Chrome check then opened the index and an overbooking article directly from disk and visibly loaded its relative screenshot. This confirms representative disk-opened rendering; the full 30-page traversal was performed over loopback.
- No interviews or tests with new product users have taken place. The research describes a small findability comparison to run before replacing live help.
- No application integration or end-to-end suite is needed for these isolated editorial samples. The narrower validation scope is recorded in the investigation issue. No production docs build is required because `docs-src/` and `docs/` have not changed.
- No merge or production documentation replacement is included. Existing live-page issues identified in the research remain for the selected migration.
