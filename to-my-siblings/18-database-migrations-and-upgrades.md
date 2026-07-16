# 18 — Database migrations and upgrade safety

A self-hosted product does not control how old an installation may be when it next upgrades. A
database migration system therefore has to protect real historical files, not only create today's
schema successfully in a clean test database.

This chapter is a family invariant for siblings using persistent SQLite. The exact module names may
change, but the compatibility, audit, snapshot, rehearsal and rollback behaviour should not.

## Separate the data contracts

Portable exports and physical database files are different compatibility surfaces:

- `EXPORT_SCHEMA_VERSION` describes JSON/import/export data understood across adapters.
- `DB_SCHEMA_VERSION` describes the physical SQLite schema, including application-owned control
  tables and schema-affecting authentication changes.

Never reuse one number for both. An export-only change should not make an old server refuse an
otherwise compatible database. A control-table or authentication migration must not escape
database downgrade protection merely because exported domain entities did not change.

## Own and identify the database

Use both SQLite header fields deliberately:

- `PRAGMA user_version` stores the current physical schema version.
- `PRAGMA application_id` identifies the file as belonging to the sibling.

Choose and document a unique signed 32-bit application id. Startup must reject:

- a version newer than the running build supports;
- a non-zero application id belonging to another application;
- a current-version file without the expected application id;
- an unclaimed file that has tables but does not match a narrowly recognised legacy shape.

Legacy recognition is a one-time compatibility bridge, not permission to mutate any SQLite file
that happens to contain a generic table name.

## Use an immutable ordered migration registry

Each migration has:

- one unique, increasing integer version;
- a stable descriptive name;
- a stable SHA-256 checksum of its complete immutable definition;
- one forward `up` operation.

The newest registered migration must equal `DB_SCHEMA_VERSION`, and registered versions after the
chosen baseline must be contiguous. Never edit, reorder or delete a migration that reached an
installation. Restore the released definition and add a new version that corrects it.

The checksum definition must cover the real migration semantics: SQL blocks, data backfills and
named revisions of code-based repairs. Do not hash only `version + name`; that records identity but
cannot detect changed behaviour. Prefer self-contained migration files or frozen SQL/repair
definitions so later changes to “current schema” helpers cannot silently change an old migration.

## Keep a database-side migration ledger

Create an application-owned table equivalent to:

```sql
CREATE TABLE application_schema_migrations (
  version INTEGER NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK(length(checksum) = 64),
  appliedAt TEXT NOT NULL
) STRICT;
```

The table name should be product-prefixed. Insert its row in the same transaction as the migration
and `user_version`/`application_id` stamps. Before planning any write, validate that:

- the table exists whenever the database version requires it;
- its columns, nullability and primary key match exactly;
- it contains exactly the expected ordered rows for `user_version`;
- every name and checksum matches the running build;
- every row has an application timestamp.

Missing, extra, reordered, renamed or checksum-mismatched history is a startup refusal. Do not
silently repair the ledger: it is evidence about what code touched the database.

## Split open, plan, snapshot and initialise

Do not let the database constructor apply DDL. Production startup should follow this order:

1. Validate pure production configuration that does not need storage.
2. Open the SQLite connection without application DDL and with foreign keys disabled for planning.
3. Read and validate application id, database version and migration history.
4. Resolve authentication/provider configuration without creating tables.
5. Plan application, authentication-control and library-owned authentication schema work.
6. If an existing on-disk database needs any work, create and verify a pre-migration snapshot.
7. Apply application migrations.
8. Apply explicitly planned authentication/control migrations.
9. Assert current schema, migration history, `quick_check` and `foreign_key_check`.
10. Enable foreign-key enforcement and only then accept traffic.

Keep a convenience `openDb()` wrapper for tests and embedded callers, but make the production
entrypoint use the explicit open → plan → snapshot → initialise sequence.

## Make every version step atomic

For each pending migration:

1. `BEGIN IMMEDIATE` so another writer cannot race the upgrade.
2. Apply DDL and data repair.
3. Run `PRAGMA foreign_key_check` while the changes are still uncommitted.
4. Insert the version/name/checksum/timestamp ledger row.
5. Stamp `application_id` and `user_version`.
6. Commit.

Any thrown error, `ENOSPC`, failed assertion or process termination before commit must leave the
previous schema, data, ledger and version stamps intact. Nested application transactions should use
savepoints rather than issuing a second `BEGIN`.

Shape introspection is useful for a one-time legacy baseline and for post-migration assertions. It
must not remain an unversioned mechanism that automatically adds whatever columns the current model
happens to contain.

## Treat authentication schema as part of the upgrade

An authentication library may own its SQL, but the product owns startup safety:

- validate provider/auth configuration before explicit DDL;
- expose a read-only “pending auth migrations” plan when the library supports it;
- include pending library and application-owned auth-control work in the snapshot decision;
- run the pinned library migration before serving traffic;
- introspect again afterward and refuse startup if work remains.

Any dependency/plugin upgrade that may change the desired auth schema also advances
`DB_SCHEMA_VERSION`. A named marker migration is enough when the application has no SQL of its own;
the version bump ensures the previous server refuses the newly touched database.

## Always create a rollback point before DDL

Scheduled backups may be optional. The pre-migration rollback snapshot for an existing database is
not optional.

Use SQLite's online backup API (or a verified `VACUUM INTO` fallback), never raw `cp` of a live WAL
database. The snapshot must:

- be written before application or authentication DDL;
- use an exclusive temporary filename and atomic rename;
- pass `PRAGMA quick_check`;
- contain the expected source `user_version`;
- be checkpointed into one standalone database file with no required WAL/SHM companions;
- use owner-only file permissions;
- remain outside rolling snapshot pruning until the new release is accepted.

If the snapshot cannot be created or verified, startup refuses. Rollback means stopping the API,
preserving the failed database for diagnosis, restoring this snapshot without stale sidecars and
starting the matching previous image. Do not add down migrations for this product shape.

## Keep released database fixtures

Fresh-database tests do not exercise migrations. Keep immutable, sanitised SQLite fixtures made by
released builds, including every supported authentication shape.

For each fixture, test:

- upgrade from its real historical version;
- preservation of domain rows, identities and sessions as appropriate;
- fresh-versus-migrated schema equivalence;
- correct ledger row/checksum and version/application-id stamps;
- idempotent reopen;
- integrity checks;
- future-version and wrong-application refusal;
- transaction rollback and retry after a late failure.

Fixtures contain only fictional data and invalid example domains. Tests copy them before opening and
never migrate the committed file in place.

## Rehearse every schema-bearing release

Provide one command that defaults to a committed historical auth fixture and accepts
`--source /path/to/database.db` for a representative long-lived installation.

The command must never migrate the source. It should:

1. Take a consistent online snapshot into a temporary directory.
2. Fail closed if it encounters an unknown table not covered by the anonymiser.
3. Remap ids while preserving relationships.
4. Replace names, notes, emails, provider ids and all credential/session/invite/MFA material.
5. Enable secure deletion and `VACUUM` the copy so replaced source values do not remain in free
   pages.
6. Run the normal migration with a verified pre-migration snapshot.
7. Check row preservation, ledger convergence, `quick_check`, `foreign_key_check` and idempotence.
8. Inject an `ENOSPC` immediately before commit and prove the complete database digest is unchanged.
9. Kill a child process while the real migration transaction is open, reopen the WAL database and
   prove recovery returns the exact previous digest.
10. Delete temporary artifacts by default and print only schema version plus table/row counts.

An optional `--keep` is acceptable for protected local diagnosis, but installation-derived database
files must never be committed, attached to an issue or copied into ordinary test fixtures.

## Deployment compatibility policy

The small SQLite sibling default is:

- new builds upgrade old databases;
- builds containing this framework refuse schemas newer than they know;
- upgrades are coordinated single-server restarts;
- mixed-version or rolling writers are unsupported;
- rollback restores the pre-migration snapshot and runs its matching image;
- future zero-downtime/multi-instance support requires expand → backfill/dual-read-write → contract
  changes across releases.

Be explicit that builds released before the downgrade guard cannot retroactively refuse a newer
database. Returning to one of those builds always requires restoring its matching snapshot.

## Definition of done

A schema-bearing change is incomplete until:

- portable and physical versions were considered independently;
- the next immutable migration and checksum definition exist;
- fresh DDL/current model and post-migration assertions agree;
- control/auth changes participate in planning and snapshotting;
- historical fixtures and failure-path tests pass;
- the rehearsal passes against a released fixture and a representative anonymised installation;
- changelog, development guide, self-hosting guide and runbook explain upgrade and rollback;
- all app, server and E2E gates pass;
- the release retains the old image and generated rollback snapshot until acceptance.

CapacityLens's working implementation is indexed in
[the reference map](16-capacitylens-reference-map.md). The copy-ready agent task is
[`templates/database-migration-framework.md`](templates/database-migration-framework.md).
