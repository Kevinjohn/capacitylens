# Onboarding and access control

**Status:** implemented alpha acceptance specification, audited 2026-07-16, decided and aligned
2026-07-17. The current-state sections describe the resulting product and enforcement model.

## The mental model

CapacityLens currently has three different concepts that can all look like “a person” in the UI:

| Concept | Stored as | Scope | What it controls |
| --- | --- | --- | --- |
| Login identity | Better Auth `user` and credential/session tables | The whole installation | Who can sign in. One identity may belong to several companies. |
| Company membership | `account_members` (`accountId`, `userId`, `role`, `status`) | One company | Which company the identity may open and what it may do there. |
| Schedulable resource | `resources` (`kind: person`) | One company | Who can receive allocations and time off on the schedule. |

These records are deliberately independent today:

- adding a **resource** does not give that person a login;
- inviting a **member** does not add them to the schedule;
- a member can access several companies with a different role in each;
- a resource can exist without ever using CapacityLens.

This separation is sound. **Team & access** now explains it beside the real membership controls so
an owner is not sent to Resources when they mean to grant app access.

## Current onboarding flows

### Public in-memory demo

1. A cosmetic Jordan Avery account chooser is shown.
2. The user chooses Studio North or Loft Digital.
3. A once-per-device product introduction is shown.
4. The app opens with full edit affordances.

The demo has no real identities, memberships, roles or invitations. `PermissionProvider` supplies
`role: null`, which is intentionally editable but now labelled **Demo access**. **Team & access**
remains visible and explains the real role model, while clearly stating that the demo cannot create
app members or enforce Owner, Admin, Editor and Viewer permissions.

### Persisted server with authentication off

This is not the in-memory demo: scheduling data is stored on the configured SQLite server, but
there are no login identities or company memberships. The picker, sidebar and **Team & access** all
label this posture **Open access** and explain that anyone who can reach the installation can view
and edit its companies. No fictional Owner role or member-management controls are shown.

### First real owner (password mode)

1. On a server with no users, **Create the owner account** asks for name, email, password and the
   operator-configured setup token.
2. The signed-in identity reaches an empty company picker and creates a company.
3. `POST /api/orgs` atomically creates the company, its built-in Internal client and the caller's
   Owner membership.
4. The owner chooses the company, acknowledges the product introduction and reaches the app.
5. Member management is a first-class **Team & access** destination, separate from general company
   and security settings.

### Invited person

1. An Owner or Admin opens **Team & access**, chooses a role and optionally pre-authorises an
   email address.
2. CapacityLens creates a single-use link. It displays the bearer token once; the server stores only
   its hash. CapacityLens sends no email.
3. The recipient opens `/invite/:token` outside the normal company gate and safely previews the
   company name, proposed role, role consequences and expiry. Previewing never changes membership.
4. An existing identity signs in, reviews the invitation under that identity and explicitly chooses
   **Accept invite**. Alternatively, **Create account and accept** creates the password identity and
   claims the invitation atomically.
5. Existing identities see the success state and **Continue** activates the joined company. A new
   identity's signup refreshes the session and company list, activates the joined company and enters
   it directly.

### Returning member

1. The person signs in.
2. `GET /api/accounts` lists only companies where that identity has an active membership, including
   the identity's role in each company.
3. The person chooses a company.
4. `GET /api/state?accountId=…` independently checks membership, then returns only that company's
   data with role-specific field projection.
5. The client resolves the active role and removes disallowed affordances. The server remains the
   authorization boundary for every direct request.

## Current role and visibility matrix

Roles are per company and strictly nested for action permissions:
`Viewer < Editor < Admin < Owner`.

| Capability or data | Viewer | Editor | Admin | Owner |
| --- | :---: | :---: | :---: | :---: |
| Open the company and read active scheduling data | Yes | Yes | Yes | Yes |
| Create, edit and archive scheduling data | No | Yes | Yes | Yes |
| Export the active slice | Redacted | Redacted | Yes, including inactive rows | Yes, including inactive rows |
| See a time-off note | No | No | Yes | Yes |
| See a private client/project real name and raw code name | No; quoted code name only | No; quoted code name only | No; quoted code name only | Yes |
| List members and invitations | No | No | Yes | Yes |
| Invite, remove or change non-owner members | No | No | Yes | Yes |
| Assign Owner through an invite or ordinary role change | No | No | No | No |
| Revoke an Owner's sessions/reset their password | No | No | No | Yes, subject to cross-company authority |
| Restore, soft-delete and permanently purge lifecycle data | No | No | Yes | Yes |
| Import/replace the whole company slice | No | No | No | Yes |
| Delete the company | No | No | No | Yes |
| Transfer ownership | No | No | No | Yes |

Additional rules:

- No membership means no company listing and no tenant data, even if an account id is guessed.
- Offline snapshots always become Viewer/read-only and never queue writes.
- An Admin cannot touch an Owner, grant Owner, or transfer ownership.
- The single Owner cannot be demoted or removed through ordinary member management.
- Ownership transfer atomically promotes the recipient and steps the current Owner down to Admin.
- Owner cannot be selected in an invite or ordinary role change. A definition-checked partial unique
  database index prevents a second active Owner; the boot assertion also rejects a member-bearing
  company with zero Owners. Migration deterministically promotes the oldest active member if a
  legacy company is ownerless. Explicit transfer is the only ownership-change operation.
- Creating another company is an installation policy, not simply a capability on the active
  company. It also depends on the single/multi-company cap and whether the caller is already an
  Owner/Admin somewhere or holds an operator bootstrap token.

## Where enforcement lives

| Layer | Responsibility | Current implementation |
| --- | --- | --- |
| Session | Establish a verified identity | Better Auth through `AuthProvider`; password stable, SSO experimental |
| Membership | Bind identity to company and role | Server-only `account_members`; `listAccounts` and `resolveRole` |
| Action policy | Decide whether the role may read/write/administer | Pure shared `can(role, action)` matrix used by server and client |
| Tenant boundary | Prevent cross-company reads/writes | Server resolves membership before scoped reads and writes; every scoped entity also carries `accountId` |
| Field visibility | Remove confidential columns/identities | Server redacts time-off notes below Admin and private real names below Owner |
| UI affordance | Avoid offering an action that will be refused | `PermissionProvider`, `useCanEdit`, member-management guards and role-specific forms |
| Local defence | Prevent optimistic Viewer edits | Store no-ops Viewer mutations and surfaces a read-only notice |

The server, not the hidden button, owns authorization. This is already the right architectural
boundary.

## Implemented target experience

The implemented experience makes the three-person model explicit and gives access management a
first-class home without weakening the existing server model.

### Owner journey

1. Create the first identity and company.
2. Land on a short company setup path with two clearly separated tracks:
   - **Build the schedule:** add clients, projects, resources and allocations.
   - **Give people access:** open **Team & access**, invite app users and choose their roles.
3. Show an optional **Invite your team** path in Getting Started without making it a completion step,
   so a solo owner can finish schedule setup without inviting anyone.
4. Show the owner's role beside the active company and on the company picker.

### Team & access surface

Membership administration lives outside general Settings in the dedicated **Team & access**
main-navigation destination:

- every member can see their own role and a plain-language “what you can do” summary;
- Owner/Admin can see the member directory, pending/used invitations and management controls;
- role choices show their consequences before an invite or role change is submitted;
- ownership transfer is visually and conceptually separate from ordinary role changes;
- the page explicitly states that app members and scheduled Resources are different records;
- members and Resources remain independent; neither operation creates the other record.

### Invitee journey

1. Open the invite link.
2. See the company name, proposed role and a concise capability
   summary before accepting.
3. Sign in or create the identity.
4. Explicitly accept the membership (or create a password identity and accept atomically).
5. Land directly in the company with the role visible and a short first-session explanation.

The bearer-limited public preview returns only the company display name, role and expiry. It does
not expose the pre-authorised email, membership directory, identity existence or company data.

### Demo/access lab

The in-memory demo is explicitly labelled as non-authenticated. The real local password-auth access
lab has fixed fictional personas and the Studio North schedule in their shared company; it exercises
the actual session, membership, server projection and 403 boundaries.

## Acceptance assessment

| Area | State | Evidence |
| --- | --- | --- |
| Tenant isolation and action authorization | Acceptance target met | Shared policy and server enforcement remain the boundary. |
| Four-role policy | Acceptance target met | Plain-language role copy plus an exactly-one-Owner boot assertion and definition-checked index. |
| Invitation and member administration | Acceptance target met | First-class destination, safe preview and explicit signed-in acceptance. |
| Viewer/edit affordance gating | Acceptance target met | Every role is visible, capability status is accessible, and membership mutations invalidate live projections. |
| Confidential field projection | Acceptance target met | Auth-backed tests plus human-visible private-name and time-off fixtures. |
| Company onboarding | Acceptance target met | Getting Started links Owner/Admin to the optional access setup path. |
| Identity vs membership vs resource model | Acceptance target met | Explained side by side; records remain deliberately independent. |
| Demo testability | Acceptance target met | Demo is honestly labelled; the password-auth access lab exercises real enforcement. |

“100%” here means the agreed alpha acceptance target, not a claim that access control can never need
more testing or iteration. The agreed mechanics, information architecture, explanations, invite
context and repeatable acceptance environment are now implemented. Feedback from real click-through
testing can therefore refine the product without first inventing the missing flow.

## Alpha access lab

The lab is destructive only to the fixed local file `server/.access-lab.db`, which is recreated on
every run. Its launcher removes inherited `CAPACITYLENS_*`, `BETTER_AUTH_*` and
`VITE_CAPACITYLENS_*` configuration, then pins the API to `127.0.0.1`, password auth, the lab
database and the local Vite origin. Its setup script also refuses every path except that exact
repository fixture, including a same-named database in another directory.
Never use these fictional credentials on a real installation.

1. Start the complete lab:

   ```bash
   pnpm run dev:access
   ```

2. Open <http://127.0.0.1:5473>. Studio North, a private client/project and a time-off note are
   already present. Sign in with any persona; every persona uses `access-lab-password-2026`:

   | Persona | Email | Role |
   | --- | --- | --- |
   | Olivia Owner | `owner@capacitylens.dev` | Owner |
   | Alex Admin | `alex.admin@capacitylens.dev` | Admin |
   | Erin Editor | `erin.editor@capacitylens.dev` | Editor |
   | Vic Viewer | `vic.viewer@capacitylens.dev` | Viewer |

3. Compare the sidebar role badge, **Team & access**, edit affordances, private names and time-off
   note against the matrix above. Stop the command with Ctrl-C before running auth-backed Playwright;
   the automated suite deliberately owns different ports and a separate database.

Useful automated counterparts are:

```bash
pnpm exec playwright test --project=auth-backed \
  e2e/login.auth.spec.ts e2e/invite.auth.spec.ts \
  e2e/members.auth.spec.ts e2e/viewer.auth.spec.ts
```

## Confirmed product decisions

1. **Ownership:** exactly one Owner, changed only through explicit transfer to an existing member.
2. **Member/resource relationship:** app members and scheduled people remain independent records.
3. **Navigation:** **Team & access** is visible to every role; management controls remain
   Owner/Admin-only.
4. **Invitation delivery:** alpha continues with administrator-delivered one-time links. Outbound
   email is separate future scope because it changes the operator and privacy model.
