# Released database fixtures

These SQLite files are sanitised compatibility artifacts, not runtime seed data.

Each listed version has an `off` fixture containing only the application/control schema and a
`password` fixture containing Better Auth 1.6.23's schema plus one synthetic `.invalid` identity.
The generator revision is the historical source revision used to open and migrate a copy of the
sanitised v7 seed into that released shape.

| Top-level schema | Generator revision | Package version |
|---:|---|---|
| 7 | `36b6084` | `0.20.0-alpha.1` |
| 8 | `f0aa3b3` | `0.20.1-alpha.2` |
| 9 | `0f0fbdc` | `0.21.0-alpha.0` |
| 12 | `fd5374b` | `0.21.0-alpha.0` |
| 13 | `eda9243` | `0.23.0-alpha.0` |
| 14 | `00748d0` | `0.23.3-alpha.0` |
| 15 | `f6454ed` | `0.23.3-alpha.0` |
| 16 | `630c75d` | `0.26.0-alpha.1` |

Versions 10 and 11 were ordered migration steps first shipped together in the v12 build; no
released build used either as its top-level `user_version`, so there is no synthetic v10 or v11
fixture. The v12 artifacts deliberately retain the superseded v11 checksum stamped by that build.

Tests copy a fixture to a temporary path before opening it; committed artifacts must never be
migrated in place. Add one fixture for each future `DB_SCHEMA_VERSION` that actually ships, retain
old fixtures indefinitely, and generate them with the released build before changing migration
code. No production names, emails, tokens, hashes, or other data may enter this directory.
