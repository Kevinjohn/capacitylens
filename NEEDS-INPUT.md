# Needs input

Open product questions to revisit with the owner. Don't silently resolve these — flag them.

## Resolved by assumption (confirm)
- **Local-first by default.** Data is one `AppData` blob in `localStorage` (`floaty/v3`); no
  backend, no login. The optional server is off unless `VITE_FLOATY_API` is set. Confirm this stays
  the default — turning the server on for everyone is a behaviour change (shared dataset,
  last-writer-wins).
- **Tenant picker is not auth.** You pick an Account on load (`AccountPicker`) and the dataset is
  scoped to it; `activeAccountId` is never persisted. This is convenience scoping, not a security
  boundary. Confirm that's acceptable for the current (trusted) audience.
- **Import repairs, it doesn't reject.** Forms reject bad input; import + server strip/repair per
  record (clean text, clamp hours, fresh ids, drop dangling required FKs). Confirm owners want a
  forgiving import over a strict all-or-nothing one.

## Genuinely open
- **Capacity advisory stays non-blocking.** Over-capacity / time-off overlaps warn at allocation
  time but never block the save (`lib/capacity.ts` `capacityAdvisory()`). Confirm owners want the
  soft warning, or do some want a hard stop on overbooking?
- **Undo/redo affordance.** Undo/redo is keyboard-only (⌘Z / ⌘⇧Z); the toolbar buttons are hidden
  on purpose pending a clearer affordance. Do owners want visible buttons, or is keyboard enough?
- **Shared server dataset for the demo.** `docs/server-migration-plan.md` describes moving the
  friends-demo onto the DB (daemon + `/api` proxy + Basic Auth + persistent SQLite). Build-time
  flag with **no localStorage fallback** — the server becomes a hard dependency. Confirm before
  cutting over.
- **Real auth + per-account isolation.** Stage C of the migration plan (the big one). Today the
  server's `ownsRow` tenant check is defence-in-depth, not real isolation — account is
  client-asserted until session auth lands. Required before exposing isolated user data publicly.
- **Concurrency / conflict UI.** Server mode is last-writer-wins; optimistic concurrency needs a
  client-side conflict UI (Stage B), not just the env flag. Build only when concurrent edits matter.
- **Postgres.** `server/` is raw `node:sqlite` (no ORM), so a move to Postgres (Stage E) is a
  rewrite, not a config change. Only if the SQLite single-file model is outgrown.
