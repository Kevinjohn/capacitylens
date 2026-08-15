import { useStore } from "../store/useStore";
import { errorMessage } from "../lib/errorMessage";

/**
 * Shared delete-with-notice handler for a list page's ConfirmDialog `onConfirm`. Three list pages
 * (DisciplineList, TimeOffList, ActivityList) hand-rolled this exact try/catch: delete, then close
 * the dialog on success; on a thrown validation error, leave the dialog open and surface the message
 * as a store notice instead. Kept as the same delete-then-close call order everywhere.
 */
export function useConfirmDelete(del: (id: string) => void, close: () => void) {
  const setNotice = useStore((s) => s.setNotice);
  return (id: string) => {
    try {
      del(id);
      close();
    } catch (error) {
      setNotice(errorMessage(error), "error");
    }
  };
}
