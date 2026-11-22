# US-TEAM-05 — Request and decide company access

As an invited person, I want to request company access and check the decision so that I know when I can join.

**Status:** Current
**Access:** Invited person; Owner or Admin decides requests
**Entry:** Waiting for access screen; Team & access → Waiting for approval
**Documentation:** [Join your team](../../docs-src/using/join-your-team.md); [Invite teammates](../../docs-src/admin/invite-teammates.md#approve-new-people)
**Source:** [AccessScreens.tsx](../../apps/frontend/src/auth/AccessScreens.tsx); [AdmissionRequestsPanel.tsx](../../apps/frontend/src/components/team/AdmissionRequestsPanel.tsx)

## Acceptance criteria

- A person who can request access sees **Ask for access**; after requesting, the screen says the request was sent and offers **Check again**.
- When approval is granted, **Check again** refreshes access and the approved person can select **Join company** if they do not yet have a membership.
- Owner and Admin see waiting requests with each person's email and invited role when available. They can **Approve** a request or **Decline** a pending request; declined or revoked requests stay listed, and **Approve** remains available.
- The **Waiting for approval** card shows its explanation only while at least one request is listed. With none, it shows its heading and "Nobody is waiting for approval."
- A declined or revoked person sees the access message without request or refresh controls. A person without an invitation or with a disallowed email domain sees the corresponding instruction.

## User flow

```mermaid
flowchart TD
    Person["Invited person opens Waiting for access"] --> Ask["Select Ask for access"]
    Ask --> Pending["See request sent; select Check again later"]
    Pending --> Decision{"Has access been approved?"}
    Decision -->|"No"| Wait["Continue waiting for approval"]
    Decision -->|"Yes, membership exists"| Access["Open company"]
    Decision -->|"Yes, no membership yet"| Join["Select Join company"]
    Manager["Owner or Admin opens Waiting for approval"] --> Listed{"Any request listed?"}
    Listed -->|"No"| Empty["Read: Nobody is waiting for approval."]
    Listed -->|"Yes"| Decide["Read the explanation; Approve or Decline a pending request"]
    Decide --> Refresh["Request list refreshes; person checks access again"]
```

## Code flow

```mermaid
flowchart TD
    Ask["AccessScreens AdmissionStep Ask for access"] --> AuthApi["authApi.requestAdmission → api.admission_requests.store"]
    AuthApi --> RequestController["AdmissionRequestsController.store → AccountAdmission.request"]
    RequestController --> Refresh["AccessScreen onRefresh asks AuthProvider to resolve access again"]
    Check["AccessScreens Check again"] --> Refresh
    Refresh --> Gate{"Current admission and membership gate"}
    Gate -->|"Admission pending"| Wait["AccessScreens keeps waiting state"]
    Gate -->|"Rejected or revoked"| Refused["AccessScreens shows refusal message without request controls"]
    Gate -->|"Admitted, no membership"| Join["MembershipStep Join company → authApi.completeMembership"]
    Join --> Complete["MembershipsController.store → completeMembership"]
    Complete --> Company["AuthProvider refreshes access and opens company"]
    Manager["AdmissionRequestsPanel: settings_admission_intro only when requests.length > 0, else settings_admission_empty"] --> Buttons["Approve or Decline"]
    Buttons --> Client["teamAccessApi.decideAdmission → admissionRequests.decideAdmission"]
    Client --> Decision["AdmissionApprovalsController.store or AdmissionRejectionsController.store → AccountAdmission decision"]
    Decision --> Reload["Panel reloads request list; person refreshes access when ready"]
    Manager -. "No Revoke control or caller" .-> NoRevoke["api.admission_revocations.store exists, but this UI does not call it"]
```

**Code references:** [AccessScreens.tsx](../../apps/frontend/src/auth/AccessScreens.tsx), [authApi.ts](../../apps/frontend/src/auth/authApi.ts), [AdmissionRequestsPanel.tsx](../../apps/frontend/src/components/team/AdmissionRequestsPanel.tsx), [teamAccessApi.ts](../../apps/frontend/src/account/teamAccessApi.ts), [admissionRequests.ts](../../apps/frontend/src/account/admissionRequests.ts), [admission_routes.ts](../../apps/backend/start/admission_routes.ts), [admission_requests_controller.ts](../../apps/backend/app/controllers/admission_requests_controller.ts), [memberships_controller.ts](../../apps/backend/app/controllers/memberships_controller.ts), [admission_approvals_controller.ts](../../apps/backend/app/controllers/admission_approvals_controller.ts), [admission_rejections_controller.ts](../../apps/backend/app/controllers/admission_rejections_controller.ts), [admission_membership.ts](../../apps/backend/app/services/membership/admission_membership.ts)
