import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectForm } from './ProjectForm'
import { useStore } from '../../store/useStore'
import { resetStoreWithAccount } from '../../test/fixtures'

beforeEach(() => resetStoreWithAccount())

describe('ProjectForm', () => {
  it('refuses to save a project without a client', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ProjectForm onClose={onClose} />)

    await user.type(screen.getByLabelText('Name'), 'New Project')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/must belong to a client/i)
    expect(onClose).not.toHaveBeenCalled()
    expect(useStore.getState().data.projects).toHaveLength(0)
  })

  it('saves when a client is chosen', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    render(<ProjectForm onClose={onClose} />)

    await user.type(screen.getByLabelText('Name'), 'New Project')
    await user.selectOptions(screen.getByLabelText('Client'), client.id)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalled()
    expect(useStore.getState().data.projects).toHaveLength(1)
    expect(useStore.getState().data.projects[0].clientId).toBe(client.id)
  })
})
