# US-SET-25 — Add example data

As an Owner or Admin, I want to add example data to an empty company so that I can explore a working setup.

**Status:** Current
**Access:** Owner, Admin
**Entry:** Settings → Data and support → Add example data
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsDataSection.tsx](../../apps/frontend/src/components/settings/SettingsDataSection.tsx)

## Acceptance criteria

- **Add example data** is available to Owner/Admin on an empty server-backed company, excluding the built-in Internal client. It adds the fictional example dataset.
- The action is unavailable once the company has any resource, client other than Internal, project or allocation, including archived or deleted ones; the server refuses the request in that case.

## User flow

```mermaid
flowchart TD
A["Owner or Admin opens an empty server-backed company"] --> B["Select Add example data in Settings"]
B --> C{"Request accepted?"}
C -->|yes| D["Explore the example planning data"]
C -->|no| E["Read the error and resolve loading or existing-data conditions"]
```

## Code flow

```mermaid
flowchart TD
  settings["SettingsDataSection requires members:manage and no active qualifying rows"] --> inactive["ExampleDataOffer waits for the authorized useInactiveCompanyData result"]
  inactive -->|Pending, unavailable or contains qualifying rows| hidden["Leave Add example data hidden"]
  inactive -->|No resources, non-Internal clients, projects or allocations| button["ExampleDataSection renders Add example data"]
  button --> suspend["runSuspendedReplacement checks planning readiness and suspends writes"]
  suspend -->|Blocked| blocked["Show planning notice without dispatch"]
  suspend -->|Ready| post["companyDataRequests.addExampleData calls ExampleDataController.store"]
  post --> tx["withActor checks live members:manage and addExampleData rereads rows including inactive"]
  tx -->|Refused or incompatible data| refusal["Show error and release planning suspension"]
  tx -->|Eligible| write["Insert sample rows, record exampleData company audit and advance revision"]
  write -->|HTTP 201| canonical["Refresh planning with a fresh authoritative read"]
  post -->|Commit uncertain| canonical
  canonical -->|Confirmed commit and read succeeded| done["Release suspension and show added notice, with audit warning if reported"]
  canonical -->|Uncertain commit and read succeeded| feedback["Release suspension and show failure notice"]
  canonical -->|Read failed| reload["Keep suspension and ask for reload"]
```

**Code references:** [SettingsDataSection.tsx](../../apps/frontend/src/components/settings/SettingsDataSection.tsx#L18) · [SettingsDataSection.tsx](../../apps/frontend/src/components/settings/SettingsDataSection.tsx#L28) · [SettingsDataSection.tsx](../../apps/frontend/src/components/settings/SettingsDataSection.tsx#L72) · [SettingsDataSection.tsx](../../apps/frontend/src/components/settings/SettingsDataSection.tsx#L110) · [useInactiveCompanyData.ts](../../apps/frontend/src/hooks/useInactiveCompanyData.ts#L74) · [company_state_controller.ts](../../apps/backend/app/controllers/company_state_controller.ts#L12) · [example_data_controller.ts](../../apps/backend/app/controllers/example_data_controller.ts#L6) · [example_data.ts](../../apps/backend/app/services/example_data.ts#L26) · [SettingsDataSection.test.tsx](../../apps/frontend/src/components/settings/SettingsDataSection.test.tsx#L129) · [suspendedReplacement.ts](../../apps/frontend/src/store/suspendedReplacement.ts#L54)
