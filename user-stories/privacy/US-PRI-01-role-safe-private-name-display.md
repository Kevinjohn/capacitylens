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
  inactive["CompanyStateController.show receives includeInactive and resolves effective role"] -->|members:manage| project
  inactive -->|unauthorized| refusedInactive["Refuse the inactive data read"]
  project -->|Owner| owner["Preserve real name and codeName; displayName may select the codeName"]
  project -->|Non-Owner| safe["Keep isPrivate and use quoted replacement; withhold real name and raw codeName"]
  owner --> surface["Use projected fields in frontend displays"]
  safe --> surface
  archived["PlanningArchiveController.show calls readArchiveRecovery"] --> check{"Live planning write access outside View as member?"}
  check -->|no| refused["Refuse archive recovery read"]
  check -->|yes| labels["archiveRecovery builds identity-only rows and parent labels for the role"]
  labels --> display["ArchiveRecoverySection displays labels; private client and project labels are redacted for non-Owners"]
```

**Code references:** [state_transformer.ts](../../apps/backend/app/transformers/state_transformer.ts#L20) · [restricted_fields.ts](../../apps/backend/app/services/planning/restricted_fields.ts#L73) · [planning.ts](../../apps/backend/app/services/planning.ts#L104) · [planning.ts](../../apps/backend/app/services/planning.ts#L299) · [Inactive company data](../../apps/backend/app/controllers/company_state_controller.ts#L12) · [Archive recovery controller](../../apps/backend/app/controllers/planning_archive_controller.ts#L6) · [Archive recovery authorization](../../apps/backend/app/services/planning.ts#L135) · [Role-aware identity projection](../../packages/shared/src/domain/lifecycle/archiveRecovery.ts#L24) · [Archive recovery UI](../../apps/frontend/src/components/common/ArchiveRecoverySection.tsx#L26) · [native_authorization.spec.ts](../../apps/backend/tests/functional/auth/native_authorization.spec.ts#L263) · [archive_recovery.spec.ts](../../apps/backend/tests/functional/planning/archive_recovery.spec.ts#L173) · [archive_recovery.spec.ts](../../apps/backend/tests/functional/planning/archive_recovery.spec.ts#L298)
