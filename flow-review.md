# CapacityLens — Flow Review

_Read-only product/UX review of the whole flow (wishlist item 8). No source files
were changed, no branch, no PR. Written after the 7 preceding wishlist items shipped
(Task→Activity rename; built-in Internal client; placeholders behind a setting;
External relocated + gated; capacity % over the visible window; red over-capacity
background; post-login intro page)._

Reviewed against CapacityLens's stated positioning — a **deliberately small, week-granularity
"helicopter view of who's busy / free / overworked."** Every suggestion below stays
inside that scope: nothing here proposes budgets, timesheets, hour-granularity, mobile
views, or project-management process. The recommendations **reduce or clarify existing
surface**, they don't add product.

Overall health is good: the data model is clean, the invariants held across all 7 items,
and the docs (DECISIONS / NEEDS-INPUT) are unusually disciplined. The friction is almost
entirely in **legibility and discoverability**, not correctness.

---

## TL;DR — the five things worth doing first

1. **Make gated features discoverable.** Placeholders and External both default OFF and
   leave *zero trace* in the UI when off — a user can't tell the capability exists. One
   muted line at the point of need (Resources page) fixes it. _(High)_
2. **Explain the three "over"/capacity signals.** A red day-cell, a red %, and a %
   number each mean different things over different windows, disambiguated only on hover.
   A one-line legend + a window micro-label on the per-row % removes the single biggest
   conceptual confusion. _(High)_
3. **Stop making single-company users click through a picker on every reload**, and don't
   leave the intro page as a third post-picker wall. Auto-select the lone/last account;
   fold the intro into first-run. _(High)_
4. **Name the two Settings buckets** (per-browser vs shared-with-team/exported) and
   **group the repeated toggles** — the page is at 11 stacked cards and growing one per
   feature. _(High/Med)_
5. **Disambiguate "Internal."** It's both an activity *kind* and a *client*, both render
   "Internal," and Filter-by-client→Internal returns both — surprising. Add a one-line
   helper and reconsider whether 3 activity kinds are needed. _(High)_

---

## 1. Entry / Onboarding flow

The default (auth-off) path is **FakeSignIn → AccountPicker → IntroPage → app** — a
first-time single-company user passes 3 click-to-continue gates before seeing a schedule,
and a returning user still passes 2 (sign-in + picker) on *every* reload.

- **[High] The company picker is an unavoidable speed-bump on every reload for the common
  single-company case.** `activeAccountId` is deliberately never persisted (load-bearing
  multi-tenant invariant), but the *picker UI* doesn't have to appear when there's no real
  choice. **Fix:** when there's exactly one account (or a remembered last-active one that
  still exists), auto-select it and go straight to the app; show the picker only on genuine
  choice or via explicit "Switch company." Keeps the data invariant, removes the daily
  friction. (`AppShell.tsx` tenant gate; `AccountPicker.tsx`.)
- **[High] The IntroPage is a third full-screen wall, and it sits _after_ the picker.**
  It's purely informational (no choice, no input) yet blocks every device once. **Fix:**
  fold the "resourcing tool, not a PM tool" message into the first-run empty state or a
  dismissible banner, or show it only on true first run (never-seen-data) rather than
  once-per-device after the picker. (`IntroPage.tsx`, `AppShell.tsx` intro gate.) _(Also an
  open question — see §5.)_
- **[Med] Two near-identical "Choose an account" / "Choose a company" cards back-to-back
  read as "pick, then pick again."** Make the cosmetic sign-in unmistakably an *identity*
  step (avatar/email prominent, "Sign in to CapacityLens") so it reads "who are you → which
  company," not "pick → pick." (`FakeSignIn.tsx` vs `AccountPicker.tsx`.)
- **[Med] A brand-new company lands on a near-blank grid with thin, easy-to-miss guidance.**
  Seed data only appears on true first run; a user-created company gets an empty grid whose
  only hint is buried in the left rowheader ("Add people on the Resources page…"). **Fix:**
  make the empty state a centred call-to-action with an inline "Add resource" button (avoid
  a multi-step wizard — that contradicts "deliberately small"). (`SchedulerGrid.tsx` empty
  state ~558–580.)
- **[Med] The cosmetic-demo vs real-auth duality is invisible and oversells "Sign out."**
  The fake sign-in is indistinguishable from real Google auth (real "G", a plausible
  persona), and "Sign out" only bounces to the cosmetic chooser. A small "Demo — not real
  sign-in" caption frames the chrome honestly. (`FakeSignIn.tsx`, `fakeAuth.ts`.)
- **[Low] "Use another account" on the demo sign-in is a no-op that mimics a real control**
  (same action as clicking the persona row). Drop the second row or make it visibly the
  single advance action. (`FakeSignIn.tsx`.)
- **[Low] Sign-out → sign-in is a 3-screen round trip.** Mostly resolved if the
  auto-select-single-company fix lands.

## 2. Core scheduling & capacity flow

The model is clean; the friction is in **legibility of the capacity signals** and the
**create path always routing through a modal**.

- **[High] The three over/capacity signals never explain themselves on-screen, and the
  per-row % has no visible window label.** A user simultaneously sees: a red day-cell
  (signal: that *day* is over, `allocated>available`), a red **%** (signal: `overSoon`,
  overbooked somewhere in the *fixed next 14 days*, possibly off-screen), and the **%
  number itself** (signal: utilisation over the *visible* week-window). The per-row %
  renders as a bare `48%`; its window lives only in a `title` tooltip — invisible to a
  glance or on touch. So the same red means two different things and nothing says so.
  **Fix (no model change):** add the visible-window micro-label under the per-row % (mirror
  the headline `· {zoom}w`), and a one-line legend by the headline: _"% = the weeks you're
  viewing; red number = overbooked in the next 14 days; red cell = that exact day is over."_
  (`SchedulerGrid.tsx` ~476–548, `ResourceLane.tsx` over-marker.)
- **[High] Booking is never fewer than ~4 deliberate steps; draw/quick-create only fills
  *dates*, then dumps you into the full modal.** Even the fast path (row "+" or lane click)
  still needs Project → Activity (dependent select that resets on project change) → Save.
  **Fix:** remember the last-used Project (and Activity) per session and pre-select them in
  create mode, so a repeat booking onto the same project is draw → Enter. One default, not a
  new workflow. (`AllocationModal.tsx`, `ResourceLane.tsx` draw.)
- **[Med] Jump-to-date *centres*, but quick-create pre-fills the *left-edge* date** — so
  jumping to 1 Aug then "+" starts the booking in late July. US-SCH-18 already documents the
  papercut. **Fix:** pick one anchor for both (left-align jump, or seed create from the
  focus date). (`SchedulerToolbar.tsx` goToDate; `SchedulerGrid.tsx` visibleStartDate.)
- **[Med] A rejected drag-reassign silently keeps the date-move** — the bar "fails" (no row
  change) and "succeeds" (shifts days) in one drop. **Fix:** revert the whole gesture on a
  rejected reassign; keep the single explanatory toast. "All or nothing" is easier to reason
  about. (`AllocationBar.tsx` ~189–261.)
- **[Med] The activity lens is a 4th peer dropdown that silently nukes the client/project
  filter** (and vice-versa) with no feedback. **Fix:** make the exclusivity legible — a
  segmented "Client/Project ▸ Activity" control, or at minimum a one-line helper ("Activity
  filter replaces the client/project filter"). The mutual-exclusion is sound; only its
  invisibility is the friction. (`SchedulerToolbar.tsx` filter row; `setFilters`.)
- **[Low] Zoom offers 1/2/4/6/8w but utilisation windows are documented for 1/2/4/8w** — 6w
  is honest (label tracks zoom) but reads as an inconsistency; resolve or note in DECISIONS.
- **[Low] "Work / Time off" draw-mode is a hidden, sticky mode** that changes what a drag
  creates and collides in name with the Time off nav link. Label the active mode on the draw
  ghost or rename "Draw: Work / Draw: Time off."
- **[Low] Reading "who's free" is harder than "who's overworked":** under-loaded and
  healthy people look identical (faint grey %); only *over* gets colour. A subtle
  low-utilisation cue would let "who can take work" pop as readily as "who's drowning" —
  directly serving the core product question, no new data.

## 3. Data-model setup flow

The `AllocationModal` is already a strong fast-path (inline "Add activity", a "No project
(internal/repeatable)" option). Friction is in overlapping concepts and cold-start.

- **[High] "Internal" means two things — the activity *kind* and the *client*.** A user
  sees a non-editable built-in **Internal client** *and* an **Internal activity kind**,
  silently linked (project-less activities bucket under the Internal client for
  display/filter), both rendering the label "Internal." Filter-by-client → Internal
  returning *both* is unpredictable. **Fix:** in `ActivityForm`, when kind is
  Internal/Repeatable show a one-line helper ("Shows under the Internal client on the
  schedule"); and reconsider #2. (`ActivityForm.tsx`, `ClientList.tsx`.)
- **[High/Med] Three activity kinds may be one more than a small agency needs.** The only
  difference between `internal` and `repeatable` is "reusable across projects"; both are
  project-less, both bucket under Internal. The Activities page pays for it with three
  headed sections + three empty states for an account that may have ~4 activities. **Fix:**
  collapse to `Project` + `General/Internal`, or render Activities as one flat list with a
  small kind tag instead of three sections. (`ActivityForm.tsx`, `ActivityList.tsx`.)
- **[Med] Cold-start to the first booking is up to 5 separate modal forms** (Discipline →
  Resource → Client → Project → Activity → Allocation), nothing cross-links them, and list
  **empty states are dead ends** — `EmptyState` is plain text ("No clients yet.") with no
  inline Add; the only Add is the page header. **Fix:** (a) give `EmptyState` an optional
  action so "No clients yet." carries an Add button; (b) expand the scheduler empty state
  into a short ordered checklist; (c) the modal's inline-add pattern could extend to
  project/client. (`dialogs.tsx` EmptyState ~280; `SchedulerGrid.tsx` empty state.)
- **[Med] Placeholders & External are invisible out-of-the-box** (see §4 — same root issue,
  flagged independently from the data-setup angle: a freelance-heavy agency's most
  differentiating features are the hidden ones).
- **[Med] Resource vs External = two Add buttons + two near-duplicate forms on one page**
  (up to three Add buttons when External is on). Defensible (locked-kind decision), but the
  place to watch — a 4th kind should fold to a single "Add" with a kind step, not N buttons.
- **[Low] Colour pickers on Client/Project/Discipline are create-time friction with little
  payoff** — bar colour comes from the project, resource colour from discipline, so client
  colour especially is rarely seen. **Fix:** auto-assign a preset swatch on create (keep the
  preset-only invariant), make colour an edit-time refinement.
- **[Low] Disciplines feel like a required first step but are optional** (account toggle;
  resources work without them). Clarify the "— None —" default is fine.
- **[Low] Phase is modelled + seeded but has no creation UI** — a latent half-feature
  (`phaseId` is preserved on edit to avoid ungrouping, but nothing can create/assign a
  phase). Either expose a minimal phase picker on project-kind activities, or formally drop
  phases from the user-facing model (keep import/migration tolerance).

## 4. Settings, preferences & config

Settings is at **11 stacked cards** across two persistence buckets (account-data, exported,
team-shared vs **device-global**, per-browser, not exported). The three just-shipped toggle
items grew this surface measurably.

- **[High] The device-global vs account-data split is invisible.** The only cue is a
  `text-xs text-muted` "applies to this browser" clause buried mid-paragraph in *some*
  descriptions (and Calendar says the opposite, "the whole team," in the same style). A user
  who toggles "Minimise weekends" or "Show placeholders," then opens CapacityLens on another
  laptop, finds it reverted with no explanation. **Fix:** group the page into two labelled
  blocks — "Company settings (shared with your team / included in export)" vs "This browser"
  — or a per-card badge. The buckets already exist in code; the UI just doesn't name them.
  (`SettingsView.tsx`.)
- **[High] Placeholders/External discoverability** _(convergent with §3)_: both default OFF,
  and the entire surface (schedule band, Resources section, assignee picker, command
  palette) is hidden until toggled — **no entry point anywhere**. A user concludes the
  feature is missing, not "off in a settings page I haven't opened." **Fix:** one muted line
  at the point of need (Resources page header / Add menu): _"Outsourcing work or penciling in
  unfilled slots? Turn on External / Placeholders in Settings."_ This is the single biggest
  product risk from the three new toggles.
- **[Med] Consolidate the repeated toggles.** Placeholders + External are both "resource
  kinds you can show," both default-off, both gated identically — they should be ONE
  "Resource types" card with two switches and a shared explainer (the way Allocation bars
  and Utilisation already group switches), rather than two near-identical full-width cards
  with duplicated boilerplate. Stops each new resource-kind from minting a new top-level
  card. (`SettingsView.tsx` ~269–301.)
- **[Med] Several toggles are arguably defaults, not settings** — 5 always-on display
  switches (bar labels ×2, utilisation ×3) occupy two cards above the fold, competing with
  the genuinely consequential account settings. Consider a single collapsible "Display
  options" group, or dropping the ones with an obvious right answer.
- **[Med] Import/Export is divorced from Settings and silently active-account-scoped.** It
  lives in the sidebar "Data" section, and Export quietly emits only the active company (and
  excludes device-global prefs) with no in-UI warning — a multi-company user backing up "my
  data" gets one slice. **Fix:** co-locate in a Settings "Data" card and/or label "Exports
  *this company's* data." (The empty-file-wipe guards themselves are a genuine strength —
  precise, confirmed, undoable.) Minor mismatch: the import confirm says "undo with ⌘Z" but
  undo is keyboard-only (no on-screen button by design).
- **[Low] Timezone is a raw ~400-entry IANA dump** in a native select; a curated short list
  (GMT + common zones + "more…") matches "keep it light" better.

## 5. Open questions for the owner (consolidated)

These are deferred product decisions that *shipped with a sensible default* and are flagged
in `NEEDS-INPUT.md` — gathered here so the owner can sign off or revisit in one place.

1. **[High] Placeholder display name = literal "Placeholder".** Two unfilled slots on one
   project render two identical "Placeholder" lanes — indistinguishable at a glance, which
   fights the helicopter view. Revisit: `Placeholder 1/2`, or keep the role as the primary
   name? (`metadata.ts` `placeholderDisplayName`; `DECISIONS.md:170`.)
2. **[Med] Per-week aggregate over-capacity band — currently per-day only.** Someone light
   Mon–Thu but crushed Friday only lights Friday; at week granularity the week-sum may be the
   signal that matters. _Caveat: a week band would add a **fourth** over/capacity signal to
   an already-subtle set (see below) — weigh against the legibility cost._ (`NEEDS-INPUT:94`.)
3. **[Med] Intro-page frequency: once-per-device vs every-login** — one-line change either
   way. **And the intro copy is still placeholder** (`introCopy.ts` carries a
   `PLACEHOLDER COPY — pending human edit` banner) — finalize the copy before beta. Surface
   these together. (`NEEDS-INPUT:71`.)
4. **[Low] Internal modelled as a real builtin client** (can own real projects; virtual-only
   rejected). No action now — listed so the trade isn't silently forgotten. (`NEEDS-INPUT:76`.)
5. **[Low] Capacity advisory stays non-blocking** (warns, never blocks save). Confirm some
   agencies don't want a hard stop on overbooking. (`NEEDS-INPUT:91`.)
6. **[Low, carried — not from this batch] Undo/redo is keyboard-only** (toolbar buttons
   hidden), and the **Cohesion "colour bars by person"** request still sits open against the
   colour-by-project/discipline rule. Listed for a complete picture. (`DECISIONS.md:154`,
   `NEEDS-INPUT:88`.)

## 6. Cross-cutting structure & coherence (describe-only — not for action now)

Engineering quality across the 7 items is high (drift-proofing held, single hide-chokepoint,
docs match code). These are watch-items, not defects.

- **[Med] The "device-global pref + gated section" pattern is now repeated 3× and is the
  clearest structural smell.** Each pref (placeholders, external, intro) adds the same
  quintet — a `read/writeStored*` pair (`displayPrefs.ts`), a field + setter (`useStore.ts`),
  a gated section (`ResourceList.tsx`), a `resourceVisible` check (`schedulerModel.ts`), a
  Settings card (`SettingsView.tsx`) — ~28 lines across 5 files. The next boolean view-pref is
  a 5-file copy-paste. A **declarative pref registry** (key + default + label + explainer +
  optional resource-kind gate) would unify it and *reduce* surface — fits "deliberately small."
- **[Low] The AppShell gate chain is 6 deep and its ordering is load-bearing but
  undocumented as such.** connectionError → loadError → FakeSignIn → AccountPicker → IntroPage
  → shell, each with a why-comment — but no note that the *order* matters (Intro must follow
  the picker because it reads `activeAccount`), and no test catches a mis-ordered insertion.
  `RotateHint` is also hand-duplicated across 4 sites. A one-line "order matters" note + an
  eye on the next addition.
- **[Low] One red token, two meanings (UX).** The day-cell over uses red `bg-danger-cell`
  ("this day is over"); `overSoon` turns the % *text* red ("over somewhere in the next 14
  days, possibly off-screen"). Cleanly separated in code, conflated visually — relevant to
  open question #2 (a week band = a fourth signal).
- **[Low] Two small drift risks.** `#9c3ace` is hardcoded twice for different meanings
  (`internalClient.ts` INTERNAL_CLIENT_COLOR and `palette.ts` placeholder) with no shared
  source — change one and they silently desync. And Placeholder has **no `isPlaceholder()`
  predicate** (~12 inline `kind === 'placeholder'` checks) where External has
  `isExternalResource` — a 4th resource kind would multiply the scatter.
- **[Low] Copy modules lack a consistent "done-ness" signal** — `introCopy.ts` says
  PLACEHOLDER/pending-edit, `externalCopy.ts` says EDITABLE/stable; a shared `STATUS:
  draft|final` convention would make the pending-edit ones findable as they multiply.

---

_Net: no correctness or invariant breakage found across the 7 items. The highest-value work
is **legibility and discoverability** (TL;DR 1–5), all achievable without leaving the
"deliberately small" positioning. The one structural item worth acting on before it
compounds is the 3×-repeated pref/gate pattern (§6, first bullet)._
