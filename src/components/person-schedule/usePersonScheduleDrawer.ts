import { useCallback, useMemo, useState } from "react";
import type { RefObject } from "react";
import type { AppData, ID } from "@capacitylens/shared/types/entities";
import { useStore } from "../../store/useStore";
import { resolvePersonScheduleIdentity, usePersonSchedule } from "./usePersonSchedule";

interface PersonScheduleSelection {
  accountId: ID;
  resourceId: ID;
  opener: HTMLButtonElement;
}

export function usePersonScheduleDrawer({
  data,
  fallbackRef,
}: {
  data: AppData;
  fallbackRef: RefObject<HTMLDivElement | null>;
}) {
  const [selection, setSelection] = useState<PersonScheduleSelection | null>(null);
  const [open, setOpen] = useState(false);
  const schedule = usePersonSchedule({
    accountId: selection?.accountId ?? null,
    resourceId: selection?.resourceId ?? null,
  });
  const titlesByResourceId = useMemo(
    () => new Map(data.resources.map((resource) => [resource.id, resolvePersonScheduleIdentity(resource, data)])),
    [data],
  );
  const viewSchedule = useCallback((resourceId: ID, opener: HTMLButtonElement) => {
    const accountId = useStore.getState().activeAccountId;
    if (!accountId) return;
    setSelection({ accountId, resourceId, opener });
    setOpen(true);
  }, []);
  const restoreFocus = useCallback(() => {
    if (selection?.opener.isConnected) {
      selection.opener.focus({ preventScroll: true });
      return;
    }
    fallbackRef.current?.focus({ preventScroll: true });
  }, [fallbackRef, selection]);
  return { open, schedule, setOpen, restoreFocus, titlesByResourceId, viewSchedule };
}
