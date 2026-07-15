# Mutation-test security review — 2026-07-15

## Conclusion

The mutation suite clears its 85% release threshold, but the score is accepted only together with
this survivor review. One genuine defence-in-depth tenant-integrity defect was found and fixed: a
project-bound activity whose project was missing or belonged to another account could pass
allocation validation because the unresolved project was treated like an activity with no project.
The shared write boundary now fails closed, with missing, cross-account, inactive, reassigned and
unchanged-reference cases pinned by tests. The generic scoped-reference boundary also directly
proves that a new write cannot attach to an archived parent.

Additional assertions close material test gaps around private-name fallback, malformed working-day
sets, import privacy/lifecycle repair, cascade revision stamps, strict ISO-date anchoring and
untrusted API error bodies. No surviving mutant reviewed after that pass demonstrated another
authorization, tenant-isolation, confidentiality or write-integrity bypass.

## Scope

`stryker.config.json` mutates the pure shared domain/lib core, scheduler helpers, browser helpers and
the reset failure mapper. It intentionally excludes React component code and the entire `server/`
implementation. Therefore this score supports the shared validation and browser-logic claims only;
it is **not** evidence that Fastify, Better Auth, session, MFA, CSRF or SQLite route authorization is
mutation-tested. Those controls rely on `gate:server`, focused integration tests, E2E and the manual
ASVS review.

The generated interactive report is `reports/mutation/mutation.html`. It is a local generated
artifact rather than a committed assurance record; this document preserves the reviewed outcome.

## Result

| Metric | First post-fix baseline | Final reviewed run |
|---|---:|---:|
| Mutants | 2,988 | 2,988 |
| Killed by assertions | 2,746 | 2,763 |
| Timed out | 11 | 11 |
| Survived | 192 | 177 |
| No coverage | 39 | 37 |
| Errors | 0 | 0 |
| Total mutation score | 92.27% | **92.84%** |
| Covered-code score | 93.49% | **94.00%** |

The final run improves the baseline by 17 assertion kills, 15 fewer survivors and two fewer
uncovered mutants. The shared domain core scores 95.14%; `mutations.ts` scores 96.03% with no
uncovered mutants. `tenancy.ts`, private-name projection, working-day validation and reset-failure
mapping each score 100%. The result exceeds the configured 85% break threshold by 7.84 percentage
points.

## Survivor triage

| Area | Review outcome |
|---|---|
| `shared/src/domain/tenancy.ts` | 100% mutation score. The direct tenant predicates have no surviving or uncovered mutants. |
| Access rank guards | Surviving guard mutants are behaviorally equivalent: JavaScript rank comparison with an unknown value already returns false. Exhaustive role/action oracles and untyped-boundary cases still prove fail-closed behavior. |
| Allocation/reference validation | A real missing/cross-account project defect and inactive-reference assertion gaps were fixed. Missing, cross-account and archived parents now exercise fail-closed throw branches at both the specialized allocation validator and generic scoped write boundary. |
| Private-name projection | Missing/non-string/empty code names now assert the neutral `"Confidential"` projection and prove the real name is absent; quote normalization asserts repeated smart/straight outer marks. |
| Import and lifecycle repair | Adversarial privacy values, ordinary/built-in colour, blank/invalid timestamps and equal archive/delete boundaries are pinned. Remaining helper-condition survivors either converge on the same repaired output or guard an unreachable type-exhaustive default. |
| Referential cascades | Tests now prove that surviving rows retain identity and receive the caller's revision when a foreign key is cleared. |
| Date and working-day validation | Prefix/suffix date junk, duplicate/fractional/out-of-range weekdays and custom error-field routing are now explicit. |
| API error parsing | Direct tests cover unreadable JSON, null, primitives, arrays, empty/non-string error values and valid server text. |
| Scheduler/layout/timezone/tour helpers | Remaining survivors or uncovered mutants here are product-behavior/test-quality debt, not authorization or confidentiality controls. They remain visible in the HTML report and must not be described as security coverage. |
| Timed-out mutants | Stryker counts these as detected, but they are weaker diagnostic evidence than an assertion kill. Reviewed timeouts are in date/layout/fuzzy/virtualization logic, outside the security boundary. |

## Acceptance and follow-up

- The configured score must remain at or above the 85% break threshold.
- Any survivor in tenancy, access, private-name projection, import/reference validation, auth failure
  mapping or destructive-action support code requires manual triage; the aggregate score alone is
  insufficient.
- Changes to `server/src/auth.ts`, authorization hooks, password security, CSRF, session handling or
  production guards require focused server integration tests and manual security review. A separate
  server mutation profile may be added later, but is not implied by this report.
- `src/lib/tour.ts` and low-scoring timezone/presentation helpers should receive product-focused
  mutation work independently; their current status does not lower a security control to Pass.
