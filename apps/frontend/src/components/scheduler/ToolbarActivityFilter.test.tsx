import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { makeActivity } from '@/test/fixtures';
import { ToolbarActivityFilter } from './ToolbarActivityFilter';

const admin = makeActivity({ id: 'act-admin', name: 'Admin', kind: 'internal' });
const design = makeActivity({ id: 'act-design', name: 'Design', kind: 'repeatable' });

function renderFilter(props: Partial<React.ComponentProps<typeof ToolbarActivityFilter>> = {}) {
  const onChange = vi.fn();
  render(
    <ToolbarActivityFilter
      internalActivities={[admin]}
      repeatableActivities={[design]}
      activityId={null}
      activityKind={null}
      onChange={onChange}
      {...props}
    />,
  );
  return onChange;
}

function openActivityFilter() {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Filter by activity' }), {
    key: 'ArrowDown',
  });
}

describe('ToolbarActivityFilter', () => {
  it('selects the "Internal — All" activity group', () => {
    const onChange = renderFilter();
    openActivityFilter();

    fireEvent.click(screen.getByRole('option', { name: 'Internal — All' }));

    expect(onChange).toHaveBeenCalledWith({ activityKind: 'internal', activityId: null });
  });

  it('selects a specific activity', () => {
    const onChange = renderFilter();
    openActivityFilter();

    fireEvent.click(screen.getByRole('option', { name: 'Admin' }));

    expect(onChange).toHaveBeenCalledWith({ activityId: 'act-admin', activityKind: null });
  });

  it('clears a specific activity by selecting "All activities"', () => {
    const onChange = renderFilter({ activityId: 'act-admin' });
    openActivityFilter();

    fireEvent.click(screen.getByRole('option', { name: 'All activities' }));

    expect(onChange).toHaveBeenCalledWith({ activityId: null, activityKind: null });
  });

  it('displays "All projects — All" for the repeatable activity group', () => {
    renderFilter({ activityKind: 'repeatable' });

    expect(screen.getByRole('combobox', { name: 'Filter by activity' })).toHaveTextContent(
      'All projects — All',
    );
  });

  it('keeps an archived activity selection readable and clearable', () => {
    const onChange = renderFilter({ activityId: 'act-archived' });

    expect(screen.getByRole('combobox', { name: 'Filter by activity' })).toHaveTextContent(
      'Unavailable activity',
    );
    openActivityFilter();
    expect(screen.getByRole('option', { name: 'Unavailable activity' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.click(screen.getByRole('option', { name: 'All activities' }));
    expect(onChange).toHaveBeenCalledWith({ activityId: null, activityKind: null });
  });

  it('keeps an archived activity selection visible when no activities remain', () => {
    renderFilter({ activityId: 'act-archived', internalActivities: [], repeatableActivities: [] });

    expect(screen.getByRole('combobox', { name: 'Filter by activity' })).toHaveTextContent(
      'Unavailable activity',
    );
    openActivityFilter();
    expect(screen.getByRole('option', { name: 'All activities' })).toBeInTheDocument();
  });

  it('keeps a kind selection visible when its group becomes empty', () => {
    renderFilter({ activityKind: 'internal', internalActivities: [] });

    expect(screen.getByRole('combobox', { name: 'Filter by activity' })).toHaveTextContent(
      'Unavailable activity',
    );
    openActivityFilter();
    expect(screen.getByRole('option', { name: 'Unavailable activity' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
