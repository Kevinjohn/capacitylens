# Issue #968 — Optional strategic capacity periods

Status: implementation-ready plan. Issue: [#968](https://github.com/Kevinjohn/capacitylens/issues/968).
Base reviewed: `97e822c9`.

## Outcome

Keep Overview's four tactical columns unchanged and add an optional strategic horizon with two
four-week total columns. The extra columns let a manager scan weeks 5–8 and 9–12 without losing the
near-term detail in the remainder of the current week and the next three complete company weeks.

This is one frontend capability. It does not change the server API, persisted account data, access
policy, export format or database schema.

## User-visible contract

Add an **Overview horizon** segmented control to the Overview toolbar:

- **4 weeks** is selected by default and shows the existing four columns.
- **12 weeks** keeps those four columns and adds **Weeks 5–8** and **Weeks 9–12**.
- The selection is component state, like the existing Overview controls. It resets to **4 weeks**
  when Overview is reopened or the page reloads; it is not a company or device preference.
- Switching the horizon preserves the current tentative, people, totals and display-mode controls,
  plus group collapse state. An account change resets the whole Overview view through the existing
  route lifecycle; no cross-account preference is introduced.
- The control is available to every role that can open Overview. Existing Overview access rules
  remain authoritative.

“12 weeks” is concise UI shorthand. User documentation must explain that the range is the remainder
of the current company week followed by eleven complete company weeks, not twelve full weeks from
today.

### Period boundaries

The existing columns remain:

1. today through the end of the current company week;
2. the next complete company week;
3. the following complete company week;
4. the following complete company week.

When the strategic horizon is selected:

5. **Weeks 5–8** starts the day after column 4 and covers four consecutive complete company weeks;
6. **Weeks 9–12** starts the day after column 5 and covers the next four complete company weeks.

Both strategic periods respect the account's Monday or Sunday week start and are never partial.
Their visible headings show the period label and actual localized date range on separate lines. The
accessible column name includes both, for example, “Weeks 5 to 8, 29 Jun to 26 Jul”. The date range
is authoritative at month and year boundaries.

Example for Wednesday 3 June 2026 in a Monday-start company:

| Column     | Range             |
| ---------- | ----------------- |
| 1          | 3–7 June          |
| 2          | 8–14 June         |
| 3          | 15–21 June        |
| 4          | 22–28 June        |
| Weeks 5–8  | 29 June–26 July   |
| Weeks 9–12 | 27 July–23 August |

### Capacity calculations

Treat every column as a displayed period with a start and end date. Apply the current daily capacity
rules across every date in that period:

- respect personal and company working days, half-days, allocations, time off and closures;
- apply **Show tentative** or **Hide tentative** to all displayed periods;
- keep free hours, overbooked hours and placeholder demand separate;
- aggregate exact hours for the entire displayed period, then round once for display;
- round free capacity down to the nearest quarter-day;
- round overbooking and unassigned demand up to the nearest quarter-day;
- never total already-rounded weekly display values.

Preserve the existing bar denominator: configured company working weekdays within the displayed
date range multiplied by eight hours. Company closures reduce available/free capacity through the
daily calculation but do not reduce the bar denominator. For a five-day company, a complete
four-week period therefore has a 160-hour denominator; nineteen free days after one closure fill
95% of the cell.

Preserve the current mixed-state priority: if a period has any overbooking, Bar and Bar & number use
the red overbooking fill and do not also paint the green free-capacity fill. Bar & number still shows
both the free and overbooked figures. Pure Bar mode exposes both values through the same accessible
text used by Number mode. This plan deliberately does not introduce a split or stacked bar.

**Has availability** evaluates the periods currently displayed, after each period's exact
aggregation and display rounding:

- a person qualifies when any displayed period has at least `0.25` displayed free days;
- a placeholder qualifies when any displayed period has non-zero displayed demand;
- four weeks with `0.5` free hours each aggregate to `2` hours, or `0.25` displayed days, so the
  person qualifies in 12-week mode even though none of those constituent weeks would qualify alone;
- switching back to 4-week mode removes a row that qualifies only in a strategic period;
- group summaries continue to cover all eligible rows, including rows hidden by this filter.

### Layout and accessibility

- Four-week mode retains the existing layout.
- Twelve-week mode renders one identity column and six aligned period columns. Column widths and the
  empty-state `colSpan` derive from the displayed-period count rather than a hardcoded total.
- At constrained widths, horizontal overflow belongs to the table region; the toolbar remains
  outside it and wraps without clipping controls.
- Keyboard users can scroll or otherwise reach horizontally obscured cells. Sticky identity-column
  behaviour is optional and must not block the issue.
- Strategic headings visibly and accessibly distinguish four-week totals from one-week columns.
- Existing row headers, underlying accessible value text and non-colour overbooking cue remain.
- Blocks mode keeps its current explanation and does not render period values.

The read-only person schedule drawer remains its existing fixed 28-day view. It does not expand to
the strategic periods; the user guide must state this boundary so the six-column overview does not
imply a twelve-week drawer.

## Acceptance criteria

- [ ] Overview opens in 4-week mode with the existing four date ranges and values unchanged.
- [ ] Selecting **12 weeks** adds exactly the two strategic columns described above.
- [ ] Returning to **4 weeks** removes them without resetting other Overview controls or collapsed
      groups.
- [ ] Reopening or reloading Overview restores the default 4-week horizon.
- [ ] Monday- and Sunday-start accounts produce contiguous, correct period boundaries.
- [ ] Month and year rollovers retain correct ranges and understandable headings.
- [ ] The company timezone determines “today”; a local midnight/week rollover rebuilds all periods
      from the new date without retaining stale boundaries.
- [ ] Strategic cells aggregate precise daily values before quarter-day rounding.
- [ ] Tentative allocations, personal patterns, half-days, time off and closures affect strategic
      values under the same rules as tactical values.
- [ ] Bar fills use the configured-company-working-day denominator and preserve red priority when a
      period contains both free capacity and overbooking.
- [ ] Number and Bar & number modes display both free and overbooked values for a mixed period; Bar
      mode exposes the same information to assistive technology.
- [ ] **Has availability** and placeholder inclusion use the currently displayed, rounded periods
      and behave as specified when the horizon changes.
- [ ] Group totals contain the same number of periods as the table and retain their all-eligible-row
      scope while filtering.
- [ ] The table renders seven aligned columns in 12-week mode, including empty and grouped states;
      the toolbar does not clip, and keyboard users can reach overflowed cells.
- [ ] Existing Overview permissions and Blocks-mode behaviour are unchanged.
- [ ] The person schedule drawer remains a 28-day view and documentation describes that limit.

## Implementation sequence

### 1. Generalize the date model from weeks to displayed periods

Start from the “Four-week Overview” task-navigation entry in
`docs-src/reference/development.md` and read:

- `src/components/capacity-overview/capacityOverviewDates.ts`
- `src/components/capacity-overview/capacityOverviewTypes.ts`
- `src/components/capacity-overview/capacityOverviewModel.ts`
- `src/components/capacity-overview/capacityOverview.test.ts`

Represent the horizon explicitly and build either four or six periods. Prefer period-oriented names
where a type or function now represents both seven- and twenty-eight-day ranges; do not leave a
misleading public “week” contract merely to minimize edits. Preserve keys for the original four
columns where this avoids needless UI churn. Add focused date and aggregation tests before changing
rendering.

Verification:

```sh
source "$NVM_DIR/nvm.sh" && nvm use
node --version
pnpm exec vitest run src/components/capacity-overview/capacityOverview.test.ts
```

### 2. Add the horizon control and variable-period table

Read and update:

- `src/components/capacity-overview/CapacityOverviewView.tsx`
- `src/components/capacity-overview/OverviewToolbar.tsx`
- `src/components/capacity-overview/CapacityOverviewTable.tsx`
- `src/components/capacity-overview/CapacityOverviewTable.test.tsx`
- `messages/en.json` and regenerated Paraglide messages

Keep the horizon in `CapacityOverviewView`; pass it into model construction and expose the two-state
segmented control. Derive columns, widths, headings and empty-state span from the model's periods.
Preserve the table's header relationships and the toolbar's existing control state.

Verification:

```sh
source "$NVM_DIR/nvm.sh" && nvm use
node --version
pnpm run paraglide:compile
pnpm exec vitest run src/components/capacity-overview/CapacityOverviewTable.test.tsx
```

### 3. Verify bar, filter and responsive edge cases

Read and update focused tests around:

- `src/components/capacity-overview/capacityOverviewBar.ts`
- `src/components/capacity-overview/capacityOverviewBar.test.ts`
- `src/components/capacity-overview/capacityOverview.test.ts`
- `src/components/capacity-overview/CapacityOverviewTable.test.tsx`
- `e2e/capacity-overview.spec.ts`

Pin the 160-hour four-week denominator, the nineteen-free-day/one-closure 95% example, mixed
free/overbooked red priority, the aggregated quarter-day filter threshold, horizon toggle-back
behaviour, accessible strategic headings and constrained-width overflow. Keep E2E browser-agnostic.

### 4. Update the lasting product contract and user guide

Update together:

- `user-stories/REFERENCE.md` before changing the user-visible control labels
- `user-stories/capacity-overview/US-CAP-01-review-four-week-capacity.md`
- `docs-src/guide/capacity-overview.md`
- the Overview task-navigation entry in `docs-src/reference/development.md`
- `CHANGELOG.md` under **Unreleased**
- generated `docs/`

Describe tactical versus strategic periods, state lifetime, filter semantics, four-week totals and
the unchanged 28-day person drawer. Review existing Overview screenshots after all UI changes; if
the new control or table invalidates one, recapture it manually against the demo on port 5199 and
open the changed image before submission.

Verification:

```sh
source "$NVM_DIR/nvm.sh" && nvm use
node --version
pnpm run docs:build
```

### 5. Review and validate the complete change

This is a P2 frontend behaviour change. After focused tests pass, run formatting, type-checking and
linting, obtain the required independent code review, resolve blocking findings and repeat affected
static checks before E2E. Then run the Green gate suites sequentially enough to avoid local resource
contention:

```sh
source "$NVM_DIR/nvm.sh" && nvm use
node --version
pnpm run gate
pnpm run gate:server
pnpm run e2e
git diff --check
```

No Docker, schema, migration, server persistence, cross-browser or mutation work is in scope.

## Delivery and handoff

Implement on a fresh `feature/<short-description>` branch and sibling worktree from fetched
`origin/main`; do not implement in the primary checkout. One cohesive pull request may close #968.
Use signed commits and the normal merge flow in `AGENTS.md`.

The implementer returns:

- the base and final commit;
- changed files and any deliberate deviation from this plan;
- focused and full validation results tied to the tested commit;
- independent review findings and resolutions;
- documentation/screenshot disposition;
- pull request, CI, merge and issue state, clearly distinguished.
