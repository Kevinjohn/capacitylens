# [Product] repository guidance

## Product boundary

[Product] is a deliberately small [granularity] [category] for [specific audience].
[Adjacent system A], [B] and [C] are non-goals.

## Architecture

- `shared/` is the pure domain core imported by app and server.
- `src/store/[store].ts` orchestrates client state, ids/timestamps and history.
- `src/data/` owns explicit persistence adapters, retry and offline snapshots.
- `server/` is the default SQLite API.
- `VITE_[PREFIX]_DEMO=1` selects the in-memory demo; it never persists domain data.
- Scoped reads use [named seam]. The server independently authorizes every tenant operation.

## Load-bearing invariants

- Every scoped entity carries `accountId`; selected account state is transient.
- [Domain edge rule with equality/inclusive semantics.]
- [Distinct metric/window rules that must not be merged.]
- [Canonical user-facing vocabulary.]
- Forms reject invalid input; import/server sanitise only safe repairs.
- Device preferences are not tenant data.
- Offline snapshots are opt-in, expiring and read-only; no queued offline writes.
- Surface errors; no empty catches on a data path. Follow `DEFENSIVE-CODING.md`.
- New fields flow through shared types → full fixtures → server columns → explicit SQLite migration
  → sanitisation. Keep portable export and physical database versions independent. Retain every
  shipped migration and released database fixture; never alter a checksummed migration definition.
  Schema-affecting authentication upgrades also advance the physical database version.

## Authentication

- Password auth is stable; [provider posture].
- Production password mode supports opt-in required MFA, defaults to breached-password screening
  and always enforces fixed-lifetime sessions.
- New external identities require verified email and invitation.
- Never weaken server authorization because UI hides an action.
- Unknown role/auth state fails closed.
- Identity-global credential/session actions require authority across every target account.

## Documentation

- `DECISIONS.md` holds standing decisions.
- Public/product detail belongs in `README.md`; implementation in `docs/development.md`.
- [List operator docs.]
- Update `user-stories/REFERENCE.md` first for visible route/label/test-id/seed changes.
- Add user-visible changes under `CHANGELOG.md` → Unreleased.

## Green gate

Run:

```bash
pnpm run gate
pnpm run gate:server
pnpm run e2e
```

[Document cross-browser/mutation commands and test-server constraints.]

## GitHub CI policy

- Patch-version-only: [policy].
- Minor version: [policy].
- Major version: [policy].
