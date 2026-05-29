import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DisciplineList } from './DisciplineList'
import { useStore } from '../../store/useStore'
import { emptyAppData } from '../../types/entities'

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData())
  useStore.getState().clearFilters()
})

describe('DisciplineList', () => {
  it('shows an empty state message when there are no disciplines', () => {
    render(<DisciplineList />)
    expect(screen.getByText(/no disciplines yet/i)).toBeInTheDocument()
  })

  it('lists disciplines that already exist in the store', () => {
    useStore.getState().addDiscipline({ name: 'Engineering', color: '#6366f1', sortOrder: 0 })
    useStore.getState().addDiscipline({ name: 'Design', color: '#ec4899', sortOrder: 1 })
    render(<DisciplineList />)
    expect(screen.getByText('Engineering')).toBeInTheDocument()
    expect(screen.getByText('Design')).toBeInTheDocument()
    expect(screen.getAllByTestId('discipline-row')).toHaveLength(2)
  })

  it('adds a discipline via the modal (fill Name, Save) and sees it listed', async () => {
    const user = userEvent.setup()
    render(<DisciplineList />)

    await user.click(screen.getByRole('button', { name: 'Add discipline' }))

    const dialog = screen.getByRole('dialog', { name: 'Add discipline' })
    expect(dialog).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Name'), 'Product')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Product')).toBeInTheDocument()
    expect(useStore.getState().data.disciplines).toHaveLength(1)
    expect(useStore.getState().data.disciplines[0].name).toBe('Product')
  })

  it('shows a validation error when trying to save without a name', async () => {
    const user = userEvent.setup()
    render(<DisciplineList />)

    await user.click(screen.getByRole('button', { name: 'Add discipline' }))
    const dialog = screen.getByRole('dialog', { name: 'Add discipline' })
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i)
    expect(useStore.getState().data.disciplines).toHaveLength(0)
  })

  it('edit renames a discipline', async () => {
    const user = userEvent.setup()
    useStore.getState().addDiscipline({ name: 'OldName', color: '#aabbcc', sortOrder: 0 })
    render(<DisciplineList />)

    const row = screen.getByTestId('discipline-row')
    await user.click(within(row).getByRole('button', { name: 'Edit' }))

    const dialog = screen.getByRole('dialog', { name: 'Edit discipline' })
    expect(dialog).toBeInTheDocument()

    const nameInput = within(dialog).getByLabelText('Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'NewName')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('OldName')).not.toBeInTheDocument()
    expect(screen.getByText('NewName')).toBeInTheDocument()
    expect(useStore.getState().data.disciplines[0].name).toBe('NewName')
  })

  it('delete opens a ConfirmDialog and removes it on confirm', async () => {
    const user = userEvent.setup()
    useStore.getState().addDiscipline({ name: 'ToDelete', color: '#ff0000', sortOrder: 0 })
    render(<DisciplineList />)

    expect(screen.getByText('ToDelete')).toBeInTheDocument()

    const row = screen.getByTestId('discipline-row')
    await user.click(within(row).getByRole('button', { name: 'Delete' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveTextContent(/delete discipline\?/i)
    expect(dialog).toHaveTextContent(/ToDelete/)

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('ToDelete')).not.toBeInTheDocument()
    expect(useStore.getState().data.disciplines).toHaveLength(0)
  })

  it('cancel on the delete ConfirmDialog keeps the discipline', async () => {
    const user = userEvent.setup()
    useStore.getState().addDiscipline({ name: 'KeepMe', color: '#00ff00', sortOrder: 0 })
    render(<DisciplineList />)

    const row = screen.getByTestId('discipline-row')
    await user.click(within(row).getByRole('button', { name: 'Delete' }))

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('KeepMe')).toBeInTheDocument()
    expect(useStore.getState().data.disciplines).toHaveLength(1)
  })
})
