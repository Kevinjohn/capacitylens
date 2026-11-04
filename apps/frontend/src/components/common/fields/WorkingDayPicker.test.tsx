import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkingDayPicker } from '@/components/common/ui';
import { useStore } from '@/store/useStore';
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

type RenderWorkingDayPickerOptions = {
  onChange?: React.ComponentProps<typeof WorkingDayPicker>['onChange'];
  invalid?: boolean;
};
const renderWorkingDayPicker = ({
  onChange = vi.fn(),
  invalid = false,
}: RenderWorkingDayPickerOptions = {}) =>
  render(
    <WorkingDayPicker
      label="Working days"
      workingDays={[1, 2, 3, 4, 5]}
      halfDays={[3]}
      onChange={onChange}
      invalid={invalid}
      describedById="err-1"
    />,
  );

describe('WorkingDayPicker', () => {
  registerWorkingDayPickerLayoutTests();
  registerWorkingDayPickerStateTests();
});

function registerWorkingDayPickerLayoutTests() {
  it('renders a full-width Monday–Sunday grid with the three choice headings written once', () => {
    renderWorkingDayPicker({});
    expect(screen.getByRole('columnheader', { name: 'Weekday' })).toBeInTheDocument();
    for (const option of ['Full day', 'Half day', 'Not working']) {
      expect(screen.getByRole('columnheader', { name: option })).toBeVisible();
    }
    const table = screen.getByRole('table');
    expect(table).toHaveClass('w-full');
    expect(table.parentElement).toHaveClass('min-w-0', 'w-full', 'max-w-full', 'overflow-x-auto');
    expect(table.closest('fieldset')).toHaveClass('min-w-0');
    expect(table.parentElement).not.toHaveClass('justify-end');
    expect(screen.getAllByRole('radio')).toHaveLength(21);
    for (const day of [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]) {
      const row = screen.getByRole('row', { name: new RegExp(day) });
      expect(within(row).getByRole('radio', { name: `${day} Full day` })).toHaveAttribute(
        'type',
        'radio',
      );
      expect(within(row).getByRole('radio', { name: `${day} Half day` })).toHaveAttribute(
        'type',
        'radio',
      );
      expect(within(row).getByRole('radio', { name: `${day} Not working` })).toHaveAttribute(
        'type',
        'radio',
      );
    }
  });

  it('keeps long availability and weekday labels on one line for horizontal overflow', () => {
    renderWorkingDayPicker({});
    for (const header of screen.getAllByRole('columnheader').slice(1)) {
      expect(header).toHaveClass('whitespace-nowrap');
    }
    for (const day of [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]) {
      expect(screen.getByRole('rowheader', { name: day })).toHaveClass('whitespace-nowrap');
    }
  });
}

function registerWorkingDayPickerStateTests() {
  it('selects full, half and non-working choices from the persisted subsets', () => {
    renderWorkingDayPicker({});
    const monday = screen.getByRole('row', { name: /Monday/ });
    const wednesday = screen.getByRole('row', { name: /Wednesday/ });
    const saturday = screen.getByRole('row', { name: /Saturday/ });
    expect(within(monday).getByRole('radio', { name: 'Monday Full day' })).toBeChecked();
    expect(within(wednesday).getByRole('radio', { name: 'Wednesday Half day' })).toBeChecked();
    expect(within(saturday).getByRole('radio', { name: 'Saturday Not working' })).toBeChecked();
  });

  it('moves a weekday between mutually exclusive choices', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWorkingDayPicker({ onChange: onChange });
    await user.click(
      within(screen.getByRole('row', { name: /Saturday/ })).getByRole('radio', {
        name: 'Saturday Half day',
      }),
    );
    expect(onChange).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6], [3, 6]);
  });

  it('does NOT set aria-invalid/aria-describedby on the fieldset when valid', () => {
    const { container } = renderWorkingDayPicker({});
    const fieldset = getRequiredElement<HTMLFieldSetElement>(container, 'fieldset');
    expect(fieldset).not.toHaveAttribute('aria-invalid');
    expect(fieldset).not.toHaveAttribute('aria-describedby');
  });

  it('marks the GROUP errored (aria-invalid + aria-describedby) when invalid, mirroring sibling fields (WCAG 3.3.1)', () => {
    const { container } = renderWorkingDayPicker({ onChange: vi.fn(), invalid: true });
    const fieldset = getRequiredElement<HTMLFieldSetElement>(container, 'fieldset');
    expect(fieldset).toHaveAttribute('aria-invalid', 'true');
    expect(fieldset).toHaveAttribute('aria-describedby', 'err-1');
  });
}
