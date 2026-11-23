# US-NAV-13 — Track first schedule progress

As an Owner, Admin, or Editor, I want visible first-schedule milestones so that I can prepare useful company planning data.

**Status:** Current

**Access:** Owner, Admin, Editor; Viewer does not see the Getting Started panel

**Entry:** Getting Started panel and its milestone links

**Documentation:** [Quick Start](../../docs-src/getting-started/quick-start.md)

**Source:** [GettingStarted.tsx](../../apps/frontend/src/components/GettingStarted.tsx)

## Acceptance criteria

- Five milestones reflect current company data. Each unfinished milestone links to its relevant screen; completed milestones are shown as done.
- **Hide checklist** and **Show checklist** collapse and expand the card. Owners and Admins see **Dismiss**, which hides the card for everyone in the company; it always first asks **Do you really want to hide this forever?** (**Yes** / **No**). Once all five milestones are complete the card is not shown on any page; it returns if a completed milestone is undone. Editors can use the card but have no **Dismiss**.
- Show me around starts the role-aware schedule tour when available. The Help page provides a separate, persistent route to start that tour.

## User flow

```mermaid
flowchart TD
  open["Open Getting Started"] --> review["Review five milestones and unfinished links"]
  review --> toggle["Hide or show the card"]
  review --> dismiss["Owner/Admin chooses Dismiss"]
  dismiss --> confirm["Confirm dismissal"]
  review -->|all five complete| gone["Card is no longer shown"]
  review --> tour["Show me around starts role-based tour"]
```

## Code flow

```mermaid
flowchart TD
  shell["AppShell renders GettingStarted for an active company with planning write permission outside View as member"] --> read["useCompanyDismissal rereads milestones and dismissal on path/revision changes"]
  read --> server["GettingStartedController.show verifies planning:read and reads server milestones"]
  server -->|Dismissed or all milestones complete| hidden["Hide the checklist"]
  server -->|Incomplete| panel["Render progress; open by default on Schedule"]
  read -->|Read failed| retry["Show notice and Retry on the card"]
  retry --> read
  panel -->|Show or hide| toggle["Store the one most recent path-tagged open choice"]
  panel -->|Show me around| tour["useTourOperation starts the eligible tour"]
  panel -->|Eligible Owner or Admin chooses dismissal| dialog["Open AlertDialog before saving"]
  dialog -->|No| panel
  dialog -->|Yes| save["dismiss calls GettingStartedController.update"]
  save -->|Live Owner/Admin with planning:write| stored["Persist company dismissal and hide card"]
  save -->|Failed| restore["Close confirmation, show error and keep checklist"]
```

**Code references:** [GettingStarted.tsx](../../apps/frontend/src/components/GettingStarted.tsx#L53) · [GettingStarted.tsx](../../apps/frontend/src/components/GettingStarted.tsx#L142) · [GettingStarted.tsx](../../apps/frontend/src/components/GettingStarted.tsx#L198) · [GettingStarted.tsx](../../apps/frontend/src/components/GettingStarted.tsx#L219) · [gettingStarted.ts](../../packages/shared/src/domain/gettingStarted.ts#L23) · [getting_started_controller.ts](../../apps/backend/app/controllers/getting_started_controller.ts#L13) · [getting_started.ts](../../apps/backend/app/services/getting_started.ts#L20) · [GettingStarted.test.tsx](../../apps/frontend/src/components/GettingStarted.test.tsx#L231)
