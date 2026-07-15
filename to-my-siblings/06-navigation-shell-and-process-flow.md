# 06 — Navigation, shell and process flow

The shell is the product's control plane. It sequences loading, auth, tenancy, onboarding,
permissions, navigation, feedback and page content without letting those concerns leak into every
route.

## Shell gate order

CapacityLens effectively resolves:

```text
bootstrap
 ├─ connection/load error? ──> blocking recovery
 ├─ demo sign-in required? ──> cosmetic sign-in
 ├─ no active tenant? ───────> tenant picker
 ├─ intro unseen? ───────────> product boundary intro
 └─ app body
      ├─ permission provider
      ├─ sidebar/navigation
      ├─ offline/persistence banners
      ├─ lazy route outlet
      ├─ toast bridge
      ├─ command palette
      └─ responsive hints
```

The real auth provider wraps the router outside this shell, so a 401 can replace everything before
tenant UI renders.

Order is load-bearing. For example, invite acceptance lives outside the tenant gate because joining
the tenant is the action that creates membership.

## Sidebar default

The inherited desktop shell is:

- persistent left sidebar;
- product wordmark and collapse toggle at the top;
- ordered primary destinations;
- import/export data section below destinations;
- active company, role hint, switch company and demo sign-out at the bottom;
- main content in an independently scrolling landmark.

CapacityLens order is Schedule, Resources, Disciplines, Clients, Projects, Activities, Time off,
Settings. A sibling replaces nouns but keeps the information architecture principle:

1. primary value surface first;
2. actors/resources;
3. taxonomy/configuration nouns;
4. work nouns in dependency order;
5. exceptions/absence;
6. Settings last.

Do not mirror database table order automatically. Order by user workflow.

## One navigation definition

Keep route, deferred label and icon together:

```ts
type NavLinkDef = [to: string, label: () => string, icon: IconName]

const LINKS: NavLinkDef[] = [
  ['/', () => m.nav_home(), 'home'],
  ['/people', () => m.nav_people(), 'people'],
  ['/settings', () => m.nav_settings(), 'sliders'],
]
```

Consumers include:

- sidebar;
- command palette;
- page-title effect;
- orientation tour constants;
- feature-flag filtering.

Labels are getters so a locale switch re-resolves at render. Do not resolve localised strings in a
module-scope array.

## Collapse behaviour

CapacityLens's collapsed rail is intentionally not a miniature navigation menu:

- the labelled collapse/expand toggle stays keyboard accessible;
- rail icons are mouse-only decorations that expand the menu;
- tapping a narrow icon cannot accidentally navigate;
- icons do not shift position between states;
- the company/data sections disappear until expanded;
- the preference is device-global;
- default is open on desktop, collapsed on small width or height.

If a sibling wants icon navigation, use proper focusable buttons/links with tooltips and adequate
touch targets. Do not copy the decorative/`aria-hidden` treatment while keeping navigation.

## Route rules

- Main route is the primary value surface and remains eager.
- Secondary screens lazy-load.
- Hidden optional features are removed from nav, command palette and direct route.
- Moved routes redirect saved bookmarks.
- Special unauthenticated routes are siblings of the tenant shell.
- Each top-level branch has a branded route error.
- Every route gets a meaningful document title.
- Main content has a stable landmark and skip-link target.

## Command palette

The command palette is a complementary acceleration layer, not a second product.

Inherited behaviour:

- open with Command/Ctrl+K from anywhere, including inputs;
- block while a dirty form owns the keyboard;
- show actions/pages without a query;
- add domain search results with a query;
- support exact structured input such as a real ISO date;
- Arrow Up/Down, Enter and Escape;
- hover tracks active option;
- selection navigates and resets/sets view filters intentionally;
- focus is contained and restored;
- background is inert for assistive technology.

Search should use canonical scoped/active data and omit features/entities the user cannot see.

## Process flow vocabulary

Document flows as state machines rather than prose alone.

### Interactive form

```text
closed
  ↓ Add/Edit
pristine open
  ↓ first meaningful change
dirty open
  ├─ Save → validate → boundary write → success → close + notice
  ├─ invalid → stay open + associated error
  ├─ expected write error → stay open + associated error
  ├─ Cancel → close without write
  └─ Escape/backdrop → refuse + unsaved-changes notice
```

The dirty guard should observe text inputs and ARIA toggles/radios/switches. Explicit Cancel and
Save remain decisive; accidental dismissal is guarded.

### Normal write

```text
user action
  ↓
form/gesture validation
  ↓
store mutation + shared integrity enforcement
  ↓
optimistic UI + history
  ↓
debounced adapter diff
  ↓
authorized atomic server transaction
  ↓
server revision receipt
  ↓
adapter acknowledges + banner clears
```

Failures do not vanish:

- invalid caller data stays at field/form;
- persistence failure raises a banner and retry;
- conflict uses a documented resolution policy and informs the user;
- unknown destructive outcome reconciles before retry.

### Archive/delete/purge

```text
active row
  ↓ Archive confirm (name downstream disappearance)
archived admin view
  ├─ Restore → active
  └─ Delete confirm → tombstone/scrub
                         ↓ age + admin permission
                    Permanent delete confirm → purge/cascade
```

The labels must match the transition. Do not call archive “delete”.

### Import

```text
choose file
  ↓ parse/size/product validation
flush pending ordinary writes
  ↓ suspend new server writes
atomic import request
  ├─ definite failure → resume/retry parked edits
  ├─ unknown outcome → reconcile
  └─ committed → reload authoritative slice
                  ↓
              rebase safe parked edit or surface discard
```

### Tenant switch

```text
request switch
  ↓ flush/await previous tenant writes
tag switch with sequence token
  ↓ load selected tenant slice
if still latest + still selected
  ↓ install slice and reseed sync snapshot
otherwise discard stale result
```

Tag every async tenant-scoped result; cancellation flags alone do not prove the result belongs to the
current account.

## Feedback hierarchy

Use the narrowest useful surface:

| Situation | Surface |
| --- | --- |
| One invalid field | Inline field error linked by `aria-describedby` |
| Form-wide expected rejection | Form error |
| Successful transient action | Auto-dismissing info toast |
| Successful but important side-effect | Persistent warning toast |
| Failed data mutation | Persistent error toast + persistence banner where applicable |
| Whole app cannot safely continue | Blocking recovery/error boundary |
| Offline verified snapshot | Persistent read-only banner |

Error toasts remain on a neutral AA-safe surface with a red accent, not an inaccessible “rich
colour” pairing. Error and warning toasts persist until dismissed.

## Keyboard ownership

- Text inputs own normal undo.
- Global undo/redo ignores input, textarea and contenteditable targets.
- A dirty modal prevents global model undo and command-palette opening.
- Escape cancels in-flight gestures before it closes unrelated UI.
- Modal focus is trapped and restored.
- Icon buttons have explicit accessible names.

## Information architecture review

Before adding a menu item ask:

- Is this a primary destination or a setting/section inside an existing noun?
- Is the noun stable enough to deserve a route?
- Is it hidden behind an account capability?
- What is the direct-URL behaviour when hidden?
- Does it appear in the command palette and tour?
- Where does it sit in the user's dependency flow?
- What old URL needs redirecting?
- What page title and empty state does it own?
