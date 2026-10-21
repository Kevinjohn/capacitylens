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
- Ordinary writes reject invalid supplied input; nothing is repaired on the way in. Import accepts only this product's own export, atomically, and rejects anything else. Demo mode is temporary and in-memory. Scheduling data is never persisted in the browser; failed requests remain visible and retryable.

## Identity, security and data

- Account Kit owns accounts, sessions, social sign-in (Ally) and admission. CapacityLens owns company membership, roles, the member/resource link, Bouncer policies and every screen that renders a kit outcome. Do not re-implement a kit capability in the product.
- Admission is three independent cumulative checks (domain, invitation, approval) configured in `config/admission.ts`. A person who is authenticated but not admitted reaches only the limited surface. Enforcement is on the next request; nothing is pushed to the browser.
- Google is the supported company identity provider. Microsoft and GitHub are not supported. Do not claim live-provider acceptance from deterministic tests. Identities are never merged by email; a verified provider email matching an unused invitation records invitation evidence at creation.
- Sessions use the kit's idle expiry. Sensitive actions (ownership transfer, company deletion, import, anonymisation) re-prove the password per action. There is no time-based freshness window, no breach screening and no custom hashing.
- The first Owner is bootstrapped through the kit's operator commands, never an environment variable. Keep one Owner per company; ownership transfer is one atomic transaction. View-as-member is a read-only projection; every write under it is refused server-side.
- Never weaken server authorization because the UI hides an action. Never persist, log or replay password-reset or invitation bearers.
- Surface data-path errors. Never add empty catches or silently replace API failures with browser persistence.
- Migrations are append-only from the beta baseline and run through Lucid; `app:upgrade` backs up before migrating. There is no checksum ledger and no fixture compatibility suite. Retain the privacy, anonymisation and backup behaviour recorded in `DECISIONS.md`.

## Frontend and documentation

- Give icon-only buttons accessible names. Use native `title` for simple hover hints; use the local Radix tooltip only for styled, delayed or keyboard-accessible rich content. Use the shared z-index tokens for global layers.
- Local UI primitives are source-owned. Before updating one from shadcn, inspect the dry-run diff and preserve documented local behavior.
- Keep `DECISIONS.md` authoritative for product rules and framework departures. User-facing documentation is sourced from `docs-src/`; regenerate committed `docs/` after changing its inputs. Update affected stories and their guide links when user-visible behavior changes.
- Use fictional DC/Marvel identities in demo data, examples and tests; never use a real customer or colleague's name.
- Do not publish AI/provider/model attribution or credentials in repository content, screenshots, commits or pull requests.

## Working and delivery rules

- Make repository changes only in the assigned worktree, never the primary checkout. On this fork, fetch `origin/platform/adonisjs` and create a unique feature branch and sibling worktree from it; resume existing work only in its assigned worktree. Target `platform/adonisjs` for pull requests, or the predecessor branch for an unmerged stack. Never open a pull request to `main` until the owner authorises cutover.
- `DECISIONS.md` states the target; code may lag until the owning issue lands.
- Record new implementation, design or investigation plans in a GitHub issue; do not add repository Markdown plans. Keep settled scope and existing plans authoritative.
- Use the Node version in `.nvmrc` and `pnpm` for JavaScript package operations. Do not use npm, npx or yarn.
- Run focused checks while implementing; the default submission gate is `pnpm run gate:all` plus `pnpm run e2e`, unless the accepted scope defines a narrower required gate. Do not add fixed file-size, test-size, coverage-floor or naming-ratchet requirements. Do not run Docker for routine work.
- Commit each feature change with `git commit -s`. Never push task commits to `main`; publish a ready pull request only after review and required checks.
- A pull request stays open until the user explicitly authorizes merging that specific pull request. Preserve unrelated work; never rewrite history without explicit authorization.
- Do not build or run Docker images or alter Dockerfiles, Compose, Docker workflows or Docker tests unless the task explicitly authorizes that Docker work.
- Before public delivery, inspect all outgoing text and metadata for privacy, secrets and the public naming restrictions in the global instructions.
