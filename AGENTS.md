# CapacityLens repository guidance

Read this file with [DECISIONS.md](DECISIONS.md) and the official AdonisJS documentation for framework conventions and APIs. This file records only repository-specific requirements.

## Scope and architecture

- Make the smallest complete change within the accepted issue or plan. Keep unrelated cleanup and speculative features out.
- CapacityLens is a week-granularity scheduler for small agencies. Budgets, timesheets, hour-by-hour workflows and mobile scheduling are non-goals.
- The AdonisJS backend lives in `apps/backend`, the SPA in `apps/frontend`, and `packages/shared` is the pure domain and wire-contract package. Keep backend code out of shared.
- SQLite is the supported product database. One application process owns one database file and a pool of one connection; do not add a second writer, PostgreSQL support or nested package transactions.
- Keep network and mail work outside database transactions. Use explicit transaction handles for product writes and preserve the operation's authorization, audit and failure ordering.
- Every scoped row carries its company id. The server independently authorizes every tenant read and write; client scoping is not authorization.
- Over-capacity means allocated is greater than available. Normal allocations use working days unless the explicit override applies. Visible utilisation follows the visible window; `overSoon` stays fixed at 14 days.
- Activity kind is required; only project activities carry project or phase ids. Colours use preset swatches, and a person's colour derives from discipline.
- Ordinary writes reject invalid supplied input; imports sanitize and repair atomically. Demo mode is temporary and in-memory. Offline snapshots are opt-in, expire after seven days, and are read-only.

## Identity, security and data

- Google is the supported company identity provider. Microsoft is deferred and GitHub is retired. Do not claim live-provider acceptance from deterministic tests.
- New external principals need verified email and an unused pre-authorized invitation, except the configured first-provider bootstrap. Never merge identities by email. Company invitations and membership remain product-owned.
- Sessions have a twelve-hour absolute lifetime and thirty-minute inactivity expiry. Freshness is required only for ownership transfer, another member's password reset or session revocation, company deletion, import/purge, and external identity link/repair.
- Password and session authority is identity-global across every company the principal can enter. Never weaken server authorization because the UI hides an action or render bearer session tokens. Never persist, log or replay password-reset or invitation bearers; show newly issued links only in their authorized flow.
- Password mode uses the bounded scrypt policy and production breached-password screening. Password reset is a verified ceremony, not an administrative password setter.
- Keep one Owner per company. Ownership transfer is explicit and transactional. Masquerade is a read-only data projection; explicit end and sign-out are its only allowed mutations.
- Secret-bearing command repeats return an idempotency conflict; never replay or store a bearer. Completed non-secret command results may replay, with payload mismatch rejected.
- Surface data-path errors. Never add empty catches or silently replace API failures with browser persistence.
- Export schema and database schema versions are independent. Released migrations are immutable and checksum-pinned; add schema changes through forward migrations and retain required privacy, erasure and backup behavior.

## Frontend and documentation

- Give icon-only buttons accessible names. Use native `title` for simple hover hints; use the local Radix tooltip only for styled, delayed or keyboard-accessible rich content. Use the shared z-index tokens for global layers.
- Local UI primitives are source-owned. Before updating one from shadcn, inspect the dry-run diff and preserve documented local behavior.
- Keep `DECISIONS.md` authoritative for product rules and framework departures. User-facing documentation is sourced from `docs-src/`; regenerate committed `docs/` after changing its inputs. Update affected stories and their guide links when user-visible behavior changes.
- Use fictional DC/Marvel identities in demo data, examples and tests; never use a real customer or colleague's name.
- Do not publish AI/provider/model attribution or credentials in repository content, screenshots, commits or pull requests.

## Working and delivery rules

- Make repository changes only in the assigned worktree, never the primary checkout. For new tasks, fetch `origin/main` and create a unique feature branch and sibling worktree from it; resume existing work only in its assigned worktree.
- Record new implementation, design or investigation plans in a GitHub issue; do not add repository Markdown plans. Keep settled scope and existing plans authoritative.
- Use the Node version in `.nvmrc` and `pnpm` for JavaScript package operations. Do not use npm, npx or yarn.
- Run focused checks while implementing; the default submission gate is `pnpm run gate:all` plus `pnpm run e2e`, unless the accepted scope defines a narrower required gate. Do not run Docker for routine work.
- Commit each feature change with `git commit -s`. Never push task commits to `main`; publish a ready pull request only after review and required checks.
- A pull request stays open until the user explicitly authorizes merging that specific pull request. Preserve unrelated work; never rewrite history without explicit authorization.
- Do not build or run Docker images or alter Dockerfiles, Compose, Docker workflows or Docker tests unless the task explicitly authorizes that Docker work.
- Before public delivery, inspect all outgoing text and metadata for privacy, secrets and the public naming restrictions in the global instructions.
