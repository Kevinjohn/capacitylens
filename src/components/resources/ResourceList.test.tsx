import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResourceList } from './ResourceList'
import { useStore } from '../../store/useStore'
import { WORKDAYS, resetStoreWithAccount, setPlaceholdersEnabled } from '../../test/fixtures'

beforeEach(() => {
  resetStoreWithAccount()
  useStore.getState().clearFilters()
  // Placeholders are gated behind a per-account pref that defaults OFF. Most tests here exercise
  // the placeholder management section, so enable it for the suite; the default-OFF hide behaviour
  // has its own dedicated test below.
  setPlaceholdersEnabled(true)
})

// Shared resource shape helpers
const personDraft = (name: string) => ({
  kind: 'person' as const,
  name,
  role: 'Developer',
  employmentType: 'permanent' as const,
  workingHoursPerDay: 8,
  workingDays: WORKDAYS,
  color: '#3b82f6',
})

const freelancerDraft = (name: string) => ({
  kind: 'person' as const,
  name,
  role: 'Designer',
  employmentType: 'freelancer' as const,
  workingHoursPerDay: 8,
  workingDays: WORKDAYS,
  color: '#f59e0b',
})

describe('ResourceList display', () => {
  it('shows an empty state when no resources exist', () => {
    render(<ResourceList />)
    expect(screen.getByText(/No resources yet/i)).toBeInTheDocument()
  })

  it('shows the name of a person resource', () => {
    useStore.getState().addResource(personDraft('Alice'))
    render(<ResourceList />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('does not show a "placeholder" tag or "Temp" tag for a permanent person', () => {
    useStore.getState().addResource(personDraft('Alice'))
    render(<ResourceList />)
    const rows = screen.getAllByTestId('resource-row')
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(within(row).queryByText('placeholder')).not.toBeInTheDocument()
    expect(within(row).queryByText('Temp')).not.toBeInTheDocument()
  })

  it('renders a freelancer with NO "Temp" tag (the pill is parked — see NEEDS-INPUT.md)', () => {
    useStore.getState().addResource(freelancerDraft('Bob'))
    render(<ResourceList />)
    const rows = screen.getAllByTestId('resource-row')
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(within(row).queryByText('Temp')).not.toBeInTheDocument()
    expect(within(row).queryByText('placeholder')).not.toBeInTheDocument()
  })

  it('shows a "placeholder" tag for a placeholder resource and its role as its label', () => {
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'ProjectX', clientId: client.id, color: '#222' })
    useStore.getState().addResource({
      kind: 'placeholder',
      role: 'Senior Designer',
      employmentType: 'permanent' as const,
      workingHoursPerDay: 8,
      workingDays: WORKDAYS,
      color: '#a855f7',
      projectId: project.id,
    })
    render(<ResourceList />)
    const rows = screen.getAllByTestId('resource-row')
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(within(row).getByText('placeholder')).toBeInTheDocument()
    // The placeholder's NAME shows as the literal "Placeholder"; its role is in the secondary text.
    expect(within(row).getByText('Placeholder')).toBeInTheDocument()
    expect(within(row).getByText(/Senior Designer/)).toBeInTheDocument()
    // No "Temp" tag since it is permanent
    expect(within(row).queryByText('Temp')).not.toBeInTheDocument()
  })

  it('hides the Placeholders section + its placeholders when the pref is OFF (default)', () => {
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'ProjectX', clientId: client.id, color: '#222' })
    useStore.getState().addResource(personDraft('Alice'))
    useStore.getState().addResource({
      kind: 'placeholder',
      role: 'Senior Designer',
      employmentType: 'permanent' as const,
      workingHoursPerDay: 8,
      workingDays: WORKDAYS,
      color: '#a855f7',
      projectId: project.id,
    })
    // Turn the feature off — the placeholder data still exists, it's just hidden.
    setPlaceholdersEnabled(false)
    render(<ResourceList />)
    // The person still renders; the placeholder section/heading/row do not.
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('Placeholders')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add placeholder/i })).not.toBeInTheDocument()
    expect(screen.queryByText('placeholder')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('resource-row')).toHaveLength(1)
  })

  it('renders all three resource types together', () => {
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'ProjectX', clientId: client.id, color: '#222' })

    useStore.getState().addResource(personDraft('Alice'))
    useStore.getState().addResource(freelancerDraft('Bob'))
    useStore.getState().addResource({
      kind: 'placeholder',
      role: 'Senior Designer',
      employmentType: 'permanent' as const,
      workingHoursPerDay: 8,
      workingDays: WORKDAYS,
      color: '#a855f7',
      projectId: project.id,
    })

    render(<ResourceList />)

    const rows = screen.getAllByTestId('resource-row')
    expect(rows).toHaveLength(3)

    // Alice row: no tags
    const aliceRow = rows.find((r) => within(r).queryByText('Alice'))!
    expect(aliceRow).toBeDefined()
    expect(within(aliceRow).queryByText('placeholder')).not.toBeInTheDocument()
    expect(within(aliceRow).queryByText('Temp')).not.toBeInTheDocument()

    // Bob row (freelancer): no tags either — the Temp pill is parked
    const bobRow = rows.find((r) => within(r).queryByText('Bob'))!
    expect(bobRow).toBeDefined()
    expect(within(bobRow).queryByText('Temp')).not.toBeInTheDocument()
    expect(within(bobRow).queryByText('placeholder')).not.toBeInTheDocument()

    // Placeholder row: placeholder tag, no Temp tag (role "Senior Designer" is in its secondary text)
    const slotRow = rows.find((r) => within(r).queryByText(/Senior Designer/))!
    expect(slotRow).toBeDefined()
    expect(within(slotRow).getByText('placeholder')).toBeInTheDocument()
    expect(within(slotRow).getByText('Placeholder')).toBeInTheDocument()
    expect(within(slotRow).queryByText('Temp')).not.toBeInTheDocument()
  })
})

// P2.5b: the per-row "Delete" affordance now ARCHIVES (the simplest coherent flow — soft-delete is
// reached LATER from Settings → Archived & deleted on an archived row). LOCAL mode here, so it calls
// the store's archiveEntity: the row gets `archivedAt` set (still in `data`) and vanishes from this
// list (which reads useActiveScopedData → active-only). The button + confirm copy read "Archive".
describe('ResourceList archive flow', () => {
  it('shows an Archive confirm dialog and cancelling keeps the resource visible', async () => {
    const user = userEvent.setup()
    useStore.getState().addResource(personDraft('Alice'))
    render(<ResourceList />)

    expect(screen.getByText('Alice')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Archive Alice' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/Archive resource\?/i)
    expect(dialog).toHaveTextContent(/Alice/i)

    // Cancel keeps the resource active + visible.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(useStore.getState().data.resources).toHaveLength(1)
    expect(useStore.getState().data.resources[0].archivedAt).toBeUndefined()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('archives a resource after confirming (kept in data, hidden from the list)', async () => {
    const user = userEvent.setup()
    useStore.getState().addResource(personDraft('Alice'))
    render(<ResourceList />)

    await user.click(screen.getByRole('button', { name: 'Archive Alice' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))

    // Still in the data (archived, not destroyed) but hidden from the active-only list.
    expect(useStore.getState().data.resources).toHaveLength(1)
    expect(useStore.getState().data.resources[0].archivedAt).toBeTruthy()
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('archives the correct resource when multiple exist', async () => {
    const user = userEvent.setup()
    useStore.getState().addResource(personDraft('Alice'))
    useStore.getState().addResource(personDraft('Bob'))
    render(<ResourceList />)

    // Find the Bob row and click its Archive button.
    const rows = screen.getAllByTestId('resource-row')
    const bobRow = rows.find((r) => within(r).queryByText('Bob'))!
    await user.click(within(bobRow).getByRole('button', { name: 'Archive Bob' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/Bob/i)
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))

    // Alice stays active + visible; Bob is archived (still in data) and gone from the list.
    const bob = useStore.getState().data.resources.find((r) => r.name === 'Bob')!
    expect(bob.archivedAt).toBeTruthy()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
  })

  it('archives a freelancer resource', async () => {
    const user = userEvent.setup()
    useStore.getState().addResource(freelancerDraft('Bob'))
    render(<ResourceList />)

    expect(screen.getByText('Bob')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Archive Bob' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))

    expect(useStore.getState().data.resources[0].archivedAt).toBeTruthy()
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
  })

  it('archives a placeholder resource', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'ProjectX', clientId: client.id, color: '#222' })
    useStore.getState().addResource({
      kind: 'placeholder',
      role: 'Senior Designer',
      employmentType: 'permanent' as const,
      workingHoursPerDay: 8,
      workingDays: WORKDAYS,
      color: '#a855f7',
      projectId: project.id,
    })
    render(<ResourceList />)

    // The placeholder's name shows as the literal "Placeholder"; its role ("Senior Designer") is in
    // the secondary text. Match the role with a substring matcher since it's combined with the rest.
    expect(screen.getByText('Placeholder')).toBeInTheDocument()
    expect(screen.getByText(/Senior Designer/)).toBeInTheDocument()
    expect(screen.getByText('placeholder')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Archive Placeholder' }))
    const dialog = screen.getByRole('dialog')
    // The confirm dialog names the placeholder by its DISPLAY name ("Placeholder"), matching the
    // row above it — not its role ("Senior Designer"), which would read inconsistently.
    expect(dialog).toHaveTextContent(/Archive "Placeholder"/i)
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))

    expect(useStore.getState().data.resources[0].archivedAt).toBeTruthy()
    expect(screen.queryByText('Placeholder')).not.toBeInTheDocument()
    expect(screen.queryByText('placeholder')).not.toBeInTheDocument()
  })
})
