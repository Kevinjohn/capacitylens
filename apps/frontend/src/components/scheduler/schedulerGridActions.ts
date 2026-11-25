import { createContext, useContext } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ID, ISODate } from '@capacitylens/shared/types/entities';
import type { DialogState } from './schedulerGridDialog';

/** Grid-wide callbacks the row leaves call; the grid memoises the value so it stays stable. */
export interface SchedulerGridActions {
  setDialog: Dispatch<SetStateAction<DialogState | null>>;
  onViewSchedule: (resourceId: ID, opener: HTMLButtonElement) => void;
  /** Reads the date at the timeline's left edge when called, not at render. */
  visibleStartDate: () => ISODate;
}

/** Supplies {@link SchedulerGridActions} to the rows of one scheduler grid. */
export const SchedulerGridActionsContext = createContext<SchedulerGridActions | null>(null);

/** Reads the enclosing grid's actions; a row rendered outside a grid is a programming error. */
export function useSchedulerGridActions(): SchedulerGridActions {
  const actions = useContext(SchedulerGridActionsContext);
  if (!actions) throw new Error('Scheduler grid rows need a SchedulerGridActionsContext provider.');
  return actions;
}
