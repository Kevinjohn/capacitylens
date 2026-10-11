import { createContext, useContext } from "react";

/** Describes the form dirty context used by this module. */
export const FormDirtyContext = createContext<() => void>(() => {});

/** Explicit signal for button-driven form controls that do not emit native input/change events. */
export function useMarkFormDirty(): () => void {
  return useContext(FormDirtyContext);
}
