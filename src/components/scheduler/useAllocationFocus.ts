import { useEffect, useRef } from "react";
import type { ID } from "@capacitylens/shared/types/entities";
import { useStore } from "../../store/useStore";

export type ScheduleAllocationFocus = (allocationId: ID, accountId: ID | null) => void;

export function useAllocationFocus(): ScheduleAllocationFocus {
  const focusRafRef = useRef(0);
  useEffect(
    () => () => {
      if (focusRafRef.current) cancelAnimationFrame(focusRafRef.current);
    },
    [],
  );
  return (allocationId, accountId) => {
    if (focusRafRef.current) cancelAnimationFrame(focusRafRef.current);
    focusRafRef.current = requestAnimationFrame(() => {
      focusRafRef.current = 0;
      if (useStore.getState().activeAccountId !== accountId) return;
      const element = Array.from(document.querySelectorAll<HTMLElement>("[data-alloc-id]")).find(
        (candidate) => candidate.dataset.allocId === allocationId,
      );
      element?.scrollIntoView({ block: "nearest", inline: "nearest" });
      element?.focus({ preventScroll: true });
    });
  };
}
