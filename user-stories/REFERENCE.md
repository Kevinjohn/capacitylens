# CapacityLens — User-story reference (single source of truth)

This file pins the exact, current facts every user story and test script depends on:
routes, control labels, `data-testid`s, the first-run seed data, and shared conventions.
If the app changes, update this file first, then the affected stories.

> CapacityLens is a multi-tenant resource scheduler. It is **server-backed by default** (an empty
> env means the same-origin SQLite API). The app is **multi-tenant by Account**: you pick a company
> on load and the whole dataset is scoped to it. An explicit in-browser **demo build**
> (`VITE_CAPACITYLENS_DEMO=1`) keeps data in memory with no login or network calls and resets on
> reload — that
> is the build these manual stories run against, started with `pnpm run dev:demo`, signed in to the
> seeded **Wayne Enterprises** company.

---

## Launching the app (for a human tester)

1. From the project root run `pnpm run dev:demo` and open **the URL Vite prints**
   (<http://127.0.0.1:5173>; `localhost:5173` also works). If Vite exits with a
   port-in-use error, another dev server is squatting 5173 — find it with
   `lsof -nP -iTCP:5173 -sTCP:LISTEN` and kill it (strict port is deliberate).
2. **First run** seeds a demo dataset (see _Seed data_ below).
3. CapacityLens opens on a **demo sign-in** — a cosmetic, Google-style _"Choose an account"_ screen
   (the **Jordan Avery** account; heading `Choose an account`). It is **not** real auth and
   has **no** popup: click the single preview account to continue. It is shown only
   when real auth is off (the default) and is skipped once "signed in" (the choice persists
   device-globally; "Sign out" on the picker/sidebar returns to it).
4. Then the **company picker**. The active company remains session-only and is never persisted.
   On a browser reload, a login with exactly one valid company opens that company automatically and
   keeps the requested route; first entry, an explicit **Switch company**, and every multi-company
   login still show the picker. Pick **Wayne Enterprises** to see the seeded data these stories
   describe. (A second seeded company, _Stark Industries_, is near-empty, so this demo remains on
   the multi-company picker after a reload.) While "signed in", the picker shows
   _"Signed in as Jordan Avery"_ with a **Sign out** link. **`New company`**
   (`data-testid="new-company-button"`) opens an inline create form that captures the company
   name and the three **frozen-after-creation** fields: **Week starts on** (segmented
   Monday/Sunday, default Monday), **Timezone** (select, default `GMT`, with its numeric UTC offset
   shown in every option), and **Language** (read-only **English** — `data-testid="create-language"`;
   English-only until Paraglide). Company colour uses the default preset automatically rather than asking for a
   one-off choice during onboarding. These three are set ONCE here and are then **disabled** in
   Settings; the server rejects a later change with **409**.
   When there are no companies and the caller may create one, the picker presents only two next
   steps: **New company** or **Ask an admin for an invite**. A caller without create permission sees
   only the invite step. With one or more companies already listed, the subtitle says
   _"Choose a company to plan, or create another one."_
   If a refresh or account switch returns a slice that no longer contains the selected company,
   CapacityLens installs no active workspace: it returns atomically to this picker, shows the
   company-not-found notification, and rejects scoped edits until a real company is selected.
   A single-company reload attempt is consumed once, so a missing or deleted company cannot be
   repeatedly reactivated. An unavailable membership, empty company list, or invite handoff also
   remains at its safe entry boundary rather than being mistaken for a valid single company.
   Only the newest complete company-directory response may treat a missing company as revoked
   access. A superseded response cannot close the current company, and a partially malformed
   directory may publish its valid rows with a warning but cannot claim that a dropped membership
   was removed.
   **Single-company-per-instance policy + caller standing:** a server-backed deploy defaults to
   ONE company (`CAPACITYLENS_MULTI_ACCOUNT` unset) — once an account already exists,
   `GET /api/auth/me` reports `canCreateAccount: false` and the **`New company`** button is
   HIDDEN entirely (not merely disabled). Under auth-on the flag ALSO requires the caller's
   standing (the same predicate `POST /api/orgs` enforces): only a user who is owner/admin of
   SOME account — or any user on a zero-account instance — may create, so an editor-only or
   membership-less login never sees the button (its empty picker says "ask an admin for an
   invite" instead of "create your first one"). In SSO-only mode the current session must also come
   from the required strict provider; an experimental social-provider session cannot provision an
   Owner membership that would fail the next readiness check. A direct `POST /api/accounts` still 403s
   regardless, so this is UX only. The
   button stays visible whenever the fact is unavailable or doesn't apply: the demo build (no
   server, no cap), a zero-account instance (the bootstrap exemption — you must be able to create
   the FIRST company), an older server that predates these fields, or a deploy with
   `CAPACITYLENS_MULTI_ACCOUNT=1` set (the auth-backed stories' server runs this way, so its
   picker always shows the button). In a server deploy the create goes through `POST /api/orgs`
   (atomic: company + built-in Internal client + your Owner membership); a server refusal (the
   cap, org-create gate, or stale-session step-up) surfaces as the form's inline error. When an
   existing Owner/Admin membership authorises another company, the server requires a fresh session
   because creation grants a new Owner role. In an authenticated deploy,
   every listed company shows the caller's membership role — **Owner**, **Admin**, **Editor** or
   **Viewer** (`data-testid="company-role"`) — before it is opened. The in-memory demo instead says
   **Demo access** and an auth-off persisted server says **Open access**; neither invents an Owner
   membership. When an authenticated user switches companies, local writes fail closed as Viewer
   until the role resolved for that exact company replaces the prior company's authority. Each
   listed company also shows a **Delete** button (`Delete <name>`,
   type-the-name-to-confirm dialog) only to its Owner; Admin/Editor/Viewer get no company-delete
   affordance. In that dialog the destructive button remains keyboard-focusable while the typed
   name does not match, exposes `aria-disabled="true"`, and is described by the confirmation hint;
   activation is ignored until the exact company name is entered.
   Company deletion is atomic and fail-closed: if a corrupt stored relationship would cascade a
   delete or unbind into another company, both companies remain intact and the picker surfaces the
   server refusal for operator repair. A completed authenticated deletion retains its anonymized
   command receipt briefly: if the response is lost, retrying the same command returns success even
   though that company's membership is already gone. A post-delete `403` from an older/mixed server
   is treated as an unknown outcome, so the browser retains the command and refreshes the company
   list without an offline-cache fallback instead of converting uncertainty into a new destructive
   ceremony. The picker consumes that same erasure outcome classification rather than independently
   reclassifying the response status.
   After a confirmed deletion completes, the picker announces that the named company was
   permanently deleted.
5. Then a one-time **"What CapacityLens is" intro page** (heading `Welcome to CapacityLens`) — a minimal
   post-login explainer that CapacityLens is a resourcing tool, not a project-management tool. Click
   **Continue** (`data-testid="intro-continue"`) to enter the app. It shows once per device
   (`capacitylens/introSeen`, default off, never in `AppData`/export) and is skipped thereafter. The
   wording is **placeholder copy** (single-sourced under `intro_*` in `messages/en.json` and assembled
   by `src/lib/introCopy.ts`), pending a human edit.
6. On an account that still has an onboarding step to do, the schedule shows a floating **Getting
   started** checklist card (`data-testid="getting-started"`) over the schedule without shifting
   the toolbar or grid, with four
   state-driven steps — **Add your first client / project / person** (links to those pages) and
   **Assign them to the project** (done once any allocation exists). A step ticks itself off from
   the account's actual data (the built-in Internal client does NOT count as "your first
   client", and placeholder or external resources do NOT count as "your first person"); the card
   self-hides once ALL steps are done, so the seeded companies never show it.
   **Show me around** (`data-testid="getting-started-tour"`) runs a loose five-stop driver.js
   spotlight tour (schedule grid → toolbar → People → Clients & projects → Settings; Next/Back/
   Done buttons, Escape bails, never navigates). The button is busy and cannot start a duplicate
   tour while the lazy tour code is loading. If that code cannot load or start, the
   card remains usable and a persistent error says **The tour could not start. Check your connection
   and try again.** **Dismiss**
   (`data-testid="getting-started-dismiss"`) hides the card for good on this device
   (`capacitylens/gettingStartedDismissed`, default off, never in `AppData`/export). Hidden for a
   Viewer (every schedule-setup CTA is a write they can't do). In an authenticated company, Owner
   and Admin additionally see an optional **Invite your team** link to `/team`; it is deliberately
   outside the four completion steps, so a solo owner can finish setup without inviting anyone.
7. To start from the seeded state again, reload the page. The demo is intentionally temporary.
8. **If the page sticks on "Loading… / JavaScript isn't running"**, the browser is blocking
   scripts for the site (per-site JavaScript setting or a content-blocker extension — these
   also run in private windows when allowed). Enable JavaScript for the site and reload;
   no story can run without it.

## Navigation (left sidebar)

The sidebar links, in order, route to:

| Link label    | Route          | Screen                                                                                                                                                       |
| ------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Schedule      | `/`            | Timeline scheduler                                                                                                                                           |
| Resources     | `/resources`   | Resource list (incl. the **External** section when enabled)                                                                                                  |
| Disciplines   | `/disciplines` | Discipline list                                                                                                                                              |
| Clients       | `/clients`     | Client list                                                                                                                                                  |
| Projects      | `/projects`    | Project list                                                                                                                                                 |
| Activities    | `/activities`  | Activity list                                                                                                                                                |
| Time off      | `/timeoff`     | Time-off list                                                                                                                                                |
| Team & access | `/team`        | Current role, capability summary and app-member access management                                                                                            |
| Settings      | `/settings`    | Settings (scheduling, global working days, disciplines, schedule, work visibility, allocation bars, utilisation, appearance, local data and account options) |

The last two — **Team & access** and **Settings** — form a separate **administration group** pinned
to the **bottom** of the nav list, below a divider and separated from the working destinations
above. Both remain ordinary first-class routes (same markup, same icons, same command-palette
entries); only their placement differs, so administration stays out of the way of the app's
day-to-day purpose and role-gated controls don't sit among everyone's destinations.

That's **nine** sections by default — **eight** when the company turns disciplines off (the
**Disciplines** link is then hidden; see _Disciplines optional_ under Domain rules). External / 3rd
parties no longer have their own nav link — they moved INTO the **Resources** tab behind a setting
(see _External / 3rd parties_ under Domain rules); the old `/external` URL still resolves but
**redirects to `/resources`** so saved bookmarks don't 404. Each link
carries a small decorative icon (`aria-hidden`; the accessible name stays the label text).

An otherwise unmatched or stale URL renders the branded **Page not found** screen with a
**Go to schedule** link instead of the generic reload-only 404 recovery. Public reset/invitation
matching stays strict: while signed out, a truncated or nested token URL remains behind the usable
sign-in wall rather than being treated as a valid bearer entry.

Loading or reloading any valid section URL serves the application shell. A reload clears the
session-only active company; exactly one complete, valid company resumes automatically, while every
other directory shows the picker. Choosing from the picker keeps the requested URL and continues to
that section. Unknown extensionless URLs still reach the in-app
**Page not found** screen; missing asset and API paths remain real HTTP errors.

The **Import & export** card (**Export JSON** / **Import JSON**) is a closed-by-default disclosure
near the bottom of Settings, below **Archived & deleted** and above the compact account-options
summary. It used to be a "Data" section in the sidebar; it moved because a full-slice export or
replacement is a rare administrative act that does not warrant permanent navigation real estate.
In an authenticated
server deployment, **Import JSON** is owner-only because a slice replacement can author or erase
owner-confidential client/project identities; **Export JSON** remains available at its existing
role tiers and is server-redacted for non-owners. The local demo and auth-off deploy remain
owner-equivalent. Import repair applies the same erasure privacy rule as an interactive resource
deletion: a deleted person is anonymised and notes on their dependent allocations and time off are
removed before the replacement slice is stored. The portable file contains the active company's
scoped planning records but deliberately omits the company row itself. Import re-stamps those
records into the destination company and does not replace its identity, calendar, language,
scheduling mode or visibility settings. Export → import is a planning-data transfer, not a
byte-for-byte company clone.
Before a server import starts, CapacityLens flushes every pending edit. It then suspends persistence
for the atomic replacement and reloads the authoritative company slice before allowing edits again.
Server import preparation has a bounded worker pool and waiting queue. If that capacity is exhausted,
the import is refused as temporarily busy; if the browser disconnects, queued preparation is
withdrawn and active preparation is terminated before its worker slot is reused.
The server compares the complete company slice captured before import preparation with the slice
inside the replacement transaction. If another request commits a company change while the import is
being prepared, the import is refused with a conflict notice asking the owner to retry; the newer
change remains stored and ordinary writes resume without an authoritative reload.
If the import may have committed but the reload cannot prove the resulting state, the UI stays
blocked behind an explicit reload action; parked pre-import edits are never replayed over the
replacement. File reads and confirmations remain bound to the company that was active when the file
was selected, and export/import actions suppress duplicate in-flight requests.
The account block —
the active company name and role badge, a **Switch company** control (which returns to the company
picker), and a **Sign out** row carrying the signed-in person's avatar — is pinned to the very
**bottom** of the sidebar, below a divider beneath the administration group. (The company name used
to sit at the top; pinning it to the bottom keeps the logo + collapse toggle as the first item in
both the open menu and the collapsed rail, so the nav icons don't shift when the sidebar collapses.)
The avatar is the signed-in user's own picture when the identity provider supplied one, initials
otherwise, and the demo persona's face in the demo build. The row always reads **Sign out**, never
"Sign in": the sign-in wall means the sidebar only ever renders for someone already signed in.
It appears on any auth-enabled deploy and in the demo build; an auth-off server shows no such row.

**Badge shape.** Shared role and status badges use a compact pill silhouette. This applies to the
company picker and sidebar roles, invite roles, Team & access posture, placeholder resources,
company-login connection state and cutover readiness. Their semantic colour remains independent:
brand/default, neutral, warning, danger and outline badges keep their existing meanings.

**Collapse / expand.** A toggle button at the **top-left** of the sidebar (accessible name
**Collapse menu** / **Expand menu**, with `aria-expanded`) collapses it to an icons-only rail.
On small screens the matching top-bar control opens the sidebar sheet and exposes the same
state-dependent name and `aria-expanded` value.
The global **⌘B / Ctrl+B** shortcut performs the same toggle when focus is outside text-entry
controls and no modal is open; it yields to input, textarea, select and editable content, IME
composition, and modal dialogs so page chrome never changes underneath those interactions.
The toggle sits at the same left inset as the nav icons, so the toggle + icon column keep their
x-position when collapsing — only the labels and the "CapacityLens" wordmark come and go. Each rail
destination remains the same labelled, keyboard-focusable navigation link as in the expanded menu;
clicking or tapping it navigates directly while the rail stays collapsed. Its decorative icon is
`aria-hidden`, while the visually hidden label continues to supply the link's accessible name and
an instant visual hover label appears to the right. Collapsing hides
the account block until re-opened; the administration group stays as icons on the rail. The choice is device-global
(`localStorage` key `capacitylens/sidebar`); with no stored choice the sidebar starts **open on
desktop and collapsed on small screens** (`(max-width: 767px), (max-height: 480px)` — phone
portrait or phone landscape).

**Rotate hint (portrait phones only).** On a portrait viewport ≤ 767px wide, a dismissable
dialog titled **Best in landscape** appears (over the company picker too, since that's a
phone's first contact). **Got it** (or Escape / backdrop) dismisses it for the session
(`sessionStorage` key `capacitylens/rotateHintDismissed`); rotating to landscape hides it. It
never appears on desktop viewports or in landscape.

**Overlapping save and page close (server mode).** If an ordinary background save is still in
flight when the page is hidden or closed, the teardown keepalive sends the newest complete intent
immediately. The server orders both requests per browser session, so the newest edit wins whether
the ordinary request or the teardown request arrives first. An undo performed before the first
save acknowledges is also preserved, including removal of a newly created row that uses the
archive lifecycle. Teardown lifecycle archives travel in the same ordered atomic batch as ordinary
changes, so an older in-flight creation cannot recreate the archived row. If the page survives in
the back/forward cache and the user undoes a confirmed teardown archive, the foreground retry
unarchives that remembered row even when its local content already matches the pre-teardown save
baseline. An unrelated writer's intervening edit still produces the normal conflict-and-reload path.
On a conflict, the sticky notice says the edit was not saved and that CapacityLens is reloading the
latest copy; it does not claim reload completion before the authoritative read succeeds. If that
read fails, every write remains gated and connectivity recovery retries the read before any clean or
rebased follow-up save.
Every successful non-superseded batch receipt must identify the server-owned revision for each
written row exactly once. If that receipt is absent, partial, duplicated or names another row,
CapacityLens treats the commit state as uncertain, reloads the authoritative company slice before
accepting another write, and shows: **The server could not confirm every saved change, so the latest
server copy was reloaded. Review your recent changes and re-apply anything missing.**
A failed write also leaves the persistent save-error banner visible above the current page. If a
page-closing save is too large to dispatch, a sticky notice asks the user to keep the page open until
the warning clears and retry. Its
normal-size body copy uses the opaque danger token so it clears WCAG AA in both themes.
If a later company switch safely rebases a newer edit made while its slice loads but must discard
the older failed write, the newer edit still saves and the sticky re-apply notice remains visible;
success for the rebase never hides the independent loss.

## Seed data (first run)

> This auto-seed is **DEMO-BUILD-ONLY** going forward (single-company-per-instance policy). A
> real, server-backed instance (the default deploy) no longer auto-seeds from the client side —
> `bootstrap()` (src/main.tsx) only passes a seed dataset in the demo build
> (`VITE_CAPACITYLENS_DEMO=1`); a fresh server-backed instance lands on the empty
> create-your-company picker instead of a fabricated "Wayne Enterprises" (a pre-seeded two-company
> instance would otherwise trip its own single-company cap on first boot). The two-company seed
> described below happens only in: the demo build (`pnpm run dev:demo`, what these stories run
> against), local dev tooling that opts in explicitly, and the db-backed E2E server's explicit
> `POST /api/test/reset {seed:true}` (used by `e2e/db-helpers.ts`'s `resetServer()` — exempt from
> the single-company cap so tests can still exercise a two-company picker). The reset route exists
> only in trusted-local/auth-off mode; an auth-enabled server refuses it even when the development
> flag is set because a browser session carries no installation-wide erasure authority.

- **Accounts (companies):** **Wayne Enterprises** (holds everything below — pick this one) and
  _Stark Industries_ (a second tenant with one Design discipline and no work).
- **Disciplines:** Design (order 0), Development (1), Copywriting (2).
- **Resources:**
  - _Bruce Wayne_ — Designer, Design, permanent, 8h, Mon–Fri.
  - _Diana Prince_ — PR & Brand, Copywriting, permanent, 8h, Mon–Fri.
  - _Clark Kent_ — Web Developer, Development, permanent, 8h, Mon–Fri.
  - _Barry Allen_ — Front End (freelance), Development, **freelancer**, 8h, **Mon–Wed only**.
  - _Senior Designer_ — a **placeholder** (no name), Design, **bound to Project Watchtower**. Shown
    as the literal name **"Placeholder"** with a **"?"** avatar. **Hidden by default** — placeholders
    are behind the per-account **Show placeholders** pref (Settings → Placeholders, default **off**);
    enable it to see this row in the schedule, the Resources list, and the assignee picker.
  - _Kord Industries_ — an **external / 3rd party** (`r-ext-northstar`): a company, no discipline/
    capacity, booked on Visual Design (Project Watchtower) as a span only. **Hidden by default** —
    externals are behind the per-account **Show external resources** pref (Settings → External,
    default **off**); enable it to see this row in the schedule's bottom band, the **External** section
    of the Resources tab, and the assignee picker.
- **Clients:** Queen Consolidated, LexCorp. (**Internal** is the built-in, one per account — it is **HIDDEN
  from the Clients management list**, but still selectable as a project's client and a "Filter by
  client" option; see the Internal-client appendix below.)
- **Projects:** Project Watchtower (Queen Consolidated), Metropolis Rebrand (LexCorp).
- **Phases (Project Watchtower):** Discovery, Build.
- **Activities** (every activity has a **kind**): _Project-specific_ — Wireframes, Visual Design, CMS Review
  (Watchtower), Brand System (Metropolis Rebrand); _Internal_ — Admin / Internal; _Cross-project_ —
  Design, Workshop. "Design" is also booked for Barry (8–10 June) to demo the activity lens.
- **Canonical allocations (June 2026):** Bruce is **over-allocated on 3–4 June** (8h + 4h > 8h).
- **Canonical time off:** Bruce — 10–12 June (Holiday).

The canonical `seed()` fixture remains fixed to June 2026 for repeatable tests, screenshots and the
exact dates in these stories. Runtime demo, access-lab and opt-in server seeding shift the same
relative scenario onto the current Monday: Bruce's overlap remains Wednesday–Thursday and his time
off remains the following Wednesday–Friday, so a new session opens populated without a date jump.
The Playwright suite freezes the browser clock to **2026-06-03** in `e2e/helpers.ts` `openApp()`, so
its runtime seed resolves to the canonical 1 June week and the literal story dates remain executable.

**Allocation drag transactions.** A diagonal drag that changes both dates and assignee is one
operation. If the target row rejects the allocation (for example, a placeholder bound to another
project), the allocation keeps its original assignee, dates and hours; the rejection notice never
accompanies a hidden source-row move. Adjacent assignee lanes use top-inclusive, bottom-exclusive
hit regions, so a pointer exactly on their shared edge belongs to the following visible lane rather
than the preceding one. While a large schedule scrolls vertically during a drag, newly visible rows
become drop targets and the original allocation remains pinned until the gesture completes. A
keyboard move or resize cannot move a currently visible bar wholly beyond the rendered timeline;
after a successful nudge the grid follows the bar and restores focus to it.
Reassignment also applies one start-date rule in every drag direction: the destination date must be
both a company working day and one of that person's working days. A purely vertical drop onto an
unavailable destination date is rejected atomically; the original assignee and dates remain
unchanged. An allocation with **Ignore working days** enabled deliberately bypasses both recurring
calendars during a move. Time off remains a visible capacity conflict rather than silently moving
the allocation to another date.

**Weekend columns.** By default the **Minimise weekends** display pref (Settings → Schedule,
on by default) shrinks the Saturday and Sunday columns to a sliver — just wide enough for the
date number — and their weekday label reads a single **"S"** (both Sat and Sun), so the working
week dominates the helicopter view. Weekends are not removed: people can still work weekends,
bars span across them, and the narrowing only applies at a fine enough zoom to show per-day
columns. Turn the pref off and weekends return to full width with `Sat`/`Sun` labels.

**Month header placement.** In the wide 1- and 2-week views, each month/year label starts at the
left edge of the first visible day in that month, including split-month windows and a partial month
at either edge. The 4-, 6- and 8-week views retain the compact sticky label, bounded to its own month
so neighbouring labels cannot overlap.

## Control labels (accessible names)

**Forms (modals).** Fields are labelled: `Name`, `Role`, `Type`, `Discipline`,
`Engagement`, `Bound project`, `Working days` (a full-width Monday–Sunday radio grid aligned with
the field label whose `Full day`, `Half day` and `Not working` column headings appear once; every
cell's native radio is labelled by both its weekday and availability, and each row permits one
choice; long labels remain on one line inside a horizontally scrollable narrow-width boundary),
`Colour (…)` (a swatch-picker trigger — its name carries the current colour, e.g.
`Colour (Blue dark)` for a known swatch, else the raw hex — that opens a `radiogroup` of preset
colour swatches, each `radio` labelled by a human-readable name like `Blue dark` /
`Red bright`, not a hex). The selected swatch is the group's single Tab stop; arrow keys move and
select between presets. Fields with rejected input expose the inline error as their accessible
description. Allocation and time-off validation focus the associated invalid field (or the
form-level alert), scroll it into view, and clear the stale error on the next edit. Other labels are
`Start`, `End`, `Hours / day`, `Repeat`, `Status`,
`Note`, `Assignee`, `Project`, `Activity`, `Resource`, plus `Company` + `Descriptor` (the External form).
The Resource, External party, Discipline, Client, Project, Activity, Time off and Allocation
add/edit modals use an approximately 25/75 label-to-control row at normal modal widths and stack
vertically on narrow screens. This includes conditional Activity Kind/Project controls,
Client/Project privacy controls and every applicable Allocation field in Hours, Days and Blocks
modes. Long labels wrap inside the label column without shifting the control column. Compound
Allocation controls remain side by side inside the control column; inline activity creation and
date/end/repeat hints align with that column; Status fills it with three equal segments. The
Resource form's `Working days` grid fills that same field width without widening the modal at narrow
sizes. Administrative modal layouts are unchanged.
The allocation modal's `Project` picker begins with `Internal` and `Any Project`, followed by a
separator and the real projects sorted by client name and then project name. `Internal` exposes only
internal activities; `Any Project` exposes only cross-project activities; a real project exposes
only its project-specific activities. Each resulting `Activity` list is alphabetical. `Any Project`
is wording local to this picker: cross-project activities keep their established name elsewhere.
Allocation `Status` is a three-option `Confirmed` / `Tentative` / `Completed` radiogroup, and `Note`
is a single-line text field. A historical multiline note remains byte-for-byte intact when another
field is edited and saved; editing the note itself adopts the single-line value shown by the field.
The allocation checkbox is labelled exactly `Ignore working days`. Unchecked, the allocation follows
the assignee's effective working week (the company's global working days intersected with their
personal pattern); checked, it uses every calendar day in the date span. The
control is hidden for external allocations, whose start/end span is already literal.
Client and project forms also expose an owner-only `Use a code name` switch, **off by default**.
Turning it on reveals the required `Code name` field (placeholder `e.g. Nightwing`) and the hint
`Quotation marks are added automatically.` Non-owners editing an already-private row do not see the
switch/code-name field; its redacted `Name` is disabled with `Only an account owner can change this
private name.` An open client or project edit form never silently overwrites a newer copy loaded
underneath it. If that entity changes or disappears before **Save**, the form stays open, writes
nothing, and shows `This client changed while you were editing. Close and reopen the form, then
re-apply your changes.` or the equivalent `This project changed…` message.
Resource, external-party and time-off edit forms use the same stale-edit contract and show the
equivalent entity-specific `changed while you were editing` message.
The **activity form** has an `Activity kind` radiogroup ordered `Internal` / `Cross-project` /
`Project-specific` (with `Project-specific` selected by default); the
`Project` field shows (and is required) only for the `Project-specific` kind — internal/cross-project
activities are project-less.
The **time-off form** presents `Note` as a single-line text field and shows/submits it only for
Owner/Admin (and open/demo mode, where no membership role applies); Editor/Viewer never receive or
submit that protected field.
Buttons include `Save`, `Cancel`, `Delete`, `Archive`, `Duplicate`, and `Add activity` as applicable.
The **create / "Add"**
affordances carry a leading **`+`** glyph before the label (decorative, `aria-hidden`; the
accessible name stays the label text). List pages have an add button per entity: `Add resource`,
`Add discipline`, `Add client`, `Add project`, `Add activity`, `Add time off`,
`Add external party` (plus the company picker's `New company`).
Resolved Viewers do not see resource or section-level create affordances; the company picker's
separately authorised `New company` action follows its account-creation capability instead.
Each list row has an **icon-only** `Edit <name>` (pencil) button and, where supported, an icon-only
destructive action. Time-off rows include the resource and complete date range in both action names
(`Edit <name> time off from <start> to <end>` / `Delete …`) so repeated entries for one person remain
distinct. Resources, clients,
and projects use **Archive** (`Archive <name>`); their records and children are retained under the
lifecycle described below. Other deletable rows use **Delete** and include the row name when several
controls would otherwise be ambiguous (for example, `Delete Design`). The glyph is decorative and the
button's `aria-label`/`title` carries its action and, where needed, the row name.
Person and external-party rows also have an account-wide favourite toggle beside Edit/Archive.
Its star is an outline when off and yellow-filled when on, exposes `aria-pressed`, and is named
`Add <name> to favourites` or `Remove <name> from favourites` for the action it will perform.
Viewers do not see the toggle, and placeholder rows never show one.

The **Time off** page is a forward-looking capacity view. It shows entries whose end date falls on
or after the start of the current company week, calculated from the active company's timezone and
Monday/Sunday week-start setting; older entries remain stored but are hidden. Entries are grouped
into one compact bordered list per resource, with the displayed resource name shown once as the
section heading. Resource sections sort alphabetically, and their rows sort by start date, end date
and id. Placeholder entries still follow **Show placeholders**; an unexpected dangling resource is
kept visible in a final **(unknown)** section rather than crashing.

An ordinary allocation **Delete** asks for confirmation, then closes its editor only after the store
accepts the removal. A newly generated repeat batch carries one optional, system-owned series ID;
legacy repeats and one-off allocations remain unlinked. Deleting a linked occurrence instead asks
whether to delete only that occurrence or that occurrence and every later-starting allocation in the
same account and series. Earlier occurrences remain. Either choice is one atomic, undoable mutation,
and one Undo restores the complete removal. Editing a linked occurrence preserves its membership and
never applies edits to future occurrences. Linked occurrences do not offer **Duplicate**; unlinked
one-off allocations retain it regardless of activity kind. If any deletion rejects, the dialog stays
open and its form error surfaces the safe rejection reason. Viewers see no allocation mutation actions.

**Repeat allocation creation.** New allocation forms opened from either the row **+** or a drawn
range include a **Repeat** dropdown between the scheduling controls and **Status**. It defaults to
**Doesn’t repeat** and offers **Weekly**, **Every 2 weeks**, **Every 3 weeks**, **Every 4 weeks** and
**Monthly**. Choosing a cadence reveals a required **Repeat until** date suggested as the end of the
month two calendar months after the allocation start (and safely clamped at the supported date
boundary). The suggestion follows start-date changes until the user edits it. The cutoff is inclusive
by occurrence start: an occurrence whose start is on the chosen date is included, and its
end may fall later. Repeat until cannot precede today or the allocation start, must allow at least one
occurrence after the entered allocation, and cannot be later than six calendar months after the
allocation start. A valid choice previews the number of linked allocations, chosen cutoff and final
occurrence start. Saving gives the generated allocations one shared series ID in a single undoable
operation; old independent repeats are never inferred or backfilled. Each occurrence can still be
edited independently while retaining its series membership. Deletion can target one occurrence or
that occurrence and all later starts in its series; earlier starts are untouched. Edit never shows
the Repeat choice. Duplicate is available only for unlinked allocations, where it creates one
independent allocation; linked occurrences hide it. Capacity and time-off warnings count the
generated allocations affected, remain advisory, and include conflicts between allocations in the
same generated batch. The batch advisory also counts occurrences whose generated start lands on a
non-effective working day (a monthly day-of-month cadence can drift onto one): the first occurrence
must start on an effective day like any new allocation, but later occurrences are still created and
simply load nothing there, so the count is informational rather than blocking.

Linked-series bars show a repeat icon when space permits. Their hover/focus details and accessible
name state **Series through <date>**, where the date is the end of the last surviving allocation in
the series. One-offs and legacy unlinked repeat batches show no series cue.

**Destructive confirmation** uses the action-specific title and buttons: lifecycle list actions use
`Archive <entity>?`, `Archive`, and `Cancel`; actual deletion uses `Delete <entity>?`, `Delete`, and
`Cancel`. Dialog/footer action buttons keep their text — only the list-row actions are icon-only.
The archive flow is reversible and retains children; it must not be described as cascade deletion.

**Scheduler toolbar.** A filter-icon button at the right of the toolbar, after **Undo**/**Redo** and
its own divider, starts as **Show filters** with `aria-expanded="false"`; it becomes **Hide filters**
with `aria-expanded="true"` while the centred secondary filter row is present. Viewers retain the
filter button in the same right-hand action area while the unavailable history controls are hidden.
Opening and closing the row moves the schedule body down and back up without changing any filter or
draw-mode state. A **Weeks visible** dropdown (a `role="combobox"` select whose accessible name
carries its visible text — "Weeks visible, 4 weeks" — so voice control can act on the words on
screen, WCAG 2.5.3) replaces the former zoom radiogroup (#173): its five options read "1 week", "2
weeks", "4 weeks", "6 weeks", "8 weeks", and the closed trigger displays the current one (e.g. "4
weeks"). Then icon-only **Prev**/**Next** chevron buttons (accessible names "Prev"/"Next" via
`aria-label`, hover titles "Back one week"/"Forward one week" — the words no longer show) and a
text **Today** button. The **Jump to date** date input is HIDDEN from the toolbar as of #173 (a
deliberate product decision — people rarely look far ahead, and a month list is the likely future
affordance); its component (`src/components/scheduler/JumpToDateInput.tsx`) is retained, gated
behind `SHOW_JUMP_TO_DATE` in `SchedulerToolbar.tsx`, and its behaviour is covered by
`src/components/scheduler/JumpToDateInput.test.tsx` plus the `goToDate` tests in
`src/store/useStore.test.ts` rather than through the toolbar UI.
The week dropdown opens below its trigger so all five options, including **1 week**, are immediately
visible without scrolling.
**Navigation always re-anchors the grid's left edge to the week start** (the account
`weekStartsOn`, default Monday): choosing a **Weeks visible** level, a **Prev/Next** pan, and
**Today** all snap the leftmost column to that week's Monday so the helicopter view always
opens on a week boundary. (The hidden **Jump to date** picker snaps the same way when re-enabled —
see the tests above.)
A pure window resize / Minimise-weekends toggle does NOT re-anchor — it preserves the exact
left-edge date. (This is ALWAYS on; there is no setting.)
**Undo**/**Redo** icon buttons (`undo-button` /
`redo-button`, `aria-label` "Undo"/"Redo", disabled when the history stack is empty) — the
visible counterpart to the global Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z shortcuts; their title hints use
the current platform's conventional labels. The expanded filter row starts with the draw-mode
radiogroup `Work`/`Time off` (radios using `aria-checked` — note "Time off" here is the _toggle_,
distinct from the "Time off" _nav link_). **In `Time off` mode the grid signals the mode whole-view:
work allocation bars recede to a flat neutral (the theme-aware `var(--color-muted-foreground)` token, which adapts to light/dark) at 20% opacity AND go fully _inert_ (not
clickable/draggable, no hover popover, not tab-reachable), while existing time-off blocks use the
same vivid yellow background and dark label ink in both themes, retain their light-grey diagonal
hatch and carry only a tight glow — so a lane draw books time off without the bars intercepting the gesture (a draw started
over an existing allocation falls through to the lane). The grid carries
`data-draw-mode="work"|"timeoff"`; nothing about the underlying data changes.**
Switching modes is announced in the scheduler's polite live region. In Time-off mode row summaries
omit work-allocation counts, and each eligible non-external resource row exposes a keyboard
**Add time off for <name>** button that opens the same prefilled time-off form as drawing the lane.
External rows expose no time-off creation action.
Undo/redo run
from BOTH the toolbar **Undo**/**Redo** buttons (above) AND the global Cmd/Ctrl undo/redo shortcuts.
The rest of the expanded filter row follows the draw-mode control:
`Search people…` matches accent-insensitively across the displayed name, stored name and role as
one phrase, so a query may span those fields. The remaining controls are `Filter by discipline`
(in the scheduler grid's canonical discipline order), `Filter by client` (Internal first, then
alphabetical), `Filter by project` (Internal-owned projects first, then alphabetical by project name),
`Filter by activity` (a grouped dropdown — `All activities`, then an `Internal` optgroup with
`Internal — All` + each internal activity, then a `Cross-project` optgroup with `Cross-project — All` +
each group's activities alphabetically; shown only when the account has internal/cross-project activities. Project-specific activities
are reached via `Filter by project`). The activity lens is a **standalone** view: selecting it
clears the client/project filter and vice-versa. `Hide tentative` checkbox, `Show unallocated`
(shown only while a client/project/activity filter is active, **off by default** — filtering hides
resources with no matching work in the displayed timeline; ticking it brings them back
visible-but-dimmed so you can see who's free to staff), `Clear Filters` (always shown at the far
right; disabled and visually quiet with no active filters, then red with a bin icon while active).

**Schedule display (minimise weekends).** Settings → **Schedule** has a switch
**Minimise weekends** (`role="switch"`, accessible name `Minimise weekends`), **on** by default.
It's a **device-global** display pref (own `localStorage` key `capacitylens/minimiseWeekends`, NOT on the
account and NOT in export) — like the theme and bar-label toggles. On → narrow Sat/Sun columns
with a single **"S"** label; off → full-width weekend columns labelled `Sat`/`Sun`. See _Weekend
columns_ above.

**Global working days (account-level).** Settings → **Global working days** exposes a two-row table:
seven abbreviated weekday headings and seven checkboxes directly beneath them, in the account's
configured week order. A new company selects the first five days of that week by default
(Monday–Friday for a Monday start; Sunday–Thursday for a Sunday start).
Changing the week-start presentation only reorders these controls; it never changes the saved
selection. Editors and above may change the selection; Viewers can read it but cannot edit it.
The selection cannot be emptied: when exactly one day remains checked, that checkbox is disabled
(still visibly checked) and a visible explanation — `At least one company working day is
required.` — is referenced from the checkbox via `aria-describedby`. The store rejects an empty
company week outright, and every repair boundary (import, server write, startup) heals an empty or
malformed stored selection to the week-start-aware default.

The account selection governs **capacity**, not just interaction. Each capacity-tracked person's
**effective working week** is the intersection of the company's global working days and their
personal working pattern; External parties use the company set verbatim. A normal allocation
schedules and loads hours only on effective days — a day it merely spans that is company- or
personally-non-working stays grey and unavailable, contributes zero scheduled and zero available
hours, and is excluded from utilisation on both sides of the ratio. Days- and Blocks-mode spans
count their length in effective days, so the stored day count is preserved and the end date is
reinterpreted when either calendar changes. A person whose intersection is empty has **no effective
working days**: zero capacity everywhere, and no new work can be placed on them.

New placement is gated at every entry point: the lane hover **+** is absent and a click or draw is
rejected when its start date is not an effective working day or is covered by that resource's time
off; a typed start date in the creation form, a **Duplicate**, and a reassignment to another person
are all rejected with the same rule — new allocations must start on a company and personal working
day. A multi-day draw may still cross blocked dates after an allowed start. **Ignore working days**
is the explicit per-allocation escape hatch: it makes the saved allocation use every calendar day
in its span (loading hours on company- and personally-non-working days, which then read as
over-capacity), and moving an existing allocation with it enabled may land a literal start on
either kind of non-working date. It never bypasses time off, and it never changes where a **new**
allocation may start — closed-day work is reached by creating on an open day with the checkbox
ticked, then dragging or extending onto closed days. Saving edits to an existing allocation stays
permissive so historical records never trap the form, though a person with no effective working
days cannot have their normal (non-ignoring) allocations moved or resized until a working day
returns.

Changing the global selection **reinterprets** existing allocations rather than rewriting them:
stored dates never move, but capacity, utilisation and conflicts are recalculated, so work on newly
non-working days no longer counts unless the allocation has Ignore working days enabled. Time off
remains a separate mechanism and a visible conflict rather than a calendar rule.

**Schedule display (snap to week start).** The same Settings → **Schedule** section has a second
switch **Snap to week start** (`role="switch"`, accessible name `Snap to week start`), **on** by
default — sibling to _Minimise weekends_. It's also a **device-global** display pref (own
`localStorage` key `capacitylens/snapToWeekStart`, NOT on the account and NOT in export). On → after a
**free horizontal scroll** settles, the grid **floors** its left edge back to the current week's
first day (the account `weekStartsOn`, default Monday) — a stray nudge that would park the view on
a Tue/Wed settles back to that week's Monday. It floors (never forward): forward weeks are reached
via Prev/Next. Off → free scrolling is unconstrained and a nudge sticks on the mid-week day. This
governs **free scroll only** — the always-on **navigation** snap (Weeks visible / Prev-Next / Today,
see _Scheduler toolbar_ above) re-anchors to the week start regardless of this switch.

**Account options selected at creation (per-account, FROZEN after creation — P1.14).** The final
Settings card is a compact, read-only four-row table: **Company name**, **Week starts on**,
**Time zone** (including its numeric UTC offset) and **Language** (`data-testid="settings-language"`,
**English**). It replaces the editable Company card and the disabled Calendar controls. These values
are captured ONCE in the company-create form (see _Launching the app_ above), and the help modal
explains that they cannot be changed here. The server continues to reject a direct change to
`language`, `weekStartsOn` or `timezone` with **409**. Ordinary company-wide planning and display
settings — scheduling mode, disciplines, colour mode and feature-visibility switches — deliberately
use the normal Editor-and-up write tier. Identity, membership, privacy, lifecycle, import and company-erasure
operations retain their stricter Admin/Owner gates. (English-only until Paraglide; the value persists
as `'en'` on the Account.)

**Settings help and disclosures.** Every Settings card has an icon-only question-mark action whose
accessible name and native hover title are `About <section>`. Activating it opens a labelled modal
with the fuller explanation that used to sit permanently in the card. **Device data**, **Archived &
deleted** and **Import & export** are separate disclosures, each closed by default and independently
expandable; opening one never closes another. Safety consequences remain in destructive confirmation
dialogs rather than depending on hidden help copy.

> **i18n note.** Every Settings + Team & access label/heading/button/placeholder/hint quoted in
> this file is rendered from a Paraglide message key (`settings_*` in `messages/en.json`) rather
> than an inline literal. Role labels (Owner/Admin/Editor/Viewer) and the
> week-start/theme/scheduling option lists resolve their labels at render. Interpolated copy (the
> server-vs-local clear-storage / "Signed in as …" / status-suffixed error toasts) is deferred to the
> later toasts/errors i18n area; its visible text is likewise unchanged.

**Placeholders (per-account, default OFF).** Settings → **Placeholders** has a single switch
**Show placeholders** (`role="switch"`, accessible name `Show placeholders`), **off** by default.
It's a **per-account** setting (`placeholdersEnabled` on the Account, absent = off, toggled via
`updateAccount` — mirroring `disciplinesEnabled`; synced but omitted from the scoped planning-data
export). **Off** (the out-of-the-box state) → every placeholder is hidden:
no row in the schedule (and no contribution to utilisation), no entry in the assignee picker or
command palette, and the Resources page hides its _Placeholders_ section + _Add placeholder_ button.
The **Time off** views honour it too: the Time-off list hides any time-off entry whose resource is a
placeholder, and the Time-off form's Resource picker omits placeholders.
The placeholder DATA is untouched — flipping the switch on brings the rows back (and the hidden
time-off entries reappear). **On** → a placeholder shows the literal name **"Placeholder"** with a
**"?"** avatar (its role/discipline is the secondary text); the assignee picker labels it
**"Placeholder (slot)"**, and the Time-off list/picker show it as **"Placeholder"**. Editing an
allocation **or a time-off entry** that already targets a placeholder keeps that placeholder
selectable in the picker even while the pref is off, so editing never silently reassigns the work.

**Allocation bars.** A bar's label reads `Client · Project · Activity · Nh` (hours hidden in
blocks mode; a `✓ ` prefix when completed, a trailing ` •` when it has a note). The client
and project parts are device-global toggles in Settings → **Allocation bars** — switches
`Show client name` and `Show project name`, both **on** by default; a bar whose activity has no
project (or whose toggle is off) just skips that part. The hover/focus popover keeps its own
activity-first layout regardless of these toggles. Its visible card contains allocation details
only; the retained drag/resize/reassign guidance is exposed as the popover's assistive label rather
than as a footer over the schedule.

**Internal work colours (per-account, default GREY).** Settings → **Internal work colours** has a
two-option segmented control (`role="radiogroup"`, accessible name `Internal work colours`):
**Grey** (the default) or **Use colour palette**. It is stored as `internalColourMode` on the
Account (absent = `grey`, syncs but is omitted from the scoped planning-data export). In **Grey** mode, allocation bars for `internal`
activities and for projects owned by the built-in **Internal** client use the neutral grey, and an
Internal-owned project's saved colour is overridden by grey in the Projects list. The project
form hides its existing **Colour** swatch picker whenever the selected client is Internal; the
saved palette colour is retained rather than cleared. Switching to **Use colour palette** restores
those saved project colours and reveals the picker. Cross-project activities remain a distinct
kind and retain their existing resource-derived colours in both modes.

**Disciplines (account-level).** Settings → **Disciplines** has a single switch **Use disciplines**
(on by default). Turning it off hides disciplines across the whole app — the **Disciplines** nav
link and route (a direct `/disciplines` URL redirects to `/`), the **Discipline** field in the
resource form, the **Filter by discipline** control, the discipline part of each Resources-list
row, the Disciplines command-palette entry, and the **Show Discipline Utilisation** toggle. The
schedule then groups capacity-tracked resources by **Studio** and **Supplementary** engagement
(or one **Unassigned** band when engagement grouping is off), followed by External / 3rd party.
It's stored on the account
(`disciplinesEnabled`, syncs but is omitted from the scoped planning-data export), so it applies to everyone on that company; the discipline
data itself is kept and reappears if switched back on. Both seed companies leave it on.

**Engagement grouping (account-level).** Settings → **Engagement grouping** has a single switch
**Group resources by engagement**, on by default. When on, Resources renders people in separate
**Studio** and **Supplementary** sections; each section puts favourites first and then sorts by
display name. On the schedule, assigned resources stay in canonical discipline order and unassigned
resources follow in separate **Studio** then **Supplementary** bands. With disciplines off, those
engagement bands become the primary schedule grouping. Empty bands never render and External /
3rd party remains last. When the switch is off, Resources returns to one People list and the
schedule uses one **Unassigned** fallback band for resources outside a discipline. Placeholders
remain after people inside the applicable band. The preference is
stored on the account (`groupResourcesByEngagement`, absent = on), so every member of the company
sees the same grouping.

**Clear device data (Settings → Device data).** A closed-by-default maintenance disclosure near the
bottom of Settings contains a `Clear device data` button
(`data-testid="clear-local-storage"`). Clicking it opens the standard confirm dialog (title
`Clear device data?`, danger `Clear device data` confirm + `Cancel`). It removes the opt-in offline
snapshot and CapacityLens preferences from **THIS browser**, leaves server data and unrelated origin
keys alone, and reloads. **Cancel is a no-op.**

**Offline cache health (Settings → Offline access).** When offline access remains opted in but a
snapshot write fails, Settings keeps the switch on and shows that recent snapshots could not be
saved on this device. The warning clears after a successful snapshot write or after offline access
is disabled; it does not claim that already cached data was deleted. Offline shell installation is
available in production builds. Vite development/demo servers reject enablement with a clear
message because their on-demand module graph cannot provide a complete, immutable shell for safe
offline promotion.

**Build stamp + feedback link (Settings, flag-gated).** When the build sets
`VITE_CAPACITYLENS_BUILD_SHA`, the Settings page ends with a muted one-line footer containing the
stamp (`data-testid="build-stamp"`) reading `build <sha> · server` (a server backend is
configured, i.e. `VITE_CAPACITYLENS_API` was baked in) or `build <sha> · demo` (in-memory
mode). When the build also sets `VITE_CAPACITYLENS_FEEDBACK_MAILTO`, a **Send feedback** link
(`data-testid="send-feedback"`) sits beside the stamp — a `mailto:` whose subject carries
the build stamp, so reports arrive pinned to a build. The build value must be one valid email
address; invalid build configuration is rejected, and the address is safely encoded into the URI.
The default dev/local build leaves both variables unset and renders **nothing** — the seeded state
these stories run against has no footer at all.

**Persistence diagnostics (Settings, server mode).** A collapsed **Persistence diagnostics**
disclosure (`data-testid="persistence-diagnostics"`) reports process-local, privacy-safe counts for
failed saves, armed retries, completed reconciliations, superseded reloads, rebased edits and
discarded edits, plus whether writes are currently suspended. It contains counts and state only—no
company, person, project or note values—and resets when a fresh persistence lifecycle attaches.

**Login screen (flag-gated; not reachable in the default deploy).** Only when the app runs in
server mode (`VITE_CAPACITYLENS_API` set) **and** that server runs with `CAPACITYLENS_AUTH=password` or
`sso`: the app checks `GET /api/auth/me` at boot, showing **Checking your session…** as an
accessible status while the request is pending; a 401 replaces everything — company
picker included — with a **Sign in** screen (heading `Sign in`; fields `Email` + `Password`
and a `Sign in` button in password mode; a `Continue with SSO` button in sso mode; failures
show an inline alert). If a mid-session 401 arrives while server writes are still unsaved, the
sign-in wall also warns **Some changes could not be saved before your session expired. They will
not be restored after you sign in again.** On a fresh server-mode boot, company persistence starts
only after `/api/auth/me` has admitted the session: a signed-out visitor or an identity awaiting
mandatory MFA makes no tenant-data request and cannot receive a misleading save-failure banner.
Because session cookies are shared across tabs, a server-mode tab also rechecks the session when it
returns to the foreground. A sign-out or revocation completed in another tab therefore replaces its
stale authenticated shell with the sign-in wall before the user resumes work.
The sign-in, mandatory MFA and session-verification failure walls set page-specific document titles;
the failure detail is announced as an alert when it replaces the checking state.
While signed in, Settings gains an **Account** section
showing who is signed in plus a `Sign out` button. With auth off (the default everywhere) or in
local mode, no login screen exists, Settings has no Account section, and local mode makes **no**
auth request at all. The server's reported `authMode` is the single source of truth — there is no
client-side auth flag.

Identity display-name and label limits count Unicode code points, so an astral CJK character is one
character even though browser `maxlength` uses two UTF-16 code units. Email admission applies the
254 limit to UTF-8 bytes. Passwords independently use the documented 15–128 Unicode-code-point
policy.

**Password MFA and account security.** When an operator sets `CAPACITYLENS_REQUIRE_MFA=1`, after
first-owner setup or after an existing pre-MFA user signs in, the app shows **Secure your account**
before any company data. MFA is optional by default. The user enters their current password
(`data-testid="mfa-enroll-password"`), records the authenticator URI and one-time recovery codes,
enters the six-digit code (`data-testid="mfa-enroll-code"`), confirms the codes were saved, and
chooses **Enable MFA** (`data-testid="mfa-enroll-submit"`). A user who already enrolled sees an
**Authentication code** challenge after email/password sign-in (`data-testid="mfa-code"`, submit
`data-testid="mfa-submit"`), with a recovery-code alternative. The in-place **Confirm it's you**
challenge for sensitive actions offers the same **Use a recovery code** alternative, so a stored
one-time code can restore freshness without signing out or losing the current form. The enrollment
wall deliberately outranks public-entry links for a signed-in identity: an invitation explains that
MFA must be finished before it can be accepted, while a password-reset link explains that the user
may finish enrollment or choose **Sign out** to redeem the link without the current session. Settings gains a **Security** section
(`data-testid="security-section"`) where password users can change their password only by supplying
the current password and can view/revoke active sessions. Recovery codes and session tokens are
never displayed after their one-time setup/use. Disabling MFA is deliberately not offered when the
deployment requires it.

On a `self-hosted-mixed` deployment with strict OIDC configured, the Security section also shows
**Connect your SSO account** (`data-testid="sso-connection"`). **Connect with _provider_** starts a
fresh-session-gated, self-service provider ceremony; the member authenticates at the IdP and returns
to the same page. The provider must assert `email_verified: true`, its email must match the local
sign-in email, and its immutable subject must not belong to another principal. A successful callback
shows **Connected to _provider_**. Raw provider link/unlink routes are unavailable. A federated
session in mixed mode uses that same provider—not a password it may not have—for **Confirm it's you**.

**First-run owner setup (password mode, zero users).** When the server reports `needsSetup: true`
on the 401 (password mode with an **empty** user table — sign-up is open for exactly one
bootstrap account and closes the moment it exists), the login wall shows a **Create the owner
account** screen instead of sign-in: heading `Create the owner account`, fields `Name`
(`data-testid="owner-setup-name"`), `Email` (`data-testid="owner-setup-email"`), `Password`
(`data-testid="owner-setup-password"`), and a `Create owner account` button
(`data-testid="owner-setup-submit"`); failures show the same inline alert. Success signs the
owner in and reloads into the normal boot flow (company picker → app). On a populated server the
flag is absent and the ordinary `Sign in` form renders — the auth-backed E2E server is never
zero-users (it boots with the `--create-owner-admin-admin` bootstrap credential `admin@admin.admin`
/ `auth-e2e-password-2026` — PINNED for the e2e server via `CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD`, since
production now mints a one-time generated password; see `BOOTSTRAP_ADMIN` in `e2e/auth-helpers.ts`),
so the setup form
itself is covered by unit tests, not a spec. Spec `e2e/login.auth.spec.ts`.
On a mixed password/OIDC deployment, every configured external provider remains available below
the setup form as **Continue with _provider_**. A verified email on the OIDC bootstrap allow-list may
therefore create the first owner directly; the operator does not need a temporary password identity.

**Invite accept route (`/invite/:token`; server mode).** A single-use, expiring invite link
carries a pre-set Admin, Editor or Viewer role for one company; Owner is never invitational.
Opening `/invite/<token>` shows the **Accept invite** screen (heading `Accept invite`) and safely
previews the company name, proposed role, role summary and expiry before acceptance using public
`GET /api/invites/:token/preview`. Possession of the bearer link is required to read that limited
metadata; the preview returns no company data, membership list or unrelated identity facts. Merely
opening or previewing the URL never changes membership. In a server deploy with auth on, an
unauthenticated invitee gets the page's OWN inline onboarding form (NOT the app login wall): an
existing user chooses **Sign in**, reloads onto the same `/invite/<token>` URL, reviews the invitation
under that identity, sees the signed-in email/name, then chooses **Accept invite**. **Use a different
account** signs out without discarding the bearer URL. If a pre-authorised invite rejects the current
identity, the page explains the mismatch and retains that same recovery action instead of suggesting
a retry as the wrong identity. In SSO-only mode the accepting session must come from the required
strict-OIDC provider; configured experimental social providers remain sign-in doors for existing
principals but cannot create a new local principal or membership that would fail the next startup
readiness check. A brand-new invitee chooses **Create account and
accept** (POST `/invite/:token/signup`), which creates the identity and claims the invite atomically,
then refreshes the authenticated company list, activates that company and enters it directly.
A fresh authenticated boot is required because the pre-session invite page deliberately starts
without tenant persistence attached; the signup handoff carries only the joined company id in a
one-use query parameter, removes it from the URL, verifies it against the authenticated company
list, and activates it. It never persists `activeAccountId` or trusts the URL as membership proof.
If the signup response is lost, a successful credential sign-in reloads the same invite URL instead
of guessing which company was joined: an unused token can then be explicitly accepted, while a used
token directs the person to their authenticated company list.
A **valid** accept binds the signed-in user to that company and shows the effective role returned by
the mutation in a _"You've joined this company as `<role>`"_ success with a **Continue** link (which
opens the joined company directly after refetching the account list so the brand-new membership is
activatable). Leaving the invitation route while that refresh is pending does not later switch the
active company; the refreshed company directory remains available for normal account selection. A
single polite status announces checking, readiness, joining and completion; accepting moves focus
to that status, and completed activation moves focus to **Continue**.
An accept by someone whose membership in that company is **disabled or archived** is refused
(403) with _"This membership is no longer active. An Owner or Admin must restore it before you can
rejoin."_ — redemption must never be a route back in for a member an administrator turned off, and
the invite is left unused so it still works once the membership is restored. A
**used** link shows _"This invite has already been used."_; an
**expired** link shows _"This invite has expired."_ (expiry is evaluated as an instant, including
explicit UTC offsets, and malformed stored values fail closed); an **unknown** token shows _"Invite not
found."_ Invites are server-only: in the explicit in-memory demo build
(`VITE_CAPACITYLENS_DEMO=1`) the page shows a
short _"Invite links work only when CapacityLens is connected to a server."_ note and makes no
request. The link page is `src/components/invites/InviteAccept.tsx`; the create UI is the Members
section below. Spec `e2e/invite.auth.spec.ts`.

**Team & access (`/team`; every role).** The dedicated **Team & access** destination is visible to
Owner, Admin, Editor and Viewer. Its **Your access** panel (`data-testid="current-access"`) shows the
active role in a plain-language summary sentence. The full allowed/not-allowed capability list —
schedule writes, member administration, time-off-note visibility and private client/project-name
visibility — is collapsed behind a **See full capabilities** disclosure
(`data-testid="capabilities-toggle"`, reporting its state through `aria-expanded`), so the page opens
on the member table rather than on reference material. The sidebar company block also shows the
resolved role (`data-testid="active-role"`); Viewer retains the explicit **View only** wording. Where
there is no company directory to show, the page says plainly that Team & access lists the people who
sign in, not the resources you schedule, and that adding a Resource does not create an app login;
neither record implicitly creates the other.

In the in-memory demo the route remains visible but labels the state **Demo access** and clearly says
that it neither creates app members nor simulates server authorization. A persisted auth-off server
instead says **Open access** and explains that anyone who can reach the installation can view and
edit its companies. In an authenticated server deploy, Owner/Admin additionally get the **Members**
management section
(heading `Members`, `data-testid="members-section"`). Editor/Viewer see their own access explanation
but no company directory, invitations or management controls; the server's 403 remains the backstop.
The management section has four parts:

- **SSO cutover readiness** (`data-testid="sso-readiness"`, mixed mode with strict OIDC only) shows
  whether every active member of the company has one verified link to the required provider. It
  names each member and role, highlights Owner and integrity blockers, and includes installation-wide
  blockers such as unsupported providers, unverified strict-provider links held by non-members,
  configured-social-only non-members, or providerless or credential-only orphan identities. Live
  reset ceremonies are reported as pending cutover revocations, but do not block the transaction that
  atomically revokes them. This is an advisory view; the operator CLI and SSO-only startup interlock independently
  evaluate every company. A failed or malformed readiness response remains visible as
  `data-testid="sso-readiness-error"`; it never silently removes the cutover warning. Admin-approved
  email correction and wrong-subject unlink repair are
  available only during mixed-mode staging, require a fresh identity-global administrative session,
  revoke the affected member's sessions and pending link/reset ceremonies, and are durably audited.
  Link repair is offered only for coordinates implicated by the reported blocker, supports both the
  required and alternative providers, confirms the exact provider row and subject, and refuses to
  remove a principal's only viable sign-in method. It is not rendered in SSO-only mode.
  Their controls are **Correct email** (`data-testid="sso-correct-email"`), the correction input
  (`data-testid="sso-correct-email-input"`), **Save and revoke sessions**
  (`data-testid="sso-correct-email-save"`), and **Remove incorrect link**
  (`data-testid="sso-remove-link"`).

- **Members table** (`data-testid="members-table"`) — columns **Name**, **Email**, optional **Signed
  in**, **Edit member** and **Member settings**, one row per member (`data-testid="member-row"`).
  The role stays visible beneath the member's name. The caller's own row is marked **(you)** and a
  non-active member's row carries a **Disabled** or **Archived** badge
  (`data-testid="member-status"`). Members are ordered by **join date, then name** (with the
  principal id as a final tie-break so the listing is stable between reads). The table itself lists
  only **active** members; disabled and archived memberships are grouped below it behind a
  collapsed **No longer active (_count_)** disclosure (`data-testid="members-inactive-toggle"`,
  reporting its state through `aria-expanded`) which reveals a second table of the same columns
  (`data-testid="members-inactive-table"`). The disclosure is absent when no membership is in that
  state, and its rows carry the same badges, gear and confirmations as the main table. The
  owner-only **Record member sign-ins** switch (`data-testid="member-sign-in-tracking"`) is off by
  default. While it is on, the table adds **Signed in** (`data-testid="member-sign-in-confirmed"`),
  showing **Yes** or **Not yet** for a successful sign-in during the current observation window.
  CapacityLens stores only this per-membership boolean: no sign-in date, enablement date, session
  history or site activity. Enabling starts a fresh window and confirms the signed-in Owner;
  disabling deletes every confirmation. Changing a membership's access state, issuing a new
  password-reset link or revoking a person's sessions clears their confirmation until they next
  sign in. An Admin may see the column when the Owner enables it but cannot change the setting. Each
  manageable **active** row ends in a pencil
  (`data-testid="member-edit"`) opening the **Change member role** dialog — a role select
  (`data-testid="member-role-select"`) offering only Admin, Editor and Viewer, the chosen role's
  plain-language consequences (`data-testid="member-role-summary"`), and **Save role**
  (`data-testid="member-role-save"`) — and a gear
  (`data-testid="member-menu"`) opening the **Member actions** menu: **Reset password**
  (`data-testid="member-reset-password"`), **Revoke sessions**
  (`data-testid="member-revoke-sessions"`), **Disable user** (`data-testid="member-disable"`),
  **Archive user** (`data-testid="member-archive"`) and **Remove**
  (`data-testid="member-remove"`), with **Restore access** (`data-testid="member-restore"`)
  replacing disable/archive once the member is no longer active. The pencil is offered on **active
  rows only** — a role change must not be a back door that reinstates a disabled member, so such a
  row is restored first — while the gear, including **Remove**, stays available on those rows so
  a membership can be ended without first handing its access back. Every control has a member-scoped
  accessible name — **Edit _member_**, **More actions for _member_**, **Remove _member_**, **Reset
  password for _member_**, **Revoke sessions for _member_**, **Disable _member_** — so non-linear
  assistive-technology navigation cannot detach an action from its target. Each menu action opens a
  confirmation naming the affected member before sending its destructive or security-sensitive
  request. While any member action is in flight, the management section is marked busy, politely
  announces **Updating team access…**, and every row's pencil and gear are disabled, so a second
  mutation cannot be raised. Removing yourself explicitly warns that you will return to the company
  picker and need a new invitation; revoking your own sessions warns that the current browser will
  reload into sign-in. Disable and archive are offered only where the target is neither the Owner nor
  yourself; a disabled or archived membership keeps its role and history but authorizes nothing, and
  the member stays listed under **No longer active** so the change is visible and reversible. No row carries a transfer-ownership control
  for anyone. In **password mode only**, the menu's **Reset password** mints a
  **single-use, 24-hour** reset link
  shown **once** (`data-testid="reset-link"`, `<origin>/reset-password/<token>`) with a **Copy**
  button named **Copy reset link for _member_** and a note naming the member and the expiry date — nothing is emailed; the admin hands the
  link over directly. An **Admin never sees Reset password on an Owner's row** (a reset link is an
  account-takeover capability; only an Owner may reset an Owner — the server 403s regardless). The
  action is absent in `sso` mode (the IdP owns credentials). **Revoke sessions** uses the same
  cross-account authority rule as password reset.
- **Invite form** — a card of its own (`data-testid="invites-section"`), separate from the members
  table since #175 so inviting someone is not mixed into the list of people who already joined. An
  Admin/Editor/Viewer **role** picker (`data-testid="invite-role"`) with the
  selected role's plain-language consequences visible below it, plus an optional **pre-authorise
  email** field (`data-testid="invite-preauth"`) and a **Create invite** button
  (`data-testid="invite-submit"`). On success the full link (`<origin>/invite/<token>`) is shown
  **once** (`data-testid="invite-link"`) with a **Copy** button named **Copy invitation link** — the token is write-once and never
  shown again. If any membership, invite or reset-token mutation loses its response after dispatch,
  the section reloads memberships, invites and authentication before enabling a retry. A lost invite
  or reset-token response is reported as an unknown one-time token; the operator must deliberately
  revoke or replace it rather than accidentally minting duplicates. Reconciliation never declares
  a command abandoned while its original server executor is still active: it waits for that
  execution to record its actual completed, compensated or repair-required outcome first. An
  unreadable or unrecognised conflict response also keeps the original browser command identity;
  only a successfully decoded terminal rejection permits a later retry to mint a new identity.
  In SSO-only mode the pre-authorised email is required by both the UI and server because a
  bearer-only invitation cannot admit a brand-new external identity.
- **Outstanding invites** — a row per invite (`data-testid="invite-row"`) with role / preauth-email
  or "link" / expiry-or-used and a **Revoke** button (`data-testid="invite-revoke"`). The list never
  carries the secret token. When an invite expires while this page remains open, its row updates to
  **Expired** and the unusable Revoke action disappears without requiring navigation or reload.
  Used rows are operational history: each company retains at most the newest 200 and never retains
  one for more than 365 days. Live unused invitations keep their existing expiry and explicit
  revocation lifecycle and are not removed by the used-history limit.

The Owner row carries no pencil for anyone, and no gear for anyone but the Owner themselves (whose
own row still offers the self-service Reset password and Revoke sessions): each company has exactly
one Owner, ownership is changed only by explicit transfer, and the Owner can be neither demoted,
removed nor disabled.
Ownership transfer is owner-only and atomic — it promotes the target and steps the caller down to
Admin in one transaction — but has no control in the member table; it is reached through
`POST /api/accounts/:accountId/transfer-ownership` while its own owner-only section is designed. No generic
role-change or invite endpoint can assign Owner, even for the current Owner. A partial unique SQLite
index prevents multiple active owners for an account, and the server prevents removing/demoting the
Owner outside transfer. The server remains the backstop: bypassing the UI cannot grant a second
Owner, transfer as Admin, revoke another account's invite or read another account's member list.

The API routes: `GET /api/accounts/:accountId/members` (gated manageMembers; returns
`{members, signInTrackingEnabled}` and each member carries `status` plus nullable
`signInConfirmed`; OFF → `{members:[], signInTrackingEnabled:false}`),
`PUT /api/accounts/:accountId/member-sign-in-tracking {enabled}` (Owner only; desired-state and
idempotent; disabling erases every observation),
`PATCH /api/accounts/:accountId/members/:userId {role}` (400 bad role or attempted Owner assignment,
404 non-member, 403 by the role rules),
`PATCH /api/accounts/:accountId/members/:userId/status {status}` (`active` | `disabled` | `archived`;
200 `{userId, status}`, idempotent — re-applying the status a member already holds succeeds without
burning their outstanding reset link; 400 unknown status, 404 non-member, 403 against the Owner,
against yourself, or by the role
rules — a non-active membership authorizes nothing, so the member's own reads 403 until restored
while the administrative directory keeps listing them),
`DELETE /api/accounts/:accountId/members/:userId` (204; 403 for the Owner),
`GET /api/accounts/:accountId/invites` (gated manageInvites; NO token; OFF → `{invites:[]}`),
`DELETE /api/accounts/:accountId/invites/:id` (204, idempotent, cross-tenant-safe),
`POST /api/accounts/:accountId/transfer-ownership {toUserId}` (owner-only; 400 missing/empty or
self-target, 404 non-member target, 403 non-owner; OFF → inert 200 no-op — hands the account to an
existing member and demotes the caller to admin atomically). `POST /api/invites` rejects `owner` for
every caller — ownership is transferred, never invited — and
`POST /api/accounts/:accountId/members/:userId/reset-password` (gated manageMembers; password mode
only — sso/OFF → 400; admin resetting an owner → 403; 404 non-member; 201 `{token, expiresAt}`,
write-once) mints the reset link. SSO staging additionally exposes
`GET /api/accounts/:accountId/sso-readiness`,
`PATCH /api/accounts/:accountId/members/:userId/email`, and
`DELETE /api/accounts/:accountId/members/:userId/federated-link`; the two repair writes are
mixed-mode-only and identity-global. The management UI is
`src/components/settings/MembersSection.tsx`, composed by `src/components/team/TeamAccessView.tsx`;
story `user-stories/settings/US-SET-10-member-management.md`;
spec `e2e/members.auth.spec.ts`.

`POST /api/accounts/:accountId/members/:userId/revoke-sessions` uses the same cross-account
takeover-authority rule as password reset and revokes every active session for that identity.

**Password reset route (`/reset-password/:token`; server mode, password auth).** The page an
admin-minted reset link opens: heading **Reset password**, a **New password** field
(`data-testid="reset-new-password"`), a **Confirm new password** field
(`data-testid="reset-confirm-password"`) and a **Set new password** button
(`data-testid="reset-submit"`). It renders **without a session** — unlike `/invite/:token` there is
no login wall in front of it (the visitor is exactly the person who cannot sign in). Client
pre-checks (mismatch, under 15 characters) show a field error without a request; the server is the
authority on redeem (`POST /api/auth/reset-password`). Success shows _"Password updated. Sign in
with your new password."_ (`data-testid="reset-success"`) with a **Go to sign in** link (a full page
load onto the login wall); the member's previous sessions are revoked. An invalid / already-used /
expired token shows _"This reset link is invalid, already used, or expired. Ask your admin for a
new one."_ — the token is single-use. If the server does not mount password reset, the page says
that reset is unavailable on this instance and directs the visitor to their administrator instead
of suggesting another attempt. In local/demo mode the page shows a short "server mode only"
note and makes no request. The page is `src/auth/ResetPassword.tsx`; spec
`e2e/reset-password.auth.spec.ts`.

**Viewer read-only mode (server + auth-on).** On an auth-on, server-backed deploy a member's account
**role** (`owner` | `admin` | `editor` | `viewer`) drives the UI. `GET /api/accounts` now returns
`{ id, name, role }` per account (the caller's role for it; in **OFF mode** every entry's role is the
trusted-local sentinel `'owner'`, keeping OFF fully editable). When the active account's role resolves
to **viewer**, the whole app goes **read-only**:

- **No create/edit/delete affordances** — list pages show no **Add X** button and no row **Edit** /
  **Delete** buttons (`EditButton`/`DeleteButton` render nothing), and the "Add your first X" empty-state
  create CTA is hidden (navigation CTAs like _Clear filters_ / _Go to Resources_ stay).
- **The scheduler is display-only** — no per-row **+**, no draw-to-create gesture (a click/drag on a
  lane creates nothing) and no hover **+** hint; allocation bars have **no resize grips**, no
  drag/resize, and don't open the edit modal (a viewer bar is `role="img"`, not a `button`). Viewer
  bars remain Tab-reachable so keyboard users can open and Escape-close the same read-only detail
  popover available on hover. The visible card has no instruction footer; its assistive label says
  **Read-only allocation details** rather than offering edit gestures, and the bar's accessible name
  includes the full project/client context and note text even when those optional face-label parts
  are hidden.
- **The toolbar hides the Draw-mode toggle and Undo/Redo** (nothing to draw/undo); navigation +
  filters (reads) stay.
- A subtle **"View only" badge** (`data-testid="view-only"`) sits in the sidebar footer beside the
  company name.
  The **server 403** (the write tier is editor+; a viewer's write is rejected) is the AUTHORITATIVE
  backstop — the client gating is UX + defense-in-depth. As a second local guard, the store no-ops a
  viewer's `add*`/`update*`/`delete*`/`importData` — including company creation — and surfaces a
  _"Read-only — you don't have edit access."_ notice, so an ungated path or an optimistic write can't
  desync local state. Account-setting writes additionally require their target to be the active
  company; a stale missing target is a no-op, while an existing foreign target is rejected. **Online
  default-editable invariant:** in auth off (the default everywhere) or local mode the live role is
  `null` → fully editable. An opted-in cached offline snapshot is the deliberate exception: it is
  labelled **Offline · View only**, projects Viewer capabilities, and never enables mutations
  regardless of the live authentication posture. It is eligible when a request is unreachable,
  including when a stalled connection reaches its client deadline, provided the verified snapshot is
  still within its seven-day lifetime and was saved for both this web deployment and its configured
  API origin. Repointing the same frontend origin at another backend invalidates the prior backend's
  identity, company directory and snapshots. CapacityLens never enables cached writes or queues
  changes for later.
  The provider is `src/auth/PermissionProvider.tsx` (the hooks `useRole`/`useCanEdit` in
  `src/auth/permissionContext.ts`, off the pure `can`); story `user-stories/settings/US-SET-11-viewer-readonly.md`;
  spec `e2e/viewer.auth.spec.ts`.

**Demo sign-in (cosmetic; not real auth).** In the default (auth-off) deploy, a Google-style
_"Choose an account"_ screen (heading `Choose an account`; the **Jordan Avery** account row,
`data-testid="fake-sign-in"`) is shown **before** the company
picker, to preview a "log in first, then pick a company" flow. There is no password and no
popup — the preview account advances. The signed-in state is a **device-global** flag
(`capacitylens/fakeSignedIn`, default off; never in `AppData`/export), so it persists across reloads
and is cleared by **Sign out** (on the picker and the sidebar footer). It is mounted only when
`authMode === 'off'`, so it never collides with the real login wall above. The persona lives in
`src/lib/fakeAuth.ts` (avatar: `src/assets/avatar-demo.svg`).

**Post-login intro page ("What CapacityLens is").** After a company is chosen — in **every** entry mode
(real auth, the cosmetic demo sign-in, and the no-auth default all converge on a chosen account) —
a minimal full-screen page (heading `Welcome to CapacityLens`) explains CapacityLens is a **resourcing tool**,
not a project-management tool, before the app proper. It has a single **Continue** button
(`data-testid="intro-continue"`). Shown **once per device** (`capacitylens/introSeen`, default off; never
in `AppData`/export) and skipped thereafter — so it does not reappear on reload. The copy is
**placeholder** (a human edits it later), single-sourced under `intro_*` in `messages/en.json` and
assembled by `src/lib/introCopy.ts`; the component is `src/components/IntroPage.tsx`. Spec
`e2e/fake-signin.spec.ts` (and `e2e/login.auth.spec.ts` for the
real-auth path).

## Command palette

Opened by **⌘K / Ctrl+K** from anywhere in the app (including while a text field is focused).
**Exception:** if a dialog has unsaved changes (`dirtyForm` is true), ⌘K/Ctrl+K is blocked —
a notice appears ("You have unsaved changes — use Cancel or Save to close this dialog.") and
the palette does **not** open. A clean overlapping dialog (including the portrait-phone rotate
hint) cannot clear that protection; it remains active until every dirty owner closes or saves.
Closed by **Escape**, backdrop click, or selecting an item.

**Sections shown (no query):** Actions ("Go to today"), Pages (all 9 routes; 8 — no Disciplines — when the company turns disciplines off).
**Sections shown (with query):** any of the above that match, plus People, Projects, Clients,
Activities. Matching is case- and diacritic-insensitive, so an unaccented query such as `jose` or
`muller` finds labels such as **José** or **Müller**. Palette visibility follows the result's
destination: hidden placeholder/external people and hidden Internal projects are omitted because
they jump to schedule rows/bars that are not rendered, while Internal activities remain searchable
even when their schedule bars are hidden because they open the always-complete Activities list.
**Special action:** typing a valid, real calendar ISO date (`YYYY-MM-DD`, zero-padded,
e.g. `2026-06-03`) shows "Go to date YYYY-MM-DD". Impossible dates like `2026-02-31`,
unpadded dates like `2026-6-3`, and out-of-range months/days are rejected.

**Selection behaviours:**

- Page item → navigate to that route.
- "Go to today" → navigate to `/` + recenter the scheduler on this week.
- "Go to date YYYY-MM-DD" → navigate to `/` + scroll the scheduler to that date.
- Person item → navigate to `/` + clear filters + scroll that resource's row into view once. The
  jump is consumed after the row becomes available, so later schedule/model changes do not override
  the user's subsequent vertical scroll position.
- Project item → navigate to `/` + **replace** schedule filters with `{ projectId }` (all other
  filters — search, discipline, client, hideTentative, showUnmatched — are reset to defaults).
- Client item → navigate to `/` + **replace** schedule filters with `{ clientId }` (same reset).
- Activity item → navigate to `/activities#activity=<id>` and focus the selected activity row in
  the complete Activities list, including Internal activities whose schedule bars are hidden.

**Keyboard navigation:** `ArrowUp`/`ArrowDown` move the highlight; `Enter` selects; `Escape` closes.
The focused combobox input exposes the highlighted option through `aria-activedescendant` from the
initial selection onward, updates that relationship with keyboard/pointer selection, and removes it
when a query has no options.
Mouse hover sets the active option; mouse click selects.

## `data-testid`s (for automated checks)

`scheduler-grid`, `scheduler-toolbar` (the scheduler chrome wrapper — title/filter-toggle/nav/zoom/history
row plus the expandable draw-mode/filter row; the WCAG 1.4.10 reflow check asserts the expanded
state doesn't overflow at 320 CSS px),
`scheduler-row`, `discipline-group`, `resource-lane`,
`allocation-bar`, `resize-start`, `resize-end`, `over-marker`, `unavailable-day`, `half-day`,
`scheduler-live-region` (a grid-level visually-hidden `role="status"` `aria-live="polite"` region —
WCAG 4.1.3; announces the recomputed over-capacity outcome for a resource AFTER a KEYBOARD move/resize
on one of its bars, e.g. "Ty now over capacity on 1 day." or "Ty: no capacity conflicts." Pointer drags
stay silent — they give sighted feedback),
`timeoff-block`, `utilization`, `overall-utilization`, `allocation-popover`,
`scheduler-empty`, `timeoff-row`, `discipline-row`, `external-row`, `export-data`, `import-data`,
`import-input`, `import-busy` (the server-mode "Importing data…" blocking dialog's status text —
shown for the few seconds of POST + re-hydrate; not dismissable, locks all editing/switching),
`fake-sign-in` (the demo sign-in's account row — auth-off deploys only),
`intro-continue` (the post-login "What CapacityLens is" page's Continue button; shown once per device),
`getting-started` (the schedule's first-run checklist card; only while the active account has an
incomplete onboarding step and it hasn't been dismissed), `getting-started-tour` (its **Show me
around** button — runs the driver.js orientation tour), `getting-started-dismiss` (its **Dismiss**
button; sets `capacitylens/gettingStartedDismissed`),
`create-language` (company-create form's read-only Language row — **English**), `settings-language`
(Settings → Account Options Selected at Creation's read-only Language cell — **English**; both
frozen, P1.14),
`new-company-button` (the company picker's **New company** button; HIDDEN — not merely disabled —
whenever `GET /api/auth/me` reports `canCreateAccount: false`: the single-company cap is reached,
or under auth-on the caller lacks owner/admin standing on any account),
`clear-local-storage` (Settings → Device data danger button; opens a destructive confirm),
`archived-section` (Settings → Archived & deleted; shows in local mode and for admins on an auth-on
server, self-hidden on a 403), `archived-row` (one per archived resource/client/project; carries a
**Restore <name>** + **Delete <name>** button), `deleted-row` (one per soft-deleted tombstone; carries
`archived-purge` — the **Permanently delete <name>** button, disabled with a locked hint until the
30-day grace elapses, purge-tier/admin-only),
`view-only` (sidebar-footer "View only" badge — shown ONLY for a Viewer on an auth-on, server-backed
deploy; absent in the default OFF/local deploy and for any non-viewer role),
`persistence-diagnostics` (Settings diagnostics disclosure; server mode), `build-stamp` (Settings footer; only rendered when the build sets
`VITE_CAPACITYLENS_BUILD_SHA`), `send-feedback` (Settings footer mailto; only when the build sets
`VITE_CAPACITYLENS_FEEDBACK_MAILTO`). A lane carries `data-resource-id="<id>"`; a bar carries
`data-alloc-id`/`data-status`. Seed ids include `r-tyler`, `r-nike`, `r-alex`,
`r-ph-designer`, `r-ext-northstar` (external party), `p-acme` (Project Watchtower), `p-brand` (Metropolis Rebrand), `t-wires`.

**Command palette:** `command-palette` (the palette panel), `command-palette-overlay` (the dismiss
backdrop), `command-palette-input` (search field), `command-palette-option` (each result item;
multiple).

## Domain rules a tester should know

- **A project must belong to a client. An activity has a `kind`:** `project` (a project-specific activity;
  belongs to a project and may carry a phase), `internal` (project-less internal work), or `repeatable`
  (a project-less cross-project activity). Internal/cross-project activities carry no project or phase. The Activities page
  shows three sections — `internal-activities`, `cross-project-activities`, `project-specific-activities` (testids).
  Internal and cross-project rows are alphabetical. Project-specific rows are grouped and sorted by
  **client → project → activity**, with each client and project name shown once. Scoped rows whose
  parent metadata is unavailable remain visible in a clearly labelled fallback group.
- **Private client/project names.** A normal client or project may be marked private by an account
  **owner** and given a required code name. The real `name` and raw `codeName` remain persisted, but
  only owners receive them from the server. Admins, editors and viewers receive the code name in the
  `name` field with exactly one pair of quotation marks (for example **`"Nightwing"`**) and no raw
  `codeName`, so the same quoted label flows through lists, filters, the scheduler, allocation bars,
  forms and the command palette. Non-owner writes pin the stored privacy fields, preventing a
  redacted sync round-trip from replacing the real name. Privacy is **off by default**, applies only
  to clients/projects, and never applies to the built-in Internal client.

  The complete acceptance contract is split across five runnable stories so every boundary remains
  traceable when tests change:

  | Criterion           | Required behaviour                                                                                       | Story       |
  | ------------------- | -------------------------------------------------------------------------------------------------------- | ----------- |
  | Client setup        | Owner-only switch; public by default; required, normalised code name; real name retained                 | `US-CLI-05` |
  | Project setup       | Same privacy controls while preserving the required client relationship                                  | `US-PRJ-05` |
  | Role projection     | Owner sees real/raw values; admin/editor/viewer see one quoted code name everywhere                      | `US-PRI-01` |
  | Server integrity    | Non-owner creates cannot author privacy; writes pin protected fields; every response path stays redacted | `US-PRI-02` |
  | Portability/upgrade | Role-safe export, owner-only server import, fail-closed repair and v6→v7 public defaults                 | `US-DAT-07` |

  “Everywhere” includes active and archived client/project lists, filters and pickers, project/client
  compound labels, scheduler bars and popovers, forms, confirmation dialogs and the command palette.
  Quotation marks are display chrome: straight or curly outer quotes are removed before storage, and
  the non-owner projection adds exactly one pair of straight double quotes. A private code name that
  becomes empty after normalisation is rejected by every ordinary write path; a malformed imported
  private row is repaired fail-closed to a distinct, stable `Confidential #<record tag>` label instead
  of exposing its real name or collapsing several private rows onto one indistinguishable label.

- **Management list ordering.** The **Resources**, **Disciplines**, **Clients** and **Projects**
  management lists are alphabetical by the name shown in each row. With the default engagement
  grouping on, Resources keeps Studio, Supplementary, Placeholders and External as separate
  sections; turning it off combines Studio and Supplementary into one People list. Each section
  sorts independently. Favourite people appear first within their engagement partition and
  favourite external parties appear first in External; each favourite and non-favourite partition
  remains alphabetical. Projects
  sort by project name; their client label is secondary text. The hidden built-in **Internal** client
  remains excluded before client rows are sorted. Case- or accent-equivalent names use their exact
  spelling and then stable record id as deterministic tie-breakers. This ordering is display-only:
  stored arrays are unchanged. The schedule keeps its deliberate discipline `sortOrder` and
  resource grouping while sorting Studio before Supplementary within each discipline, favourites
  first and alphabetical inside each engagement partition, followed by placeholders. Unassigned
  resources follow the assigned discipline bands as separate Studio and Supplementary bands; those
  engagement bands become the complete capacity grouping when disciplines are off. Turning
  engagement grouping off replaces the fallback engagement bands with one **Unassigned** band while
  retaining favourites-first alphabetical order. Favourite external parties similarly lead the
  final External band. Favourites and
  the grouping preference are company data shared by every account member, not per-user view
  preferences.
- **The built-in "Internal" client.** Every account has exactly one **built-in** client named
  **Internal** (the store rejects renaming/deleting it; the write boundary also rejects a direct API write
  that would create a _second_ Internal, so the one-per-account rule holds on every path). It is a behind-the-scenes data anchor, so it
  is **HIDDEN from the Clients management list** (`/clients` shows no Internal row) — but it stays a
  real, persisted client that is **still selectable and bindable everywhere it's used:** in the
  **project form's Client `<select>`** (a project can be created under Internal), as a **Filter by
  client → Internal** option, and as a **Clients** entry in the command palette; a project bound to
  Internal still shows "· Internal" as its client in the Projects list. It can own real projects, AND a
  project-less internal/cross-project activity is **bucketed under it for display + filtering** (its
  bars/labels read "Internal", and **Filter by client → Internal** shows BOTH the project-less
  activities AND any activities under Internal-owned projects). No `clientId` is stored on the
  activity; the association is derived in the view-model.
  In the project form, **Internal is pinned first**, followed by a non-selectable divider and then
  active ordinary clients in alphabetical display-name order. An archived current client remains a
  disabled final option while editing so an unrelated change can still preserve that relationship.
- **Placeholders** are bound to exactly one project and may take that project's activities **plus any
  project-less (internal/cross-project) activity**. They are **hidden by default** behind the
  per-account **Show placeholders** pref (Settings → Placeholders, `placeholdersEnabled` on the
  Account, default off); when shown they display as the literal name **"Placeholder"** with a **"?"** avatar.
- **External / 3rd parties** are a resource kind for outsourced work: a **company name** (+ optional
  descriptor), assignable to **any** activity with **no hours**, shown in a **neutral band at the bottom
  of the schedule** with **no utilisation / over-markers**. Their allocations carry `hoursPerDay: 0`
  and are a **literal start/end span** (`ignoreWeekends: true` — the **Ignore working days** checkbox
  is hidden and every date counts as a plain calendar day); they're excluded from the Time-off picker, and the
  write boundary rejects time off OR a non-zero load for an external on _any_ path (a direct/crafted
  write is rejected; an import is repaired — external time off dropped, external load coerced to 0). They are
  **hidden by default** behind the per-account **Show external resources** pref (Settings → External,
  `externalEnabled` on the Account, default off); when on, an **External** section appears under the **Resources**
  tab (with a labelled question-mark explainer modal + an `Add external party` button) and the band appears on the schedule. When
  off they're hidden everywhere (schedule band, assignee picker, command palette, Resources tab) but
  their data is kept. The old standalone `/external` route now **redirects to `/resources`**.
- **Archived & soft-deleted resources/clients/projects are hidden from all normal views** (the
  scheduler, the management lists, the forms' option-pickers, and the command palette) — they remain
  in the DB **and in export**, and surface in the **admin "Archived & deleted" view** (P2.4/P2.5).
  A non-active entity is one with `archivedAt` set (archived) or `deletedAt` set (soft-deleted); the
  hide is applied by the shared `activeOnly` projection in both the client view seam
  (`useActiveScopedData`) and the server per-account read (`GET /api/state?accountId=` →
  `includeInactive:false`). The tester-facing affordances are: each management list's **per-row
  archive** action (Resources / Clients / Projects — see below) and the **Settings → Archived &
  deleted** admin view (see below) that restores / deletes / permanently-deletes them. The server
  lifecycle routes (below) enforce the same machine server-side. The **"archived vanishes"
  end-to-end story is `e2e/archived.spec.ts`** (LOCAL mode).

### List archive affordance (P2.5b)

On the **Resources**, **Clients** and **Projects** management lists, the per-row destructive action
is **Archive** (not a hard delete — the simplest coherent flow; soft-delete + permanent delete are
reached later from Settings → Archived & deleted). The row's icon button has the accessible name
**"Archive <name>"** (e.g. _Archive Barry Rivera_); clicking it opens a confirm dialog (title
**"Archive resource?" / "Archive client?" / "Archive project?"**, body _"Archive '<name>'? … You can
restore it or permanently delete it from Settings → Archived & deleted."_, confirm button
**"Archive"**). Confirming hides the row from the list **and** from the schedule (it becomes
archived), but the record + its children are **retained** (archiving is reversible, unlike the old
cascade-delete). Client and project confirmations count the projects, phases and allocations the
archive will additionally hide, using singular nouns only when a count is exactly one. The affordance is gated by `useCanEdit` (a Viewer sees nothing). In **server mode**
the row POSTs `POST /api/:entity/:id/archive {accountId}` and reloads the active slice; in
**local/OFF mode** it calls the store's `archiveEntity`. Built-in **Internal** client has no archive
button (it's hidden from the Clients list and the store/server backstop it). Hook:
`src/hooks/useLifecycleActions.ts` (the shared server/local dispatch).

### Settings → Archived & deleted (P2.5b)

Settings gains an **"Archived & deleted"** section (heading `Archived & deleted`,
`data-testid="archived-section"`) — the admin view of the data-lifecycle, the counterpart to the
normal active-only views. Its independent disclosure is closed by default. Unlike Members it **also
shows in LOCAL mode** (everyone is owner locally);
in **server mode** it self-gates by trying the `GET /api/state?accountId=…&includeInactive=1` read and
rendering **nothing** if the server replies **403** (a non-admin — the inactive read is purge-tier).
The inactive-row **source** is the store (`useInactiveScopedData`) in local mode and that
`includeInactive=1` fetch in server mode. Rows are partitioned into two groups:

- **Archived** (`data-testid="archived-row"`, one per archived resource/client/project) — each shows
  the entity name + a type tag (Resource / Client / Project) and two actions: **Restore** (aria
  _"Restore <name>"_ → unarchive, back to active) and **Delete** (aria _"Delete <name>"_ → a confirm
  dialog _"Delete this item?"_, then soft-delete: it moves to the Deleted group and a resource's name
  is scrubbed to _"Removed person #…"_).
- **Deleted** (`data-testid="deleted-row"`, one per soft-deleted tombstone) — shows the (for a
  resource, already-obfuscated _"Removed person #…"_) name + type tag and a **Delete permanently**
  button (`data-testid="archived-purge"`, aria _"Permanently delete <name>"_). It is **disabled** with
  the hint _"Can be permanently deleted 30 days after deletion"_ until the tombstone is ≥ 30 days old;
  once eligible it's enabled and a strong confirm dialog (_"Permanently delete?"_, confirm _"Delete
  permanently"_) is required. The permanent-delete button is **purge-tier (admin+)**: it is shown only
  when the caller may purge (always in OFF/local; admin+ on an auth-on server) — the server 403 is the
  backstop. There is **no Restore on a tombstone**. An **empty state** (_"Nothing archived or
  deleted."_) shows when nothing is inactive. The component is
  `src/components/settings/ArchivedSection.tsx`; spec `e2e/archived.spec.ts`.

### Generic scoped write privacy

Generic scoped writes do not expose whether a guessed id belongs to another company. A PATCH has
no required company assertion, so a non-member receives the same `404 {"error":"Not found"}` for
a foreign row and an absent row; row-specific guards such as the built-in Internal-client rule run
only after that tenant boundary. DELETE requires `?accountId=…`: a caller unauthorized for that
asserted company receives the same 403 for either id, while an authorized caller receives the same
404 for a foreign or absent id. Auth-off keeps its established idempotent missing DELETE response.
PUT authorizes the body's company before looking up the id, so a non-member likewise receives one
indistinguishable response. Insufficient-role members still receive 403 for rows in a company they
can already read.
The built-in **Internal** client remains server-managed: generic POST cannot create one and direct
writes cannot modify the active singleton. A legacy-id PUT that atomically replaces the generated
singleton and reparents its projects is a fresh-session Admin/Owner operation; an Editor receives 403. The same authority applies to a direct PUT and the atomic batch path.

### Server lifecycle routes (P2.5a)

The Active → Archived → Soft-deleted → Purged data-lifecycle is enforced **server-side** by four
dedicated action routes (entity ∈ `resources` | `clients` | `projects` **only** — any other entity is
a **404**). Each takes a JSON body `{ accountId }` (**required** — the tenant assertion, mirroring the
scoped-write contract; a missing/empty one is a **400**). OFF mode is allow-all on all four.

| Route                             | Tier               | Transition                                                                 | Result            |
| --------------------------------- | ------------------ | -------------------------------------------------------------------------- | ----------------- |
| `POST /api/:entity/:id/archive`   | write (editor+)    | active → archived                                                          | `200` updated row |
| `POST /api/:entity/:id/unarchive` | write (editor+)    | archived → active                                                          | `200` updated row |
| `POST /api/:entity/:id/delete`    | purge (admin+)     | archived → soft-deleted (resource: `name` scrubbed to `Removed person #…`) | `200` updated row |
| `POST /api/:entity/:id/purge`     | **purge (admin+)** | ≥30-day-old tombstone → **HARD delete + cascade**                          | `204`             |

- **Error mapping:** an **illegal transition** (e.g. deleting a row that was never archived, archiving
  an already-archived row) → **409** with the state machine's own message; a **cross-account** target →
  the standard tenant guard (**403** non-member, or **404** when the id isn't in the asserted account's
  slice); an **absent** row → **404**; an insufficient role → **403**.
- **Purge interlock (server-enforced):** purge is refused (**409**) unless the row is a **soft-deleted
  tombstone aged ≥ 30 days** (`PURGE_MIN_AGE_DAYS`); the cascade then removes the row **and its
  descendants** (client → projects/phases/activities/allocations, etc.), same rules as a normal delete.
- **Built-in Internal client guard:** the protected built-in **Internal** client cannot be
  archived/deleted/purged — any of the three on it is a **409**. Import and load repair also clear
  legacy or hand-edited lifecycle tombstones so the singleton always returns active.
- **Inactive-ancestor write guard:** generic POST/PUT/PATCH and batch writes return **400** when the
  target row would sit beneath an archived or soft-deleted client, project or resource, including
  inherited ancestry such as phase → project → client and allocation → activity → project → client.
  The same shared ancestry graph drives the normal active-only read, so an accepted descendant write
  cannot immediately disappear from that view. Demo/local store creates and reparenting apply the
  same closure, while an unrelated edit may retain its already-stored parent reference. Existing
  retained rows are not deleted by this guard.
- **Admin "read inactive":** `GET /api/state?accountId=…&includeInactive=1` returns the **full** slice
  (archived + soft-deleted rows retained). It is gated at the **purge tier (admin+ with a session
  signed in within the last 15 minutes)**: a non-admin gets **403**, while a stale privileged session
  gets `403 SESSION_NOT_FRESH`; OFF mode always allows; omitting the flag = today's active-only read.
- **Cascade deletes:** deleting a client removes its projects → activities → allocations;
  deleting a project removes its phases/activities/allocations and _unbinds_ (does not delete)
  placeholders; deleting an activity removes its allocations; deleting a resource removes its
  allocations + time off. Deleting a **discipline** or **phase** is _non-destructive_
  (ungroups resources / ungroups activities). These ordinary CRUD deletes are undoable. Lifecycle
  **soft-delete and purge** of an archived person, client or project are irreversible and clear the
  local undo/redo history so a destructive lifecycle action cannot be restored accidentally.
- **Disciplines are optional (account-level).** Default **on**. When a company turns them off
  (Settings → Disciplines → _Use disciplines_) disciplines are hidden everywhere and the schedule
  uses engagement fallback bands — see the _Disciplines (account-level)_ note above. The seed companies leave it
  **on**, so every story below runs with disciplines visible.
- **Engagement is separate from employment and discipline.** A person is either **Studio** or
  **Supplementary**, defaulting to Studio. The resource form shows Engagement instead of the
  retained employment field; editing preserves the existing employment value. Placeholders are
  always Studio and do not show the Engagement control.
- **Capacity:** a full day's available hours are always **8 hours**, a half day is always
  **4 hours**, and a non-working weekday or time-off day is **0 hours**. Resource forms therefore
  do not expose a separate working-hours field and always save `workingHoursPerDay: 8`; editing a
  legacy resource with a custom value normalises it to 8 without a bulk data migration. Existing
  working-day patterns migrate to full days and existing non-working weekdays remain non-working.
  A day is **over-allocated** when allocated > available
  (STRICTLY greater — exactly at capacity is NOT over). Allocated hours are **weekend-aware**: a
  normal allocation does no work outside the resource's effective working week (company global
  working days ∩ personal pattern), so a weekend or other non-effective day a bar merely
  **spans** is NOT over (it keeps only the grey unavailable tint). The zero-capacity days that DO
  read as over are a **time-off** day a working allocation covers, and any company or personal
  non-working day an allocation opts into via **Ignore working days** (`ignoreWeekends`). An over-allocated day renders
  with a **clear red background** (`data-testid="over-marker"`) plus a solid
  red top band, in both light and dark themes. When work overlaps time off, the red marker is
  composited above the holiday hatch while its label stays legible, and the allocation bar remains
  above both. Direct date edits, drag/reassignment and generated repeat occurrences all use this
  same day-capacity signal; a holiday with no work is not red. The over-marker carries no `title` (it's
  `pointer-events-none`, so a hover tooltip there is unreachable); the screen-reader signal is the
  per-row sr-only "Over capacity on N day(s)" summary in the row header instead.
- **Half working days are visible at fine zoom.** At 1- and 2-week zoom, the bottom half of each
  saved half-day cell uses the same neutral tint family as an unavailable day
  (`data-testid="half-day"`), while the top half remains clear. The decorative tint is pointer
  transparent, so the day-level add affordance and click/draw creation continue to use the full
  cell. A time-off or non-working day remains fully unavailable rather than also showing a half-day
  tint, and the row's screen-reader summary announces the number of half working days without
  relying on colour.
- **An allocation can't exceed 24h/day, and the form says so instead of silently trimming it.** In
  **days mode**, a _Days of work_ spread over too few _Days over_ (e.g. 5 days of work in a 1-day span =
  40h/day) is **rejected** ("That's more than 24h a day. Increase Days over or reduce Days of work.")
  rather than saved as a quietly-clamped 24h; **hourly mode** likewise rejects a _Hours / day_ above 24.
  _Days over_ itself must be a whole number from 1 through 36,500 in both Days and Blocks modes;
  out-of-range or fractional values are rejected rather than rounded or clamped. A directly entered
  Start/End span in Hours mode, for an External resource or for time off cannot exceed 36,500
  calendar days; the form rejects a longer span with "Date span cannot exceed 36,500 calendar days."
  The previewed "…h/day" hint always equals what saves.
- **Blocks mode has zero effective consumption.** Switching an existing company from Hours or Days
  to Blocks leaves historical hour values stored so switching back restores the prior schedule, but
  those values contribute zero to utilisation, hourly capacity warnings and announcements, drag
  previews, keyboard moves and duplication for as long as Blocks is active. A block that overlaps
  its resource's time off is still a scheduling conflict: the overlapping day receives the existing
  red marker and is included in the row's non-colour conflict summary. An ordinary personal or
  company non-working day does not receive that treatment. New and duplicated blocks persist zero
  hours. Reassigning a block never synthesises hours: an External target is still forced to zero, and
  a zero-hour External block moved to a person stays at zero. Switching back makes the preserved
  historical values effective again.
- **Visual language.** Blue semantic tokens (`brand`) identify CapacityLens, navigation and links;
  green semantic tokens (`ok-strong`) identify positive actions such as Create, Save, Add and
  Continue; red semantic tokens (`danger` / `danger-soft`) identify destructive actions. These
  roles remain distinct and WCAG-AA readable in light and dark themes. User-selected client,
  project and discipline swatches remain entity data colours, while new accounts and resources use
  the default blue preset.
- **Utilisation %** (left-column label "Utilisation · Nw" where N tracks the **Weeks visible** span, and
  each discipline header's "N% avg utilisation") is computed over the currently **VISIBLE window** —
  the 1/2/4/6/8-week range anchored at the left edge of the view — so **switching the range toggle
  recomputes it** to reflect exactly the visible span. It turns **red** when the resource trips its
  separate **fixed forward 14-day** "over soon" radar (over-allocated on any working day in the next
  14 days from today); that red flag stays on the fixed window regardless of zoom/pan, distinct from
  the zoomable %.
- **Validation:** required fields per form; an allocation/time-off range must be non-empty
  and not reversed (end ≥ start); hours must be > 0; colours are chosen from a preset
  swatch palette (always a valid 6-digit hex `#rrggbb`).

## Conventions for these stories

### Reliability and recovery expectations

- The application shows a loading state until the local store is hydrated; it never renders an
  empty company as though loading had completed. Lazy public-auth, first-run introduction and
  storage-recovery screens also retain a visible `Loading…` status while their code loads.
- Unreadable browser data opens a dedicated recovery screen rather than the server connection retry.
  It can request a raw-copy download before a confirmed reset; reset attempts clear both local
  CapacityLens keys and offline snapshots, report partial failures precisely, and only reload once
  the unreadable local data is gone.
- Failed SSO hand-off, MFA enrollment, reauthentication and invitation acceptance remain visible
  and actionable. A successful invitation keeps the newly selected company active while its account
  list refreshes.
- Company management data is fetched only for members who may manage it. Removing a client or
  project through the normal UI is undoable, and keyboard or pointer allocation gestures stop
  cleanly when focus, capture or the initiating button is lost.
- A deleted person's retained tombstone contains neither their original name nor role; the displayed
  identifier is an opaque `Removed person #…` label.

- Each story is **end-to-end**: it starts from a defined state (usually the seeded app)
  and is runnable by a human with no prior setup.
- **Acceptance criteria** are written as checkable assertions (✅) — a tester can tick each.
- Cross-cutting/security-sensitive criteria carry stable IDs (for example `PRI-WRITE-01`) so a
  future automated test can name the exact contract it covers rather than only the broad story.
- Each story names its **Linked E2E test(s)** (file + test title) so the automated coverage
  is traceable to the manual script.
