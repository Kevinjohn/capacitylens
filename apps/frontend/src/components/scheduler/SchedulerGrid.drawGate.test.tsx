import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ID, ISODate } from '@capacitylens/shared/types/entities';
import {
  loadPlanningData,
  DEFAULT_ACCOUNT_ID,
  makeAccount,
  makeClosure,
  makeTimeOff,
} from '@/test/fixtures';
import { schedulerDataset } from './__tests__/schedulerTestKit';
import { useStore } from '@/store/useStore';
import { SchedulerGrid } from './SchedulerGrid';

vi.mock('./ResourceLane', () => ({
  ResourceLane: ({
    resourceId,
    onDraw,
  }: {
    resourceId: ID;
    onDraw?: (resourceId: ID, startDate: ISODate, endDate: ISODate) => void;
  }) => (
    <button type="button" onClick={() => onDraw?.(resourceId, '2026-06-03', '2026-06-03')}>
      Draw on 3 June
    </button>
  ),
}));

const ACTIVE_ACCOUNT_ID = DEFAULT_ACCOUNT_ID;
const INACTIVE_ACCOUNT_ID = 'a-loft';

beforeEach(() => {
  loadPlanningData(
    schedulerDataset({
      accounts: [
        makeAccount({ id: ACTIVE_ACCOUNT_ID }),
        makeAccount({ id: INACTIVE_ACCOUNT_ID, name: 'Stark Industries' }),
      ],
      closures: [
        makeClosure({
          accountId: INACTIVE_ACCOUNT_ID,
          startDate: '2026-06-03',
          endDate: '2026-06-03',
        }),
      ],
    }),
  );
  useStore.getState().setActiveAccount(ACTIVE_ACCOUNT_ID);
  useStore.getState().setDrawMode('work');
  useStore.getState().clearFilters();
  useStore.setState((state) => ({ ui: { ...state.ui, collapsedGroups: [] } }));
});

describe('SchedulerGrid draw gate', () => {
  it('opens for the active account when only an inactive account has a closure on the date', async () => {
    render(<SchedulerGrid />, { wrapper: MemoryRouter });

    fireEvent.click(screen.getByRole('button', { name: 'Draw on 3 June' }));

    const dialog = await screen.findByRole('dialog', { name: /new allocation/i });
    expect(within(dialog).getByLabelText('Start Date')).toHaveValue('2026-06-03');
  });

  it('opens over a closure omitted for an invalid date range', async () => {
    const corrupt = makeClosure({
      id: 'closure-corrupt',
      accountId: ACTIVE_ACCOUNT_ID,
      startDate: '2026-02-30',
      endDate: '2026-06-07',
    });
    useStore.setState((state) => ({
      data: { ...state.data, closures: [...state.data.closures, corrupt] },
    }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<SchedulerGrid />, { wrapper: MemoryRouter });

    fireEvent.click(screen.getByRole('button', { name: 'Draw on 3 June' }));

    const dialog = await screen.findByRole('dialog', { name: /new allocation/i });
    expect(within(dialog).getByLabelText('Start Date')).toHaveValue('2026-06-03');
    expect(error).toHaveBeenCalledWith(`Scheduler omitted ${corrupt.id}: invalid date range.`);
    error.mockRestore();
  });

  it('opens over time off omitted for an invalid date range', async () => {
    const corrupt = makeTimeOff({
      id: 'time-off-corrupt',
      accountId: ACTIVE_ACCOUNT_ID,
      startDate: '2026-02-30',
      endDate: '2026-06-07',
    });
    useStore.setState((state) => ({
      data: { ...state.data, timeOff: [...state.data.timeOff, corrupt] },
    }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<SchedulerGrid />, { wrapper: MemoryRouter });

    fireEvent.click(screen.getByRole('button', { name: 'Draw on 3 June' }));

    const dialog = await screen.findByRole('dialog', { name: /new allocation/i });
    expect(within(dialog).getByLabelText('Start Date')).toHaveValue('2026-06-03');
    expect(error).toHaveBeenCalledWith(`Scheduler omitted ${corrupt.id}: invalid date range.`);
    error.mockRestore();
  });
});
