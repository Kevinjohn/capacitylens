# Released database fixtures

These SQLite files are sanitised compatibility artifacts, not runtime seed data.

Each listed version has an `off` fixture containing only the application/control schema and a
`password` fixture containing Better Auth 1.6.23's schema plus one synthetic `.invalid` identity.
The generator revision is the historical source revision used to open and migrate a copy of the
sanitised v7 seed into that released shape.

| Top-level schema | Generator revision | Package version  |
| ---------------: | ------------------ | ---------------- |
|                7 | `36b6084`          | `0.20.0-alpha.1` |
|                8 | `f0aa3b3`          | `0.20.1-alpha.2` |
|                9 | `0f0fbdc`          | `0.21.0-alpha.0` |
|               12 | `fd5374b`          | `0.21.0-alpha.0` |
|               13 | `eda9243`          | `0.23.0-alpha.0` |
|               14 | `00748d0`          | `0.23.3-alpha.0` |
|               15 | `f6454ed`          | `0.23.3-alpha.0` |
|               16 | `630c75d`          | `0.26.0-alpha.1` |
|               23 | `92b2af6`          | `0.27.1-alpha.1` |

Versions 10 and 11 were ordered migration steps first shipped together in the v12 build; no
released build used either as its top-level `user_version`, so there is no synthetic v10 or v11
fixture. The v12 artifacts deliberately retain the superseded v11 checksum stamped by that build.

The v23 pair was generated from tag `v0.27.1-alpha.1` at full revision
`92b2af6ffb1ee172ea545a2ac01b320049a8cac0`, using its frozen lockfile with Node 24.16.0 and pnpm
11.4.0. The released build migrated copies of the sanitised v7 off/password seeds; the password
shape then converged through the release's pinned Better Auth 1.6.23 migrator. Both artifacts were
vacuumed into delete-journal mode and passed `quick_check` and `foreign_key_check`. Their SHA-256
digests are:

- `v23-off.db`: `910bcbfaaf9405740c1e31cf7358fc1643a94690c0a5aadbc7fd9605eb0536d5`
- `v23-password.db`: `e6025ceb31905b6a8f99f1bad4870cc3495bf848912eb37ecf49bc79f831adf3`

Tests copy a fixture to a temporary path before opening it; committed artifacts must never be
migrated in place. Add one fixture for each future `DB_SCHEMA_VERSION` that actually ships, retain
old fixtures indefinitely, and generate them with the released build before changing migration
code. No production names, emails, tokens, hashes, or other data may enter this directory.
