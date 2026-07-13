# CapacityLens — User-story reference (single source of truth)

This file pins the exact, current facts every user story and test script depends on:
routes, control labels, `data-testid`s, the first-run seed data, and shared conventions.
If the app changes, update this file first, then the affected stories.

> CapacityLens is a multi-tenant resource scheduler. It is **server-backed by default** (an empty
> env means the same-origin SQLite API). The app is **multi-tenant by Account**: you pick a company
> on load and the whole dataset is scoped to it. An explicit in-browser **demo build**
> (`VITE_CAPACITYLENS_DEMO=1`) keeps all data in `localStorage` with no login or network calls — that
> is the build these manual stories run against, started with `pnpm run dev:demo`, signed in to the
> seeded **Studio North** company.

---

## Launching the app (for a human tester)

1. From the project root run `pnpm run dev:demo` and open **the URL Vite prints**
   (<http://127.0.0.1:5173>; `localhost:5173` also works). If Vite exits with a
   port-in-use error, another dev server is squatting 5173 — find it with
   `lsof -nP -iTCP:5173 -sTCP:LISTEN` and kill it (strict port is deliberate).
2. **First run** seeds a demo dataset (see *Seed data* below).
3. CapacityLens opens on a **demo sign-in** — a cosmetic, Google-style *"Choose an account"* screen
   (the **Jordan Avery** account; heading `Choose an account`). It is **not** real auth and
   has **no** popup: click the account (or "Use another account") to continue. It is shown only
   when real auth is off (the default) and is skipped once "signed in" (the choice persists
   device-globally; "Sign out" on the picker/sidebar returns to it).
4. Then the **company picker** (you choose a tenant on every load — `activeAccountId` is never
   persisted). Pick **Studio North** to see the seeded data these stories describe. (A second
   seeded company, *Loft Digital*, is near-empty.) While "signed in", the picker shows
   *"Signed in as Jordan Avery"* with a **Sign out** link. **`New company`**
   (`data-testid="new-company-button"`) opens an inline create form (P1.14) that captures, besides
   name + colour, the three **frozen-after-creation** fields: **Week starts on** (segmented
   Monday/Sunday, default Monday), **Timezone** (select, default `GMT`), and **Language**
   (read-only **English** — `data-testid="create-language"`; English-only until Paraglide). These
   three are set ONCE here and are then **disabled** in Settings; the server rejects a later
   change with **409**.
   **Single-company-per-instance policy + caller standing:** a server-backed deploy defaults to
   ONE company (`CAPACITYLENS_MULTI_ACCOUNT` unset) — once an account already exists,
   `GET /api/auth/me` reports `canCreateAccount: false` and the **`New company`** button is
   HIDDEN entirely (not merely disabled). Under auth-on the flag ALSO requires the caller's
   standing (the same predicate `POST /api/orgs` enforces): only a user who is owner/admin of
   SOME account — or any user on a zero-account instance — may create, so an editor-only or
   membership-less login never sees the button (its empty picker says "ask an admin for an
   invite" instead of "create your first one"); a direct `POST /api/accounts` still 403s
   regardless, so this is UX only. The
   button stays visible whenever the fact is unavailable or doesn't apply: the demo build (no
   server, no cap), a zero-account instance (the bootstrap exemption — you must be able to create
   the FIRST company), an older server that predates these fields, or a deploy with
   `CAPACITYLENS_MULTI_ACCOUNT=1` set (the auth-backed stories' server runs this way, so its
   picker always shows the button). In a server deploy the create goes through `POST /api/orgs`
   (atomic: company + built-in Internal client + your Owner membership); a server refusal (the
   cap, or the org-create gate) surfaces as the form's inline error. Each listed company also
   shows a **Delete** button (`Delete <name>`, type-the-name-to-confirm dialog) — but ONLY on
   companies where your role is owner/admin (deletion is purge-tier); viewers/editors get no
   Delete affordance at all.
5. Then a one-time **"What CapacityLens is" intro page** (heading `Welcome to CapacityLens`) — a minimal
   post-login explainer that CapacityLens is a resourcing tool, not a project-management tool. Click
   **Continue** (`data-testid="intro-continue"`) to enter the app. It shows once per device
   (`capacitylens/introSeen`, default off, never in `AppData`/export) and is skipped thereafter. The
   wording is **placeholder copy** (single-sourced in `src/lib/introCopy.ts`), pending a human edit.
6. On an account that still has an onboarding step to do, the schedule shows a **Getting
   started** checklist card (`data-testid="getting-started"`) above the toolbar, with four
   state-driven steps — **Add your first client / project / person** (links to those pages) and
   **Assign them to the project** (done once any allocation exists). A step ticks itself off from
   the account's actual data (the built-in Internal client does NOT count as "your first
   client"); the card self-hides once ALL steps are done, so the seeded companies never show it.
   **Show me around** (`data-testid="getting-started-tour"`) runs a loose five-stop driver.js
   spotlight tour (schedule grid → toolbar → People → Clients & projects → Settings; Next/Back/
   Done buttons, Escape bails, never navigates). **Dismiss**
   (`data-testid="getting-started-dismiss"`) hides the card for good on this device
   (`capacitylens/gettingStartedDismissed`, default off, never in `AppData`/export). Hidden for a
   Viewer (every CTA is a write they can't do).
7. To start from the seeded state again, clear it: open DevTools → Console →
   `localStorage.clear()` → reload. (Clearing data *inside* the app does **not** re-seed —
   that's deliberate.)
8. **If the page sticks on "Loading… / JavaScript isn't running"**, the browser is blocking
   scripts for the site (per-site JavaScript setting or a content-blocker extension — these
   also run in private windows when allowed). Enable JavaScript for the site and reload;
   no story can run without it.

## Navigation (left sidebar)

The sidebar links, in order, route to:

| Link label | Route | Screen |
|---|---|---|
| Schedule | `/` | Timeline scheduler |
| Resources | `/resources` | Resource list (incl. the **External** section when enabled) |
| Disciplines | `/disciplines` | Discipline list |
| Clients | `/clients` | Client list |
| Projects | `/projects` | Project list |
| Activities | `/activities` | Activity list |
| Time off | `/timeoff` | Time-off list |
| Settings | `/settings` | Settings (company rename, scheduling, calendar, disciplines, schedule, allocation bars, utilisation, appearance, local data) |

That's **eight** sections by default — **seven** when the company turns disciplines off (the
**Disciplines** link is then hidden; see *Disciplines optional* under Domain rules). External / 3rd
parties no longer have their own nav link — they moved INTO the **Resources** tab behind a setting
(see *External / 3rd parties* under Domain rules); the old `/external` URL still resolves but
**redirects to `/resources`** so saved bookmarks don't 404. Each link
carries a small decorative icon (`aria-hidden`; the accessible name stays the label text). The
**Data** section (**Export JSON** / **Import JSON**) sits below the nav links. The company block —
the active company name plus a **Switch company** control (which returns to the company picker) —
is pinned to the **bottom** of the sidebar, below a divider beneath the Data section. (It used to
sit at the top; pinning it to the bottom keeps the logo + collapse toggle as the first item in
both the open menu and the collapsed rail, so the nav icons don't shift when the sidebar collapses.)

**Collapse / expand.** A toggle button at the **top-left** of the sidebar (accessible name
**Collapse menu** / **Expand menu**, with `aria-expanded`) collapses it to an icons-only rail.
The toggle sits at the same left inset as the nav icons, so the toggle + icon column keep their
x-position when collapsing — only the labels and the "CapacityLens" wordmark come and go. Rail icons
(`data-testid="nav-rail-item"`, one per **visible** section — so 8 with disciplines on, 7 when disciplines are off —
`data-label` = the section label; each shows an instant visual hover label to the right) are **not** navigation — tapping any
of them just re-opens the menu; they're hidden from assistive tech (the labelled toggle is the
single accessible control). Collapsing hides
the company block and the Data section until re-opened. The choice is device-global
(`localStorage` key `capacitylens/sidebar`); with no stored choice the sidebar starts **open on
desktop and collapsed on small screens** (`(max-width: 767px), (max-height: 480px)` — phone
portrait or phone landscape).

**Rotate hint (portrait phones only).** On a portrait viewport ≤ 767px wide, a dismissable
dialog titled **Best in landscape** appears (over the company picker too, since that's a
phone's first contact). **Got it** (or Escape / backdrop) dismisses it for the session
(`sessionStorage` key `capacitylens/rotateHintDismissed`); rotating to landscape hides it. It
never appears on desktop viewports or in landscape.

## Seed data (first run)

> This auto-seed is **DEMO-BUILD-ONLY** going forward (single-company-per-instance policy). A
> real, server-backed instance (the default deploy) no longer auto-seeds from the client side —
> `bootstrap()` (src/main.tsx) only passes a seed dataset in the demo build
> (`VITE_CAPACITYLENS_DEMO=1`); a fresh server-backed instance lands on the empty
> create-your-company picker instead of a fabricated "Studio North" (a pre-seeded two-company
> instance would otherwise trip its own single-company cap on first boot). The two-company seed
> described below happens only in: the demo build (`pnpm run dev:demo`, what these stories run
> against), local dev tooling that opts in explicitly, and the db-backed E2E server's explicit
> `POST /api/test/reset {seed:true}` (used by `e2e/db-helpers.ts`'s `resetServer()` — exempt from
> the single-company cap so tests can still exercise a two-company picker).

- **Accounts (companies):** **Studio North** (holds everything below — pick this one) and
  *Loft Digital* (a second tenant with one Design discipline and no work).
- **Disciplines:** Design (order 0), Development (1), Copywriting (2).
- **Resources:**
  - *Tyler Nix* — Designer, Design, permanent, 8h, Mon–Fri.
  - *Pam Gonzalez* — PR & Brand, Copywriting, permanent, 8h, Mon–Fri.
  - *Nike Spiros* — Web Developer, Development, permanent, 8h, Mon–Fri.
  - *Alex Rivera* — Front End (freelance), Development, **freelancer**, 8h, **Mon–Wed only**.
  - *Senior Designer* — a **placeholder** (no name), Design, **bound to Project Lightning**. Shown
    as the literal name **"Placeholder"** with a **"?"** avatar. **Hidden by default** — placeholders
    are behind the per-account **Show placeholders** pref (Settings → Placeholders, default **off**);
    enable it to see this row in the schedule, the Resources list, and the assignee picker.
  - *Dog Eat Cog* — an **external / 3rd party** (`r-ext-dogeatcog`): a company, no discipline/
    capacity, booked on Visual Design (Project Lightning) as a span only. **Hidden by default** —
    externals are behind the per-account **Show external resources** pref (Settings → External,
    default **off**); enable it to see this row in the schedule's bottom band, the **External** section
    of the Resources tab, and the assignee picker.
- **Clients:** Acme Inc., Globex. (**Internal** is the built-in, one per account — it is **HIDDEN
  from the Clients management list**, but still selectable as a project's client and a "Filter by
  client" option; see the Internal-client appendix below.)
- **Projects:** Project Lightning (Acme), Brand Themes (Globex).
- **Phases (Project Lightning):** Discovery, Build.
- **Activities** (every activity has a **kind**): *Project* — Wireframes, Visual Design, CMS Review
  (Lightning), Brand System (Brand Themes); *Internal* — Admin / Internal; *Repeatable* —
  Design, Workshop. "Design" is also booked for Alex (8–10 June) to demo the activity lens.
- **Allocations (June 2026):** Tyler is **over-allocated on 3–4 June** (8h + 4h > 8h).
- **Time off:** Tyler — 10–12 June (Holiday).

The scheduler auto-scrolls to today on load; demo data lives in June 2026, so a tester
on a later date should **Jump to date → 2026-06-01** (or zoom out) to see the seed bars.
The Playwright E2E suite avoids that drift by **freezing the clock to 2026-06-03** (a date
inside the seed window) in `e2e/helpers.ts` `openApp()`, so the seed bars and the 3–4 June
over-marker are always on-screen without a jump — keep that date in step with the seed.

**Weekend columns.** By default the **Minimise weekends** display pref (Settings → Schedule,
on by default) shrinks the Saturday and Sunday columns to a sliver — just wide enough for the
date number — and their weekday label reads a single **"S"** (both Sat and Sun), so the working
week dominates the helicopter view. Weekends are not removed: people can still work weekends,
bars span across them, and the narrowing only applies at a fine enough zoom to show per-day
columns. Turn the pref off and weekends return to full width with `Sat`/`Sun` labels.

## Control labels (accessible names)

**Forms (modals).** Fields are labelled: `Name`, `Role`, `Type`, `Discipline`,
`Employment`, `Bound project`, `Working hours / day`, `Working days` (Mon…Sun toggle
buttons), `Colour (…)` (a swatch-picker trigger — its name carries the current colour, e.g.
`Colour (Blue dark)` for a known swatch, else the raw hex — that opens a grid of preset
colour swatches, each button labelled by a human-readable name like `Blue dark` /
`Red bright`, not a hex), `Start`, `End`, `Hours / day`, `Status`,
`Note`, `Assignee`, `Project`, `Activity`, `Resource`, plus `Company` + `Descriptor` (the External form).
The **activity form** has an `Activity kind` radiogroup (`Project` / `Internal` / `Repeatable`); the
`Project` field shows (and is required) only for the `Project` kind — internal/repeatable
activities are project-less.
Buttons: `Save`, `Cancel`, `Delete`, `Duplicate`, `Add activity`. The **create / "Add"**
affordances carry a leading **`+`** glyph before the label (decorative, `aria-hidden`; the
accessible name stays the label text). List pages have an add button per entity: `Add resource`,
`Add discipline`, `Add client`, `Add project`, `Add activity`, `Add time off`,
`Add external party` (plus the company picker's `New company`). Each list row has an **icon-only**
`Edit` (pencil) and `Delete` (trash) button — the glyph is decorative and the button's
`aria-label`/`title` carry the name (`Edit` / `Delete`, or `Delete <name>` on the company picker),
so `getByRole('button', { name: 'Edit' | 'Delete' })` still matches.

**Delete confirmation** is a dialog titled `Delete <entity>?` with `Delete` and `Cancel` (these
dialog/footer action buttons keep their text — only the list-row actions are icon-only).
Cascade dialogs say "You can undo this with ⌘Z."

**Scheduler toolbar.** Zoom buttons `1w`/`2w`/`4w`/`6w`/`8w` (the active one has
`aria-pressed="true"`); `‹ Prev`, `Today`, `Next ›`; a `Jump to date` date input; a
**Navigation always re-anchors the grid's left edge to the week start** (the account
`weekStartsOn`, default Monday): a **zoom** click (1/2/4/6/8w), a **Prev/Next** pan, and the
**date picker** all snap the leftmost column to that week's Monday so the helicopter view always
opens on a week boundary. The `Jump to date` input reflects the snapped Monday (its value is the
snapped focus date — pick a Thursday and it shows that week's Monday). `Today` snaps the same way.
A pure window resize / Minimise-weekends toggle does NOT re-anchor — it preserves the exact
left-edge date. (This is ALWAYS on; there is no setting.)
A
draw-mode toggle `Work`/`Time off` (buttons — note "Time off" here is the *toggle*, distinct
from the "Time off" *nav link*). Then **Undo**/**Redo** icon buttons (`undo-button` /
`redo-button`, `aria-label` "Undo"/"Redo", disabled when the history stack is empty) — the
visible counterpart to the global ⌘Z / ⌘⇧Z shortcut. **In `Time off` mode the grid signals the mode whole-view:
work allocation bars recede to a flat neutral (the theme-aware `var(--color-muted)` token, which adapts to light/dark) at 20% opacity AND go fully *inert* (not
clickable/draggable, no hover popover, not tab-reachable), while existing time-off blocks glow
amber — so a lane draw books time off without the bars intercepting the gesture (a draw started
over an existing allocation falls through to the lane). The grid carries
`data-draw-mode="work"|"timeoff"`; nothing about the underlying data changes.** Undo/redo run
from BOTH the toolbar **Undo**/**Redo** buttons (above) AND the global `⌘Z` / `⌘⇧Z` shortcut. Filter row:
`Search people…`, `Filter by discipline`, `Filter by client`, `Filter by project`,
`Filter by activity` (a grouped dropdown — `All activities`, then an `Internal` optgroup with
`Internal — All` + each internal activity, then a `Repeatable` optgroup with `Repeatable — All` +
each repeatable activity; shown only when the account has internal/repeatable activities. Project activities
are reached via `Filter by project`). The activity lens is a **standalone** view: selecting it
clears the client/project filter and vice-versa. `Hide tentative` checkbox, `Show unallocated`
(shown only while a client/project/activity filter is active, **off by default** — filtering hides
resources with no matching work; ticking it brings them back visible-but-dimmed so you can see
who's free to staff), `Clear` (only shown when a filter is active).

**Schedule display (minimise weekends).** Settings → **Schedule** has a switch
**Minimise weekends** (`role="switch"`, accessible name `Minimise weekends`), **on** by default.
It's a **device-global** display pref (own `localStorage` key `capacitylens/minimiseWeekends`, NOT on the
account and NOT in export) — like the theme and bar-label toggles. On → narrow Sat/Sun columns
with a single **"S"** label; off → full-width weekend columns labelled `Sat`/`Sun`. See *Weekend
columns* above.

**Schedule display (snap to week start).** The same Settings → **Schedule** section has a second
switch **Snap to week start** (`role="switch"`, accessible name `Snap to week start`), **on** by
default — sibling to *Minimise weekends*. It's also a **device-global** display pref (own
`localStorage` key `capacitylens/snapToWeekStart`, NOT on the account and NOT in export). On → after a
**free horizontal scroll** settles, the grid **floors** its left edge back to the current week's
first day (the account `weekStartsOn`, default Monday) — a stray nudge that would park the view on
a Tue/Wed settles back to that week's Monday. It floors (never forward): forward weeks are reached
via Prev/Next. Off → free scrolling is unconstrained and a nudge sticks on the mid-week day. This
governs **free scroll only** — the always-on **navigation** snap (zoom / Prev-Next / date-picker,
see *Scheduler toolbar* above) re-anchors to the week start regardless of this switch.

**Calendar (per-account, FROZEN after creation — P1.14).** Settings → **Calendar** shows the
account's **Week starts on** (segmented Monday/Sunday, default Monday), **Timezone** (select,
default `GMT`), and a read-only **Language** row (`data-testid="settings-language"`, **English**).
All three are **disabled** here — they are captured ONCE in the company-create form (see *Launching
the app* above) and are then **frozen**: the section carries the explainer *"Set when the company
was created and can't be changed."*, and the server rejects a direct change to any of the three
(`language`/`weekStartsOn`/`timezone`) with **409**. Company **name** and **disciplines** remain
editable. (English-only until Paraglide; the value persists as `'en'` on the Account.)

> **i18n note (P1.5.2).** Every Settings + Members label/heading/button/placeholder/hint quoted in
> this file is now rendered from a Paraglide message key (`settings_*` in `messages/en.json`) rather
> than an inline literal — the **visible English text is char-identical**, so all selectors here (by
> text / role-name / `data-testid`) are unchanged. Role labels (Owner/Admin/Editor/Viewer) and the
> week-start/theme/scheduling option lists resolve their labels at render. Interpolated copy (the
> server-vs-local clear-storage / "Signed in as …" / status-suffixed error toasts) is deferred to the
> later toasts/errors i18n area; its visible text is likewise unchanged.

**Placeholders (per-account, default OFF).** Settings → **Placeholders** has a single switch
**Show placeholders** (`role="switch"`, accessible name `Show placeholders`), **off** by default.
It's a **per-account** setting (`placeholdersEnabled` on the Account, absent = off, toggled via
`updateAccount` — mirroring `disciplinesEnabled`; carried in export like other account settings). **Off** (the out-of-the-box state) → every placeholder is hidden:
no row in the schedule (and no contribution to utilisation), no entry in the assignee picker or
command palette, and the Resources page hides its *Placeholders* section + *Add placeholder* button.
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
activity-first layout regardless of these toggles.

**Disciplines (account-level).** Settings → **Disciplines** has a single switch **Use disciplines**
(on by default). Turning it off hides disciplines across the whole app — the **Disciplines** nav
link and route (a direct `/disciplines` URL redirects to `/`), the **Discipline** field in the
resource form, the **Filter by discipline** control, the discipline part of each Resources-list
row, the Disciplines command-palette entry, and the **Show Discipline Utilisation** toggle — and
the schedule then renders **flat** (no `discipline-group` bands). It's stored on the account
(`disciplinesEnabled`, syncs + exports), so it applies to everyone on that company; the discipline
data itself is kept and reappears if switched back on. Both seed companies leave it on.

**Clear local storage (Settings → Local data).** A destructive maintenance action in a danger-styled
**Local data** section near the bottom of Settings: a `Clear local storage` button
(`data-testid="clear-local-storage"`). Clicking it opens the standard confirm dialog (title
`Clear local storage?`, danger `Clear local storage` confirm + `Cancel`) whose copy depends on the
backend — in **server mode** (`VITE_CAPACITYLENS_API` set) it says your data lives in the database and is
safe, the app will reload and re-load it from there; in **local mode** it says this is your only copy
so it erases your local data. Both say it clears CapacityLens data + settings in **THIS browser** and
**cannot be undone**. Confirm removes every `capacitylens/`-prefixed localStorage key (the data blob + all
device prefs — unrelated origin keys are left alone) and reloads the page. **Cancel is a no-op.**

**Build stamp + feedback link (Settings, flag-gated).** When the build sets
`VITE_CAPACITYLENS_BUILD_SHA`, the Settings page ends with a muted one-line footer containing the
stamp (`data-testid="build-stamp"`) reading `build <sha> · server` (a server backend is
configured, i.e. `VITE_CAPACITYLENS_API` was baked in) or `build <sha> · local` (localStorage
mode). When the build also sets `VITE_CAPACITYLENS_FEEDBACK_MAILTO`, a **Send feedback** link
(`data-testid="send-feedback"`) sits beside the stamp — a `mailto:` whose subject carries
the build stamp, so reports arrive pinned to a build. The default dev/local build leaves
both variables unset and renders **nothing** — the seeded state these stories run against
has no footer at all.

**Login screen (flag-gated; not reachable in the default deploy).** Only when the app runs in
server mode (`VITE_CAPACITYLENS_API` set) **and** that server runs with `CAPACITYLENS_AUTH=password` or
`sso`: the app checks `GET /api/auth/me` once at boot, and a 401 replaces everything — company
picker included — with a **Sign in** screen (heading `Sign in`; fields `Email` + `Password`
and a `Sign in` button in password mode; a `Continue with SSO` button in sso mode; failures
show an inline alert). While signed in, Settings gains an **Account** section showing who is
signed in plus a `Sign out` button. With auth off (the default everywhere) or in local mode,
no login screen exists, Settings has no Account section, and local mode makes **no** auth
request at all. The server's reported `authMode` is the single source of truth — there is no
client-side auth flag.

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
/ `admin` — `admin` is PINNED for the e2e server via `CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD`, since
production now mints a one-time generated password; see `BOOTSTRAP_ADMIN` in `e2e/auth-helpers.ts`),
so the setup form
itself is covered by unit tests, not a spec. Spec `e2e/login.auth.spec.ts`.

**Invite accept route (`/invite/:token`; server mode).** A single-use, expiring invite link
carries a pre-set role for one company. Opening `/invite/<token>` shows the **Accept invite**
screen (heading `Accept invite`). In a server deploy with auth on, an **unauthenticated** visit
gets a 401 from the accept POST and the invite page shows its OWN inline onboarding form (NOT the
app login wall): an existing user signs in with **Sign in and accept**, or a brand-new invitee
creates a password account with **Create account and accept** (POST `/invite/:token/signup`); either
way the page reloads onto the same `/invite/<token>` URL and the accept runs — so the token survives.
A **valid** link binds the signed-in user to that company with the invited role and shows a
*"You've joined this company as `<role>`"* success with a **Continue** link into the app (which
opens the joined company directly — the accept flow refetches the account list so the brand-new
membership is activatable; if that refetch fails, Continue lands on the company picker, where
the new company is listed). A **used** link shows *"This invite has already been used."*; an
**expired** link shows *"This invite has expired."*; an **unknown** token shows *"Invite not
found."* Invites are server-only: in local mode (no `VITE_CAPACITYLENS_API`) the page shows a
short *"Invite links work only when CapacityLens is connected to a server."* note and makes no
request. The link page is `src/components/invites/InviteAccept.tsx`; the create UI is the Members
section below. Spec `e2e/invite.auth.spec.ts`.

**Settings → Members (Owner/Admin only; server + auth-on).** When the app runs in server mode
(`VITE_CAPACITYLENS_API` set) against a server with auth ON, Settings gains a **Members** section
(heading `Members`, `data-testid="members-section"`) — but ONLY for an Owner or Admin: the section
self-gates by trying to read the member list and rendering **nothing** if the server replies 403
(a Viewer/Editor/non-member), so it is invisible to anyone who can't manage members. In **auth off**
(the default everywhere) or **local mode** the section is **absent**. It has three parts:
- **Members list** — one row per member (`data-testid="member-row"`) showing name (email), role and
  status; the caller's own row is marked **(you)**. Each manageable row carries a **role select**
  (`data-testid="member-role-select"`) and a **Remove** button (`data-testid="member-remove"`); an
  **Owner** additionally sees a **Make owner** button (`data-testid="member-make-owner"`) on every
  other, non-owner member's row (the atomic ownership hand-over — see below). In **password mode
  only**, manageable rows also carry a **Reset password** button
  (`data-testid="member-reset-password"`): clicking it mints a **single-use, 24-hour** reset link
  shown **once** (`data-testid="reset-link"`, `<origin>/reset-password/<token>`) with a **Copy**
  button and a note naming the member and the expiry date — nothing is emailed; the admin hands the
  link over directly. An **Admin never sees Reset password on an Owner's row** (a reset link is an
  account-takeover capability; only an Owner may reset an Owner — the server 403s regardless). The
  button is absent in `sso` mode (the IdP owns credentials).
- **Invite form** — a **role** picker (`data-testid="invite-role"`) + an optional **pre-authorise
  email** field (`data-testid="invite-preauth"`) and a **Create invite** button
  (`data-testid="invite-submit"`). On success the full link (`<origin>/invite/<token>`) is shown
  **once** (`data-testid="invite-link"`) with a **Copy** button — the token is write-once and never
  shown again.
- **Outstanding invites** — a row per invite (`data-testid="invite-row"`) with role / preauth-email
  or "link" / expiry-or-used and a **Revoke** button (`data-testid="invite-revoke"`). The list never
  carries the secret token.

What's **hidden for an Admin vs an Owner**: an Admin never sees the **owner** option (not in the
role-change select nor the invite-role picker), and an **owner row** shows no role control and no
Remove for an Admin (an Admin can't touch an owner). The **sole owner** is protected — its role
select is disabled and Remove is hidden (the account must keep at least one owner; *"Sole owner —
protected"* is shown). The Owner sees every affordance. Only the Owner sees **Make owner**
(`data-testid="member-make-owner"`) on another, non-owner member's row — the true atomic **transfer
of ownership** (promote them to owner + step the caller down to admin in ONE server transaction),
distinct from setting a role to *owner* via the select (which keeps the caller an owner too). An
Admin never sees it. The server is the backstop for all of this:
an Admin granting owner, touching an owner, or demoting/removing the last owner is **403** even if
the UI is bypassed; revoking another account's invite is a no-op; reading another account's members
is **403** (no cross-tenant leak).

The API routes: `GET /api/accounts/:accountId/members` (gated manageMembers; OFF → `{members:[]}`),
`PATCH /api/accounts/:accountId/members/:userId {role}` (400 bad role, 404 non-member, 403 by the
role/last-owner rules), `DELETE /api/accounts/:accountId/members/:userId` (204; 403 owner/last-owner),
`GET /api/accounts/:accountId/invites` (gated manageInvites; NO token; OFF → `{invites:[]}`),
`DELETE /api/accounts/:accountId/invites/:id` (204, idempotent, cross-tenant-safe),
`POST /api/accounts/:accountId/transfer-ownership {toUserId}` (owner-only; 400 missing/empty or
self-target, 404 non-member target, 403 non-owner; OFF → inert 200 no-op — hands the account to an
existing member and demotes the caller to admin atomically). Creating an
**owner** invite via `POST /api/invites` requires the caller be an owner (admin → 403), and
`POST /api/accounts/:accountId/members/:userId/reset-password` (gated manageMembers; password mode
only — sso/OFF → 400; admin resetting an owner → 403; 404 non-member; 201 `{token, expiresAt}`,
write-once) mints the reset link. The UI is
`src/components/settings/MembersSection.tsx`; story `user-stories/settings/US-SET-10-member-management.md`;
spec `e2e/members.auth.spec.ts`.

**Password reset route (`/reset-password/:token`; server mode, password auth).** The page an
admin-minted reset link opens: heading **Reset password**, a **New password** field
(`data-testid="reset-new-password"`), a **Confirm new password** field
(`data-testid="reset-confirm-password"`) and a **Set new password** button
(`data-testid="reset-submit"`). It renders **without a session** — unlike `/invite/:token` there is
no login wall in front of it (the visitor is exactly the person who cannot sign in). Client
pre-checks (mismatch, under 8 characters) show a field error without a request; the server is the
authority on redeem (`POST /api/auth/reset-password`). Success shows *"Password updated. Sign in
with your new password."* (`data-testid="reset-success"`) with a **Go to sign in** link (a full page
load onto the login wall); the member's previous sessions are revoked. An invalid / already-used /
expired token shows *"This reset link is invalid, already used, or expired. Ask your admin for a
new one."* — the token is single-use. In local/demo mode the page shows a short "server mode only"
note and makes no request. The page is `src/auth/ResetPassword.tsx`; spec
`e2e/reset-password.auth.spec.ts`.

**Viewer read-only mode (server + auth-on).** On an auth-on, server-backed deploy a member's account
**role** (`owner` | `admin` | `editor` | `viewer`) drives the UI. `GET /api/accounts` now returns
`{ id, name, role }` per account (the caller's role for it; in **OFF mode** every entry's role is the
trusted-local sentinel `'owner'`, keeping OFF fully editable). When the active account's role resolves
to **viewer**, the whole app goes **read-only**:
- **No create/edit/delete affordances** — list pages show no **Add X** button and no row **Edit** /
  **Delete** buttons (`EditButton`/`DeleteButton` render nothing), and the "Add your first X" empty-state
  create CTA is hidden (navigation CTAs like *Clear filters* / *Go to Resources* stay).
- **The scheduler is display-only** — no per-row **+**, no draw-to-create gesture (a click/drag on a
  lane creates nothing) and no hover **+** hint; allocation bars have **no resize grips**, no
  drag/resize, and don't open the edit modal (a viewer bar is `role="img"`, not a `button`).
- **The toolbar hides the Draw-mode toggle and Undo/Redo** (nothing to draw/undo); navigation +
  filters (reads) stay.
- A subtle **"View only" badge** (`data-testid="view-only"`) sits in the sidebar footer beside the
  company name.
The **server 403** (the write tier is editor+; a viewer's write is rejected) is the AUTHORITATIVE
backstop — the client gating is UX + defense-in-depth. As a second local guard, the store no-ops a
viewer's `add*`/`update*`/`delete*`/`importData` and surfaces a *"Read-only — you don't have edit
access."* notice, so an ungated path or an optimistic write can't desync local state. **In auth off
(the default everywhere) or local mode the role is `null` → fully editable, byte-identical to today.**
The provider is `src/auth/PermissionProvider.tsx` (the hooks `useRole`/`useCanEdit` in
`src/auth/permissionContext.ts`, off the pure `can`); story `user-stories/settings/US-SET-11-viewer-readonly.md`;
spec `e2e/viewer.auth.spec.ts`.

**Demo sign-in (cosmetic; not real auth).** In the default (auth-off) deploy, a Google-style
*"Choose an account"* screen (heading `Choose an account`; the **Jordan Avery** account row,
`data-testid="fake-sign-in"`; a "Use another account" row) is shown **before** the company
picker, to preview a "log in first, then pick a company" flow. There is no password and no
popup — any choice just advances. The signed-in state is a **device-global** flag
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
**placeholder** (a human edits it later), single-sourced in `src/lib/introCopy.ts`; the component is
`src/components/IntroPage.tsx`. Spec `e2e/fake-signin.spec.ts` (and `e2e/login.auth.spec.ts` for the
real-auth path).

## Command palette

Opened by **⌘K / Ctrl+K** from anywhere in the app (including while a text field is focused).
**Exception:** if a dialog has unsaved changes (`dirtyForm` is true), ⌘K/Ctrl+K is blocked —
a notice appears ("You have unsaved changes — use Cancel or Save to close this dialog.") and
the palette does **not** open. Closing or saving the dialog re-enables the shortcut.
Closed by **Escape**, backdrop click, or selecting an item.

**Sections shown (no query):** Actions ("Go to today"), Pages (all 8 routes; 7 — no Disciplines — when the company turns disciplines off).
**Sections shown (with query):** any of the above that match, plus People, Projects, Clients, Activities.
**Special action:** typing a valid, real calendar ISO date (`YYYY-MM-DD`, zero-padded,
e.g. `2026-06-03`) shows "Go to date YYYY-MM-DD". Impossible dates like `2026-02-31`,
unpadded dates like `2026-6-3`, and out-of-range months/days are rejected.

**Selection behaviours:**
- Page item → navigate to that route.
- "Go to today" → navigate to `/` + recenter the scheduler on this week.
- "Go to date YYYY-MM-DD" → navigate to `/` + scroll the scheduler to that date.
- Person item → navigate to `/` + clear filters + scroll that resource's row into view.
- Project item → navigate to `/` + **replace** schedule filters with `{ projectId }` (all other
  filters — search, discipline, client, hideTentative, showUnmatched — are reset to defaults).
- Client item → navigate to `/` + **replace** schedule filters with `{ clientId }` (same reset).
- Activity item → navigate to `/activities`.

**Keyboard navigation:** `ArrowUp`/`ArrowDown` move the highlight; `Enter` selects; `Escape` closes.
Mouse hover sets the active option; mouse click selects.

## `data-testid`s (for automated checks)

`scheduler-grid`, `scheduler-toolbar` (the two-row scheduler chrome wrapper — title/nav/zoom/draw
row + filters row; the WCAG 1.4.10 reflow check asserts it doesn't overflow at 320 CSS px),
`scheduler-row`, `discipline-group`, `resource-lane`,
`allocation-bar`, `resize-start`, `resize-end`, `over-marker`, `unavailable-day`,
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
(Settings → Calendar's read-only Language row — **English**; both frozen, P1.14),
`new-company-button` (the company picker's **New company** button; HIDDEN — not merely disabled —
whenever `GET /api/auth/me` reports `canCreateAccount: false`: the single-company cap is reached,
or under auth-on the caller lacks owner/admin standing on any account),
`clear-local-storage` (Settings → Local data danger button; opens a destructive confirm),
`archived-section` (Settings → Archived & deleted; shows in local mode and for admins on an auth-on
server, self-hidden on a 403), `archived-row` (one per archived resource/client/project; carries a
**Restore <name>** + **Delete <name>** button), `deleted-row` (one per soft-deleted tombstone; carries
`archived-purge` — the **Permanently delete <name>** button, disabled with a locked hint until the
30-day grace elapses, purge-tier/admin-only),
`view-only` (sidebar-footer "View only" badge — shown ONLY for a Viewer on an auth-on, server-backed
deploy; absent in the default OFF/local deploy and for any non-viewer role),
`build-stamp` (Settings footer; only rendered when the build sets
`VITE_CAPACITYLENS_BUILD_SHA`), `send-feedback` (Settings footer mailto; only when the build sets
`VITE_CAPACITYLENS_FEEDBACK_MAILTO`). A lane carries `data-resource-id="<id>"`; a bar carries
`data-alloc-id`/`data-status`. Seed ids include `r-tyler`, `r-nike`, `r-alex`,
`r-ph-designer`, `r-ext-dogeatcog` (external party), `p-acme` (Project Lightning), `p-brand` (Brand Themes), `t-wires`.

**Command palette:** `command-palette` (outer backdrop), `command-palette-input` (search field),
`command-palette-option` (each result item; multiple).

## Domain rules a tester should know

- **A project must belong to a client. An activity has a `kind`:** `project` (belongs to a project,
  may carry a phase), `internal` (project-less internal work), or `repeatable` (project-less,
  reusable across projects). Internal/repeatable activities carry no project or phase. The Activities page
  shows three sections — `internal-activities`, `repeatable-activities`, `project-activities` (testids).
- **The built-in "Internal" client.** Every account has exactly one **built-in** client named
  **Internal** (the store rejects renaming/deleting it; the write boundary also rejects a direct API write
  that would create a *second* Internal, so the one-per-account rule holds on every path). It is a behind-the-scenes data anchor, so it
  is **HIDDEN from the Clients management list** (`/clients` shows no Internal row) — but it stays a
  real, persisted client that is **still selectable and bindable everywhere it's used:** in the
  **project form's Client `<select>`** (a project can be created under Internal), as a **Filter by
  client → Internal** option, and as a **Clients** entry in the command palette; a project bound to
  Internal still shows "· Internal" as its client in the Projects list. It can own real projects, AND a
  project-less internal/repeatable activity is **bucketed under it for display + filtering** (its
  bars/labels read "Internal", and **Filter by client → Internal** shows BOTH the project-less
  activities AND any activities under Internal-owned projects). No `clientId` is stored on the
  activity; the association is derived in the view-model.
- **Placeholders** are bound to exactly one project and may take that project's activities **plus any
  project-less (internal/repeatable) activity**. They are **hidden by default** behind the
  per-account **Show placeholders** pref (Settings → Placeholders, `placeholdersEnabled` on the
  Account, default off); when shown they display as the literal name **"Placeholder"** with a **"?"** avatar.
- **External / 3rd parties** are a resource kind for outsourced work: a **company name** (+ optional
  descriptor), assignable to **any** activity with **no hours**, shown in a **neutral band at the bottom
  of the schedule** with **no utilisation / over-markers**. Their allocations carry `hoursPerDay: 0`
  and are a **literal start/end span** (`ignoreWeekends: true` — the "Include weekends" toggle is
  hidden, weekends count as plain calendar days); they're excluded from the Time-off picker, and the
  write boundary rejects time off OR a non-zero load for an external on *any* path (a direct/crafted
  write is rejected; an import is repaired — external time off dropped, external load coerced to 0). They are
  **hidden by default** behind the per-account **Show external resources** pref (Settings → External,
  `externalEnabled` on the Account, default off); when on, an **External** section appears under the **Resources**
  tab (with explainer copy + an `Add external party` button) and the band appears on the schedule. When
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
**"Archive <name>"** (e.g. *Archive Alex Rivera*); clicking it opens a confirm dialog (title
**"Archive resource?" / "Archive client?" / "Archive project?"**, body *"Archive '<name>'? … You can
restore it or permanently delete it from Settings → Archived & deleted."*, confirm button
**"Archive"**). Confirming hides the row from the list **and** from the schedule (it becomes
archived), but the record + its children are **retained** (archiving is reversible, unlike the old
cascade-delete). The affordance is gated by `useCanEdit` (a Viewer sees nothing). In **server mode**
the row POSTs `POST /api/:entity/:id/archive {accountId}` and reloads the active slice; in
**local/OFF mode** it calls the store's `archiveEntity`. Built-in **Internal** client has no archive
button (it's hidden from the Clients list and the store/server backstop it). Hook:
`src/hooks/useLifecycleActions.ts` (the shared server/local dispatch).

### Settings → Archived & deleted (P2.5b)

Settings gains an **"Archived & deleted"** section (heading `Archived & deleted`,
`data-testid="archived-section"`) — the admin view of the data-lifecycle, the counterpart to the
normal active-only views. Unlike Members it **also shows in LOCAL mode** (everyone is owner locally);
in **server mode** it self-gates by trying the `GET /api/state?accountId=…&includeInactive=1` read and
rendering **nothing** if the server replies **403** (a non-admin — the inactive read is purge-tier).
The inactive-row **source** is the store (`useInactiveScopedData`) in local mode and that
`includeInactive=1` fetch in server mode. Rows are partitioned into two groups:
- **Archived** (`data-testid="archived-row"`, one per archived resource/client/project) — each shows
  the entity name + a type tag (Resource / Client / Project) and two actions: **Restore** (aria
  *"Restore <name>"* → unarchive, back to active) and **Delete** (aria *"Delete <name>"* → a confirm
  dialog *"Delete this item?"*, then soft-delete: it moves to the Deleted group and a resource's name
  is scrubbed to *"Removed person #…"*).
- **Deleted** (`data-testid="deleted-row"`, one per soft-deleted tombstone) — shows the (for a
  resource, already-obfuscated *"Removed person #…"*) name + type tag and a **Delete permanently**
  button (`data-testid="archived-purge"`, aria *"Permanently delete <name>"*). It is **disabled** with
  the hint *"Can be permanently deleted 30 days after deletion"* until the tombstone is ≥ 30 days old;
  once eligible it's enabled and a strong confirm dialog (*"Permanently delete?"*, confirm *"Delete
  permanently"*) is required. The permanent-delete button is **purge-tier (admin+)**: it is shown only
  when the caller may purge (always in OFF/local; admin+ on an auth-on server) — the server 403 is the
  backstop. There is **no Restore on a tombstone**. An **empty state** (*"Nothing archived or
  deleted."*) shows when nothing is inactive. The component is
  `src/components/settings/ArchivedSection.tsx`; spec `e2e/archived.spec.ts`.

### Server lifecycle routes (P2.5a)

The Active → Archived → Soft-deleted → Purged data-lifecycle is enforced **server-side** by four
dedicated action routes (entity ∈ `resources` | `clients` | `projects` **only** — any other entity is
a **404**). Each takes a JSON body `{ accountId }` (**required** — the tenant assertion, mirroring the
scoped-write contract; a missing/empty one is a **400**). OFF mode is allow-all on all four.

| Route | Tier | Transition | Result |
| --- | --- | --- | --- |
| `POST /api/:entity/:id/archive` | write (editor+) | active → archived | `200` updated row |
| `POST /api/:entity/:id/unarchive` | write (editor+) | archived → active | `200` updated row |
| `POST /api/:entity/:id/delete` | write (editor+) | archived → soft-deleted (resource: `name` scrubbed to `Removed person #…`) | `200` updated row |
| `POST /api/:entity/:id/purge` | **purge (admin+)** | ≥30-day-old tombstone → **HARD delete + cascade** | `204` |

- **Error mapping:** an **illegal transition** (e.g. deleting a row that was never archived, archiving
  an already-archived row) → **409** with the state machine's own message; a **cross-account** target →
  the standard tenant guard (**403** non-member, or **404** when the id isn't in the asserted account's
  slice); an **absent** row → **404**; an insufficient role → **403**.
- **Purge interlock (server-enforced):** purge is refused (**409**) unless the row is a **soft-deleted
  tombstone aged ≥ 30 days** (`PURGE_MIN_AGE_DAYS`); the cascade then removes the row **and its
  descendants** (client → projects/phases/activities/allocations, etc.), same rules as a normal delete.
- **Built-in Internal client guard:** the protected built-in **Internal** client cannot be
  archived/deleted/purged — any of the three on it is a **409**.
- **Admin "read inactive":** `GET /api/state?accountId=…&includeInactive=1` returns the **full** slice
  (archived + soft-deleted rows retained). It is gated at the **purge tier (admin+)**: a non-admin
  asking for the flag gets **403**; OFF mode always allows; omitting the flag = today's active-only read.
- **Cascade deletes:** deleting a client removes its projects → activities → allocations;
  deleting a project removes its phases/activities/allocations and *unbinds* (does not delete)
  placeholders; deleting an activity removes its allocations; deleting a resource removes its
  allocations + time off. Deleting a **discipline** or **phase** is *non-destructive*
  (ungroups resources / ungroups activities). All deletes are **undoable with ⌘Z**.
- **Disciplines are optional (account-level).** Default **on**. When a company turns them off
  (Settings → Disciplines → *Use disciplines*) disciplines are hidden everywhere and the schedule
  renders flat — see the *Disciplines (account-level)* note above. The seed companies leave it
  **on**, so every story below runs with disciplines visible.
- **Capacity:** a day's available hours = the resource's working hours, but **0** on a
  non-working weekday or a time-off day. A day is **over-allocated** when allocated > available
  (STRICTLY greater — exactly at capacity is NOT over). Allocated hours are **weekend-aware**: a
  normal allocation does no work on the resource's non-working weekdays, so a weekend a bar merely
  **spans** is NOT over (it keeps only the grey unavailable tint). The zero-capacity days that DO
  read as over are a **time-off** day a working allocation covers, and a weekend an allocation opts
  into via **"Include weekends as working days"** (`ignoreWeekends`). An over-allocated day renders
  with a **clear red background** (`data-testid="over-marker"`) plus a solid
  red top band, in both light and dark themes. The over-marker carries no `title` (it's
  `pointer-events-none`, so a hover tooltip there is unreachable); the screen-reader signal is the
  per-row sr-only "Over capacity on N day(s)" summary in the row header instead.
- **An allocation can't exceed 24h/day, and the form says so instead of silently trimming it.** In
  **days mode**, a *Days of work* spread over too few *Days over* (e.g. 5 days of work in a 1-day span =
  40h/day) is **rejected** ("That's more than 24h a day. Increase Days over or reduce Days of work.")
  rather than saved as a quietly-clamped 24h; **hourly mode** likewise rejects a *Hours / day* above 24.
  The previewed "…h/day" hint always equals what saves.
- **Utilisation %** (left-column label "Utilisation · Nw" where N tracks the week-range toggle, and
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

- Each story is **end-to-end**: it starts from a defined state (usually the seeded app)
  and is runnable by a human with no prior setup.
- **Acceptance criteria** are written as checkable assertions (✅) — a tester can tick each.
- Each story names its **Linked E2E test(s)** (file + test title) so the automated coverage
  is traceable to the manual script.
