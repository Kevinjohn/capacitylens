# Floaty — Standing decisions (digest)

Present-tense summary of the judgement calls that **still constrain the code**. Short by
design — read it whole. The dated blow-by-blow (every review/remediation round, with findings
and commit refs) lives in **[`docs/decisions-log.md`](docs/decisions-log.md)** — append-only,
not meant to be read whole. Source is the final authority; this is the index.

**Keeping it cheap:** new entries go in `docs/decisions-log.md` as one line + commit ref;
promote a call **here** only when future work must respect it, and edit the line here when a
promoted call changes (so the digest can't drift). See [`CLAUDE.md`](CLAUDE.md).

## Architecture
- **Local-first by default.** No backend, no login; data is one `AppData` blob in
  `localStorage` (`floaty/v3`).
- **Optional server behind one seam.** A Node + `node:sqlite` REST API (`server/`, off by
  default, `VITE_FLOATY_API=…`) plugs into the same `PersistenceAdapter`; nothing else changes.
  Server mode is last-writer-wins, no per-user isolation.
- **Multi-tenant by Account.** Every entity carries `accountId`; you pick a company on load
  (`AccountPicker`) and `activeAccountId` is never persisted. Scoped access goes through the
  `useScopedData` / `scopedTables()` seam.
- **Pure domain core is shared.** `shared/` (`@floaty/shared`) owns types, validation,
  integrity, cascade, import-remap, migrate, seed — imported by both app and server so they
  can't drift.

## Persistence
- **Debounced writes, flushed on unload** (`pagehide` + `visibilitychange→hidden`) so a tab
  close inside the debounce window doesn't drop the last edit.
- **Seed once, gated on a persistent marker** (not emptiness) — clearing all data does NOT
  re-seed.
- **Schema migrated on open** (introspection-gated, idempotent); `assertSchemaCurrent` throws
  loudly at startup on any required-column drift or `optional?`-vs-`NULL` mismatch, instead of
  failing silently on a later write.

## Import — repair, don't reject
- **Forms reject; import + server strip/repair.** Import sanitises per record (clean text,
  clamp hours, fresh id when missing), drops dangling **required** FKs (mirrors cascade) and
  unbinds dangling **optional** ones (mirrors set-null); one id-map **per table**.
- **Shape-checked before migrate** (`looksLikeFloaty`) so non-Floaty JSON can't wipe data;
  **confirmation dialog** + **undoable** `importData`; honest delta ("imported N, M skipped").
- **Caps** on file size + record count (self-DoS / JSON-bomb).

## Scheduling & capacity
- **Two distinct "over" signals, kept separate:** the per-day **over-marker** flags *any* work
  on a zero-capacity day; the **utilisation %** / `overSoon` red flag is a working-day-only
  ratio over a **fixed forward 14-day window from today** (decoupled from zoom/pan). They
  answer different questions — don't merge them.
- **Blocks mode allows `hoursPerDay: 0`** (span counts, load ignored); resources still require `> 0`.
- **Capacity advisory at allocation time is non-blocking** (warns on over-capacity / time-off
  overlap; save still allowed). One source: `lib/capacity.ts` `capacityAdvisory()`.

## UI & product
- **"Utilisation" is the term** everywhere on the schedule (not "Load").
- **Theme is device-global** — own key (`floaty/theme`), NOT in `AppData`/export. Default
  **light**; `system` follows `matchMedia`; FOUC guard in `index.html`.
- **Utilisation display toggles are device-global** too (`floaty/utilizationPrefs`, default all-on).
- **Undo/redo is keyboard-only** (⌘Z / ⌘⇧Z, global in `AppShell`); the toolbar buttons are
  intentionally hidden (clearer affordance is a TODO).
- **Colours are preset swatches only** (no custom hex) → a stored colour is always a valid
  `#rrggbb`. Palette = 13 hues × 4 shades generated from HSL (`lib/palette.ts`).
- **Resource colour derives from its discipline** — no per-resource colour control.
- **Placeholders** bind to one project but may take *general* tasks, so the modal's Project
  select stays **enabled but restricted** ("locked" = restricted, not immutable). In the
  schedule they sort after people, show an `@` avatar + diagonal hatch, and a quoted name.
- **Unsaved-changes guard:** the modal closes only on a backdrop press that both starts and
  ends on the backdrop; once dirty, accidental dismiss (backdrop/Escape) is refused, and a
  `beforeunload` guard covers tab-close. Dirty also tracks `aria-pressed` toggle clicks.

## Text validation
- **Denylist, not allowlist.** Reject emoji + symbol-other, control/format/surrogate/private/
  unassigned, and keycap/variation-selector marks — but allow all letters/marks/digits/
  punctuation/whitespace + currency/math, so `José`, `Müller`, `O'Brien & Co`, CJK and `€£+=`
  pass. One definition in `shared/src/lib/strings.ts` (`MAX_NAME_LENGTH` 100 /
  `MAX_NOTE_LENGTH` 1000), used by client **and** server. Forms reject inline; import/server **strip**.

## Security posture (pre-share)
- **No app-level auth.** The demo's subdomain HTTP auth covers the small trial; last-writer-wins.
- **CSP:** `object-src`/`base-uri` ship in `index.html`; a full `script-src` policy belongs in
  a host response header (where the demo's auth lives), not the app.
- **Server `ownsRow`** tenant check is defense-in-depth, not real isolation (account is
  client-asserted until session auth lands).

## Performance (and standing non-goals)
- **Row virtualization** is implemented (spacer windowing, pure window math; off-screen rows
  dropped, sticky column / flow / test markup unchanged).
- **Scheduler model is O(A+T+R)** — grouped id→entity maps + a single per-resource slice; the
  model `useMemo` keeps each row's slice referentially stable so `React.memo` on lanes/bars is
  effective.
- **Date hot path compares zero-padded `YYYY-MM-DD` strings** (`isWithin`) rather than re-parsing.
- **Deliberately NOT done at this size:** a generic store/CRUD factory or schema-driven forms;
  a custom listbox to replace native `<select>` (OS popup misalignment accepted);
  measurement-based row virtualization for font-scaling (body rows keep fixed px; only the date
  header uses `minHeight`); import id-dedup beyond repair.

## Testing & process
- **Green gate** = `npm run gate` (`tsc -b` + `eslint .` + `vitest run` + `vite build`) **and**
  `npm run e2e` (`playwright test`). The `server/` workspace is out of the root gate (needs
  `--experimental-sqlite`); `npm run gate:server` covers it.
- **Two oracles beyond "tests pass":** screenshots are the **visual** oracle (role/DOM
  assertions prove behaviour, not appearance); `@axe-core/playwright` is the **a11y** oracle
  (light + dark + a modal).
- **Modularity:** only pure extractions land behind the green gate (the gate *proves* them
  safe); high-churn structural splits (store slice-by-concern, a viewport hook, grid
  render-splits) wait until a **characterisation test is written first**.
