import { useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { resolveErrorMessage } from "@/lib/errorMessage";
import type { capturePlanningDraft } from "@/data/planning/planningActions";

type PlanningDraft = ReturnType<typeof capturePlanningDraft>;

/** Deletes an entity and closes only after acknowledgement; failures leave the dialog open. */
export function useConfirmDelete(
  deleteEntity: (id: string, draft?: PlanningDraft) => Promise<unknown>,
  close: () => void,
) {
  const setNotice = useStore((state) => state.setNotice);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const confirmDelete = async (id: string, draft?: PlanningDraft) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await deleteEntity(id, draft);
      close();
    } catch (error) {
      setNotice(resolveErrorMessage(error), "error");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return { confirmDelete, busy };
}
