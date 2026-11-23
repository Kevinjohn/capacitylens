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
  session["SessionController.show issues admission and membership state"] --> gate["readAuthResponse selects the first applicable gate"]
  gate -->|Address unconfirmed| verify["AuthProvider renders confirmation gate"]
  gate -->|Admission incomplete| admission["AdmissionStep explains the current decision"]
  admission -->|Declined, withdrawn or prerequisites missing| reason["Show reason and keep Sign out available"]
  admission -->|Request offered| request["authApi.requestAdmission calls AdmissionRequestsController.store"]
  request --> kit["AccountAdmission.request receives the web guard account input, checks prerequisites and records the request"]
  kit -->|Accepted| refresh["onRefresh checks the current session again"]
  kit -->|Refusal or request failure| error["Limited screen shows error"]
  admission -->|Check again, before request or while waiting| refresh
  refresh --> session
  gate -->|Admitted and no membership| join["MembershipStep calls authApi.completeMembership"]
  join --> service["MembershipsController.store runs completeMembership under withActor(auth)"]
  service -->|Missing member| write["Grant invited role or Viewer; record audit and revision"]
  write --> refresh
  service -->|Already active| refresh
  service -->|Suspended on direct or stale Join, or another refusal| error
  gate -->|Admitted with membership| app["Open the router; suspended membership cannot open company data"]
```

The manager’s decision controls are documented in [Approve or decline company admission](../settings/US-SET-19-company-admission.md#code-flow).

**Code references:** [session_controller.ts](../../apps/backend/app/controllers/session_controller.ts#L25) · [authResponse.ts](../../apps/frontend/src/auth/authResponse.ts#L73) · [AccessScreens.tsx](../../apps/frontend/src/auth/AccessScreens.tsx#L142) · [AccessScreens.tsx](../../apps/frontend/src/auth/AccessScreens.tsx#L192) · [admission_requests_controller.ts](../../apps/backend/app/controllers/admission_requests_controller.ts#L11) · [admission_membership.ts](../../apps/backend/app/services/membership/admission_membership.ts#L17) · [admission.spec.ts](../../apps/backend/tests/functional/auth/admission.spec.ts#L77)
