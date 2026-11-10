# Story reference

Stories describe user intent and the fields or controls a person encounters. The
[coverage matrix](COVERAGE.md) inventories current and retained capabilities;
[decision gaps](GAPS.md) distinguishes documentation omissions from differences against the
agreed product. [DECISIONS.md](../DECISIONS.md) remains authoritative for the target behavior.

## Reading the catalogue

- **Current**: exposed in the product, subject to its role, configuration and feature conditions.
- **Hidden**: retained implementation with its ordinary entry point hidden.
- **Removed**: historical capability with no current product entry point.
- **Demo**: available only in the temporary in-memory demonstration.
- **Operator**: hosting or recovery procedure outside the application UI.
- **Planned**: agreed target for which an ordinary product journey is absent.

Read status together with access and entry conditions. A Current story can include an unavailable
alternative, explicitly labelled as such. Status is source-reviewed availability, not a claim
that its journey was exercised in a browser. A retained story does not authorize new functionality.

## Reading the diagrams

Both diagrams render from Mermaid in GitHub. **User flow** uses plain-language flowcharts to show what a person does and sees.
**Code flow** uses Mermaid to show the relevant components, functions, state and service calls.
Code references below each diagram link to the implementation used to trace it. Diagrams show
the story's relevant path, not every internal check or a claim that a browser journey was run.
An unavailable user flow is explicitly labelled; its code diagram distinguishes retained code
from missing controls. See [the template](TEMPLATE.md#diagram-conventions) for maintenance rules.

## Roles and contexts

- Viewers read planning data. Editors, Admins and Owners can make ordinary planning changes.
- Owners and Admins manage access and anonymise individual resources. Only Owners manage private
  client/project identities, transfer ownership and perform whole-company import or anonymisation.
- Signed-in people can manage their own account. Confirmation, admission and membership may limit
  access to company screens. A schedulable resource is separate from an account or membership.
- View-as-member is read-only. Device display preferences and navigation do not grant write access.
- The server-backed product has one company. Only the demo offers temporary company creation and
  switching. Demo planning resets on reload and is not evidence for authentication or persistence.
- Feature switches can hide disciplines, placeholders, external parties, inline activity creation,
  Task and Overview. An absence caused by a configured switch is not a removed feature.

Source of role authority: [shared permissions](../packages/shared/src/domain/access.ts),
[company abilities](../apps/backend/app/services/auth/authorization.ts) and each action's server
handler. A story's role label is descriptive; the server owns enforcement.

## Screens and source map

| Area          | Entry          | Source                                                                                 | Guide                                                       |
| ------------- | -------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Schedule      | `/`            | [Scheduler](../apps/frontend/src/components/scheduler/SchedulerView.tsx)               | [Read the schedule](../docs-src/using/read-the-schedule.md) |
| Overview      | `/overview`    | [Overview](../apps/frontend/src/components/capacity-overview/CapacityOverviewView.tsx) | [Overview](../docs-src/using/overview.md)                   |
| Resources     | `/resources`   | [Resources](../apps/frontend/src/components/resources/ResourceList.tsx)                | [Resources](../docs-src/using/resources.md)                 |
| Disciplines   | `/disciplines` | [Disciplines](../apps/frontend/src/components/disciplines/DisciplineList.tsx)          | [Disciplines](../docs-src/using/disciplines.md)             |
| Clients       | `/clients`     | [Clients](../apps/frontend/src/components/clients/ClientList.tsx)                      | [Clients and projects](../docs-src/using/projects.md)       |
| Projects      | `/projects`    | [Projects](../apps/frontend/src/components/projects/ProjectList.tsx)                   | [Clients and projects](../docs-src/using/projects.md)       |
| Activities    | `/activities`  | [Activities](../apps/frontend/src/components/activities/ActivityList.tsx)              | [Activities](../docs-src/using/activities.md)               |
| Time off      | `/timeoff`     | [Time off](../apps/frontend/src/components/timeoff/TimeOffList.tsx)                    | [Time off](../docs-src/using/time-off.md)                   |
| Team & access | `/team`        | [Team](../apps/frontend/src/components/team/TeamAccessView.tsx)                        | [Team and access](../docs-src/using/team-access.md)         |
| Settings      | `/settings`    | [Settings](../apps/frontend/src/components/settings/SettingsView.tsx)                  | [Settings](../docs-src/using/settings.md)                   |
| Diagnostics   | `/diagnostics` | [Diagnostics](../apps/frontend/src/components/diagnostics/DiagnosticsView.tsx)         | [Support](../docs-src/using/settings.md)                    |
| Help          | `/help`        | [Help](../apps/frontend/src/components/HelpView.tsx)                                   | [User guide](../docs-src/using/index.md)                    |
| Account       | `/account`     | [Account](../apps/frontend/src/components/account/AccountView.tsx)                     | [Account](../docs-src/using/account.md)                     |

The [entry gate](../apps/frontend/src/components/AppEntryGate.tsx) handles setup and limited
identity states; the [sidebar](../apps/frontend/src/components/AppSidebar.tsx) owns ordinary
navigation. Use the source-linked story for a form's exact fields, rather than repeating those
fields in this reference. English labels are in
[messages](../apps/frontend/messages/en.json).

## Shared product boundaries

These apply across stories without repeating a technical checklist in every form:

- Planning is week-granularity; time tracking, budgets and mobile scheduling are non-goals.
- A project belongs to a client. Activities distinguish Project-specific, Internal and All projects.
  Only project-specific activities carry project/phase references; all-projects bookings may
  separately attribute work to a project.
- Working days, personal time off and company closures affect availability. Ignore working days
  never bypasses time off. Over-capacity means allocated is strictly greater than available.
- Resource and catalogue archive/restore differ from permanent anonymisation. Undo/redo is
  page-local and is not a general undo for import or erasure.
- Private client/project names are Owner-only; other members receive code names. Personal time-off
  notes are Owner/Admin-only. Editing unrelated fields must preserve hidden values.
- Ordinary writes refuse invalid supplied input. Data errors stay visible and retryable; there
  is no offline scheduling store, automatic replay or browser persistence fallback.
- Import accepts only this product's own full export, with preview and action-specific password
  confirmation. Identity and membership data are outside scheduling exports.
- Changes to privacy, code name or activity kind can clear saved deleted-item recovery data.
  Confirmations show the affected count; cancellation preserves the draft and data.
- Password sign-in is the only method. Password change/reset ends every session. Sensitive
  company actions require their own password confirmation; it is not a generic freshness window.

For full rules and any departures, follow [DECISIONS.md](../DECISIONS.md). For runnable validation,
use the existing tests and [testing guide](../docs-src/reference/how-it-is-tested.md).
