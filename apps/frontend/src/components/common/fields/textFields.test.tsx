import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextField, NumberField, DateField } from '@/components/common/ui';
import { useStore } from '@/store/useStore';
import { emptyAppData } from '@capacitylens/shared/types/entities';

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().clearFilters();
  useStore.getState().setDirtyForm(false);
});

describe('TextField', () => {
  it('renders with label and value', () => {
    render(<TextField label="Full name" value="Alice" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Full name')).toHaveValue('Alice');
  });

  it('calls onChange on each keystroke', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField label="Name" value="" onChange={onChange} />);
    await user.type(screen.getByLabelText('Name'), 'B');
    expect(onChange).toHaveBeenCalledWith('B');
  });

  it('renders placeholder text', () => {
    render(<TextField label="Search" value="" onChange={vi.fn()} placeholder="Type here..." />);
    expect(screen.getByPlaceholderText('Type here...')).toBeInTheDocument();
  });

  it('opts into a responsive label-control row without changing the default layout', () => {
    const { rerender } = render(<TextField label="Name" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Name').closest('[data-slot="field"]')).not.toHaveAttribute(
      'data-product-layout',
    );

    rerender(<TextField label="Name" value="" onChange={vi.fn()} layout="label-control" />);
    expect(screen.getByLabelText('Name').closest('[data-slot="field"]')).toHaveAttribute(
      'data-product-layout',
      'label-control',
    );
  });

  it('keeps describedById conditional on invalid state by default', () => {
    render(
      <>
        <TextField
          label="Name"
          value="Barbara Gordon"
          onChange={vi.fn()}
          describedById="name-error"
        />
        <p id="name-error">Name has an issue.</p>
      </>,
    );

    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-describedby');
  });

  it('supports a persistent external description alongside a conditional error description', () => {
    render(
      <>
        <TextField
          label="Name"
          value="Barbara Gordon"
          onChange={vi.fn()}
          externalDescriptionId="name-help"
          describedById="name-error"
          invalid
        />
        <p id="name-help">Use your full name.</p>
        <p id="name-error">Name has an issue.</p>
      </>,
    );

    expect(screen.getByLabelText('Name')).toHaveAttribute(
      'aria-describedby',
      'name-help name-error',
    );
  });
});

describe('NumberField', () => {
  it('renders with label and numeric value', () => {
    render(<NumberField label="Hours" value={8} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Hours')).toHaveValue(8);
  });

  it('calls onChange with a number on change', () => {
    const onChange = vi.fn();
    render(<NumberField label="Qty" value={5} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '10' } });
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('opts into the shared responsive label-control row', () => {
    render(<NumberField label="Qty" value={5} onChange={vi.fn()} layout="label-control" />);
    expect(screen.getByLabelText('Qty').closest('[data-slot="field"]')).toHaveAttribute(
      'data-product-layout',
      'label-control',
    );
  });
});

describe('DateField', () => {
  it('renders with label and date value', () => {
    render(<DateField label="Start date" value="2026-06-01" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-06-01');
  });

  it('calls onChange with new date string', () => {
    const onChange = vi.fn();
    render(<DateField label="End date" value="2026-06-01" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('End date'), {
      target: { value: '2026-07-01' },
    });
    expect(onChange).toHaveBeenCalledWith('2026-07-01');
  });

  it('forwards optional native date boundaries', () => {
    render(
      <DateField
        label="Repeat until"
        value=""
        onChange={vi.fn()}
        min="2026-06-01"
        max="2026-12-01"
        required
      />,
    );
    expect(screen.getByLabelText('Repeat until')).toHaveAttribute('min', '2026-06-01');
    expect(screen.getByLabelText('Repeat until')).toHaveAttribute('max', '2026-12-01');
    expect(screen.getByLabelText('Repeat until')).toHaveAttribute('aria-required', 'true');
  });

  it('opts into the shared responsive label-control row', () => {
    render(
      <DateField label="Start date" value="2026-06-01" onChange={vi.fn()} layout="label-control" />,
    );
    expect(screen.getByLabelText('Start date').closest('[data-slot="field"]')).toHaveAttribute(
      'data-product-layout',
      'label-control',
    );
  });
});
