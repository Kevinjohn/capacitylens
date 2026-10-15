import { useStore } from "@/store/useStore";
import { resolveErrorMessage } from "@/lib/errorMessage";

/** Deletes an entity and closes on success; failures leave the dialog open and show a store notice. */
export function useConfirmDelete(deleteEntity: (id: string) => void, close: () => void) {
  const setNotice = useStore((state) => state.setNotice);
  return (id: string) => {
    try {
      deleteEntity(id);
      close();
    } catch (error) {
      setNotice(resolveErrorMessage(error), "error");
    }
  };
}
