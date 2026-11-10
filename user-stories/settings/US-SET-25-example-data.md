# US-SET-25 — Add example data

As an Owner or Admin, I want to add example data to an empty company so that I can explore a working setup.

**Status:** Current
**Access:** Owner, Admin
**Entry:** Settings → Data and support → Add example data
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsDataSection.tsx](../../apps/frontend/src/components/settings/SettingsDataSection.tsx)

## Acceptance criteria

- **Add example data** is available to Owner/Admin on an empty server-backed company, excluding the built-in Internal client. It adds the fictional example dataset.
- The action is unavailable when company planning records already exist, including archived records.

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
  view["SettingsDataSection shows ExampleDataSection when empty and authorized"] --> action["ExampleDataSection.addExampleData checks planning readiness"]
  action --> api["accountClient.addExampleData sends request"]
  api --> controller["ExampleDataController.store authorizes and writes example records"]
  controller --> refresh["store.refreshPlanning loads accepted authoritative company state"]
  refresh --> notice["ExampleDataSection sets result notice"]
```

**Code references:** [SettingsDataSection.tsx](../../apps/frontend/src/components/settings/SettingsDataSection.tsx), [accountClient.ts](../../apps/frontend/src/account/accountClient.ts), [useStore.ts](../../apps/frontend/src/store/useStore.ts), [example_data_controller.ts](../../apps/backend/app/controllers/example_data_controller.ts)
