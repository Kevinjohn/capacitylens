# Documentation alternatives

**Start with [the comparison page](index.html).** It opens directly in a browser; no server or installation is needed to read the samples.

- [Research and recommendation](research.md): what to borrow, what feels heavy today, and concrete recommendations for writing, page size, roles, navigation and layout.
- [Source observations](sources.md): ten open-source documentation examples, public repositories and evidence limits.
- [Verification](verification.md): what was checked and what still needs real reader feedback.

There are **three complete ten-page treatments of one journey**: an already-created company prepares a feasible next-week plan and a Viewer finds their work. The same destination can be compared across treatments using the links above each article.

| Treatment                  | Start reading                                                  | Best fit                                                        |
| -------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| A — Task handbook          | [Plan next week](preview/handbook/01-plan-next-week.html)      | Everyday instructions and direct lookup; recommended foundation |
| B — First-week walkthrough | [Start the walkthrough](preview/guided/01-plan-next-week.html) | A continuous example for someone new to the product             |
| C — Answer desk            | [Find an answer](preview/answers/01-plan-next-week.html)       | Question-led lookup and interruptions                           |

The samples include Owner, Admin, Editor, Viewer and conditional operator handoffs. Roles are shown at the action, without hiding other viewpoints. The walkthrough is optional: a Viewer can go directly to page 9 and a planner directly to pages 6–8.

The three sets are alternatives, not a proposal to maintain three copies. Keep one canonical set when a direction is selected. The existing published documentation and application are unchanged.

## Editable sources

Markdown lives in `samples/handbook`, `samples/guided` and `samples/answers`. Existing product screenshots remain in their original `docs-src/screenshots` locations and are reused by relative link. Keep the sample folder inside this checkout when opening it so those images remain reachable.

To regenerate the standalone previews from the repository root, using the Node major in `.nvmrc` and the project's installed dependencies:

```sh
node documentation-exploration/build.mjs
```

To check formatting:

```sh
pnpm exec prettier --check documentation-exploration
```

The build uses the documentation renderer already installed by this repository. It adds no dependencies. No production documentation build or application release is performed by this sample builder.
