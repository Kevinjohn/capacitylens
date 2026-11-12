import { loadPlanningData } from '@/test/fixtures';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Modal, SelectField } from '@/components/common/ui';
import { useStore } from '@/store/useStore';
import { emptyAppData } from '@capacitylens/shared/types/entities';

beforeEach(() => {
  loadPlanningData(emptyAppData());
  useStore.getState().clearFilters();
  useStore.getState().setDirtyForm(false);
});

const selectFieldOptions = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
  { value: 'c', label: 'Option C' },
];

describe('SelectField', () => {
  registerSelectFieldBasics(selectFieldOptions);
  registerSelectFieldGrouping();
  registerSelectFieldValueEdges();
  registerSelectFieldFallbackTests(selectFieldOptions);
});

function registerSelectFieldBasics(options: typeof selectFieldOptions) {
  it('renders all options', () => {
    render(<SelectField label="Pick one" value="a" onChange={vi.fn()} options={options} />);
    const select = screen.getByLabelText('Pick one');
    expect(select).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('Pick one'), { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Option A' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Option B' })).toHaveAttribute('data-value', 'b');
    expect(screen.getByRole('option', { name: 'Option C' })).toBeInTheDocument();
  });

  it('calls onChange when an option is selected', () => {
    const onChange = vi.fn();
    render(<SelectField label="Pick one" value="a" onChange={onChange} options={options} />);
    const select = screen.getByLabelText('Pick one');
    select.focus();
    fireEvent.keyDown(screen.getByLabelText('Pick one'), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('option', { name: 'Option B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('opts into a responsive label-control row without changing the default layout', () => {
    const { rerender } = render(
      <SelectField label="Pick one" value="a" onChange={vi.fn()} options={options} />,
    );
    expect(screen.getByLabelText('Pick one').closest('[data-slot="field"]')).not.toHaveAttribute(
      'data-product-layout',
    );

    rerender(
      <SelectField
        label="Pick one"
        value="a"
        onChange={vi.fn()}
        options={options}
        layout="label-control"
      />,
    );
    expect(screen.getByLabelText('Pick one').closest('[data-slot="field"]')).toHaveAttribute(
      'data-product-layout',
      'label-control',
    );
  });

  it('renders an optional structural separator without creating another option', () => {
    const { baseElement } = render(
      <SelectField
        label="Grouped choices"
        value="internal"
        onChange={vi.fn()}
        options={[
          { value: 'internal', label: 'Internal' },
          { value: 'client', label: 'Client', separatorBefore: true },
        ]}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText('Grouped choices'), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(baseElement.querySelector('[data-slot="select-separator"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
}

function registerSelectFieldGrouping() {
  it('renders contiguous options in accessible labelled groups', () => {
    render(
      <SelectField
        label="Activities"
        value="all-projects"
        onChange={vi.fn()}
        options={[
          { value: 'all-projects', label: 'Planning', groupLabel: 'All projects' },
          { value: 'project', label: 'Delivery', groupLabel: 'Project-specific' },
        ]}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText('Activities'), { key: 'ArrowDown' });
    expect(
      within(screen.getByRole('group', { name: 'All projects' })).getByRole('option', {
        name: 'Planning',
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Project-specific' })).getByRole('option', {
        name: 'Delivery',
      }),
    ).toBeInTheDocument();
  });

  it('keeps adjacent translated labels in one group when they share semantic identity', () => {
    render(
      <SelectField
        label="Semantic groups"
        value="planning"
        onChange={vi.fn()}
        options={[
          {
            value: 'planning',
            label: 'Planning',
            groupKey: 'all-projects',
            groupLabel: 'All projects',
          },
          {
            value: 'design',
            label: 'Design',
            groupKey: 'all-projects',
            groupLabel: 'Tous les projets',
          },
        ]}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText('Semantic groups'), { key: 'ArrowDown' });
    const group = screen.getByRole('group', { name: 'All projects' });
    expect(within(group).getByRole('option', { name: 'Planning' })).toBeInTheDocument();
    expect(within(group).getByRole('option', { name: 'Design' })).toBeInTheDocument();
    expect(screen.getAllByRole('group')).toHaveLength(1);
  });
}

function registerSelectFieldValueEdges() {
  it('round-trips empty and sentinel-shaped option values without collision', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SelectField
        label="Collision-safe"
        value=""
        onChange={onChange}
        options={[
          { value: '', label: 'None' },
          { value: '__capacitylens_empty__', label: 'Sentinel-shaped id' },
        ]}
      />,
    );

    const select = screen.getByLabelText('Collision-safe');
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('option', { name: 'Sentinel-shaped id' }));
    expect(onChange).toHaveBeenLastCalledWith('__capacitylens_empty__');

    rerender(
      <SelectField
        label="Collision-safe"
        value="__capacitylens_empty__"
        onChange={onChange}
        options={[
          { value: '', label: 'None' },
          { value: '__capacitylens_empty__', label: 'Sentinel-shaped id' },
        ]}
      />,
    );
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('option', { name: 'None' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });
}

function registerSelectFieldFallbackTests(options: typeof selectFieldOptions) {
  it('marks a changed selection dirty inside a Modal', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Select modal" onClose={onClose}>
        <SelectField label="Pick one" value="a" onChange={vi.fn()} options={options} />
      </Modal>,
    );
    const select = screen.getByLabelText('Pick one');
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('option', { name: 'Option B' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders a placeholder option when provided', () => {
    render(
      <SelectField
        label="Choose"
        value=""
        onChange={vi.fn()}
        options={options}
        placeholder="-- Select --"
      />,
    );
    expect(screen.getByText('-- Select --')).toBeInTheDocument();
  });

  it('surfaces a non-empty value that is absent from the supplied options', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SelectField label="Unresolved" value="missing-id" onChange={onChange} options={options} />,
    );
    expect(screen.getByLabelText('Unresolved')).toHaveTextContent('missing-id');
    expect(onChange).not.toHaveBeenCalled();

    rerender(
      <SelectField
        label="Unresolved"
        value="missing-id"
        onChange={onChange}
        options={options}
        placeholder="Unknown selection"
      />,
    );
    expect(screen.getByLabelText('Unresolved')).toHaveTextContent('Unknown selection');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is disabled when disabled prop is true', () => {
    render(<SelectField label="Locked" value="a" onChange={vi.fn()} options={options} disabled />);
    expect(screen.getByLabelText('Locked')).toBeDisabled();
  });

  it('closes an open menu when disabled and does not restore it when re-enabled', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SelectField label="Pick one" value="a" onChange={onChange} options={options} />,
    );
    const select = screen.getByLabelText('Pick one');
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Option B' })).toBeInTheDocument();

    rerender(
      <SelectField label="Pick one" value="a" onChange={onChange} options={options} disabled />,
    );
    expect(screen.queryByRole('option', { name: 'Option B' })).not.toBeInTheDocument();
    const disabledSelect = screen.getByLabelText('Pick one');
    fireEvent.keyDown(disabledSelect, { key: 'ArrowDown' });
    fireEvent.click(disabledSelect);
    expect(onChange).not.toHaveBeenCalled();

    rerender(<SelectField label="Pick one" value="a" onChange={onChange} options={options} />);
    expect(screen.queryByRole('option', { name: 'Option B' })).not.toBeInTheDocument();
    const enabledSelect = screen.getByLabelText('Pick one');
    fireEvent.keyDown(enabledSelect, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Option B' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Option B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
}
