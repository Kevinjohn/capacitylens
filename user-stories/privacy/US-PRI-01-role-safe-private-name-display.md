# US-PRI-01 — Show private names according to role

As a company Owner, I want private client and project names visible only to Owners so that confidential identities are protected.

**Status:** Current

**Access:** Owner sees real name and code name; Admin, Editor, Viewer receive only quoted code name

**Entry:** Client and Project lists, selectors, schedule, search, forms, and archived views

**Documentation:** [Privacy](../../docs-src/security/privacy.md)

**Source:** [state_transformer.ts](../../apps/backend/app/transformers/state_transformer.ts); [native_authorization.spec.ts](../../apps/backend/tests/functional/auth/native_authorization.spec.ts)

## Acceptance criteria

- Non-Owners never receive the real private name or raw code name; all applicable surfaces show the same projected label.

## User flow

```mermaid
flowchart TD
  human1["Owner opens a private client or project"]
  human2["Owner sees real name and code name"]
  human3["Admin, Editor, or Viewer reads the same row"]
  human4["Each sees the quoted code name; real name stays hidden"]
  human1 --> human2
  human2 --> human3
  human3 --> human4
```

## Code flow

```mermaid
flowchart TD
  active["PlanningController.show resolves live effective reader through readPlanning"] --> project["transformState scopes and applies projectForReader"]
  receipt["Accepted planning write builds role-safe receipt rows"] --> project
  archived["PlanningArchiveController reads Archive recovery"] --> check["Real identity must have archive access and not be in View as member"]
  check -->|Denied| refused["Archive read refused"]
  check -->|Allowed| project
  project -->|Owner| owner["Preserve real name and codeName; displayName may select the codeName"]
  project -->|Non-Owner| safe["Keep isPrivate and use quoted replacement; withhold real name and raw codeName"]
  owner --> surface["Use projected fields in frontend displays"]
  safe --> surface
```

**Code references:** [state_transformer.ts](../../apps/backend/app/transformers/state_transformer.ts#L20) · [restricted_fields.ts](../../apps/backend/app/services/planning/restricted_fields.ts#L73) · [planning.ts](../../apps/backend/app/services/planning.ts#L104) · [planning.ts](../../apps/backend/app/services/planning.ts#L299) · [planning_archive_controller.ts](../../apps/backend/app/controllers/planning_archive_controller.ts#L6) · [native_authorization.spec.ts](../../apps/backend/tests/functional/auth/native_authorization.spec.ts#L263) · [archive_recovery.spec.ts](../../apps/backend/tests/functional/planning/archive_recovery.spec.ts#L173) · [archive_recovery.spec.ts](../../apps/backend/tests/functional/planning/archive_recovery.spec.ts#L298)
