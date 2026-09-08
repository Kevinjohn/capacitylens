# Issue #645 typed-lint baseline reconciliation

The initial inventory was measured at commit `9ab35f91` (2026-09-07), and its immutable published
ledger snapshot is available with
`git show 55c9794e:tasks/conventions-enforcement-baseline.md`. This file is the shrink-only live
reconciliation required by the programme.

This is the declaration-level audit record for the seven rule IDs in the five authorised residual smell families. `eslint-suppressions.json` is the enforcing file/rule/count baseline; this ledger makes each suppressed declaration and its classification reviewable. Counts may only shrink. Near-zero rules and `no-unnecessary-type-assertion` have no baseline.

Confirmed defects were handled before freezing this inventory: non-Error production throws were normalised while preserving causes; the unnecessary boolean comparison, incomplete switch, parameter reassignment and invalid never interpolation were fixed; all 66 current unnecessary production assertions were removed; and the exact unknown-entity diagnostic was restored. Nullish findings were reviewed as residual defaulting semantics rather than changed blindly because empty strings are deliberately meaningful or deliberately treated as absent at several configuration/UI boundaries.

## Counts

| Rule                                           | Declarations |
| ---------------------------------------------- | -----------: |
| `@typescript-eslint/no-non-null-assertion`     |            0 |
| `@typescript-eslint/no-unnecessary-condition`  |            0 |
| `@typescript-eslint/no-unsafe-argument`        |            0 |
| `@typescript-eslint/no-unsafe-assignment`      |            0 |
| `@typescript-eslint/no-unsafe-member-access`   |            0 |
| `@typescript-eslint/prefer-nullish-coalescing` |            0 |
| `no-nested-ternary`                            |            0 |

## Declaration inventory

| File:line:column | Rule | Classification | Diagnostic |
| ---------------- | ---- | -------------- | ---------- |

No declarations remain in the central typed-lint baseline. `eslint-suppressions.json` is empty.

## Live inline compatibility and tooling exceptions

These narrow directives are not legacy debt. Each preserves a framework, compile-time, or released
API constraint that the corresponding rule cannot express.

| File:line                                  | Rule                                   | Diagnostics | Justification                                                                                                                       |
| ------------------------------------------ | -------------------------------------- | ----------: | ----------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/fixtures.ts:23`                       | `no-empty-pattern`                     |           1 | Playwright automatic fixtures require a destructured first parameter even when the fixture consumes no inputs.                      |
| `server/src/tables/columns.ts:35`          | `@typescript-eslint/no-unused-vars`    |          10 | Named compile-time assertions make table-column drift fail typechecking without adding runtime work.                                |
| `shared/src/lib/dateMath.ts:122`           | `max-params`                           |           1 | The released `rangesOverlap` four-argument call shape and runtime arity remain compatible; audit rows A021/A128 classify it as `X`. |
| `src/components/StorageRecovery.tsx:48,78` | `react-refresh/only-export-components` |           2 | Recovery boundary exports remain colocated so tests can exercise injected reset behavior without mutating real browser storage.     |
| `src/components/common/ui.tsx:1`           | `react-refresh/only-export-components` |           6 | The product UI barrel contains re-exports only; component definitions retain their own refresh boundaries.                          |
| `src/router.tsx:1`                         | `react-refresh/only-export-components` |           1 | The module exports route configuration rather than defining a component refresh boundary.                                           |
