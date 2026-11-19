import { useEffect, useRef } from 'react';
import type { ID } from '@capacitylens/shared/types/entities';
import { useStore } from '@/store/useStore';

/** Focus action that locates an allocation within the active account. */
export type ScheduleAllocationFocus = (allocationId: ID, companyId: ID | null) => void;

/** Schedules focus for an allocation after its row becomes visible. */
export function useAllocationFocus(): ScheduleAllocationFocus {
  const focusRafRef = useRef(0);
  useEffect(
    () => () => {
      if (focusRafRef.current) cancelAnimationFrame(focusRafRef.current);
    },
    [],
  );
  return (allocationId, companyId) => {
    if (focusRafRef.current) cancelAnimationFrame(focusRafRef.current);
    focusRafRef.current = requestAnimationFrame(() => {
      focusRafRef.current = 0;
      if (useStore.getState().activeCompanyId !== companyId) return;
      const element = Array.from(document.querySelectorAll<HTMLElement>('[data-alloc-id]')).find(
        (candidate) => candidate.dataset.allocId === allocationId,
      );
      element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      element?.focus({ preventScroll: true });
    });
  };
}
