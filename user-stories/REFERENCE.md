# Story reference

Stories describe user intent and the fields or controls a person encounters. The
[coverage matrix](COVERAGE.md) inventories current and retained capabilities
[decision gaps](GAPS.md) distinguishes documentation omissions from differences against the
agreed product. [DECISIONS.md](../DECISIONS.md) records the owner's product rules.

## Reading the catalogue

- **Current**: exposed in the product, subject to its role, configuration and feature conditions.
- **Hidden**: retained implementation with its ordinary entry point hidden.
- **Removed**: historical capability with no current product entry point.
- **Demo**: available only through the disposable demo command.
- **Operator**: hosting or recovery procedure outside the application UI.
- **Planned**: agreed target for which an ordinary product journey is absent.

Read status together with access and entry conditions. A Current story can include an unavailable
alternative, explicitly labelled as such. Status is source-reviewed availability, not a claim
that its journey was exercised in a browser. A retained story does not authorise new functionality.

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
- View as member is read-only. Device display preferences and navigation do not grant write access.
- The product serves one company. The disposable demo uses the real server and sign-in; changes
  survive refresh and reset on command restart.
- Feature switches can hide disciplines, placeholders, external parties, inline activity creation
  Task and Overview. An absence caused by a configured switch is not a removed feature.

Source of role permissions: [shared permissions](../packages/shared/src/domain/access.ts)
[company authorization](../apps/backend/app/services/auth/authorization_service.ts) and each action's server
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
| Time off      | `/timeoff`     | [Time off](../apps/frontend/src/components/time-off/TimeOffList.tsx)                   | [Time off](../docs-src/using/time-off.md)                   |
| Team & access | `/team`        | [Team](../apps/frontend/src/components/team/TeamAccessView.tsx)                        | [Team and access](../docs-src/using/team-access.md)         |
| Settings      | `/settings`    | [Settings](../apps/frontend/src/components/settings/SettingsView.tsx)                  | [Settings](../docs-src/using/settings.md)                   |
| Diagnostics   | `/diagnostics` | [Diagnostics](../apps/frontend/src/components/diagnostics/DiagnosticsView.tsx)         | [Diagnostics](../docs-src/admin/diagnostics.md)             |
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

For full rules and any departures, follow [DECISIONS.md](../DECISIONS.md). For runnable validation
use the existing tests and [testing guide](../docs-src/reference/how-it-is-tested.md).

### Signed-in requests

- The raw `web` guard uses Account Kit's `accountKitSessionGuard` with the application's user
  provider. `web_effective` wraps that guard for member routes. It can supply the viewed-as member
  and a request context while keeping the raw sign-in available for account operations.
  [Guard configuration](../apps/backend/config/auth.ts#L8)
- [`withActor(auth, …)`](../apps/backend/app/services/auth/current_actor_service.ts#L61) gets the registered
  sign-in from `web.current()`, then reads `web_effective.context`, authenticating that guard if it
  has yet to attempt authentication. It captures the view-as context before opening Account Kit's
  `authentication.withCurrent` transaction. Inside that transaction it requires a sign-in ID,
  checks confirmed admission for ordinary routes, and verifies that any view-as context belongs
  to the same actor before running the action. Limited routes opt out of the confirmed admission
  check. Each action still applies its company scope and permissions.

### Package callbacks

[`PackageCallbacksProvider.boot`](../apps/backend/providers/package_callbacks_provider.ts#L11)
registers factories before the package providers need them. Account Kit receives the user adapter,
registration mapping, Access Control invitation and membership callbacks, and the product's
transactional effects. The provider also registers admission approval authority, the Masquerade
adapter and policy, and the authorisation callback for password confirmations. The package
configuration files supply the options for those same operations.
[Provider order](../apps/backend/adonisrc.ts#L61) · [Account boundary](../docs-src/decisions/account-boundary.md)

### Company setting writes

1. An editable Settings control calls
   [`useSettingsViewModel.updateSetting`](../apps/frontend/src/components/settings/useSettingsViewModel.ts#L55).
   It passes the patch to [`updateCompany`](../apps/frontend/src/store/typedPlanningActions.ts#L331)
   for the active company. The store stops a read-only write with a notice and rejects invalid
   working days. [`buildSettingsUpdate`](../apps/frontend/src/data/planning/planningIntents.ts#L568)
   limits the patch to settings fields and returns no intent when the supplied values have not changed.
2. [`sendPlanningIntent`](../apps/frontend/src/store/slices/planningSessionSlice.ts#L139)
   checks the planning context and write readiness through the cache before
   [the transport](../apps/frontend/src/data/planning/planningTransport.ts#L57) sends
   `settings.update` with the base revision. [`PlanningMutationsController.store`](../apps/backend/app/controllers/planning_mutations_controller.ts#L9)
   validates the request, records the validated `intent.operation` in `requestLog`, then calls
   `mutatePlanning` through [`withActor(auth, …)`](#signed-in-requests). The
   [request logging middleware](../apps/backend/app/middleware/request_logging_middleware.ts#L16)
   creates that holder before routing and includes the operation in the completion record when
   request logging is enabled and validation supplied an operation.
   [The commit path](../apps/backend/app/services/planning_service.ts#L222) checks live write access, mutation
   identity and base revision before [`executePlanningIntent`](../apps/backend/app/services/planning/planning_execution_service.ts#L401)
   dispatches to [`updateSettings`](../apps/backend/app/services/planning/planning_writer_service.ts#L55).
   The writer validates and updates the company row. It additionally requires Owner or Admin for
   Overview access and refuses changes to established calendar fields. A changed commit advances
   the revision and records audit and history before returning its projected receipt.
3. [The planning cache](../apps/frontend/src/data/planning/planningCache.ts#L469) reconciles a
   committed receipt and refreshes the company read. A stale revision triggers refresh after a
   refusal. A lost or invalid reply triggers a canonical read without resending the write.
   [`readPlanningProblem`](../apps/frontend/src/data/planning/planningNotices.ts#L29)
   classifies the shell notice, and `updateSetting` catches thrown errors for its store notice.
