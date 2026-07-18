import { createContext, useContext } from 'react'

export const FormDirtyContext = createContext<() => void>(() => {})

/** Explicit signal for button-driven form controls that do not emit native input/change events. */
export function useMarkFormDirty(): () => void {
  return useContext(FormDirtyContext)
}
