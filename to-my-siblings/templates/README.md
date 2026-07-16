# Templates

These are rewriting aids. Optionally create a working sibling with
`node to-my-siblings/reference-kit/scripts/create-sibling.mjs --name "Product" --slug product ../product`,
then use these to adapt the generated contracts to the new domain.

| Template | Use |
| --- | --- |
| [`AGENTS.template.md`](AGENTS.template.md) | Short root instructions for coding agents |
| [`DECISIONS.template.md`](DECISIONS.template.md) | Present-tense standing decisions |
| [`feature-proposal.md`](feature-proposal.md) | Substantial issue/design proposal |
| [`environment-register.template.md`](environment-register.template.md) | Complete `.env.example` checklist |
| [`database-migration-framework.md`](database-migration-framework.md) | Copy-ready agent task for checksummed SQLite upgrades and release rehearsals |
| [`optional-hardening-migration.md`](optional-hardening-migration.md) | Copy-ready agent task for the OSS baseline/hardened security split |
| [`release-checklist.md`](release-checklist.md) | Maintainer release/deploy handoff |
| [`user-story-reference.template.md`](user-story-reference.template.md) | Exact visible acceptance contract |

Replacement checklist:

- product display name and lowercase slug;
- environment/storage/package prefixes;
- repository owner/URLs/security links;
- domain nouns and non-goals;
- role/action differences;
- commands/ports;
- production topology;
- licence/support promises;
- CI/version policy;
- optional internal provenance/default record;
- portable export and physical database version baselines.

Run all three product gates plus a literal/domain search after adapting. The generator removes the
obvious brand strings, but inherited scheduler concepts still require deliberate conversion.
