# US-PRI-02 — Preserve protected names on non-Owner writes

As a company Owner, I want permitted non-Owner edits to preserve private identity fields so that ordinary changes cannot expose or overwrite them.

**Status:** Current

**Access:** Owner may manage privacy fields; Admin and Editor may make permitted ordinary edits; Viewer is read-only

**Entry:** Client and Project create/update and lifecycle operations

**Documentation:** [Privacy](../../docs-src/security/privacy.md)

**Source:** [native_authorization.spec.ts](../../apps/backend/tests/functional/auth/native_authorization.spec.ts)

## Acceptance criteria

- When an Admin or Editor saves a client or project that uses a code name, the server keeps its real name, Use code name and code name as stored and applies only the other fields; nothing is refused.
- A non-Owner cannot turn on Use code name for a public record. Responses to non-Owners show the code name in place of the real name. Owners can change every privacy field.

## User flow

```mermaid
flowchart TD
  edit["Admin or Editor saves a client or project"] --> submit["Server applies the ordinary fields"]
  submit --> keep["Real name, Use code name and code name stay as stored"]
  keep --> response["Response shows the code name to non-Owners"]
```

## Code flow

```mermaid
flowchart TD
  edit["ClientForm or ProjectForm submits an ordinary create or edit"] --> mutate["mutatePlanning checks company write authorization"]
  mutate --> restricted["writeEntity calls assertMayWriteRestrictedFields before preparing the write"]
  restricted -->|Non-Owner explicitly supplies protected fields| refused["AUTHORIZATION_DENIED"]
  restricted -->|Allowed, including empty privacy defaults on create| prepare["prepareEntityWrite pins stored hidden fields for the non-Owner before validation"]
  prepare -->|Invalid| validation["Reject invalid values without persisting"]
  prepare -->|Valid| persist["Persist allowed changes in the planning transaction"]
  persist --> reply["transformState projects the role-safe receipt"]
```

For separate lifecycle operations, see [Archive and anonymise records](../settings/US-SET-12-archived-deleted.md#code-flow).

**Code references:** [ClientForm.tsx](../../apps/frontend/src/components/clients/ClientForm.tsx#L108) · [ProjectForm.tsx](../../apps/frontend/src/components/projects/ProjectForm.tsx#L191) · [entity_write.ts](../../apps/backend/app/services/planning/entity_write.ts#L95) · [entity_rules.ts](../../apps/backend/app/services/planning/entity_rules.ts#L64) · [entity_rules.ts](../../apps/backend/app/services/planning/entity_rules.ts#L303) · [planning.ts](../../apps/backend/app/services/planning.ts#L299) · [operations.spec.ts](../../apps/backend/tests/functional/planning/operations.spec.ts#L287)
