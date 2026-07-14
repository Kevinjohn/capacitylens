# CapacityLens — Defensive coding & commenting standard

CapacityLens is a **server-backed, multi-tenant** app whose source of truth is one SQLite file.
That raises the stakes on failure handling — a swallowed error here
isn't a missed log line, it's **silent data corruption the user can't see and can't undo**. This
doc is the standard every contributor (and every AI editing this repo) follows. It's short by
design; read it whole.

This document is the review standard. Treat any deviation as a bug; do not rely on historical
claims that a subsystem was already audited.

---

## 1. The one rule: **surface, never swallow**

When something goes wrong, the error must end up somewhere a human (user, operator, or contributor)
can see it. A `catch` block has exactly three legitimate jobs:

1. **Re-throw with more context — and ALWAYS attach `{ cause: e }`** so the *full error chain*
   survives, not just a re-worded message:
   `catch (e) { throw new Error(\`Corrupt JSON in ${table}.${col} (id=${id})\`, { cause: e }) }`.
   ESLint's **`preserve-caught-error`** rule enforces this for native errors; it does **not** fire on
   custom error classes or bare `catch {}`, so those are on you — our custom classes (`LoadError`,
   `ValidationError`) take an `ErrorOptions` and forward the cause, and a bare `catch {` that
   re-throws should bind the error (`catch (e)`) and pass it through.
2. **Route it to a visible surface** — a thrown integrity message → a form `FieldError` / a `Toast` /
   the `ErrorBoundary`; a load failure → a typed `LoadError` that picks the right recovery screen;
   a server fault → the redaction funnel (`statusFor → fail`). The user is told what happened.
3. **Degrade to a documented default** — and *only* for genuinely non-load-bearing state (see §5).

There is **no fourth job.** `catch {}` that drops the error, or `catch { return null }` on a data
path, is the anti-goal: it turns a loud, fixable failure into invisible corruption. **We are in the
testing phase — prefer a loud, clearly-labelled crash over a quiet wrong answer.**

A "soft swallow" counts too: catching a specific, already-authored message and replacing it with a
generic one throws away information the user needed. Surface the real reason.

---

## 2. The error model (already in place — extend it, don't reinvent it)

Two tiers, kept separate:

- **Validation returns a value; enforcement throws.** Validators (`shared/lib/integrity.ts`,
  `src/lib/validation.ts`) return `ValidationResult { ok, errors }` or call a `fail(field, msg)`
  callback — they **never throw**. The write boundary (`shared/domain/mutations.ts`, the store,
  `server/validate.ts`) converts a failed result into a **thrown `Error` whose message is safe to
  show the user** ("That record does not belong to the active company.").
- **The UI catches the throw and surfaces it.** Form submit handlers and gesture-commit handlers
  wrap the store mutation in `try/catch` and relay `errorMessage(e)` to a `FieldError`/`Toast`.

So the flow is: **reject early with a value → throw at the boundary with a clear message → catch at
the UI and show it.** Every new feature follows this. Don't put `try/catch` *inside* a validator,
and don't let a store mutation throw past a form handler uncaught.

**Typed, classified errors over stringly-typed ones:** `LoadError('corrupt' | 'unavailable')`
routes recovery; `ValidationError` marks caller-fault (→ HTTP 400) vs a real bug (→ 500);
`AuthConfigError` frames a boot refusal. Add to this vocabulary rather than `throw new Error` +
string-sniffing — except where we already sniff a *library's* message (e.g. SQLite "constraint
failed"), which must be pinned by a test.

---

## 3. Where `try/catch` belongs

Wrap the boundary where the world is untrusted or fallible. Every one of these should be guarded
**and** surface on failure:

| Boundary | Examples | On failure |
|---|---|---|
| **Parsing** | `JSON.parse`, `parseData`, `res.json()` | re-throw clear message / typed error |
| **Storage I/O** | preference storage, IndexedDB offline cache, SQLite reads | classify, surface or fail closed |
| **Network** | `fetch`, auth `getSession`, sign-in/out | `LoadError('unavailable')` / 503 / inline message |
| **Untrusted input** | import payloads, `/api/*` bodies, an auth `/me` response | sanitize/validate, never trust an `as` cast |
| **Runtime/env** | `crypto.randomUUID`, `Intl.DateTimeFormat(tz)`, `matchMedia`, `import.meta.env` | clear thrown message or documented default + `console.warn` |
| **Store-mutation call sites** | `add*/update*/delete*` in form & gesture handlers | catch → `fail(null, e.message)` / `setNotice(msg,'error')` |
| **Browser file ops** | `downloadTextFile` (backup-before-delete!) | **throw** — a failed backup never saves a partial file and surfaces loudly (the export itself stays optional) |

If you add a new one of these, guard it and pick a surface from §1.

---

## 4. Where `try/catch` is **harmful** — do NOT wrap

This is the half a naive "add try/catch everywhere" sweep gets wrong. In these places a `catch`
would **hide data corruption** (the exact thing we're defending against) or add noise that buries
real bugs. Each carries a short guard-comment in the code so the next contributor doesn't re-add it.

- **Pure functions on the render hot path** — `resolveBarColor`, `buildSchedulerModel`,
  `virtualWindow`, `lanePacking`, pure `gestureMath`, `fuzzyScore`. A throw here is a *programmer*
  error, not user input. Wrapping it turns a visible zero-width-bar symptom into a blank grid.
  **Push the guard into the math instead** (see §6).
- **The store's deliberate integrity throws** — `mutate`, the `assert*` helpers, `importData`,
  `undo`/`redo`. Their *job* is to throw so no path can persist bad multi-tenant data. A `try/catch`
  around them converts the last-line data-safety guarantee into silent corruption.
- **The server's re-throw points** — `validateWrite`'s re-tag, `tx()`'s rollback-and-rethrow,
  `drain()` advancing `lastSynced` only after a successful batch. Swallowing here lets invalid
  writes reach SQLite or drops unsynced data from future diffs.
- **Total helpers** — `errorMessage(unknown): string` never throws; it's the *sink* for catches,
  not something to wrap.

When in doubt: **if the function can't receive untrusted input and can't do I/O, it doesn't need a
`try/catch` — it needs a precondition comment.**

---

## 5. The only acceptable swallows (and they must be commented)

A bare `catch {}` is correct in exactly these shapes, each requiring a one-line *why*:

- **Page teardown** — `flushOnUnload().catch(() => {})`: the page is closing, nothing can act on
  the error, and a surviving reload re-diffs against the source of truth.
- **A surfacing side-effect** — `/api/health` deep check: the `503` *is* the surfacing; logging
  and re-throwing would defeat the uptime monitor.
- **Device-global, non-tenant preferences** — `theme`, `utilizationPrefs`, `sidebar`, the rotate
  hint: a blocked/corrupt preference store falls back to a documented default. Losing a view-toggle
  cannot corrupt account data, so swallow-to-default is right *here and only here*.
- **Best-effort diagnostics** — `res.text().catch(() => '')` reading an error body: swallow the
  *nice-to-have detail*, never the operation itself.

Everything else surfaces. If a fallback is genuinely correct but the cause would otherwise be
invisible, **leave a breadcrumb** (`console.warn(e)`) — handled-but-logged satisfies the rule;
totally-silent does not.

---

## 6. Push guards into the pure core, not the call site

The codebase's signature pattern: low-level pure math clamps bad values to a safe, *visible* result
instead of throwing, so callers don't need defensive wrappers and corruption shows as a harmless
symptom rather than a crash or a swallow.

- `Number.isFinite` guards drop NaN day-indices into lane 0 / zero-width bars (`lanePacking`, `dateMath`).
- `endDateForSpan` clamps a runaway span to `[1, MAX_SPAN_DAYS]` so a derived date can't overflow
  `format()` into a `RangeError` mid-render.
- `utilization` returns `0` when capacity is `0` (no divide-by-zero).

When you want "more safety" on a pure path, **add a clamp/early-return in the pure function**
(with a why-comment), not a `try/catch` at every caller.

---

## 7. Comments & TSDoc — the bedrock of an open-source repo

We comment for the **junior contributor reading this cold**, and we explain **why**, not what.

- **Every exported symbol gets TSDoc.** `shared/` is published (`@capacitylens/shared`) and imported by
  others — its public API is the highest priority. State **preconditions** ("input must be a
  validated `ISODate` — see `isValidISODate`"), **`@throws`** (and what a throw *means* — e.g. "a
  throw from `downloadTextFile` means the file was NOT saved; do not proceed with a dependent
  delete"), and **purity** ("returns a new `AppData`, never mutates").
- **Document contracts invisible at the type level.** The store's CRUD actions *throw on a
  tenancy/integrity violation and silently no-op on a stale id* — that's the single most important
  thing a caller must know, and the type signature doesn't say it. Write it on the interface.
- **Why-comments on non-obvious decisions and cross-file invariants** — especially where safety
  depends on something non-local ("this cast is sound because the row was just sanitized";
  "correctness depends on `SCOPED_KEYS` being exhaustive — the gate enforces it").
- **Guard-comments** on the §4 "don't wrap this" spots, so the next hardening pass doesn't regress them.
- **One-paragraph headers** on intricate components/files (`AllocationBar`'s gesture lifecycle,
  `SchedulerGrid`'s virtualization + drag-freeze, `AuthProvider`'s "failure renders the app" policy).
- **Keep docs honest.** A comment that describes behaviour the code doesn't implement is worse than
  none — fix or delete it (and pin fragile assumptions, like a library's error wording, with a test).

---

## 8. Drift-proofing stays type-level

Where exhaustiveness can be a *compile* error, prefer that to a runtime check: `Record<Enum, …>`
maps, `const _exhaustive: never = key`, the `CheckColumns`/`UPSERT_ORDER` guards. A new enum member
or entity field that misses a list should **fail the gate**, not fall back at runtime. Don't bolt a
runtime default onto something the type system already guarantees — it's dead code that hides the
next real drift.

---

**Green gate** (`pnpm run gate` + `pnpm run e2e`, plus `pnpm run gate:server`) is the proof. A change
that follows this standard but reds the gate isn't done. See [`CLAUDE.md`](CLAUDE.md) and
[`DECISIONS.md`](DECISIONS.md).
