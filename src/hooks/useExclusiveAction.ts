import { useCallback, useRef, useState } from "react";

// The synchronous ref rejects another action before React can disable controls.
// State communicates the same lock through the rendered busy state.

/** The exclusion gate returned by {@link useExclusiveAction}. */
export interface ExclusiveAction {
  /** `true` while an action is in flight, bind it to every participating control's `disabled`. */
  busy: boolean;
  /**
   * Start `action` unless one is already running, in which case this is a no-op (not a queue: a
   * suppressed second click is a double-click to discard, never a second mutation to run later).
   * Rejections go to `onError`; the gate always reopens afterwards.
   */
  run(action: () => Promise<void>, onError: (error: unknown) => void): void;
  /**
   * Is an action in flight right now? Reads the synchronous ref, so unlike {@link busy} it is
   * already true inside the same click that started one. For guards that run before React can
   * re-render, e.g. refusing to open a confirmation dialog while a mutation is settling.
   */
  locked(): boolean;
}

/**
 * Section-wide "one action at a time" exclusion.
 *
 * The controls that share one instance of this hook exclude each other, which is the point: a
 * restore, a delete and a purge all mutate the same list and each ends in an authoritative reload,
 * so a second one launched mid-flight would race the first one's refetch and could act on rows that
 * no longer exist. Give a surface one instance per group of controls that must not overlap.
 *
 * Total: `run` never throws. A rejected action is handed to the caller's `onError` (surface it,
 * DEFENSIVE-CODING.md §1, typically as a notice), and the ref and the busy flag are both reset in
 * `finally`, so a failure reopens the gate rather than wedging the section disabled forever.
 *
 * @returns the {@link ExclusiveAction} gate: a `busy` flag for `disabled`, `run` to start an action,
 * and `locked()` for same-click guards.
 */
export function useExclusiveAction(): ExclusiveAction {
  const actionLock = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback((action: () => Promise<void>, onError: (error: unknown) => void) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    const reopen = () => {
      actionLock.current = false;
      setBusy(false);
    };
    const report = (error: unknown) => {
      try {
        onError(error);
      } catch (reportingError) {
        console.error("Exclusive action error handler failed", reportingError);
      }
    };
    try {
      void action().catch(report).finally(reopen);
    } catch (error) {
      report(error);
      reopen();
    }
  }, []);

  const locked = useCallback(() => actionLock.current, []);

  return { busy, run, locked };
}
