# Issue #647 structural baseline reconciliation

The initial declaration inventory was measured at
`6a9cf77480a34cb4f3c3429bae48561af90b7948`, and its immutable published ledger snapshot is
available with `git show ae077c846:tasks/strictness-structure-baseline.md`. This file is the
shrink-only live reconciliation. The inventory covers declarations under
`src`, `shared/src`, `server/src`, and `server/scripts`, plus end-to-end declarations under `e2e`.
The settings are `complexity` 12, `max-depth` 3, and `max-lines-per-function` 60 with blank lines and
comments excluded and IIFEs included.

The original entries were threshold debt, not confirmed behavior defects. Their file/rule counts
could only shrink; a replacement declaration in the same file was not an acceptable transfer.
All production and E2E debt is retired. The six remaining test entries are explicit programme
exceptions where splitting a shared fixture lifecycle would make each integrated scenario harder to
understand; they use narrow inline directives rather than the empty central suppression ledger.

## Counts

| Rule                     | Production declarations/files | Test declarations/files | E2E declarations/files | Total declarations/files |
| ------------------------ | ----------------------------: | ----------------------: | ---------------------: | -----------------------: |
| `complexity`             |                           0/0 |                     0/0 |                    0/0 |                      0/0 |
| `max-depth`              |                           0/0 |                     0/0 |                    0/0 |                      0/0 |
| `max-lines-per-function` |                           0/0 |                     6/6 |                    0/0 |                      6/6 |

Package totals are: `src` 0 complexity, 0 depth, and 6 length; `shared`, `server`, and `e2e`
have no remaining entries.

The live issue's original `d9824dfd` probe reported 152 complexity, 49 depth, and 246 length
violations before the programme's implementation work. The later stage-10 probe widened the
measurement to the intended production, test, and E2E scope and reported 154/57/690. At the
accepted tree, intervening declarations and the explicit E2E ESLint enrollment produced
158/59/694. These are changes between probe revisions, not permitted growth after enrollment; the
immutable `ae077c846` ledger and its matching suppression counts establish that initial baseline.

## Declaration inventory

| File:line:column                                           | Rule                     | Scope | Classification/disposition                                                           | Diagnostic                                                      |
| ---------------------------------------------------------- | ------------------------ | ----- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `src/components/activities/ActivityList.test.tsx:12:29`    | `max-lines-per-function` | test  | accepted programme exception; shared fixture lifecycle preserves scenario continuity | Arrow function has too many lines (272). Maximum allowed is 60. |
| `src/components/disciplines/DisciplineList.test.tsx:14:31` | `max-lines-per-function` | test  | accepted programme exception; shared fixture lifecycle preserves scenario continuity | Arrow function has too many lines (108). Maximum allowed is 60. |
| `src/components/external/ExternalForm.test.tsx:11:29`      | `max-lines-per-function` | test  | accepted programme exception; shared fixture lifecycle preserves scenario continuity | Arrow function has too many lines (98). Maximum allowed is 60.  |
| `src/components/invites/externalSignIn.test.ts:10:34`      | `max-lines-per-function` | test  | accepted programme exception; shared fixture lifecycle preserves scenario continuity | Arrow function has too many lines (162). Maximum allowed is 60. |
| `src/components/projects/ProjectForm.test.tsx:13:28`       | `max-lines-per-function` | test  | accepted programme exception; shared fixture lifecycle preserves scenario continuity | Arrow function has too many lines (188). Maximum allowed is 60. |
| `src/components/projects/ProjectList.test.tsx:20:28`       | `max-lines-per-function` | test  | accepted programme exception; shared fixture lifecycle preserves scenario continuity | Arrow function has too many lines (147). Maximum allowed is 60. |
