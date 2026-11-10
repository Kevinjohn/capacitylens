# US-PRI-02 — Preserve protected names on non-Owner writes

As a company Owner, I want permitted non-Owner edits to preserve private identity fields so that ordinary changes cannot expose or overwrite them.

**Status:** Current

**Access:** Owner may manage privacy fields; Admin and Editor may make permitted ordinary edits; Viewer is read-only

**Entry:** Client and Project create/update and lifecycle operations

**Documentation:** [Privacy](../../docs-src/security/privacy.md)

**Source:** [native_authorization.spec.ts](../../apps/backend/tests/functional/auth/native_authorization.spec.ts)

## Acceptance criteria

- Non-Owner writes preserve protected identity fields and responses redact them; Owner writes may change privacy fields.
