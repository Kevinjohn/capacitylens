import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PermissionContext } from './permissionContext'
import { ListPage } from '../components/common/dialogs'
import { AllocationBar } from '../components/scheduler/AllocationBar'
import { buildColumnGeometry } from '../components/scheduler/columnGeometry'
import type { BarLayout } from '../components/scheduler/schedulerModel'
import { eachDayISO } from '@capacitylens/shared/lib/dateMath'
import { useStore } from '../store/useStore'
import { resetStoreWithAccount, makeResourceDraft } from '../test/fixtures'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import type { Allocation } from '@capacitylens/shared/types/entities'
import type { Role } from '@capacitylens/shared/domain/access'

// P1.12 — client permission gating. Two halves:
//   1) the useCanEdit affordance gate (ListPage Add, AllocationBar grips) — and the OFF/local
//      regression guard (provider ABSENT / role null → fully editable, byte-identical to today);
//   2) the store's defense-in-depth viewer guard (a viewer's add*/update*/delete* no-ops + notices;
//      null/editor/owner permit).
// The server 403 (P1.5) is the TRUE backstop; this suite only covers the client UX + the local guard.

/** Render `ui` inside a PermissionContext fixed to `role` (null = no provider equivalent / OFF/local). */
function withRole(role: Role | null, ui: ReactNode) {
  return render(<PermissionContext.Provider value={{ role }}>{ui}</PermissionContext.Provider>)
}

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData())
  useStore.getState().clearFilters()
  useStore.getState().setActiveRole(null)
  useStore.getState().setNotice(null)
})

// ─── useCanEdit affordance gate ──────────────────────────────────────────────

describe('useCanEdit gates the ListPage create affordance', () => {
  const onAdd = vi.fn()

  it('a viewer sees NO "Add" button', () => {
    withRole('viewer', <ListPage title="Clients" addLabel="Add client" onAdd={onAdd} />)
    expect(screen.queryByRole('button', { name: 'Add client' })).not.toBeInTheDocument()
  })

  it.each(['editor', 'owner', 'admin'] as const)('an %s sees the "Add" button', (role) => {
    withRole(role, <ListPage title="Clients" addLabel="Add client" onAdd={onAdd} />)
    expect(screen.getByRole('button', { name: 'Add client' })).toBeInTheDocument()
  })

  it('REGRESSION GUARD: role null (OFF/local/not-fetched) keeps the "Add" button', () => {
    withRole(null, <ListPage title="Clients" addLabel="Add client" onAdd={onAdd} />)
    expect(screen.getByRole('button', { name: 'Add client' })).toBeInTheDocument()
  })

  it('REGRESSION GUARD: NO provider at all keeps the "Add" button (default-editable)', () => {
    render(<ListPage title="Clients" addLabel="Add client" onAdd={onAdd} />)
    expect(screen.getByRole('button', { name: 'Add client' })).toBeInTheDocument()
  })
})

// ─── AllocationBar viewer → display-only (no resize grips) ────────────────────

describe('useCanEdit gates the AllocationBar resize grips', () => {
  const GEOM = buildColumnGeometry(eachDayISO('2026-06-01', '2026-06-30'), 48, { minimiseWeekends: false, weekendWidth: 22 })
  const indexAtClientX = (clientX: number) => GEOM.indexAt(clientX)
  const allocation: Allocation = {
    id: 'alloc-1',
    accountId: 'acct-test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    resourceId: 'res-1',
    activityId: 'activity-1',
    startDate: '2026-06-01',
    endDate: '2026-06-07',
    hoursPerDay: 8,
    status: 'confirmed',
  }
  const bar: BarLayout = { allocation, x: 0, width: 336, top: 0, color: '#ec4899', label: 'My Activity', external: false }

  it('a viewer bar has NO resize grips and is not an edit button', () => {
    withRole('viewer', <AllocationBar bar={bar} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />)
    expect(screen.queryByTestId('resize-start')).not.toBeInTheDocument()
    expect(screen.queryByTestId('resize-end')).not.toBeInTheDocument()
    // Display-only: role="img", not the interactive "button" an editor bar carries.
    expect(screen.getByTestId('allocation-bar')).toHaveAttribute('role', 'img')
  })

  it('an editor bar HAS resize grips and is an edit button', () => {
    withRole('editor', <AllocationBar bar={bar} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />)
    expect(screen.getByTestId('resize-start')).toBeInTheDocument()
    expect(screen.getByTestId('resize-end')).toBeInTheDocument()
    expect(screen.getByTestId('allocation-bar')).toHaveAttribute('role', 'button')
  })

  it('REGRESSION GUARD: role null / no provider keeps the grips (default-editable)', () => {
    render(<AllocationBar bar={bar} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />)
    expect(screen.getByTestId('resize-start')).toBeInTheDocument()
    expect(screen.getByTestId('resize-end')).toBeInTheDocument()
  })
})

// ─── Store defense-in-depth viewer guard ─────────────────────────────────────

describe('store viewer guard (defense-in-depth) no-ops a viewer mutation', () => {
  beforeEach(() => resetStoreWithAccount())

  it('add*/update*/delete* NO-OP for a viewer and surface a read-only notice', () => {
    useStore.getState().setActiveRole('viewer')

    // add: builds the entity (return type) but DOES NOT persist it.
    const r = useStore.getState().addResource(makeResourceDraft())
    expect(useStore.getState().data.resources).toHaveLength(0)
    expect(useStore.getState().notice?.message).toMatch(/read-only/i)

    // Seed a row directly (bypass the guard) so update/delete have a target, then prove they no-op.
    useStore.getState().setActiveRole(null)
    const seeded = useStore.getState().addResource(makeResourceDraft({ name: 'Seeded' }))
    expect(useStore.getState().data.resources).toHaveLength(1)

    useStore.getState().setActiveRole('viewer')
    useStore.getState().updateResource(seeded.id, { name: 'Renamed' })
    expect(useStore.getState().data.resources[0].name).toBe('Seeded') // unchanged

    useStore.getState().deleteResource(seeded.id)
    expect(useStore.getState().data.resources).toHaveLength(1) // still there

    // The viewer's add returned a non-persisted entity (its id isn't in state) — contained no-op.
    expect(useStore.getState().data.resources.some((x) => x.id === r.id)).toBe(false)
  })

  it.each([null, 'editor', 'owner', 'admin'] as const)('role %s PERMITS the mutation', (role) => {
    useStore.getState().setActiveRole(role)
    const r = useStore.getState().addResource(makeResourceDraft())
    expect(useStore.getState().data.resources.some((x) => x.id === r.id)).toBe(true)
  })

  it('importData no-ops for a viewer (zero-effect summary, slice untouched)', () => {
    useStore.getState().setActiveRole(null)
    useStore.getState().addResource(makeResourceDraft({ name: 'Existing' }))
    useStore.getState().setActiveRole('viewer')
    const summary = useStore.getState().importData({ ...emptyAppData(), resources: [] })
    expect(summary).toEqual({ imported: 0, skipped: 0 })
    expect(useStore.getState().data.resources).toHaveLength(1) // existing slice untouched
  })
})
