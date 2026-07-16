# Released database fixtures

These SQLite files are sanitised compatibility artifacts, not runtime seed data.

- `v7-off.db` represents the last pre-runner application/control schema with authentication off.
- `v7-password.db` adds Better Auth 1.6.23's password tables and a synthetic `.invalid` identity.

Tests copy a fixture to a temporary path before opening it; committed artifacts must never be
migrated in place. Add one fixture for each future `DB_SCHEMA_VERSION` that actually ships, retain
old fixtures indefinitely, and generate them with the released build before changing migration
code. No production names, emails, tokens, hashes, or other data may enter this directory.
