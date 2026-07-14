import { describe, it, expect, beforeEach } from 'vitest'
import { hasActiveFilters, useStore } from './useStore'
import { resetStoreWithAccount, makeAppData, makeAccount } from '../test/fixtures'
import { addDaysISO, weekdayOf } from '@capacitylens/shared/lib/dateMath'
import { serializeData } from '@capacitylens/shared/data/transfer'
import { PAST_BUFFER_DAYS } from '../lib/schedulerConfig'

const s = () => useStore.getState()
beforeEach(() => resetStoreWithAccount())

const personDraft = {
  kind: 'person' as const,
  name: 'Ty',
  role: 'Dev',
  employmentType: 'permanent' as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5] as const,
  color: '#1',
}

describe('store CRUD', () => {
  it('adds entities with a generated id and timestamps', () => {
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    expect(r.id).toBeTruthy()
    expect(r.createdAt).toBeTruthy()
    expect(r.updatedAt).toBeTruthy()
    expect(s().data.resources).toHaveLength(1)
  })

  it('updates fields and bumps updatedAt', async () => {
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    await new Promise((res) => setTimeout(res, 2))
    s().updateResource(r.id, { name: 'Tyler' })
    const updated = s().data.resources[0]
    expect(updated.name).toBe('Tyler')
    expect(updated.updatedAt >= r.updatedAt).toBe(true)
  })

  it('rejects assigning a placeholder to an activity outside its bound project', () => {
    const client = s().addClient({ name: 'Acme', color: '#1' })
    const p1 = s().addProject({ name: 'P1', clientId: client.id, color: '#2' })
    const p2 = s().addProject({ name: 'P2', clientId: client.id, color: '#3' })
    const activityP2 = s().addActivity({ name: 'T2', kind: 'project', projectId: p2.id })
    const ph = s().addResource({
      kind: 'placeholder',
      role: 'Designer',
      employmentType: 'permanent',
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      color: '#1',
      projectId: p1.id,
    })
    expect(() =>
      s().addAllocation({ resourceId: ph.id, activityId: activityP2.id, startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' }),
    ).toThrow()
    expect(s().data.allocations).toHaveLength(0)
  })
})

describe('store scheduler UI', () => {
  it('setZoom sets the weeks-visible level', () => {
    s().setZoom(8)
    expect(s().ui.zoom).toBe(8)
    s().setZoom(1)
    expect(s().ui.zoom).toBe(1)
  })

  it('panDays shifts the origin', () => {
    s().setOriginDate('2026-06-01')
    s().panDays(7)
    expect(s().ui.originDate).toBe('2026-06-08')
  })

  it('setActiveAccount reopens on the current week (resets a panned origin/focus)', () => {
    s().setOriginDate('2020-01-01')
    // Re-selecting the (already active) account still runs the switch reset.
    s().setActiveAccount(s().activeAccountId)
    expect(s().ui.originDate).not.toBe('2020-01-01')
    expect(weekdayOf(s().ui.focusDate)).toBe(1) // this week's Monday
    // Origin sits the back-buffer earlier, so the past is scrollable to the left.
    expect(s().ui.originDate).toBe(addDaysISO(s().ui.focusDate, -PAST_BUFFER_DAYS))
  })

  it('signOutDemo drops the active company, the back-breadcrumb, and the fake flag', () => {
    // A company is active (resetStoreWithAccount). Turn the demo flag on, then sign out: it
    // must clear the active company AND previousAccountId — leaving the latter set would give
    // the re-shown picker a one-click "← Back to {company}", defeating the fresh "log in first,
    // then pick a company" intent.
    expect(s().activeAccountId).not.toBeNull()
    s().setFakeSignedIn(true)
    s().signOutDemo()
    expect(s().activeAccountId).toBeNull()
    expect(s().previousAccountId).toBeNull()
    expect(s().fakeSignedIn).toBe(false)
  })

  it('goToToday resets the origin and bumps recenterToken (so the grid re-scrolls)', () => {
    const before = s().ui.recenterToken
    s().setOriginDate('2020-01-01')
    s().goToToday()
    expect(s().ui.recenterToken).toBe(before + 1)
    expect(s().ui.originDate).not.toBe('2020-01-01')
    // Focus snaps to the current week's Monday (scrolled flush to the left edge);
    // origin sits the back-buffer earlier so last month stays reachable by scrolling.
    expect(weekdayOf(s().ui.focusDate)).toBe(1)
    expect(s().ui.originDate).toBe(addDaysISO(s().ui.focusDate, -PAST_BUFFER_DAYS))
  })

  it('setNotice sets and clears the transient message', () => {
    s().setNotice('Nope')
    expect(s().notice?.message).toBe('Nope')
    s().setNotice(null)
    expect(s().notice).toBeNull()
  })

  it('setNotice records severity (info default, error opt-in) so the UI can persist errors', () => {
    s().setNotice('Heads up')
    expect(s().notice?.tone).toBe('info')
    s().setNotice('Boom', 'error')
    expect(s().notice?.tone).toBe('error')
    // Clearing drops the whole notice (message + tone together — they can't desync).
    s().setNotice(null)
    expect(s().notice).toBeNull()
  })

  it('goToDate snaps focusDate to the week start and bumps recenterToken', () => {
    const before = s().ui.recenterToken
    // 2026-09-09 is a Wednesday (verified); with the default weekStartsOn=1 the picker
    // re-anchors the left edge to that week's Monday so the grid always opens on a week boundary.
    s().goToDate('2026-09-09')
    expect(weekdayOf(s().ui.focusDate)).toBe(1) // Monday
    expect(s().ui.focusDate).toBe('2026-09-07') // that week's Monday
    expect(s().ui.recenterToken).toBe(before + 1)
    // Origin sits the back-buffer behind the snapped Monday, so the past stays scrollable.
    expect(s().ui.originDate).toBe(addDaysISO('2026-09-07', -PAST_BUFFER_DAYS))
  })

  it('goToDate snaps to the account week start when weekStartsOn=0 (Sunday) — not a hardcoded Monday', () => {
    // Seed an account whose calendar week starts on SUNDAY and make it active. This guards a
    // regression where goToDate floored to Monday regardless of the account's weekStartsOn.
    const sunStart = 'acct-sun'
    useStore.getState().replaceAll(makeAppData({ accounts: [makeAccount({ id: sunStart, weekStartsOn: 0 })] }))
    useStore.getState().setActiveAccount(sunStart)
    // 2026-09-09 is a Wednesday (verified); the Sunday that starts its week is 2026-09-06 (verified).
    useStore.getState().goToDate('2026-09-09')
    expect(useStore.getState().ui.focusDate).toBe('2026-09-06') // that week's Sunday, NOT 09-07 (Monday)
    expect(weekdayOf(useStore.getState().ui.focusDate)).toBe(0) // 0 = Sunday
    // Origin sits the back-buffer behind the snapped Sunday, so the past stays scrollable.
    expect(useStore.getState().ui.originDate).toBe(addDaysISO('2026-09-06', -PAST_BUFFER_DAYS))
  })

  it('preserves the visible week when refreshing the currently loaded account', () => {
    s().goToDate('2026-09-09')
    const before = { originDate: s().ui.originDate, focusDate: s().ui.focusDate }

    s().replaceAll(makeAppData({ accounts: [makeAccount()] }))

    expect({ originDate: s().ui.originDate, focusDate: s().ui.focusDate }).toEqual(before)
  })

  it('re-anchors after the first slice for a selected account replaces the temporary fallback', () => {
    const accountId = 'late-account'
    s().setAccountSummaries([{ id: accountId, name: 'Late account', role: 'owner' }])
    s().setActiveAccount(accountId) // absent locally: temporarily anchored with GMT/Monday
    s().goToDate('2026-09-09')

    s().replaceAll(makeAppData({ accounts: [makeAccount({ id: accountId, weekStartsOn: 0 })] }))

    expect(weekdayOf(s().ui.focusDate)).toBe(0)
    expect(s().ui.focusDate).not.toBe('2026-09-06') // today's week, not the previously panned week
    expect(s().ui.originDate).toBe(addDaysISO(s().ui.focusDate, -PAST_BUFFER_DAYS))
  })

  it('setSnapToWeekStart persists to its own key, is OFF the undo stack, and is NOT in export', () => {
    // Device-global pref (default ON). Turning it off writes the 'off' literal and updates the
    // reactive store value.
    s().setSnapToWeekStart(false)
    expect(localStorage.getItem('capacitylens/snapToWeekStart')).toBe('off')
    expect(s().snapToWeekStart).toBe(false)

    // It is a device pref, NOT a data mutation, so undo must not revert it (mirrors theme /
    // minimiseWeekends — those never touch the undo/redo stack either).
    s().addClient({ name: 'Acme', color: '#1' }) // a real mutation to give undo something to pop
    s().undo()
    expect(s().snapToWeekStart).toBe(false) // still off — the pref rode through the undo untouched

    // And it never leaks into exported AppData (it lives on the store, not in `data`). Serialize the
    // active company's data the way the export/delete-backup paths do and confirm the key is absent —
    // same contract the e2e reload covers for theme / minimiseWeekends.
    const json = serializeData(s().data)
    expect(json).not.toContain('snapToWeekStart')
    expect(s().data).not.toHaveProperty('snapToWeekStart')

    // Restore the default — the store is a singleton, so leaving it off (and the 'off' key set)
    // would bleed into later specs that read the pref.
    s().setSnapToWeekStart(true)
  })

  it('setDrawMode toggles between work and time off', () => {
    s().setDrawMode('timeoff')
    expect(s().ui.drawMode).toBe('timeoff')
    s().setDrawMode('work')
    expect(s().ui.drawMode).toBe('work')
  })

  it('toggleGroup collapses and expands a discipline', () => {
    s().toggleGroup('d-design')
    expect(s().ui.collapsedGroups).toContain('d-design')
    s().toggleGroup('d-design')
    expect(s().ui.collapsedGroups).not.toContain('d-design')
  })

  it('undo and redo move through mutation history', () => {
    resetStoreWithAccount()
    const c = s().addClient({ name: 'Acme', color: '#1' })
    expect(s().data.clients).toHaveLength(1)
    s().undo()
    expect(s().data.clients).toHaveLength(0)
    s().redo()
    expect(s().data.clients).toHaveLength(1)
    expect(s().data.clients[0].id).toBe(c.id)
  })

  it('setFilters merges, hasActiveFilters reflects state, clearFilters resets', () => {
    s().clearFilters()
    expect(hasActiveFilters(s().ui.filters)).toBe(false)
    s().setFilters({ search: 'ty', hideTentative: true })
    expect(s().ui.filters.search).toBe('ty')
    expect(s().ui.filters.hideTentative).toBe(true)
    expect(hasActiveFilters(s().ui.filters)).toBe(true)
    s().clearFilters()
    expect(s().ui.filters.search).toBe('')
    expect(hasActiveFilters(s().ui.filters)).toBe(false)
  })
})
