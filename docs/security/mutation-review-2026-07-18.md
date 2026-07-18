# Mutation-test review — 2026-07-18

## Conclusion

The corrected pure-logic mutation profile clears its 85% release threshold at **92.37%**, with no
runner errors. The shared domain and library core scores **95.20%**; tenant predicates, private-name
projection, scheduling-day rules and password-reset failure mapping remain at 100%.

The first run exposed scope drift rather than a product defect. Two React hooks added under the
scheduler directory were caught by the existing broad TypeScript glob even though the documented
profile intentionally targets pure helpers. Those hooks contributed 507 lifecycle/event mutants,
including 216 survivors, 81 uncovered mutants and two Vitest-runner serialization errors. They are
now explicitly excluded by the scheduler hook naming convention. Their behavior remains covered by
component tests and the Chromium, Firefox and WebKit E2E matrix.

## Scope

`stryker.config.json` mutates the pure shared domain/library core, pure scheduler helpers, browser
helpers and reset-page failure mapper. It excludes React hooks and component rendering, along with
the entire `server/` implementation. The score therefore supports shared validation and pure
browser-logic claims; it is not evidence for Fastify, Better Auth, session, MFA, CSRF or SQLite
route authorization. Those controls rely on the server gate, focused integration tests, E2E and
manual security review.

The generated interactive report is `reports/mutation/mutation.html`. It remains a local ignored
artifact; this document preserves the reviewed outcome.

## Result

| Metric | 2026-07-15 reviewed run | 2026-07-18 reviewed run |
|---|---:|---:|
| Mutants | 2,988 | 3,068 |
| Killed by assertions | 2,763 | 2,823 |
| Timed out | 11 | 11 |
| Survived | 177 | 190 |
| No coverage | 37 | 44 |
| Errors | 0 | 0 |
| Total mutation score | 92.84% | **92.37%** |
| Covered-code score | 94.00% | **93.72%** |

The result exceeds the configured break threshold by 7.37 percentage points. All 1,720 tests in
the mutation runner's initial per-test coverage pass succeeded before the 3,068 mutants ran.

## Survivor triage

| Area | Review outcome |
|---|---|
| Tenant and private-data predicates | `tenancy.ts` and `privateNames.ts` remain at 100%. No tenant-isolation or confidential-name mutant survives. |
| Access boundary | One guard mutant survives where an unknown canonical action already resolves to no minimum role; the original and mutant both fail closed. Exhaustive role/action and untyped-boundary tests remain in place. |
| Lifecycle and destructive actions | Surviving impact-preview selectors and timestamp guards either converge on the same conservative result or exercise invalid values already rejected by the write boundary. No archive, delete, restore or purge permission bypass was found. |
| Allocation/reference validation | `mutations.ts` remains at 96.03%. Surviving type/id-remap guards cover malformed import shapes that converge on the same sanitised result; missing, cross-account, inactive and reassigned references remain explicitly rejected. |
| Import and referential repair | Integrity and import survivors are defensive type guards, equivalent ISO-date checks or repair branches whose adversarial inputs converge on the asserted canonical output. No fail-open scoped reference was found. |
| Reset failure mapping | `resetPasswordFailure.ts` remains at 100%. |
| Pure scheduler helpers | The scheduler helper group scores 92.87% with no uncovered mutants. Drag math and week snapping remain at 100%; geometry/virtualisation timeouts are counted as detected. |
| Timezone and tour presentation | Low-scoring timezone label parsing and the dynamically imported product tour remain visible product-test debt. They carry no authorization, tenant-isolation or confidentiality claim. |
| Timed-out mutants | All 11 are in date, colour, fuzzy-search, geometry or virtualisation helpers. Stryker counts them as detected, but they remain weaker evidence than assertion kills. |

## Acceptance and follow-up

- The corrected profile has no compile/runtime errors and remains above both the 90% high-water mark
  and the 85% break threshold.
- React hooks must keep behavior-focused component and cross-browser coverage; pure calculations
  extracted from a hook belong back in the mutation profile.
- Any future survivor in tenancy, access, private-name projection, import/reference validation,
  reset failure mapping or destructive-action support code requires manual triage regardless of the
  aggregate score.
- Timezone labeling and the product tour remain the clearest non-security mutation-testing debt.
