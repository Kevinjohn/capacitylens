# SQLite migration and upgrade-safety framework

Copy the task below into a sibling's coding-agent conversation. Replace `[PRODUCT]`, `[PREFIX]`,
the current schema versions and gate commands only where that sibling genuinely differs.

```text
Priority task: implement [PRODUCT]'s complete SQLite migration and upgrade-safety framework. Work
through the repository until the implementation, tests, rehearsal command and operator docs are all
green. Preserve unrelated working-tree changes and do not stage, commit, push or run remote CI
unless I separately ask.

First inspect the current database open/setup path, schema DDL, import/export version, auth/control
tables, transaction helper, backup implementation, package scripts, historical fixtures, operator
docs and repository-specific instructions. Use the existing architecture and naming conventions;
do not introduce a large migration dependency when a small in-process SQLite runner fits.

Required compatibility policy

1. New builds upgrade supported older databases forward.
2. Builds containing this framework refuse databases newer than they support.
3. Database upgrades use a coordinated single-server restart; mixed-version writers are unsupported.
4. Rollback is the previous image plus its verified pre-migration snapshot, never a down migration.
5. Be explicit that builds released before this downgrade guard cannot retroactively refuse a newer
   database and must be paired with a restored snapshot.

Separate version contracts

1. Rename/create the portable JSON/import/export version as `EXPORT_SCHEMA_VERSION` (or the
   sibling's equivalent).
2. Create an independent integer `DB_SCHEMA_VERSION` for the physical SQLite schema, including
   app-owned control tables and schema-affecting authentication work.
3. Update every import and test so the two numbers cannot be confused.
4. Any auth dependency/plugin upgrade that may change desired tables must bump `DB_SCHEMA_VERSION`,
   even when the auth library owns the DDL. A named marker migration is acceptable when no app SQL
   is required.

Database ownership and planning

1. Choose and document a unique signed 32-bit `[PRODUCT]` `PRAGMA application_id`.
2. Split database startup into:
   - raw connection open with no application DDL;
   - read-only migration planning/validation;
   - pre-migration snapshot;
   - explicit migration/initialisation.
3. Planning must reject before DDL:
   - `user_version` newer than `DB_SCHEMA_VERSION`;
   - a non-zero application id owned by another application;
   - a current database missing the expected application id;
   - an unclaimed non-empty SQLite file without a narrow, recognisable legacy [PRODUCT] shape.
4. Run `PRAGMA quick_check` before changing an existing database.

Migration registry and checksums

1. Add an immutable ordered registry. Each migration contains:
   - unique increasing integer version;
   - stable descriptive name;
   - complete stable checksum definition;
   - forward `up(db)` operation.
2. Compute a lowercase 64-character SHA-256 checksum with domain separation from the version,
   name and complete definition. The definition must include actual SQL blocks and named revisions
   for every code-based repair/backfill; do not hash only version and name.
3. Prefer self-contained/frozen migration definitions. Do not let an old migration silently inherit
   later changes from a mutable “current schema” helper.
4. Assert at module/test time that the newest migration equals `DB_SCHEMA_VERSION` and versions are
   ordered/contiguous after the selected baseline.
5. Never edit, reorder or delete a migration that has shipped. Correct it with a new version.

Migration ledger

1. Create a product-prefixed STRICT table equivalent to:

   CREATE TABLE [prefix]_schema_migrations (
     version INTEGER NOT NULL PRIMARY KEY,
     name TEXT NOT NULL,
     checksum TEXT NOT NULL CHECK(length(checksum) = 64),
     appliedAt TEXT NOT NULL
   ) STRICT;

2. Before planning writes, validate the ledger's exact columns/nullability/key and the exact ordered
   rows expected for `PRAGMA user_version`.
3. Refuse startup for missing, extra, reordered, renamed, timestamp-less or checksum-mismatched
   history. Never silently repair ledger evidence.
4. Legacy databases before the explicit baseline may legitimately lack the ledger; the baseline
   migration creates it.

Atomic runner

For every pending migration, in its own `BEGIN IMMEDIATE` transaction:

1. Create/validate the ledger infrastructure as necessary.
2. Apply the migration's DDL and data repair.
3. Run `PRAGMA foreign_key_check` before commit.
4. Insert version/name/checksum/current ISO timestamp into the ledger.
5. Stamp `[PRODUCT]` `application_id` and `user_version` in the same transaction.
6. Expose a narrow synchronous `beforeCommit` hook for tests/rehearsal only. Throwing or killing the
   process there must roll back schema, data, ledger and version stamps together.
7. Make nested transactions use savepoints and surface rollback errors without hiding the original
   failure.

After all migrations:

1. Assert the current app schema, app-owned control schema and migration ledger.
2. Enable foreign keys and require an empty `PRAGMA foreign_key_check` result.
3. Restrict the database and live WAL/SHM sidecars to owner read/write.
4. Keep a convenience `openDb()` wrapper for tests, while production explicitly uses open → plan →
   snapshot → initialise.

Authentication startup ordering

1. Validate all pure production and auth/provider configuration before schema mutation.
2. Allow auth construction/configuration with app-owned database setup deferred.
3. Expose read-only planning for app auth-control tables and library-owned auth schema work.
4. Include pending app, auth-control or library auth work in the pre-migration snapshot decision.
5. Apply app migrations, then app-owned auth controls, then the pinned library migration.
6. Re-plan the library schema afterward and refuse startup if any table/column work remains.
7. Auth-off databases must not grow auth tables.

Mandatory pre-migration rollback snapshot

1. Before any app/auth DDL on an existing on-disk database, write
   `[prefix]-pre-migration-vN-to-vM-<timestamp>.db`.
2. Use SQLite's online backup API, with `VACUUM INTO` only as a consistent fallback. Never raw-copy a
   live WAL database.
3. Write to an exclusive 0600 temporary filename, verify `quick_check` and source `user_version`,
   checkpoint/convert it into one standalone DELETE-journal database, remove temp sidecars, then
   atomically rename it.
4. Use the configured backup directory when present and otherwise the source database directory.
5. Do not create a snapshot for fresh or in-memory databases.
6. Never automatically retention-prune pre-migration snapshots.
7. Any creation/verification/permission failure must refuse startup before DDL.

Historical fixtures and tests

1. Add sanitised immutable database fixtures made with the last released schema:
   - auth off;
   - password auth with a fictional `.invalid` user, credential account and synthetic session;
   - every additional persisted auth shape the sibling supports.
2. Keep fixture data fictional. Tests must copy fixtures before opening and never mutate committed
   artifacts.
3. Test at least:
   - fresh database version/application-id/ledger stamp;
   - real historical upgrade and domain-row preservation;
   - auth identity/account/session preservation;
   - fresh-versus-migrated schema equivalence;
   - idempotent reopen;
   - missing/altered ledger refusal;
   - future-version, wrong-application and ambiguous-file refusal without mutation;
   - `quick_check` and `foreign_key_check`;
   - late failure rollback of all DDL, ledger rows and header stamps;
   - pre-migration snapshot source version/data/integrity/0600/standalone-file guarantees;
   - auth migration planning and post-migration convergence.

Release rehearsal command

Add a typed command such as `pnpm run rehearse:migrations` which defaults to the committed historical
password fixture and accepts `--source /path/to/database.db` plus an optional protected-development
`--keep`.

The rehearsal must:

1. Open the source read-only and take an online snapshot into a unique temporary directory. Never
   migrate or chmod the source.
2. Fail closed when it sees an unknown table the anonymiser does not cover.
3. On the temporary copy only, remap entity/auth ids while preserving relationships; replace all
   names, notes, emails, provider ids, access/refresh/id tokens, password hashes, sessions, IP/user
   agents, verification values, invitation tokens/hashes and MFA secrets/backup codes.
4. Enable secure deletion and `VACUUM` after redaction so old values are not recoverable from free
   pages.
5. Compute a deterministic SHA-256 digest over schema, all rows, `user_version` and `application_id`
   for rollback comparison. It is an unkeyed integrity/test digest, not secret protection; add it to
   any repository crypto inventory.
6. Happy path: create and verify the rollback snapshot, migrate, check domain/auth row preservation,
   ledger convergence, `quick_check`, `foreign_key_check`, and an idempotent reopen.
7. Disk failure: throw an error carrying `code: 'ENOSPC'` from the real runner's `beforeCommit` hook
   and prove the complete database digest is unchanged.
8. Process failure: spawn a child running the real migration, block in `beforeCommit`, send SIGKILL,
   reopen the WAL database and prove integrity plus the exact previous digest.
9. Delete temporary artifacts by default. Print only filename, versions, table/row counts and pass/
   fail status—never tenant content.
10. Run the rehearsal once against the committed fixture and once against an anonymised online
    snapshot of a representative long-lived installation. Confirm the original version and
    `quick_check` afterward.

Documentation and policy

Update together:

1. `AGENTS.md`: independent versions, explicit migration in the field flow, immutable migrations,
   checksummed ledger, retained fixtures, auth-upgrade version bump and required gates.
2. `DECISIONS.md`: one-way upgrade, downgrade refusal, coordinated restarts, snapshot rollback and
   release rehearsal.
3. Development guide: exact migration-authoring workflow, fixture policy, checksum rules and
   rehearsal commands.
4. Self-hosting/runbook: automatic rollback snapshot, coordinated upgrade, restore steps and why an
   old image must not open an upgraded database.
5. Server README and Changelog Unreleased.
6. Crypto inventory for new SHA-256 implementation paths.

Verification

1. Run focused migration/backup/auth tests while iterating.
2. Run [SERVER GATE].
3. Run [FULL APP GATE].
4. Remove only disposable old E2E databases that predate the ledger, then run [E2E GATE].
5. Run the default fixture rehearsal.
6. Run the representative long-lived-database rehearsal and confirm the source is unchanged.
7. Run whitespace/diff/artifact checks and ensure no temporary migration snapshots or anonymised
   installation files remain.
8. Follow the repository's version-specific remote-CI policy; do not infer permission to push.

Report the exact test/rehearsal counts, the source and target schema versions, whether the source was
unchanged, and any residual limitations. Do not claim builds released before the guard can refuse
newer databases. Do not overwrite unrelated changes.
```
