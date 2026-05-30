import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Button,
  Modal,
  ConfirmDialog,
  ListPage,
  EmptyState,
  FieldError,
  TextField,
  TextAreaField,
  NumberField,
  DateField,
  SelectField,
  ColorField,
  WeekdayPicker,
  TemporaryTag,
  ColorSwatch,
  Avatar,
} from './ui'
import { useStore } from '../../store/useStore'
import { emptyAppData } from '../../types/entities'
import type { Resource } from '../../types/entities'
import { WORKDAYS } from '../../test/fixtures'

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData())
  useStore.getState().clearFilters()
})

// ─── Button ────────────────────────────────────────────────────────────────

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    await user.click(screen.getByRole('button', { name: 'Go' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not call onClick when disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick} disabled>Go</Button>)
    const btn = screen.getByRole('button', { name: 'Go' })
    expect(btn).toBeDisabled()
    await user.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders primary variant by default', () => {
    render(<Button>Primary</Button>)
    // Primary has a specific class; just verify it renders without crashing and text is there
    expect(screen.getByRole('button', { name: 'Primary' })).toBeInTheDocument()
  })

  it('renders ghost variant', () => {
    render(<Button variant="ghost">Ghost</Button>)
    expect(screen.getByRole('button', { name: 'Ghost' })).toBeInTheDocument()
  })

  it('renders danger variant', () => {
    render(<Button variant="danger">Danger</Button>)
    expect(screen.getByRole('button', { name: 'Danger' })).toBeInTheDocument()
  })
})

// ─── Modal ─────────────────────────────────────────────────────────────────

describe('Modal', () => {
  it('renders with the given title as dialog label', () => {
    render(
      <Modal title="My Modal" onClose={vi.fn()}>
        <p>Content</p>
      </Modal>,
    )
    expect(screen.getByRole('dialog', { name: 'My Modal' })).toBeInTheDocument()
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('exposes the title as a navigable heading (aria-labelledby)', () => {
    render(
      <Modal title="Heady" onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    )
    expect(screen.getByRole('heading', { name: 'Heady' })).toBeInTheDocument()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(
      <Modal title="Esc Modal" onClose={onClose}>
        <p>Body</p>
      </Modal>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes when a press both starts and ends on the backdrop', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal title="Backdrop Modal" onClose={onClose}>
        <p>Inner</p>
      </Modal>,
    )
    const backdrop = container.firstChild as HTMLElement
    fireEvent.mouseDown(backdrop)
    fireEvent.mouseUp(backdrop)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does NOT close on a bare mousedown (needs the matching mouseup)', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal title="Backdrop Modal" onClose={onClose}>
        <p>Inner</p>
      </Modal>,
    )
    fireEvent.mouseDown(container.firstChild as HTMLElement)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does NOT close when a drag starts inside and releases on the backdrop', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal title="No-close Modal" onClose={onClose}>
        <p>Inner</p>
      </Modal>,
    )
    const backdrop = container.firstChild as HTMLElement
    const dialog = screen.getByRole('dialog', { name: 'No-close Modal' })
    // Press begins on the dialog, drag-releases over the backdrop — must not dismiss.
    fireEvent.mouseDown(dialog)
    fireEvent.mouseUp(backdrop)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('refuses an accidental backdrop/Escape dismissal once a field is edited', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal title="Dirty Modal" onClose={onClose}>
        <input aria-label="field" />
      </Modal>,
    )
    // Edit a field → dialog is dirty.
    fireEvent.input(screen.getByLabelText('field'), { target: { value: 'x' } })
    const backdrop = container.firstChild as HTMLElement
    fireEvent.mouseDown(backdrop)
    fireEvent.mouseUp(backdrop)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('treats clicking an aria-pressed toggle (e.g. WeekdayPicker) as a dirty edit', () => {
    const onClose = vi.fn()
    render(
      <Modal title="Toggle Modal" onClose={onClose}>
        <button type="button" aria-pressed={false}>
          Mon
        </button>
      </Modal>,
    )
    // A button-driven toggle fires no input/change event, but the guard must still
    // catch it — otherwise editing working days then pressing Escape loses the change.
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders optional footer', () => {
    render(
      <Modal title="Footer Modal" onClose={vi.fn()} footer={<span>Footer content</span>}>
        <p>Body</p>
      </Modal>,
    )
    expect(screen.getByText('Footer content')).toBeInTheDocument()
  })

  it('keeps focus stable and restores it when onClose identity churns mid-open', () => {
    // Simulate a real trigger having focus before the dialog opens.
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const body = (
      <>
        <button>First</button>
        <button>Second</button>
      </>
    )
    const { rerender, unmount } = render(
      <Modal title="Churn" onClose={() => {}}>
        {body}
      </Modal>,
    )
    const first = screen.getByRole('button', { name: 'First' })
    const second = screen.getByRole('button', { name: 'Second' })
    expect(document.activeElement).toBe(first) // focuses first control on open

    second.focus()
    // Parent re-renders with a BRAND-NEW onClose (as a store mutation would cause).
    rerender(
      <Modal title="Churn" onClose={() => {}}>
        {body}
      </Modal>,
    )
    expect(document.activeElement).toBe(second) // focus not yanked back to first

    unmount()
    expect(document.activeElement).toBe(trigger) // focus returns to the opener
    trigger.remove()
  })
})

// ─── ConfirmDialog ─────────────────────────────────────────────────────────

describe('ConfirmDialog', () => {
  it('renders title and message', () => {
    render(
      <ConfirmDialog
        title="Really delete?"
        message="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Really delete?' })).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
  })

  it('calls onConfirm when the confirm button is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="Confirm"
        message="Sure?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls onCancel when the Cancel button is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="Confirm"
        message="Sure?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('uses a custom confirmLabel', () => {
    render(
      <ConfirmDialog
        title="Remove?"
        message="This will remove it."
        confirmLabel="Remove"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })
})

// ─── ListPage ──────────────────────────────────────────────────────────────

describe('ListPage', () => {
  it('renders the page title', () => {
    render(<ListPage title="My Page" />)
    expect(screen.getByRole('heading', { name: 'My Page' })).toBeInTheDocument()
  })

  it('renders children', () => {
    render(
      <ListPage title="Page">
        <p>Child content</p>
      </ListPage>,
    )
    expect(screen.getByText('Child content')).toBeInTheDocument()
  })

  it('renders Add button with default label when onAdd is provided', () => {
    const onAdd = vi.fn()
    render(<ListPage title="Page" onAdd={onAdd} />)
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('calls onAdd when the Add button is clicked', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(<ListPage title="Page" onAdd={onAdd} />)
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAdd).toHaveBeenCalledOnce()
  })

  it('uses a custom addLabel', () => {
    const onAdd = vi.fn()
    render(<ListPage title="Page" onAdd={onAdd} addLabel="New item" />)
    expect(screen.getByRole('button', { name: 'New item' })).toBeInTheDocument()
  })

  it('does not render an Add button when onAdd is not provided', () => {
    render(<ListPage title="Page" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

// ─── EmptyState ────────────────────────────────────────────────────────────

describe('EmptyState', () => {
  it('renders children text', () => {
    render(<EmptyState>No items yet.</EmptyState>)
    expect(screen.getByText('No items yet.')).toBeInTheDocument()
  })
})

// ─── FieldError ────────────────────────────────────────────────────────────

describe('FieldError', () => {
  it('renders alert with the error message when children provided', () => {
    render(<FieldError>Name is required</FieldError>)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Name is required')
  })

  it('renders nothing when children is undefined', () => {
    const { container } = render(<FieldError />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when children is empty string', () => {
    const { container } = render(<FieldError>{''}</FieldError>)
    expect(container).toBeEmptyDOMElement()
  })
})

// ─── TextField ─────────────────────────────────────────────────────────────

describe('TextField', () => {
  it('renders with label and value', () => {
    render(<TextField label="Full name" value="Alice" onChange={vi.fn()} />)
    expect(screen.getByLabelText('Full name')).toHaveValue('Alice')
  })

  it('calls onChange on each keystroke', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TextField label="Name" value="" onChange={onChange} />)
    await user.type(screen.getByLabelText('Name'), 'B')
    expect(onChange).toHaveBeenCalledWith('B')
  })

  it('renders placeholder text', () => {
    render(<TextField label="Search" value="" onChange={vi.fn()} placeholder="Type here..." />)
    expect(screen.getByPlaceholderText('Type here...')).toBeInTheDocument()
  })
})

// ─── TextAreaField ─────────────────────────────────────────────────────────

describe('TextAreaField', () => {
  it('renders with label and value', () => {
    render(<TextAreaField label="Notes" value="Some notes" onChange={vi.fn()} />)
    expect(screen.getByLabelText('Notes')).toHaveValue('Some notes')
  })

  it('calls onChange on each keystroke', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TextAreaField label="Notes" value="" onChange={onChange} />)
    await user.type(screen.getByLabelText('Notes'), 'H')
    expect(onChange).toHaveBeenCalledWith('H')
  })
})

// ─── NumberField ───────────────────────────────────────────────────────────

describe('NumberField', () => {
  it('renders with label and numeric value', () => {
    render(<NumberField label="Hours" value={8} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Hours')).toHaveValue(8)
  })

  it('calls onChange with a number on change', () => {
    const onChange = vi.fn()
    render(<NumberField label="Qty" value={5} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '10' } })
    expect(onChange).toHaveBeenCalledWith(10)
  })
})

// ─── DateField ─────────────────────────────────────────────────────────────

describe('DateField', () => {
  it('renders with label and date value', () => {
    render(<DateField label="Start date" value="2026-06-01" onChange={vi.fn()} />)
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-06-01')
  })

  it('calls onChange with new date string', () => {
    const onChange = vi.fn()
    render(<DateField label="End date" value="2026-06-01" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-07-01' } })
    expect(onChange).toHaveBeenCalledWith('2026-07-01')
  })
})

// ─── SelectField ───────────────────────────────────────────────────────────

describe('SelectField', () => {
  const options = [
    { value: 'a', label: 'Option A' },
    { value: 'b', label: 'Option B' },
    { value: 'c', label: 'Option C' },
  ]

  it('renders all options', () => {
    render(<SelectField label="Pick one" value="a" onChange={vi.fn()} options={options} />)
    const select = screen.getByLabelText('Pick one')
    expect(select).toBeInTheDocument()
    expect(screen.getByText('Option A')).toBeInTheDocument()
    expect(screen.getByText('Option B')).toBeInTheDocument()
    expect(screen.getByText('Option C')).toBeInTheDocument()
  })

  it('calls onChange when an option is selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SelectField label="Pick one" value="a" onChange={onChange} options={options} />)
    await user.selectOptions(screen.getByLabelText('Pick one'), 'b')
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('renders a placeholder option when provided', () => {
    render(
      <SelectField label="Choose" value="" onChange={vi.fn()} options={options} placeholder="-- Select --" />,
    )
    expect(screen.getByText('-- Select --')).toBeInTheDocument()
  })

  it('is disabled when disabled prop is true', () => {
    render(
      <SelectField label="Locked" value="a" onChange={vi.fn()} options={options} disabled />,
    )
    expect(screen.getByLabelText('Locked')).toBeDisabled()
  })
})

// ─── ColorField ────────────────────────────────────────────────────────────

describe('ColorField', () => {
  it('renders a color picker input and a text input with the value', () => {
    render(<ColorField label="Brand colour" value="#ff0000" onChange={vi.fn()} />)
    // The color picker has aria-label "<label> picker"
    const colorPicker = screen.getByLabelText('Brand colour picker')
    expect(colorPicker).toHaveValue('#ff0000')
    // Both inputs (color picker + text) render the same value
    expect(screen.getAllByDisplayValue('#ff0000')).toHaveLength(2)
  })

  it('calls onChange when the text input changes', () => {
    const onChange = vi.fn()
    render(<ColorField label="Colour" value="#ff0000" onChange={onChange} />)
    // There are two inputs sharing the same value; target the text one by its current value
    const inputs = screen.getAllByDisplayValue('#ff0000')
    // The text input is the second one (after the color picker)
    const textInput = inputs.find((el) => el.getAttribute('type') !== 'color')!
    fireEvent.change(textInput, { target: { value: '#00ff00' } })
    expect(onChange).toHaveBeenCalledWith('#00ff00')
  })

  it('calls onChange when the color picker input changes', () => {
    const onChange = vi.fn()
    render(<ColorField label="Colour" value="#ff0000" onChange={onChange} />)
    const colorPicker = screen.getByLabelText('Colour picker')
    fireEvent.change(colorPicker, { target: { value: '#0000ff' } })
    expect(onChange).toHaveBeenCalledWith('#0000ff')
  })
})

// ─── WeekdayPicker ─────────────────────────────────────────────────────────

describe('WeekdayPicker', () => {
  it('renders all 7 day buttons', () => {
    render(
      <WeekdayPicker label="Working days" value={[1, 2, 3, 4, 5]} onChange={vi.fn()} />,
    )
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(screen.getByRole('button', { name: day })).toBeInTheDocument()
    }
  })

  it('marks selected days as pressed', () => {
    render(
      <WeekdayPicker label="Working days" value={[1, 2, 3, 4, 5]} onChange={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Sat' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Sun' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('toggles a day ON when it is not selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <WeekdayPicker label="Working days" value={[1, 2, 3, 4, 5]} onChange={onChange} />,
    )
    await user.click(screen.getByRole('button', { name: 'Sat' }))
    // Sat is day 6 — should be added
    expect(onChange).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6])
  })

  it('toggles a day OFF when it is already selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <WeekdayPicker label="Working days" value={[1, 2, 3, 4, 5]} onChange={onChange} />,
    )
    await user.click(screen.getByRole('button', { name: 'Mon' }))
    // Mon is day 1 — should be removed
    expect(onChange).toHaveBeenCalledWith([2, 3, 4, 5])
  })
})

// ─── TemporaryTag ──────────────────────────────────────────────────────────

const baseResource = (): Resource => ({
  id: 'r1',
  accountId: 'acct-test',
  createdAt: 't',
  updatedAt: 't',
  kind: 'person',
  name: 'Alice',
  role: 'Dev',
  employmentType: 'permanent',
  workingHoursPerDay: 8,
  workingDays: WORKDAYS,
  color: '#111',
})

describe('TemporaryTag', () => {
  it('renders "Temp" tag for a freelancer', () => {
    render(<TemporaryTag resource={{ ...baseResource(), employmentType: 'freelancer' }} />)
    expect(screen.getByText('Temp')).toBeInTheDocument()
  })

  it('renders "Temp" tag for a contractor', () => {
    render(<TemporaryTag resource={{ ...baseResource(), employmentType: 'contractor' }} />)
    expect(screen.getByText('Temp')).toBeInTheDocument()
  })

  it('renders nothing for a permanent employee', () => {
    const { container } = render(<TemporaryTag resource={{ ...baseResource(), employmentType: 'permanent' }} />)
    expect(container).toBeEmptyDOMElement()
  })
})

// ─── ColorSwatch ───────────────────────────────────────────────────────────

describe('ColorSwatch', () => {
  it('renders a span with the given background color', () => {
    const { container } = render(<ColorSwatch color="#ec4899" />)
    const swatch = container.firstChild as HTMLElement
    expect(swatch).toBeInTheDocument()
    expect(swatch.style.backgroundColor).toBe('rgb(236, 72, 153)')
  })
})

// ─── Avatar ────────────────────────────────────────────────────────────────

describe('Avatar', () => {
  it('shows two-initial monogram from a full name', () => {
    const { container } = render(<Avatar name="Alice Smith" color="#111" />)
    expect(container.firstChild).toHaveTextContent('AS')
  })

  it('shows single initial from a single-word name', () => {
    const { container } = render(<Avatar name="Alice" color="#111" />)
    expect(container.firstChild).toHaveTextContent('A')
  })

  it('shows only first two initials from a long name', () => {
    const { container } = render(<Avatar name="Alice Bob Carol" color="#111" />)
    expect(container.firstChild).toHaveTextContent('AB')
  })

  it('shows initials in uppercase', () => {
    const { container } = render(<Avatar name="alice smith" color="#111" />)
    expect(container.firstChild).toHaveTextContent('AS')
  })

  it('shows em dash fallback for an empty name', () => {
    const { container } = render(<Avatar name="" color="#111" />)
    expect(container.firstChild).toHaveTextContent('—')
  })

  it('renders with the given background color', () => {
    const { container } = render(<Avatar name="Alice Smith" color="#ec4899" />)
    const el = container.firstChild as HTMLElement
    expect(el.style.backgroundColor).toBe('rgb(236, 72, 153)')
  })
})
