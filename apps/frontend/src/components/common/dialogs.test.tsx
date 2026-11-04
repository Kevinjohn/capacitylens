import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal, ConfirmDialog, ColorField, SegmentedControl } from './ui';
import { useStore } from '@/store/useStore';
import { resolveColorName } from '@/lib/palette';
import { emptyAppData } from '@capacitylens/shared/types/entities';

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().clearFilters();
  useStore.getState().setDirtyForm(false);
});

function getRequiredElement<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Expected ${selector} to match an element`);
  }
  return element;
}

describe('Modal', () => {
  registerModalPresentationTests();
  registerModalDismissalTests();
  registerModalDirtyStateTests();
  registerModalControlDirtyTests();
  registerModalControlNoOpTests();
  registerModalControlRenderingTests();
  registerModalControlMixedValueTests();
  registerModalFooterTests();
});

function registerModalPresentationTests() {
  it('renders with the given title as dialog label', () => {
    render(
      <Modal title="My Modal" onClose={vi.fn()}>
        <p>Content</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'My Modal' })).toHaveClass(
      'bg-popover',
      'grid-cols-[minmax(0,1fr)]',
    );
    expect(screen.getByRole('dialog', { name: 'My Modal' })).not.toHaveClass('bg-background');
    expect(screen.getByText('Content').parentElement).toHaveClass('min-w-0');
  });

  it('exposes the title as a navigable heading (aria-labelledby)', () => {
    render(
      <Modal title="Heady" onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByRole('heading', { name: 'Heady' })).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Esc Modal" onClose={onClose}>
        <p>Body</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
}

function registerModalDismissalTests() {
  it('closes when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="Backdrop Modal" onClose={onClose}>
        <p>Inner</p>
      </Modal>,
    );
    const backdrop = getRequiredElement<HTMLElement>(document, '[data-slot="dialog-overlay"]');
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([
    ['right-click', { button: 2 }],
    ['macOS ctrl-click', { button: 0, ctrlKey: true }],
  ])('does not treat a %s on the backdrop as a dismissal', async (_gesture, pointer) => {
    const onClose = vi.fn();
    render(
      <Modal title="Context menu Modal" onClose={onClose}>
        <p>Inner</p>
      </Modal>,
    );

    const backdrop = getRequiredElement<HTMLElement>(document, '[data-slot="dialog-overlay"]');
    fireEvent.pointerDown(backdrop, { pointerType: 'mouse', ...pointer });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close when its content is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="Backdrop Modal" onClose={onClose}>
        <p>Inner</p>
      </Modal>,
    );
    await user.click(screen.getByText('Inner'));
    expect(onClose).not.toHaveBeenCalled();
  });
}

function registerModalDirtyStateTests() {
  it('refuses an accidental backdrop/Escape dismissal once a field is edited', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="Dirty Modal" onClose={onClose}>
        <input aria-label="field" />
      </Modal>,
    );

    fireEvent.input(screen.getByLabelText('field'), { target: { value: 'x' } });
    const backdrop = getRequiredElement<HTMLElement>(document, '[data-slot="dialog-overlay"]');
    await user.click(backdrop);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('publishes one controlled dirty transition when one edit surfaces as input and change', () => {
    const onDirtyChange = vi.fn();
    render(
      <Modal title="Controlled dirty" onClose={vi.fn()} dirty={false} onDirtyChange={onDirtyChange}>
        <input aria-label="controlled field" />
      </Modal>,
    );
    const field = screen.getByLabelText('controlled field');
    fireEvent.input(field, { target: { value: 'x' } });
    fireEvent.change(field, { target: { value: 'x' } });
    expect(onDirtyChange).toHaveBeenCalledOnce();
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it('guards an immediate Escape before controlled dirty state has re-rendered', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Controlled dirty" onClose={onClose} dirty={false} onDirtyChange={vi.fn()}>
        <input aria-label="controlled field" />
      </Modal>,
    );

    fireEvent.input(screen.getByLabelText('controlled field'), {
      target: { value: 'x' },
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
}

function registerModalControlDirtyTests() {
  it('keeps one editor globally dirty while a clean overlapping Modal mounts and unmounts', () => {
    type ModalsOptions = { showCleanOverlay: boolean };
    const modals = ({ showCleanOverlay }: ModalsOptions) => (
      <>
        <Modal key="editor" title="Dirty editor" onClose={vi.fn()}>
          <input aria-label="edited field" />
        </Modal>
        {showCleanOverlay && (
          <Modal key="overlay" title="Clean overlay" onClose={vi.fn()} guardDirty={false}>
            <p>Hint only</p>
          </Modal>
        )}
      </>
    );
    const { rerender, unmount } = render(modals({ showCleanOverlay: false }));

    fireEvent.input(screen.getByLabelText('edited field'), {
      target: { value: 'unsaved' },
    });
    expect(useStore.getState().dirtyForm).toBe(true);

    rerender(modals({ showCleanOverlay: true }));
    expect(screen.getByRole('dialog', { name: 'Clean overlay' })).toBeInTheDocument();
    expect(useStore.getState().dirtyForm).toBe(true);

    rerender(modals({ showCleanOverlay: false }));
    expect(screen.queryByRole('dialog', { name: 'Clean overlay' })).not.toBeInTheDocument();
    expect(useStore.getState().dirtyForm).toBe(true);

    unmount();
    expect(useStore.getState().dirtyForm).toBe(false);
  });
}

function registerModalControlNoOpTests() {
  it('treats clicking an aria-pressed toggle (e.g. WeekdayPicker) as a dirty edit', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Toggle Modal" onClose={onClose}>
        <button type="button" aria-pressed={false}>
          Mon
        </button>
      </Modal>,
    );
    // A button-driven toggle fires no input/change event, but the guard must still
    // catch it, otherwise editing working days then pressing Escape loses the change.
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not mark an explicitly-managed segmented control dirty when its value is unchanged', () => {
    const onClose = vi.fn();
    render(
      <Modal title="No-op segment" onClose={onClose}>
        <SegmentedControl
          value="week"
          onChange={vi.fn()}
          options={[
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
          ]}
          ariaLabel="Zoom"
        />
      </Modal>,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Week' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
}

function registerModalControlRenderingTests() {
  it('renders the default gapped intent through the shared radio-group primitive', () => {
    render(
      <SegmentedControl
        value="week"
        onChange={vi.fn()}
        options={[
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ]}
        ariaLabel="Zoom"
      />,
    );

    const group = screen.getByRole('radiogroup', { name: 'Zoom' });
    expect(group).toHaveAttribute('data-variant', 'outline');
    expect(group).toHaveAttribute('data-geometry', 'gapped');
    expect(group).toHaveAttribute('data-size', 'md');
    expect(group).toHaveAttribute('data-density', 'default');
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('data-state', 'on');
  });

  it('renders connected full-width intent without changing radio semantics', () => {
    const options = [
      { value: 'first', label: 'First' },
      { value: 'middle', label: 'Middle' },
      { value: 'last', label: 'Last' },
    ];
    render(
      <SegmentedControl
        value="first"
        onChange={vi.fn()}
        options={options}
        ariaLabel="Positions"
        geometry="connected"
        fullWidth
      />,
    );

    const group = screen.getByRole('radiogroup', { name: 'Positions' });
    expect(group).toHaveAttribute('data-geometry', 'connected');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'First' })).toHaveAttribute('data-state', 'on');
  });
}

function registerModalControlMixedValueTests() {
  it('round-trips numeric and string values that have the same display text', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value={1 as 1 | '1'}
        onChange={onChange}
        options={[
          { value: 1, label: 'Number one' },
          { value: '1', label: 'String one' },
        ]}
        ariaLabel="Mixed values"
      />,
    );

    expect(screen.getByRole('radio', { name: 'Number one' })).toHaveAttribute('data-state', 'on');
    fireEvent.click(screen.getByRole('radio', { name: 'String one' }));
    expect(onChange).toHaveBeenCalledWith('1');
  });

  it('does not mark an explicitly-managed colour picker dirty when the selected swatch is re-picked', () => {
    const onClose = vi.fn();
    const blue = '#2d75da';
    render(
      <Modal title="No-op colour" onClose={onClose}>
        <ColorField label="Colour" value={blue} onChange={vi.fn()} />
      </Modal>,
    );

    fireEvent.click(screen.getByRole('button', { name: `Colour (${resolveColorName(blue)})` }));
    fireEvent.click(screen.getByRole('radio', { name: resolveColorName(blue) }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
}

function registerModalFooterTests() {
  it('renders optional footer', () => {
    render(
      <Modal title="Footer Modal" onClose={vi.fn()} footer={<span>Footer content</span>}>
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByText('Footer content')).toBeInTheDocument();
  });

  it('keeps focus stable and restores it when onClose identity churns mid-open', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const body = (
      <>
        <button>First</button>
        <button>Second</button>
      </>
    );
    const { rerender, unmount } = render(
      <Modal title="Churn" onClose={() => {}}>
        {body}
      </Modal>,
    );
    const first = screen.getByRole('button', { name: 'First' });
    const second = screen.getByRole('button', { name: 'Second' });
    expect(document.activeElement).toBe(first);

    second.focus();

    rerender(
      <Modal title="Churn" onClose={() => {}}>
        {body}
      </Modal>,
    );
    expect(document.activeElement).toBe(second);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
}

describe('ConfirmDialog', () => {
  it('renders title and message', () => {
    render(
      <ConfirmDialog
        title="Really delete?"
        message="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('alertdialog', { name: 'Really delete?' })).toHaveClass('bg-popover');
    expect(screen.getByRole('alertdialog', { name: 'Really delete?' })).not.toHaveClass(
      'bg-background',
    );
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('calls onConfirm when the confirm button is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="Confirm" message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when the Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="Confirm" message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('uses a custom confirmLabel', () => {
    render(
      <ConfirmDialog
        title="Remove?"
        message="This will remove it."
        confirmLabel="Remove"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('disables cancellation and confirmation while an async owner is busy', () => {
    render(
      <ConfirmDialog title="Confirm" message="Sure?" busy onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});
