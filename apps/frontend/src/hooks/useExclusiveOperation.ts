import { useCallback, useRef, useState } from 'react'

// The synchronous ref rejects another operation before React can disable controls.
// State communicates the same lock through the rendered busy state.

/** The exclusion lock returned by {@link useExclusiveOperation}. */
export interface ExclusiveOperation {
  /** `true` while an operation is in flight, bind it to every participating control's `disabled`. */
  busy: boolean
  /**
   * Start `operation` unless one is already running, in which case this is a no-op (not a queue: a
   * suppressed second click is a double-click to discard, never a second mutation to run later).
   * Rejections go to `onError`; the lock always releases afterwards.
   */
  run(operation: () => Promise<void>, onError: (error: unknown) => void): void
  /**
   * Is an operation in flight right now? Reads the synchronous ref, so unlike {@link busy} it is
   * already true inside the same click that started one. For guards that run before React can
   * re-render, e.g. refusing to open a confirmation dialog while a mutation is settling.
   */
  locked(): boolean
}

/**
 * Section-wide "one operation at a time" exclusion.
 *
 * The controls that share one instance of this hook exclude each other, which is the point: a
 * restore and anonymise mutate the same list and each ends in an authoritative reload,
 * so a second one launched mid-flight would race the first one's refetch and could act on rows that
 * no longer exist. Give a surface one instance per group of controls that must not overlap.
 *
 * Total: `run` never throws. A rejected operation is handed to the caller's `onError` (surface it,
 * the notice handler), and the ref and the busy flag are both reset in
 * `finally`, so a failure releases the lock rather than wedging the section disabled forever.
 *
 * @returns the {@link ExclusiveOperation} lock: a `busy` flag for `disabled`, `run` to start an operation,
 * and `locked()` for same-click guards.
 */
export function useExclusiveOperation(): ExclusiveOperation {
  const operationLock = useRef(false)
  const [busy, setBusy] = useState(false)

  const run = useCallback((operation: () => Promise<void>, onError: (error: unknown) => void) => {
    if (operationLock.current) return
    operationLock.current = true
    setBusy(true)
    const reopen = () => {
      operationLock.current = false
      setBusy(false)
    }
    const report = (error: unknown) => {
      try {
        onError(error)
      } catch (reportingError) {
        console.error('Exclusive action error handler failed', reportingError)
      }
    }
    try {
      void operation().catch(report).finally(reopen)
    } catch (error) {
      report(error)
      reopen()
    }
  }, [])

  const locked = useCallback(() => operationLock.current, [])

  return { busy, run, locked }
}
