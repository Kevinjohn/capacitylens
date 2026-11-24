# US-SET-12 — Archive and anonymise records

As a company Editor, I want to archive records and authorised staff to anonymise people so that obsolete or identifying information is handled appropriately.

**Status:** Current — catalogue lifecycle is covered by its owning stories.
**Access:** Owner, Admin, Editor
**Entry:** Resource, Client, Project or Activity archive controls; Settings → Anonymise all people
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [CompanyAnonymiseSection.tsx](../../apps/frontend/src/components/settings/CompanyAnonymiseSection.tsx)

## Acceptance criteria

- Restore archived records from their owning pages. Individual resource anonymisation is Owner/Admin; company-wide anonymisation is Owner-only with password confirmation. See [US-RES-16](../resources/US-RES-16-anonymise-resource.md).

## User flow

```mermaid
flowchart TD
A["Open the relevant resource or catalogue page"] --> B{"Choose an available lifecycle action"}
B -->|archive| C["Confirm Archive, or Cancel"]
B -->|restore| D["Select Restore on the archived row"]
B -->|authorised anonymisation| E["Review the anonymisation confirmation"]
C -->|confirmed| F["Record leaves active views"]
C -->|cancel| I["Leave the record unchanged"]
D --> G["Record returns to active views"]
E -->|confirmed| H["Identifying resource details are removed"]
E -->|cancel| I
```

## Code flow

```mermaid
flowchart TD
  list["Owning catalogue page offers archive under planning write access"] -->|Confirm| dispatch["useLifecycleOperations sends the typed lifecycle intent"]
  list -->|Cancel| quiet["Leave records unchanged"]
  archive["ArchivedEntitySection selects the view by resolved permission"] -->|Owner or Admin| full["PrivilegedArchivedEntitySection calls useInactiveCompanyData"]
  archive -->|Editor| recovery["ArchiveRecoverySection reads authorized recovery identities from PlanningArchiveController.show"]
  full -->|Read succeeded| rows["Show archived rows for the owning page"]
  recovery -->|Read succeeded| rows
  recovery -->|Read refused or unavailable| errors["Show lifecycle read/action error"]
  full -->|Read refused or unavailable| errors
  rows -->|Hidden by an ancestor| parent["Link to the ancestor"]
  rows -->|Restore archived row| dispatch
  dispatch --> transaction["PlanningMutationsController authorizes and applies lifecycle transition in the planning transaction"]
  transaction -->|Refused| errors
  transaction -->|Committed| refresh["Reconcile planning and notify the inactive list to refresh"]
  dispatch -->|Commit uncertain| reread["Planning cache rereads; show an uncertainty notice"]
  full -->|Eligible archived Resource| dialog["PrivilegedArchivedEntitySection opens anonymisation confirmation"]
  dialog -->|Cancel| quiet
  dialog -->|Confirm| scrub["runResourceAnonymisation suspends planning writes and sends dedicated request"]
  scrub -->|Ready| endpoint["ResourceAnonymisationsController checks resources:anonymise and scoped Resource"]
  endpoint -->|Refused| errors
  scrub -->|Blocked| errors
  endpoint -->|Scrub committed| canonical["Refresh canonical planning"]
  scrub -->|Commit uncertain| canonical
  canonical -->|Read succeeds| refresh
  canonical -->|Read fails| recover["Keep planning locked and require reload"]
```

See [Anonymise all people](US-SET-26-anonymise-all-people.md#code-flow) for the separate Owner-only company operation.

**Code references:** [ArchivedEntitySection.tsx](../../apps/frontend/src/components/common/ArchivedEntitySection.tsx#L182) · [CompanyStateController](../../apps/backend/app/controllers/company_state_controller.ts#L14) · [ArchiveRecoverySection.tsx](../../apps/frontend/src/components/common/ArchiveRecoverySection.tsx#L26) · [ArchiveRecoverySection.tsx](../../apps/frontend/src/components/common/ArchiveRecoverySection.tsx#L61) · [useLifecycleOperations.ts](../../apps/frontend/src/hooks/useLifecycleOperations.ts#L51) · [planning_archive_controller.ts](../../apps/backend/app/controllers/planning_archive_controller.ts#L8) · [execute.ts](../../apps/backend/app/services/planning/execute.ts#L71) · [resource_anonymisations_controller.ts](../../apps/backend/app/controllers/resource_anonymisations_controller.ts#L20) · [archive_recovery.spec.ts](../../apps/backend/tests/functional/planning/archive_recovery.spec.ts#L355) · [resourceAnonymisation.ts](../../apps/frontend/src/store/resourceAnonymisation.ts#L26)
