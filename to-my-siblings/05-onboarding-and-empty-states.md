# 05 — Onboarding and empty states

Onboarding is not one tour. CapacityLens uses several small layers, each answering a different
question and each stored at the correct scope.

## The inherited journey

```text
authentication
    ↓
choose or create tenant
    ↓
one-time product boundary intro
    ↓
first useful screen
    ↓
state-derived setup checklist + optional orientation tour
    ↓
checklist disappears when real data proves completion
```

Every gate must have one responsibility. Do not combine credential setup, company creation, a
marketing carousel and domain data entry into a single fragile wizard.

## Stage 1 — Authentication

Purpose: establish identity, or deliberately demonstrate the signed-in flow in a demo.

- Real auth is owned by the auth provider/login wall.
- The demo may use a clearly cosmetic account chooser so prospective users understand the intended
  sequence.
- Never show fake and real auth together.
- Preserve the return URL for invite/reset routes.
- Show network/configuration failure as a retryable blocking surface.

The demo sign-in flag is device-global and outside tenant exports. It is not security.

## Stage 2 — Tenant picker

Purpose: decide which isolated dataset to open.

The picker appears on every fresh load because selected tenant state is transient. It should:

- list only memberships available to the current identity;
- show the caller's available creation path;
- distinguish “no companies yet” from “you need an invitation”;
- create a company inline without sending the user into Settings;
- capture immutable setup choices at creation;
- show a back link after “Switch company”;
- hide destructive controls when the role cannot perform them;
- reconcile the list after uncertain create/delete outcomes.

### Company creation defaults

CapacityLens asks for:

- company name;
- week start, default Monday;
- timezone, default GMT with visible UTC offset;
- language, currently English and read-only.

It does not ask for a one-off colour choice; it applies the family default blue. This is a strong
onboarding principle: ask only questions that genuinely change the first useful experience.

If a value is frozen after creation, capture a concrete value rather than leaving `undefined`.
Display it read-only in Settings and reject later API changes.

### Empty picker copy

Avoid dead-end or contradictory copy:

- zero companies + create permission: offer “New company” and “Ask an admin for an invite”;
- zero companies + no create permission: offer the invitation path only;
- existing memberships: say choose one or create another only if creation is actually available;
- single-company cap reached: hide creation rather than show a permanently disabled button.

## Stage 3 — Product boundary intro

Purpose: answer “what is this tool, and what is it not?” after identity and tenant context exist.

Characteristics:

- one small card/page;
- three short paragraphs at most;
- one Continue action;
- shown once per device;
- no product data mutation;
- no tour mechanics;
- copy is localised through the message seam;
- states the main non-goal so users form the right mental model.

This page is not feature education. It prevents category confusion.

## Stage 4 — State-derived checklist

Purpose: get a new tenant to first value without trapping the user in a script.

CapacityLens derives four steps from actual scoped data:

1. a non-built-in client exists;
2. a project exists;
3. a resource exists;
4. an allocation exists.

The transferable pattern:

```ts
interface GettingStartedSteps {
  firstParent: boolean
  firstWorkItem: boolean
  firstActor: boolean
  firstOutcome: boolean
}

function deriveSteps(data: TenantData): GettingStartedSteps {
  return {
    firstParent: data.parents.some((row) => !row.builtin),
    firstWorkItem: data.workItems.length > 0,
    firstActor: data.actors.length > 0,
    firstOutcome: data.assignments.length > 0,
  }
}

function allDone(steps: GettingStartedSteps): boolean {
  return Object.values(steps).every(Boolean)
}
```

Why this is better than a wizard:

- a user can navigate freely;
- refresh does not lose position;
- imported/seeded tenants skip irrelevant onboarding;
- another collaborator's work can complete a step;
- adding a step can be made exhaustive;
- completion proves domain state, not a clicked checkbox.

### Checklist behaviour

- Place it near the first-value surface.
- Overlay when possible rather than shifting the main layout.
- Link incomplete steps to the place where they happen.
- Mark complete steps visually and for screen readers.
- Hide when all steps are complete.
- Allow device-global dismissal.
- Hide for viewers who cannot perform the writes.
- Do not count built-in seed anchors as user progress.

Dismissal and completion are separate: dismissal is device preference; completion is tenant data.

## Stage 5 — Loose orientation tour

Purpose: answer “where are things?”.

CapacityLens uses five spotlight stops: main grid, toolbar, people, clients/projects and Settings.
It deliberately:

- does not navigate;
- does not open forms;
- does not wait for a mutation;
- does not own checklist state;
- disables accidental interaction with spotlighted elements;
- degrades gracefully if an anchor is unavailable;
- lazy-loads the tour library;
- resolves copy at launch time for the current locale.

Scripted tours rot whenever UI or data changes. Use a loose orientation tour plus a state-derived
checklist.

### Tour anchors

- Single-source route constants used by both navigation and tour selectors.
- Prefer durable semantic attributes for tour anchors.
- Do not turn tour attributes into E2E selectors if role/name queries are sufficient.
- Test that the tour launches and its key steps/copy exist.

## Onboarding state scopes

| State | Scope | Storage |
| --- | --- | --- |
| Real sign-in | Session/server | Secure cookie |
| Cosmetic demo signed-in flag | Device | Local storage |
| Active company | Transient | Memory only |
| Intro seen | Device | Local storage |
| Checklist dismissed | Device | Local storage |
| Checklist completion | Tenant | Derived from domain data |
| Rotate hint dismissed | Visit/session | Session storage |
| Feature enabled | Tenant | Account row |

Do not create an “onboarding” blob that mixes these scopes.

## Empty states are decisions

Every list and primary view needs at least:

- genuinely empty tenant;
- empty because a filter is active;
- empty because a feature is disabled;
- empty because the caller is read-only;
- empty because data failed to load.

Patterns:

- Empty list + editor: explanation and positive Add action.
- Empty list + viewer: explanation only; do not tease an impossible write.
- Filtered empty: clear-filter action, not Add.
- Feature off: point to the exact setting only when caller may change it.
- Load failure: keep the prior/recoverable data protected; show retry/recovery.

## Onboarding acceptance matrix

Test at least:

| Situation | Expected first surface |
| --- | --- |
| Demo, first device | Cosmetic sign-in |
| Real auth, no session | Login/owner setup |
| Auth service unreachable | Blocking retryable error |
| Signed in, no memberships, may create | Empty picker with create path |
| Signed in, no memberships, may not create | Invite guidance only |
| Membership exists, no active tenant | Tenant picker |
| Tenant chosen, intro unseen | Product boundary intro |
| New editable tenant | Incomplete checklist |
| Established/seeded tenant | No checklist |
| Viewer in new tenant | No write checklist |
| Portrait phone | Rotation hint without hiding the underlying journey from assistive tech |
| Reload after intro | Intro remains dismissed; tenant picker still returns |

## New sibling worksheet

Before implementing onboarding, write:

- What is the first valuable outcome?
- Which two to five pieces of real data prove it happened?
- Which setup values must be frozen?
- Which optional concepts should be hidden initially?
- What does a zero-membership user do?
- What can a viewer learn without editing?
- What is device acknowledgement versus tenant completion?
- Which screens must survive a reload or invite redirect?
- What copy prevents the most likely category misunderstanding?
