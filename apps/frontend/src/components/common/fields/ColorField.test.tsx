import { loadPlanningData } from '@/test/fixtures';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal, ColorField } from '@/components/common/ui';
import { useStore } from '@/store/useStore';
import { resolveColorName, SWATCHES } from '@/lib/palette';
import { emptyAppData } from '@capacitylens/shared/types/entities';

beforeEach(() => {
  loadPlanningData(emptyAppData());
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

const colorFieldBlue = '#2d75da';
const colorFieldRed = '#e02727';

describe('ColorField', () => {
  registerColorFieldBasicTests(colorFieldBlue, colorFieldRed);
  registerColorFieldInteractionTests(colorFieldBlue, colorFieldRed);
  registerColorFieldModalTests(colorFieldBlue, colorFieldRed);
});

function registerColorFieldBasicTests(BLUE: string, RED: string) {
  it('renders a trigger labelled with the current value and no swatches until opened', () => {
    render(<ColorField label="Brand colour" value={BLUE} onChange={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: `Brand colour (${resolveColorName(BLUE)})` }),
    ).toBeInTheDocument();

    expect(screen.queryByRole('radio', { name: resolveColorName(RED) })).not.toBeInTheDocument();
  });

  it('opts into the shared responsive label-control row', () => {
    render(<ColorField label="Colour" value={BLUE} onChange={vi.fn()} layout="label-control" />);
    expect(
      screen
        .getByRole('button', { name: `Colour (${resolveColorName(BLUE)})` })
        .closest('[data-slot="field"]'),
    ).toHaveAttribute('data-product-layout', 'label-control');
  });

  it('opens the full grid of preset swatches when the trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<ColorField label="Colour" value={BLUE} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', {
      name: `Colour (${resolveColorName(BLUE)})`,
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('radiogroup', { name: 'Colour swatches' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(52);
  });

  it('toggles the swatch grid closed when its expanded trigger is clicked again', async () => {
    const user = userEvent.setup();
    render(<ColorField label="Colour" value={BLUE} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: `Colour (${resolveColorName(BLUE)})` });

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('radio', { name: resolveColorName(RED) })).not.toBeInTheDocument();
  });

  it('calls onChange with the chosen hex and closes the popup', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorField label="Colour" value={BLUE} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: `Colour (${resolveColorName(BLUE)})` }));
    await user.click(screen.getByRole('radio', { name: resolveColorName(RED) }));
    expect(onChange).toHaveBeenCalledWith(RED);

    expect(screen.queryByRole('radio', { name: resolveColorName(RED) })).not.toBeInTheDocument();
  });

  it('closes an open grid when disabled and stays closed when re-enabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<ColorField label="Colour" value={BLUE} onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: `Colour (${resolveColorName(BLUE)})` });
    await user.click(trigger);
    expect(screen.getByRole('radio', { name: resolveColorName(RED) })).toBeInTheDocument();

    rerender(<ColorField label="Colour" value={BLUE} onChange={onChange} disabled />);
    const disabledTrigger = screen.getByRole('button', {
      name: `Colour (${resolveColorName(BLUE)})`,
    });
    expect(disabledTrigger).toBeDisabled();
    expect(screen.queryByRole('radio', { name: resolveColorName(RED) })).not.toBeInTheDocument();
    fireEvent.keyDown(disabledTrigger, { key: 'ArrowDown' });
    fireEvent.click(disabledTrigger);
    expect(onChange).not.toHaveBeenCalled();

    rerender(<ColorField label="Colour" value={BLUE} onChange={onChange} />);
    expect(screen.queryByRole('radio', { name: resolveColorName(RED) })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Colour (${resolveColorName(BLUE)})` }));
    expect(screen.getByRole('radio', { name: resolveColorName(RED) })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: resolveColorName(RED) }));
    expect(onChange).toHaveBeenCalledWith(RED);
  });
}

function registerColorFieldInteractionTests(BLUE: string, RED: string) {
  it('exposes the swatches as one single-select radio group', async () => {
    const user = userEvent.setup();
    render(<ColorField label="Colour" value={BLUE} onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: `Colour (${resolveColorName(BLUE)})` }));
    expect(screen.getByRole('radio', { name: resolveColorName(BLUE) })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: resolveColorName(RED) })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('uses one tab stop and arrow keys to move through the swatch grid', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorField label="Colour" value={BLUE} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: `Colour (${resolveColorName(BLUE)})` }));
    const selected = screen.getByRole('radio', { name: resolveColorName(BLUE) });
    const swatches = screen.getAllByRole('radio');
    expect(swatches.filter((button) => button.tabIndex === 0)).toEqual([selected]);
    selected.focus();
    await user.keyboard('{ArrowRight}');
    const next = swatches[(swatches.indexOf(selected) + 1) % swatches.length];
    expect(document.activeElement).toBe(next);
    expect(onChange).toHaveBeenCalledWith(SWATCHES[(SWATCHES.indexOf(BLUE) + 1) % SWATCHES.length]);
  });

  it('closes the popup on an outside click', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ColorField label="Colour" value={BLUE} onChange={vi.fn()} />
        <button type="button">Outside</button>
      </div>,
    );
    await user.click(screen.getByRole('button', { name: `Colour (${resolveColorName(BLUE)})` }));
    expect(screen.getByRole('radio', { name: resolveColorName(RED) })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('radio', { name: resolveColorName(RED) })).not.toBeInTheDocument();
  });

  it('closes the popup on Escape without closing the surrounding Modal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="Edit" onClose={onClose}>
        <ColorField label="Colour" value={BLUE} onChange={vi.fn()} />
      </Modal>,
    );
    await user.click(screen.getByRole('button', { name: `Colour (${resolveColorName(BLUE)})` }));
    // Move focus into the grid, then Escape: the popup must close and the keydown must
    // not reach the surrounding handler (the Modal's Escape-to-close in real use).
    const swatch = screen.getByRole('radio', { name: resolveColorName(RED) });
    swatch.focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('radio', { name: resolveColorName(RED) })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
}

function registerColorFieldModalTests(BLUE: string, RED: string) {
  it('dismisses only the popup, not the surrounding Modal, on a backdrop click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="Edit" onClose={onClose}>
        <ColorField label="Colour" value={BLUE} onChange={vi.fn()} />
      </Modal>,
    );
    await user.click(screen.getByRole('button', { name: `Colour (${resolveColorName(BLUE)})` }));
    expect(screen.getByRole('radio', { name: resolveColorName(RED) })).toBeInTheDocument();
    const backdrop = getRequiredElement<HTMLElement>(document, '[data-slot="dialog-overlay"]');
    await user.click(backdrop);
    expect(screen.queryByRole('radio', { name: resolveColorName(RED) })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does NOT swallow a press on another control inside the same dialog (first click lands)', async () => {
    const user = userEvent.setup();
    const onSiblingDown = vi.fn();
    render(
      <Modal title="Edit" onClose={() => {}}>
        <ColorField label="Colour" value={BLUE} onChange={vi.fn()} />
        <button type="button" data-testid="sibling" onMouseDown={onSiblingDown}>
          Other field
        </button>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: `Colour (${resolveColorName(BLUE)})` }));
    expect(screen.getByRole('radio', { name: resolveColorName(RED) })).toBeInTheDocument();
    // A press on another in-dialog control must reach it while Popover handles dismissal.
    await user.click(screen.getByTestId('sibling'));
    expect(onSiblingDown).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('radio', { name: resolveColorName(RED) })).not.toBeInTheDocument();
  });
}
