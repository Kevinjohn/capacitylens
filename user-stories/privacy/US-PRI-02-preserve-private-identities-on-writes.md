# US-PRI-02 — Preserve protected names on non-Owner writes

As a company Owner, I want permitted non-Owner edits to preserve private identity fields so that ordinary changes cannot expose or overwrite them.

**Status:** Current

**Access:** Owner may manage privacy fields; Admin and Editor may make permitted ordinary edits; Viewer is read-only

**Entry:** Client and Project create/update and lifecycle operations

**Documentation:** [Privacy](../../docs-src/security/privacy.md)

**Source:** [native_authorization.spec.ts](../../apps/backend/tests/functional/auth/native_authorization.spec.ts)

## Acceptance criteria

- Non-Owner writes preserve protected identity fields and responses redact them; Owner writes may change privacy fields.

## User flow

```mermaid
flowchart TD
  edit["Admin or Editor changes an ordinary field"] --> submit["Submit update without protected identity fields"]
  submit -->|allowed| response["Server preserves private identity and returns projected row"]
  submit -->|protected fields supplied by non-Owner| refused["Server refuses the request"]
```

## Code flow

```mermaid
flowchart TD
  ui["ClientForm or ProjectForm builds ordinary update"] --> client["typed planning client sends mutation"]
  client --> server["mutatePlanning resolves authority and executes intent"]
  server --> policy["entity_policy preserves hidden fields and checks privacy edits"]
  policy --> writer["planning writer persists allowed changes"]
  server --> response["transformState redacts private response"]
```

**Code references:** [ClientForm.tsx](../../apps/frontend/src/components/clients/ClientForm.tsx); [ProjectForm.tsx](../../apps/frontend/src/components/projects/ProjectForm.tsx); [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts); [planningTransport.ts](../../apps/frontend/src/data/planning/planningTransport.ts); [planning.ts](../../apps/backend/app/services/planning.ts); [entity_policy.ts](../../apps/backend/app/services/planning/entity_policy.ts); [writer.ts](../../apps/backend/app/services/planning/writer.ts); [state_transformer.ts](../../apps/backend/app/transformers/state_transformer.ts)
