# 13 — Naming and coding standards

This chapter makes the repository feel consistent even when many agents contribute.

## TypeScript baseline

- Strict mode.
- No unused locals/parameters.
- No fall-through switches.
- Verbatim module syntax where practical.
- Browser program includes DOM/Vite types but not Node globals.
- Server/shared programs use Node types and no DOM.
- Type-aware lint rules enforce no floating or misused promises.
- Zero lint warnings.
- Avoid `any`; validate `unknown` at boundaries.
- Prefer discriminated unions and exhaustive records.
- Use `import type` for types.
- Promises are `await`ed, returned or deliberately prefixed with `void`.

## Files and directories

| Thing | Convention | Example |
| --- | --- | --- |
| React component | PascalCase file | `AccountPicker.tsx` |
| Component test | Co-located same stem | `AccountPicker.test.tsx` |
| Hook | camelCase starting `use` | `useLifecycleActions.ts` |
| Pure app helper | camelCase descriptive noun | `gettingStarted.ts` |
| Shared domain module | lower camel/noun | `privateNames.ts` |
| Server concern | lower camel/noun | `controlTables.ts` |
| E2E spec | lower kebab or domain noun | `getting-started.spec.ts` |
| Auth/db E2E flavour | suffix before spec | `login.auth.spec.ts`, `onboarding.db.spec.ts` |
| User story | stable domain id + kebab title | `US-NAV-14-company-picker-onboarding.md` |
| Operator doc | lower kebab | `self-hosting.md` |

Prefer one clear concern per file. Split giant barrels/feature components when navigation becomes
difficult, but do not create a directory for a one-function abstraction.

## Symbols

- Components, interfaces, types, classes: `PascalCase`.
- Functions, variables, props: `camelCase`.
- Hooks: `useNoun/Verb`.
- Boolean values: `is*`, `has*`, `can*`, `should*`, `*Enabled`, `*Open`, `*ReadOnly`.
- Constants with runtime configuration/invariants: `UPPER_SNAKE_CASE`.
- Literal option arrays may use descriptive uppercase names.
- Event constants end `_EVENT`.
- ids end `Id`; arrays/maps use plural nouns.
- Time values include unit: `debounceMs`, `intervalMin`, `maxAgeDays`.
- Dates distinguish date-only (`startDate`) from timestamp (`createdAt`).
- Handlers name intent (`submit`, `confirmDelete`), not DOM event trivia.

Avoid abbreviations except established vocabulary (`id`, `API`, `URL`, `DB`, `SSO`, `OIDC`).

## Canonical domain vocabulary

Pick one code noun and one visible noun, then document exceptions.

CapacityLens conventions:

| Concept | Code | UI |
| --- | --- | --- |
| Tenant | `Account` / `accountId` | Company |
| Atomic tenant creation | `/api/orgs` | New company |
| Work category | `Activity` | Activity |
| Person/slot/vendor | `Resource` | Resource/People/External as context demands |
| Capacity percentage | `utilization` in some code/library names | Utilisation |
| User colour | `color` | Colour |

Why mixed spelling: web/CSS/ecosystem code uses `color` and some existing APIs use
`utilization`; visible English follows UK spelling. Consistency within a layer matters more than a
mechanical global rename.

Never add a synonym casually. A domain rename includes types, migrations, tables, routes,
fixtures, UI copy, tests and backward compatibility.

## Function design

- Pure functions for calculations, validation, policy and projection.
- I/O at named boundaries.
- Small total helpers for error messages and predicates.
- Return validation results; throw at enforcement boundary.
- Do not return `null` for a data error unless null is an explicit domain result.
- Guard non-finite numbers inside pure math with visible safe results.
- Include preconditions and failure meaning in exported TSDoc.
- Prefer an options object once a function has several same-type parameters.
- Use named typed errors when recovery/status differs.

## React

- Resolve localised copy at render/call time.
- Select the smallest store slice.
- Keep expensive scoped subscriptions behind cheap visibility/permission gates.
- Do not mirror derived domain data in component state.
- Use functional state updates for toggles/races.
- Effects synchronise with external systems; pure derivation belongs in render/helper.
- Async effects carry cancellation and identity/sequence guards.
- Keep provider/context definition separate when Fast Refresh requires component-only exports.
- Lazy-load secondary routes and click-only heavy libraries.
- Do not use `dangerouslySetInnerHTML` for ordinary rich copy.

## Props and component kit

- Name callbacks by result: `onClose`, `onSubmit`, `onChange`.
- Keep common product API stable even when underlying primitive changes.
- Map product variants to primitive styling in one place.
- Pass accessible name/description explicitly for icon controls.
- Use `testId` only when needed and forward it to the actual interactive element.
- Merge caller classes after base/variant through a Tailwind merge helper.
- Avoid raw repeated class strings across features; promote a true pattern to the common kit.

## CSS/Tailwind

- Semantic utilities only for app chrome.
- Entity colour can be inline style because it is data.
- No arbitrary colour hex in JSX.
- Avoid arbitrary text/radius/spacing unless a documented dense-visual need exists.
- Theme flips through variables, not duplicated per-component dark classes.
- Styling/state selectors use semantic classes/data attributes, never `data-testid`.
- Reduced motion is global.
- Comments explain token collision/contrast reasons, not obvious declarations.

## Server

- Route handler validates params/body before use.
- Successful response bodies are still untrusted in the browser.
- Every scoped route calls one authorization seam.
- Patch validates merged row.
- Transactions roll back and rethrow.
- Map caller validation to 4xx and defects to redacted 5xx.
- Do not leak raw SQLite/library errors.
- Keep control/auth tables separate from portable domain tables.
- Use bounded integer parsing for operational env.
- Fail startup for unsafe partial configuration.
- Audit names, never values.

## Comments and TSDoc

Comment **why**:

- security boundary;
- race/interleaving;
- deliberate asymmetry;
- non-obvious accessibility choice;
- browser/library quirk;
- invariant maintained across files;
- reason a tempting catch/fallback is absent.

Do not narrate:

```ts
// Set loading to true.
setLoading(true)
```

Useful:

```ts
// A timeout cannot tell us whether the transaction committed. Refresh the authoritative
// list before a retry so one click cannot create a duplicate tenant.
```

Every exported shared symbol gets TSDoc with:

- purpose;
- preconditions;
- purity/I/O;
- `@throws` and what the throw means;
- security/tenant expectation where relevant;
- return semantics.

Keep comments current. A confident stale comment is more dangerous than no comment.

## Errors

- Catch as `unknown`.
- Use a total `errorMessage(unknown)` at UI surfaces.
- Add context with `new Error(message, { cause: error })`.
- Do not string-sniff local errors where a typed class fits.
- Do not replace a safe specific message with generic copy.
- Log only when it adds an operator breadcrumb; avoid double logging at every layer.
- Never log secrets, tokens or domain field values.

## Dependencies

Before adding one:

1. Is it already available through the stack?
2. Can a small tested helper do it more clearly?
3. What enters the client main chunk?
4. Does it work in browser, Node and target engines?
5. Is licence compatible?
6. Is maintenance/security posture acceptable?
7. Does it bring telemetry/network behaviour?
8. Can it be lazy-loaded?

Discuss new dependencies in an issue/PR. Pin sensitive/core versions when reproducibility matters.

## Git and change hygiene

- Small focused changes.
- Preserve unrelated work in a dirty tree.
- No destructive reset of user changes.
- DCO sign-off.
- Conventional-ish subject describing intent; releases use the established release format.
- Do not commit generated Paraglide output, reports, local DBs, agent config or production data.
- Update docs/tests in the same change.

## Code review checklist

- Is the rule in the correct layer?
- Is tenancy explicit?
- Does server authorize independently?
- Is untrusted data shape-checked?
- Are async results account/sequence safe?
- Are failures visible and causes preserved?
- Are feature-off/viewer/offline paths coherent?
- Does UI use semantic tokens and accessible controls?
- Are new types/fields exhaustive through persistence?
- Do tests prove the dangerous edge, not only the happy call?
