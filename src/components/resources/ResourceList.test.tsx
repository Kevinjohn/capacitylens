import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResourceList } from './ResourceList'
import { useStore } from '../../store/useStore'
import { emptyAppData } from '../../types/entities'
import { WORKDAYS } from '../../test/fixtures'

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData())
  useStore.getState().clearFilters()
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

  it('shows a "Temp" tag for a freelancer resource', () => {
    useStore.getState().addResource(freelancerDraft('Bob'))
    render(<ResourceList />)
    const rows = screen.getAllByTestId('resource-row')
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(within(row).getByText('Temp')).toBeInTheDocument()
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
    // The placeholder's role is displayed as its name
    expect(within(row).getByText('Senior Designer')).toBeInTheDocument()
    // No "Temp" tag since it is permanent
    expect(within(row).queryByText('Temp')).not.toBeInTheDocument()
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

    // Bob row: Temp tag, no placeholder tag
    const bobRow = rows.find((r) => within(r).queryByText('Bob'))!
    expect(bobRow).toBeDefined()
    expect(within(bobRow).getByText('Temp')).toBeInTheDocument()
    expect(within(bobRow).queryByText('placeholder')).not.toBeInTheDocument()

    // Placeholder row: placeholder tag, no Temp tag
    const slotRow = rows.find((r) => within(r).queryByText('Senior Designer'))!
    expect(slotRow).toBeDefined()
    expect(within(slotRow).getByText('placeholder')).toBeInTheDocument()
    expect(within(slotRow).queryByText('Temp')).not.toBeInTheDocument()
  })
})

describe('ResourceList delete flow', () => {
  it('shows a confirm dialog when Delete is clicked and cancelling keeps the resource', async () => {
    const user = userEvent.setup()
    useStore.getState().addResource(personDraft('Alice'))
    render(<ResourceList />)

    expect(screen.getByText('Alice')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/Delete resource\?/i)
    expect(dialog).toHaveTextContent(/Alice/i)

    // Cancel keeps the resource
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(useStore.getState().data.resources).toHaveLength(1)
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('deletes a resource after confirming', async () => {
    const user = userEvent.setup()
    useStore.getState().addResource(personDraft('Alice'))
    render(<ResourceList />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(useStore.getState().data.resources).toHaveLength(0)
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('deletes the correct resource when multiple exist', async () => {
    const user = userEvent.setup()
    useStore.getState().addResource(personDraft('Alice'))
    useStore.getState().addResource(personDraft('Bob'))
    render(<ResourceList />)

    // Find the Bob row and click its Delete button
    const rows = screen.getAllByTestId('resource-row')
    const bobRow = rows.find((r) => within(r).queryByText('Bob'))!
    await user.click(within(bobRow).getByRole('button', { name: 'Delete' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/Bob/i)
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(useStore.getState().data.resources).toHaveLength(1)
    expect(useStore.getState().data.resources[0].name).toBe('Alice')
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
  })

  it('deletes a freelancer resource', async () => {
    const user = userEvent.setup()
    useStore.getState().addResource(freelancerDraft('Bob'))
    render(<ResourceList />)

    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Temp')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(useStore.getState().data.resources).toHaveLength(0)
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
    expect(screen.queryByText('Temp')).not.toBeInTheDocument()
  })

  it('deletes a placeholder resource', async () => {
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

    expect(screen.getByText('Senior Designer')).toBeInTheDocument()
    expect(screen.getByText('placeholder')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/Senior Designer/i)
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(useStore.getState().data.resources).toHaveLength(0)
    expect(screen.queryByText('Senior Designer')).not.toBeInTheDocument()
    expect(screen.queryByText('placeholder')).not.toBeInTheDocument()
  })
})
