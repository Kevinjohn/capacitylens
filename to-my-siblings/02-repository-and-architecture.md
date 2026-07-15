# 02 — Repository and architecture

CapacityLens uses a deliberately plain three-workspace shape: browser application, pure shared core
and SQLite API. Siblings should copy this shape until their product produces evidence that it is
insufficient.

## Default stack

| Layer | Default | Reason |
| --- | --- | --- |
| Web | React 19, TypeScript, Vite | Small SPA, fast iteration, familiar agent surface |
| Styling | Tailwind CSS v4, semantic CSS variables | One design language across light/dark |
| Components | Hand-owned common kit plus selected shadcn/Radix primitives | Accessible foundation without surrendering product semantics |
| State | Zustand | Small explicit store and easy external orchestration |
| i18n | Paraglide | Typed message keys and deferred locale resolution |
| Shared core | Pure TypeScript workspace | One domain authority for client and server |
| API | Fastify | Small, explicit HTTP boundary |
| Auth | Better Auth | Session/provider mechanics behind a local adapter |
| Storage | Node's built-in SQLite | One-file source of truth and low operator burden |
| Dates | date-fns plus date-only domain strings | Predictable date math without inventing a date layer |
| Unit/UI tests | Vitest and Testing Library | Fast local contract checks |
| Browser tests | Playwright and axe | Delivery-shape and accessibility evidence |

Versions move. The architecture and dependency direction are the inheritance, not a frozen lockfile.

## Canonical repository shape

```text
/
├── AGENTS.md                 # short instructions agents must read first
├── DECISIONS.md              # standing product/architecture decisions
├── DEFENSIVE-CODING.md       # error and commenting review standard
├── CHANGELOG.md
├── README.md
├── .env.example              # complete runtime/build-time variable register
├── docs/                     # operator and contributor guides
├── e2e/                      # browser acceptance tests
├── messages/                 # source locale messages
├── server/
│   ├── src/app.ts            # HTTP boundary and route authorization
│   ├── src/db.ts             # database open/migrations/load
│   ├── src/tables.ts         # exhaustive row/column specification
│   ├── src/auth.ts           # Better Auth configuration
│   └── src/controlTables.ts  # auth/membership/invite control data
├── shared/
│   └── src/
│       ├── types/            # canonical persisted shapes
│       ├── domain/           # policy, mutations, lifecycle, access
│       ├── data/             # migrations, seed, transfer, sanitisation
│       └── lib/              # environment-independent helpers
├── src/
│   ├── auth/                 # browser auth and permission boundaries
│   ├── components/
│   │   ├── common/           # product-owned component kit
│   │   ├── ui/               # generated/adapted primitives
│   │   └── <feature>/        # feature components and co-located tests
│   ├── data/                 # adapters, sync, cache and persistence
│   ├── hooks/                # cross-component orchestration hooks
│   ├── lib/                  # app-only pure helpers
│   ├── store/                # store, selectors and scoped reads
│   ├── router.tsx
│   └── index.css             # semantic tokens and global behaviour
├── user-stories/             # exact visible contract and runnable stories
└── to-my-siblings/           # family reasoning and agent knowledge base
```

## Dependency direction

```text
             shared pure core <── server HTTP/SQLite/auth
                    ▲
                    └──────── React/store
```

Rules:

- `shared/` imports no React, DOM, Fastify, SQLite or browser storage.
- Components do not import server code.
- The server imports the same shared types and policy functions as the client.
- Pure UI math may live in `src/lib/` when it is browser-product-specific but still has no I/O.
- Persistence is attached outside the store so the store remains testable.

## Layer responsibilities

### Shared core

Owns:

- canonical types and constants;
- tenant-belonging predicates;
- role/action matrix;
- domain validation and enforcement helpers;
- lifecycle state machine;
- cascade rules;
- migrations and import sanitisation;
- entity colour/contrast rules that both environments need.

It does not own toasts, request objects, database statements or component state.

The entity envelope, account access hierarchy and colour helpers live locally in the product's
shared core. The internal reference kit contains copy-ready snapshots, but the product remains the
authority until a real independently released package has multiple consumers.

### Client store

Owns:

- active in-memory `AppData`;
- transient active tenant;
- ids and timestamps for local/demo writes;
- undo/redo history;
- mutation orchestration through shared enforcement;
- device preferences and UI state when a separate store would add ceremony.

It does not decide server authorization.

### Client data layer

Owns:

- choosing the explicit demo or server adapter;
- load/save contracts;
- whole-tree diff to ordered operations;
- debounced and serialized persistence;
- retry/reconciliation;
- opt-in offline snapshot;
- request timeouts and error classification.

### Components

Own:

- rendering;
- local form state;
- mapping thrown boundary errors to fields/toasts;
- permission-driven affordances;
- accessible interaction and focus;
- calling store/hooks, not re-implementing domain rules.

### Server

Owns:

- session resolution;
- membership lookup and authorization;
- request/body/response validation;
- transaction boundaries;
- optimistic concurrency;
- authoritative timestamps;
- field-level privacy projection;
- audit, backups, health and production boot guards.

## The shared-core pattern

Put a policy in shared when both browser and server must agree:

```ts
export type Role = 'owner' | 'admin' | 'editor' | 'viewer'
export type Action = 'read' | 'write' | 'manageMembers' | 'purge'

const MIN_TIER = {
  read: 'viewer',
  write: 'editor',
  manageMembers: 'admin',
  purge: 'admin',
} as const satisfies Record<Action, Role>

export function can(role: Role, action: Action): boolean {
  // pure, fail-closed comparison
}
```

The client calls it to hide or disable an affordance. The server calls it after resolving the
membership. One policy, two consumers, one server backstop.

## Exhaustiveness as architecture

CapacityLens uses compile-time proofs where drift would be dangerous:

- `SCOPED_KEYS` covers every scoped table.
- SQL column arrays are checked against every property in each entity type.
- create/delete ordering is exhaustive over `AppData` keys.
- permission minimum tiers are exhaustive over actions.
- onboarding completeness uses all values of the step object.

Prefer `satisfies Record<Union, …>`, exhaustive switches and reverse-key checks over a comment that
says “remember to update this”.

## A new persisted field

The minimum path is:

1. Add the field to the shared canonical type.
2. Decide missing-value semantics and schema version.
3. Update full fixtures and seed data.
4. Add the server column specification.
5. Update migration and import sanitisation.
6. Update interactive validation.
7. Update response/privacy projection if sensitive.
8. Update transfer/export behaviour.
9. Add round-trip, malformed-input and authorization tests.
10. Update user-story reference and changelog when visible.

If any step is irrelevant, explain why in the change. Do not let optional fields become an excuse to
skip persistence work.

## Route and bundle shape

- Keep the first-value route eager.
- Lazy-load secondary list/settings/auth flows.
- Put invite acceptance and password reset outside the tenant-gated app shell.
- Give every top-level route a branded error boundary.
- Derive page titles from the same navigation definitions as the sidebar.
- Keep old URLs as redirects when a feature moves.
- Enforce a main-entry bundle budget so convenience imports cannot silently erase splitting.

## Adapter boundary

The store speaks a whole-data contract:

```ts
interface PersistenceAdapter {
  loadAll(accountId?: string): Promise<AppData>
  saveAll(next: AppData): Promise<void>
}
```

The in-memory demo implements it without storage or network. The server adapter diffs the next tree
against the last acknowledged tree, orders operations and sends one atomic batch. This lets
undo/redo and import work without the store knowing HTTP exists.

Siblings may choose command-oriented stores, but should preserve the qualities:

- one explicit persistence seam;
- atomic dependent writes;
- authoritative reconciliation;
- no silent fallback between persistence flavours.

## When to split further

Do not begin with microservices, event buses or multiple databases. Split only when a demonstrated
constraint cannot be solved cleanly inside the monolith, such as independently scaling a genuinely
heavy job or isolating a regulated boundary. A small SaaS gains more from one transaction, one
backup story and one mental model.
