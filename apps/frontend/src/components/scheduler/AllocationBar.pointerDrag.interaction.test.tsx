import { PlanningCacheError } from '@/data/planning/planningErrors'
import { getStubPlanningTransport } from '@/test/planningTransportHandle'
import { requireCreated } from '@/test/requireCreated'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, fireEvent, act } from '@testing-library/react'
import { AllocationBar } from './AllocationBar'
import { PermissionContext } from '@/auth/permissionContext'
import { useStore } from '@/store/useStore'
import type { Allocation, Weekday } from '@capacitylens/shared/types/entities'
import {
  resetStoreWithCompany,
  DEFAULT_COMPANY_ID,
  makeResourceDraft,
  setPlanningAccess,
} from '@/test/fixtures'
import { renderWithOwnerAndTooltip as render, GEOM, indexAtClientX } from '@/test/schedulerTestKit'

import { queuePlanningPatch } from '@/test/planning/queuePlanningPatch'
import {
  barFor,
  getStoredAllocation,
  laneRect,
  rect,
  createActivityScaffold,
  createAllocation,
  settlePlanning,
} from '@/test/allocationBarInteractionTestKit'
import { permissionValue } from '@/test/permissionGrants'

beforeEach(async () => resetStoreWithCompany())

const workingDayRejectionCases = [
  {
    boundary: 'personal',
    companyWorkingDays: [1, 2, 3, 4, 5] as Weekday[],
    targetWorkingDays: [1, 2, 3] as Weekday[],
  },
  {
    boundary: 'company',
    companyWorkingDays: [1, 2, 3, 4] as Weekday[],
    targetWorkingDays: [1, 2, 3, 4, 5] as Weekday[],
  },
  {
    boundary: 'zero-overlap',
    companyWorkingDays: [1, 2, 3, 4] as Weekday[],
    targetWorkingDays: [5] as Weekday[],
  },
]

function renderReassignmentLanes(sourceId: string, destinationId: string, allocation: Allocation) {
  render(
    <>
      <div data-resource-id={sourceId} data-testid="lane-src" />
      <div data-resource-id={destinationId} data-testid="lane-dst" />
      <AllocationBar
        bar={barFor(allocation)}
        geom={GEOM}
        indexAtClientX={indexAtClientX}
        onEdit={vi.fn()}
      />
    </>
  )
  screen.getByTestId('lane-src').getBoundingClientRect = () => laneRect(0, 50)
  screen.getByTestId('lane-dst').getBoundingClientRect = () => laneRect(100, 150)
}

async function verifyWorkingDayRefusal({
  companyWorkingDays,
  targetWorkingDays,
}: (typeof workingDayRejectionCases)[number]) {
  const st = useStore.getState()
  await st.updateCompany(DEFAULT_COMPANY_ID, { workingDays: companyWorkingDays })
  const { activity } = await createActivityScaffold()
  const source = await requireCreated(
    st.addResource({
      kind: 'person',
      name: 'Jess Chambers',
      jobTitle: 'Dev',
      employmentType: 'permanent',
      engagement: 'studio' as const,
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: '#3',
    })
  )
  const destination = await requireCreated(
    st.addResource({
      kind: 'person',
      name: 'Marie Moreau',
      jobTitle: 'PM',
      employmentType: 'permanent',
      engagement: 'studio' as const,
      workingHoursPerDay: 8,
      workingDays: targetWorkingDays,
      halfDays: [],
      color: '#4',
    })
  )
  const allocation = requireCreated(
    await st.addAllocation({
      resourceId: source.id,
      activityId: activity.id,

      startDate: '2026-06-05',
      endDate: '2026-06-05',
      hoursPerDay: 8,
      status: 'confirmed',
    })
  )

  renderReassignmentLanes(source.id, destination.id, allocation)

  const bar = screen.getByTestId('allocation-bar')
  fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 })
  document.dispatchEvent(
    new MouseEvent('pointermove', { clientX: 50, clientY: 125, bubbles: true })
  )
  expect(screen.getByTestId('lane-dst')).not.toHaveAttribute('data-droptarget')
  document.dispatchEvent(new MouseEvent('pointerup', { clientX: 50, clientY: 125, bubbles: true }))
  await settlePlanning()

  expect(
    useStore.getState().data.allocations.find((candidate) => candidate.id === allocation.id)
  ).toMatchObject({
    resourceId: source.id,
    startDate: '2026-06-05',
    endDate: '2026-06-05',
  })
  expect(useStore.getState().notice).toMatchObject({
    message: 'That allocation cannot start there because it is not a working day.',
    tone: 'error',
  })
}

describe('AllocationBar pointer drag and reassignment interactions', () => {
  it('appends the save reply capacity advisory to the move toast', async () => {
    const a = await createAllocation()
    render(
      <AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />
    )
    queuePlanningPatch(
      (execution) => {
        if (execution.intent.operation !== 'allocation.update') {
          throw new Error('Expected an update.')
        }
        const row = { ...a, ...execution.intent.changes } as Allocation
        return { removed: [], upserts: [{ entity: 'allocations', row }] }
      },
      { advisory: { overDays: 2, timeOffDays: 0 } }
    )

    fireEvent.pointerDown(screen.getByTestId('allocation-bar'), { clientX: 50, button: 0 })
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 98, bubbles: true }))
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 98, bubbles: true }))
    await settlePlanning()

    expect(useStore.getState().notice?.message).toMatch(
      /^Allocation moved — now over capacity on 2 days\. Press .+ to undo\.$/
    )
  })

  it('does not report a successful move when permission drops to Viewer mid-drag', async () => {
    const a = await createAllocation()
    const barUi = (role: 'editor' | 'viewer') => (
      <PermissionContext.Provider value={permissionValue(role, 'resolved')}>
        <AllocationBar
          bar={barFor(a)}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />
      </PermissionContext.Provider>
    )
    const { rerender } = render(barUi('editor'))
    const bar = screen.getByTestId('allocation-bar')

    fireEvent.pointerDown(bar, { clientX: 50, button: 0 })
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 98, bubbles: true }))
    act(() => setPlanningAccess({ role: 'viewer', canWrite: false }))
    rerender(barUi('viewer'))
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 98, bubbles: true }))
    await settlePlanning()

    expect(useStore.getState().data.allocations.find((row) => row.id === a.id)).toMatchObject({
      startDate: '2026-06-01',
      endDate: '2026-06-03',
    })
    expect(useStore.getState().notice).toMatchObject({ tone: 'error' })
    expect(useStore.getState().notice?.message).not.toMatch(/moved|reassigned|undo/i)
  })
  it('leaves assignee, dates and hours unchanged when a diagonal reassign is rejected', async () => {
    const st = useStore.getState()
    const { client: c, activity: t1 } = await createActivityScaffold()
    const p2 = await requireCreated(st.addProject({ name: 'P2', clientId: c.id, color: '#3' }))
    const person = await requireCreated(
      st.addResource(makeResourceDraft({ name: 'Ty', jobTitle: 'Dev', color: '#3' }))
    )
    // A placeholder bound to p2 cannot take a p1 activity, dropping onto it must be rejected.
    const slot = await requireCreated(
      st.addResource({
        kind: 'placeholder',
        jobTitle: 'Slot',
        employmentType: 'permanent',
        engagement: 'studio' as const,
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: '#4',
        projectId: p2.id,
      })
    )
    const a = requireCreated(
      await st.addAllocation({
        resourceId: person.id,
        activityId: t1.id,
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        hoursPerDay: 8,
        status: 'confirmed',
      })
    )

    render(
      <>
        <div data-resource-id={person.id} data-testid="lane-src" />
        <div data-resource-id={slot.id} data-testid="lane-dst" />
        <AllocationBar
          bar={barFor(a)}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />
      </>
    )
    screen.getByTestId('lane-src').getBoundingClientRect = () => rect(0, 50)
    screen.getByTestId('lane-dst').getBoundingClientRect = () => rect(100, 150)

    // The server owns availability and attribution; the browser surfaces its refusal.
    getStubPlanningTransport().failNext(
      new PlanningCacheError(
        'A placeholder bound to a project can only take activities from that project.',
        undefined,
        422
      )
    )
    const bar = screen.getByTestId('allocation-bar')
    fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 })
    // Cross both a row and a date boundary: rejecting the target must reject the complete gesture,
    // not silently retain its horizontal source-row move.
    document.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 98, clientY: 125, bubbles: true })
    )
    document.dispatchEvent(
      new MouseEvent('pointerup', { clientX: 98, clientY: 125, bubbles: true })
    )
    await settlePlanning()

    const alloc = getStoredAllocation(a.id)
    expect(alloc).toMatchObject({
      resourceId: person.id,
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      hoursPerDay: 8,
    })
    expect(useStore.getState().notice?.message).toMatch(/placeholder/i)
  })
  it.each(workingDayRejectionCases)(
    'rejects a purely vertical drop onto a $boundary non-working start date',
    verifyWorkingDayRefusal
  )
  it('allows that literal vertical drop when the allocation ignores working days', async () => {
    const st = useStore.getState()
    await st.updateCompany(DEFAULT_COMPANY_ID, { workingDays: [1, 2, 3, 4] })
    const { activity } = await createActivityScaffold()
    const source = await requireCreated(
      st.addResource({
        kind: 'person',
        name: 'Jess Chambers',
        jobTitle: 'Dev',
        employmentType: 'permanent',
        engagement: 'studio' as const,
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: '#3',
      })
    )
    const destination = await requireCreated(
      st.addResource({
        kind: 'person',
        name: 'Marie Moreau',
        jobTitle: 'PM',
        employmentType: 'permanent',
        engagement: 'studio' as const,
        workingHoursPerDay: 8,
        workingDays: [5],
        halfDays: [],
        color: '#4',
      })
    )
    const allocation = requireCreated(
      await st.addAllocation({
        resourceId: source.id,
        activityId: activity.id,
        // The Friday destination has no effective weekdays under the company’s Monday-through-Thursday schedule.
        startDate: '2026-06-05',
        endDate: '2026-06-05',
        hoursPerDay: 8,
        status: 'confirmed',
        ignoreWorkingDays: true,
      })
    )

    render(
      <>
        <div data-resource-id={source.id} data-testid="lane-src" />
        <div data-resource-id={destination.id} data-testid="lane-dst" />
        <AllocationBar
          bar={barFor(allocation)}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />
      </>
    )
    screen.getByTestId('lane-src').getBoundingClientRect = () => laneRect(0, 50)
    screen.getByTestId('lane-dst').getBoundingClientRect = () => laneRect(100, 150)

    const bar = screen.getByTestId('allocation-bar')
    fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 })
    document.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 50, clientY: 125, bubbles: true })
    )
    expect(screen.getByTestId('lane-dst')).toHaveAttribute('data-droptarget', '')
    document.dispatchEvent(
      new MouseEvent('pointerup', { clientX: 50, clientY: 125, bubbles: true })
    )
    await settlePlanning()

    expect(
      useStore.getState().data.allocations.find((candidate) => candidate.id === allocation.id)
    ).toMatchObject({
      resourceId: destination.id,
      startDate: '2026-06-05',
      endDate: '2026-06-05',
      ignoreWorkingDays: true,
    })
  })
  it('updates a vertical drag without a trailing transform transition', async () => {
    const allocation = await createAllocation()
    render(
      <AllocationBar
        bar={barFor(allocation)}
        geom={GEOM}
        indexAtClientX={indexAtClientX}
        onEdit={vi.fn()}
      />
    )
    const bar = screen.getByTestId('allocation-bar')

    expect(bar).toHaveClass('transition-shadow')
    expect(bar.className).not.toContain('transition-[box-shadow,transform]')
    fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 })
    act(() => {
      document.dispatchEvent(
        new MouseEvent('pointermove', { clientX: 50, clientY: 75, bubbles: true })
      )
    })
    expect(bar).toHaveStyle({ transform: 'translateY(50px)' })
    act(() => {
      document.dispatchEvent(new Event('pointercancel'))
    })
  })

  it('assigns a shared lane-boundary drop to the following lane', async () => {
    const st = useStore.getState()
    const { activity } = await createActivityScaffold()
    const source = await requireCreated(
      st.addResource(makeResourceDraft({ name: 'Ty', jobTitle: 'Dev', color: '#3' }))
    )
    const destination = await requireCreated(
      st.addResource({
        kind: 'person',
        name: 'Sam',
        jobTitle: 'Dev',
        employmentType: 'permanent',
        engagement: 'studio' as const,
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: '#4',
      })
    )
    const allocation = requireCreated(
      await st.addAllocation({
        resourceId: source.id,
        activityId: activity.id,
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        hoursPerDay: 8,
        status: 'confirmed',
      })
    )

    render(
      <>
        <div data-resource-id={source.id} data-testid="lane-src" />
        <div data-resource-id={destination.id} data-testid="lane-dst" />
        <AllocationBar
          bar={barFor(allocation)}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />
      </>
    )
    screen.getByTestId('lane-src').getBoundingClientRect = () => rect(0, 50)
    screen.getByTestId('lane-dst').getBoundingClientRect = () => rect(50, 100)

    const bar = screen.getByTestId('allocation-bar')
    fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 })
    document.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 55, clientY: 50, bubbles: true })
    )
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 55, clientY: 50, bubbles: true }))
    await settlePlanning()

    expect(
      useStore.getState().data.allocations.find((row) => row.id === allocation.id)?.resourceId
    ).toBe(destination.id)
  })
  it('keeps an External block at zero hours when it is reassigned to a person', async () => {
    const st = useStore.getState()
    await st.updateCompany(DEFAULT_COMPANY_ID, { schedulingMode: 'blocks' })
    const { activity } = await createActivityScaffold()
    const external = await requireCreated(
      st.addResource({
        kind: 'external',
        name: 'Kord Industries',
        jobTitle: 'Partner studio',
        employmentType: 'permanent',
        engagement: 'studio' as const,
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: '#3',
      })
    )
    const person = await requireCreated(
      st.addResource(makeResourceDraft({ name: 'Ty', jobTitle: 'Dev', color: '#4' }))
    )
    const allocation = requireCreated(
      await st.addAllocation({
        resourceId: external.id,
        activityId: activity.id,
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        hoursPerDay: 0,
        status: 'confirmed',
        ignoreWorkingDays: true,
      })
    )

    render(
      <>
        <div data-resource-id={external.id} data-testid="lane-src" />
        <div data-resource-id={person.id} data-testid="lane-dst" />
        <AllocationBar
          bar={{ ...barFor(allocation), external: true }}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />
      </>
    )
    screen.getByTestId('lane-src').getBoundingClientRect = () => rect(0, 50)
    screen.getByTestId('lane-dst').getBoundingClientRect = () => rect(100, 150)

    const bar = screen.getByTestId('allocation-bar')
    fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 })
    document.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 55, clientY: 125, bubbles: true })
    )
    document.dispatchEvent(
      new MouseEvent('pointerup', { clientX: 55, clientY: 125, bubbles: true })
    )
    await settlePlanning()

    // The drop names only the target and dates; the server decides the load it carries.
    expect(getStubPlanningTransport().calls.at(-1)).toEqual({
      operation: 'allocation.reassign',
      id: allocation.id,
      resourceId: person.id,
      startDate: '2026-06-01',
      endDate: '2026-06-03',
    })
    expect(
      useStore.getState().data.allocations.find((row) => row.id === allocation.id)
    ).toMatchObject({
      resourceId: person.id,
      hoursPerDay: 0,
    })
  })
  it.each(['scroll', 'resize'] as const)(
    'uses post-%s lane rectangles when pointerup precedes the queued animation frame',
    async (geometryEvent) => {
      const requestFrame = vi
        .spyOn(globalThis, 'requestAnimationFrame')
        .mockImplementation(() => 47)
      const cancelFrame = vi
        .spyOn(globalThis, 'cancelAnimationFrame')
        .mockImplementation(() => undefined)
      try {
        const st = useStore.getState()
        const { activity: t } = await createActivityScaffold()
        const r1 = await requireCreated(
          st.addResource(makeResourceDraft({ name: 'Ty', jobTitle: 'Dev', color: '#3' }))
        )
        const r2 = await requireCreated(
          st.addResource({
            kind: 'person',
            name: 'Sam',
            jobTitle: 'Dev',
            employmentType: 'permanent',
            engagement: 'studio' as const,
            workingHoursPerDay: 8,
            workingDays: [1, 2, 3, 4, 5],
            halfDays: [],
            color: '#4',
          })
        )
        const a = requireCreated(
          await st.addAllocation({
            resourceId: r1.id,
            activityId: t.id,
            startDate: '2026-06-01',
            endDate: '2026-06-03',
            hoursPerDay: 8,
            status: 'confirmed',
          })
        )

        render(
          <>
            <div data-resource-id={r1.id} data-testid="lane-src" />
            <div data-resource-id={r2.id} data-testid="lane-dst" />
            <AllocationBar
              bar={barFor(a)}
              geom={GEOM}
              indexAtClientX={indexAtClientX}
              onEdit={vi.fn()}
            />
          </>
        )
        let geometryChanged = false
        screen.getByTestId('lane-src').getBoundingClientRect = () =>
          geometryChanged ? rect(100, 150) : rect(0, 50)
        screen.getByTestId('lane-dst').getBoundingClientRect = () =>
          geometryChanged ? rect(200, 250) : rect(100, 150)

        const bar = screen.getByTestId('allocation-bar')
        fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 })
        document.dispatchEvent(
          new MouseEvent('pointermove', { clientX: 55, clientY: 125, bubbles: true })
        )
        expect(screen.getByTestId('lane-dst')).toHaveAttribute('data-droptarget')

        geometryChanged = true
        const eventTarget = geometryEvent === 'scroll' ? document : window
        eventTarget.dispatchEvent(new Event(geometryEvent))
        expect(requestFrame).toHaveBeenCalledOnce()
        document.dispatchEvent(
          new MouseEvent('pointerup', { clientX: 55, clientY: 225, bubbles: true })
        )
        await settlePlanning()

        expect(cancelFrame).toHaveBeenCalledWith(47)
        expect(getStoredAllocation(a.id).resourceId).toBe(r2.id)
      } finally {
        requestFrame.mockRestore()
        cancelFrame.mockRestore()
      }
    }
  )
})
