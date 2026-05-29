import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResourceForm } from './ResourceForm'
import { useStore } from '../../store/useStore'
import { emptyAppData } from '../../types/entities'

beforeEach(() => useStore.getState().replaceAll(emptyAppData()))

describe('ResourceForm placeholder binding', () => {
  it('requires a placeholder to be bound to a project', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ResourceForm onClose={onClose} />)

    await user.selectOptions(screen.getByLabelText('Type'), 'placeholder')
    await user.type(screen.getByLabelText('Role'), 'Senior Designer')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/bound to a project/i)
    expect(onClose).not.toHaveBeenCalled()
    expect(useStore.getState().data.resources).toHaveLength(0)
  })

  it('saves a placeholder once a bound project is chosen', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'Lightning', clientId: client.id, color: '#222' })
    render(<ResourceForm onClose={onClose} />)

    await user.selectOptions(screen.getByLabelText('Type'), 'placeholder')
    await user.type(screen.getByLabelText('Role'), 'Senior Designer')
    await user.selectOptions(screen.getByLabelText('Bound project'), project.id)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalled()
    const resources = useStore.getState().data.resources
    expect(resources).toHaveLength(1)
    expect(resources[0].kind).toBe('placeholder')
    expect(resources[0].projectId).toBe(project.id)
  })
})
