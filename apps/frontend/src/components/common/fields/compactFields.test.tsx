import { loadPlanningData } from '@/test/fixtures';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedField, SwitchField, CheckboxField } from '@/components/common/ui';
import { useStore } from '@/store/useStore';
import { emptyAppData } from '@capacitylens/shared/types/entities';

beforeEach(() => {
  loadPlanningData(emptyAppData());
  useStore.getState().clearFilters();
  useStore.getState().setDirtyForm(false);
});

describe('compact product fields', () => {
  it('lays out a privacy switch with the shared responsive label-control contract', () => {
    render(
      <SwitchField
        label="Use code name"
        description="Hide the real name"
        checked={false}
        onChange={vi.fn()}
        layout="label-control"
      />,
    );
    const control = screen.getByRole('switch', { name: 'Use code name' });
    const field = control.closest('[data-slot="field"]');
    const description = screen.getByText('Hide the real name');
    expect(field).toHaveAttribute('data-product-layout', 'label-control');
    expect(field?.firstElementChild).toContainElement(description);
    expect(control.parentElement).not.toContainElement(description);
    expect(control.parentElement).toHaveClass('min-h-9');
  });

  it('lays out a checkbox with the shared responsive label-control contract', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <CheckboxField
        label="Ignore working days"
        checked={false}
        onChange={onChange}
        layout="label-control"
      />,
    );
    const control = screen.getByRole('checkbox', { name: 'Ignore working days' });
    expect(control.closest('[data-slot="field"]')).toHaveAttribute(
      'data-product-layout',
      'label-control',
    );
    expect(control.parentElement).toHaveClass('min-h-9');
    await user.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('labels a segmented field and applies the shared responsive row', () => {
    render(
      <SegmentedField
        label="Kind"
        value="project"
        onChange={vi.fn()}
        disabled
        options={[
          { value: 'project', label: 'Project' },
          { value: 'internal', label: 'Internal' },
        ]}
        layout="label-control"
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Kind' });
    expect(group.closest('[data-slot="field"]')).toHaveAttribute(
      'data-product-layout',
      'label-control',
    );
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
  });
});
