import { useCallback, useRef, useState } from "react";

// One-at-a-time gating for a group of destructive/asynchronous controls (Settings' lifecycle
// buttons, the offline opt-in, the clear-storage confirm). Each of those grew the same ref+state
// pair; this is that pair, once.
//
// WHY BOTH a ref and a state flag — they answer different questions:
//   - the REF is the enforcement, and it is set synchronously. React commits `busy = true` only on
//     the NEXT render, so between the first click's handler and that commit the buttons are still
//     enabled and a second click would start a second mutation. The ref closes exactly that window.
//   - the STATE is the communication: it re-renders the section so every control can go `disabled`,
//     which both tells the user why nothing responds and stops the click reaching a handler at all.
// Dropping either one is a real regression, not a tidy-up.

/** The exclusion gate returned by {@link useExclusiveAction}. */
export interface ExclusiveAction {
  /** `true` while an action is in flight — bind it to every participating control's `disabled`. */
  busy: boolean;
  /**
   * Start `action` unless one is already running, in which case this is a NO-OP (not a queue: a
   * suppressed second click is a double-click to discard, never a second mutation to run later).
   * Rejections go to `onError`; the gate always reopens afterwards.
   */
  run(action: () => Promise<void>, onError: (error: unknown) => void): void;
  /**
   * Is an action in flight RIGHT NOW? Reads the synchronous ref, so unlike {@link busy} it is
   * already true inside the same click that started one. For guards that run before React can
   * re-render — e.g. refusing to open a confirmation dialog while a mutation is settling.
   */
  locked(): boolean;
}

/**
 * Section-wide "one action at a time" exclusion.
 *
 * The controls that share one instance of this hook exclude EACH OTHER, which is the point: a
 * restore, a delete and a purge all mutate the same list and each ends in an authoritative reload,
 * so a second one launched mid-flight would race the first one's refetch and could act on rows that
 * no longer exist. Give a surface one instance per group of controls that must not overlap.
 *
 * TOTAL: `run` never throws. A rejected action is handed to the caller's `onError` (surface it —
 * DEFENSIVE-CODING.md §1 — typically as a notice), and the ref and the busy flag are BOTH reset in
 * `finally`, so a failure reopens the gate rather than wedging the section disabled forever.
 *
 * @returns the {@link ExclusiveAction} gate: a `busy` flag for `disabled`, `run` to start an action,
 *          and `locked()` for same-click guards.
 */
export function useExclusiveAction(): ExclusiveAction {
  const actionLock = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback((action: () => Promise<void>, onError: (error: unknown) => void) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    void action()
      .catch(onError)
      .finally(() => {
        actionLock.current = false;
        setBusy(false);
      });
  }, []);

  const locked = useCallback(() => actionLock.current, []);

  return { busy, run, locked };
}
