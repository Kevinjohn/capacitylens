# 01 — Product and scope

The architecture becomes much easier once the product boundary is sharp. CapacityLens's most
reusable lesson is not “build a scheduler”; it is “pick the resolution of the problem and refuse
features that dissolve it”.

## Start with a one-sentence thesis

Use this shape:

> **[Product] helps [specific user] answer [one recurring question] at [explicit granularity],
> without becoming [adjacent category].**

CapacityLens's equivalent is: a small agency answers who is busy, available or over capacity,
week by week, without acquiring budgets, timesheets, CRM or project-management scope.

A good thesis:

- identifies a real operator, not “teams”;
- names the decision the product improves;
- declares time/data granularity;
- implies a smallest useful workflow;
- rules out at least one tempting adjacent product.

## Write the non-goals at the same time

Non-goals protect design quality. They stop every request becoming a new mode, tab or data model.

For a new sibling, record:

- adjacent systems it will not replace;
- finer-grained workflows it will not model;
- platforms or form factors that are not primary;
- financial, compliance or collaboration features that belong elsewhere;
- integration promises intentionally deferred;
- scale boundaries, such as “small teams” or “one company per instance by default”.

Put public non-goals in the README, standing constraints in `DECISIONS.md`, and agent-sized
warnings in `AGENTS.md`. The three documents serve different audiences.

## Define the canonical nouns

Before routes or database tables, write the smallest domain sentence:

> A **Client** owns **Projects**. A Project and internal work contain **Activities**. An
> **Allocation** connects a **Resource** to an Activity over a date range.

For each noun define:

- what it represents in plain language;
- who owns it;
- whether it belongs to a tenant;
- whether it has a lifecycle beyond hard deletion;
- required and optional relationships;
- privacy-sensitive fields;
- whether it participates in calculations;
- the word users see and the word code uses.

Then test the vocabulary against five surfaces: navigation, forms, error messages, API paths and
types. Intentional differences are allowed but documented. CapacityLens deliberately uses
`Account` in the domain, `company` in most UI copy, and `org` only for the atomic create route.

## Separate identity, action and status

Many muddled UIs overload colour or nouns because these axes were never separated.

- **Identity** answers “what is this?”—client/project colours, product brand.
- **Action** answers “what can I do?”—positive, destructive, navigation.
- **Status** answers “what is happening?”—confirmed/tentative/completed, warning/error.

Do not let a user-selectable identity colour become the global success colour. Do not use the
product's brand blue for every primary save button. CapacityLens now uses blue for identity and
navigation, green for positive action, and red for destructive action.

## Write product invariants as comparisons

Avoid vague requirements such as “show when busy”. Prefer executable statements:

- over capacity means `allocated > available`, not `>=`;
- normal allocations consume working weekdays only;
- a visible percentage uses the visible window;
- a forward risk flag uses a fixed fourteen-day window;
- only one activity kind may carry project references.

The reusable technique is to make edge semantics explicit:

- inclusive or exclusive ranges;
- equality behaviour;
- timezone owner;
- default state;
- missing-value meaning;
- which window a metric uses;
- whether a toggle hides data or deletes it.

Every important “not equal”, “only”, “never” or “fixed” belongs in a pure test.

## Decide what settings are

Classify each setting before implementation:

| Scope | Examples | Persistence |
| --- | --- | --- |
| Tenant policy | scheduling mode, enabled domain features | Account row; exported |
| Tenant immutable setup | timezone, language, week start | Captured at create; displayed read-only later |
| User preference | future per-login preference | Server user profile if truly portable |
| Device preference | theme, sidebar, dense labels | Local storage; not exported |
| Session hint | portrait rotation dismissal | Session storage |
| Operator policy | auth mode, backups, rate limits | Environment/configuration |

This classification prevents device UI choices leaking into account exports and prevents operator
security controls becoming user-editable settings.

## Prefer progressive capability

New companies should start with the smallest useful vocabulary. CapacityLens keeps disciplines
available by default because grouping is core, but hides placeholders and external resources until
an account enables them. Hidden features preserve their data; the toggle changes visibility, not
ownership or deletion.

Use the same approach in siblings:

- default optional concepts off;
- reveal them through a clearly named account setting;
- guard both navigation and direct routes;
- preserve existing data when a feature is hidden;
- ensure command palettes, selectors and empty states follow the same projection.

## Choose lifecycle semantics early

“Delete” is not one decision. Consider:

1. **Active** — normal views and writes.
2. **Archived** — reversible, hidden from normal work.
3. **Soft-deleted** — tombstone retained; sensitive display fields may be scrubbed.
4. **Purged** — irreversible hard deletion after an interlock.

If the domain needs recovery, auditability or erasure, build the lifecycle as a pure state machine
before adding list buttons. CapacityLens permits lifecycle transitions only for selected root
entities, protects its built-in Internal record and delays purge for thirty days.

## Use a decision record, not a diary

Standing decisions are short, present-tense constraints. They should say what is true now, not
recount every debate.

Good:

> Offline state is always viewer/read-only. The app never queues offline mutations.

Weak:

> We talked about offline and thought syncing might be hard, so for now maybe it should be read-only.

Put historical release detail in the changelog. Put operational procedures in operator docs.

## Feature proposal template

Before a substantial feature, answer:

1. What user problem occurs today?
2. Which user and how often?
3. Does it fit the product thesis and non-goals?
4. What is the smallest coherent behaviour?
5. Which canonical nouns and invariants change?
6. What happens in empty, loading, error, offline and read-only states?
7. What changes for tenancy, permissions and private fields?
8. What must migrate or sanitise?
9. How does a self-hoster operate and back it up?
10. What acceptance evidence proves it?
11. What is explicitly not included?

Use [`templates/feature-proposal.md`](templates/feature-proposal.md) rather than starting from a blank
issue.

## Scope test for new ideas

Score each proposed sibling idea before scaffolding:

- Is the recurring pain specific and observable?
- Can the core workflow be expressed with six or fewer main domain nouns?
- Can the first valuable outcome happen within one session?
- Is there a deliberately small initial audience?
- Can the hosted value be convenience/operations rather than withholding core capability?
- Can a single SQLite-backed instance serve the initial target safely?
- Are the non-goals credible?

If several answers are no, the idea needs more product work, not more repository code.
