import { useCallback, useRef, useState } from 'react'

/**
 * Allows one member or invitation action at a time. `beginAction` returns false while another
 * action holds the lock; `busyAction` names the holder for the busy announcement.
 */
export function useTeamOperationLock() {
  const operationLock = useRef<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const beginAction = useCallback((key: string): boolean => {
    if (operationLock.current !== null) return false
    operationLock.current = key
    setBusyAction(key)
    return true
  }, [])
  const endAction = useCallback(() => {
    operationLock.current = null
    setBusyAction(null)
  }, [])
  return { busyAction, beginAction, endAction }
}
