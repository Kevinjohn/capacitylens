import { useRef, useState } from 'react';
import type { Entity } from '@capacitylens/shared/types/entities';
import { PlanningSaveCancelledError } from '@/data/planning/PlanningSaveCancelledError';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { isStaleEdit } from '@/lib/isStaleEdit';
import type { CreateResult } from '@/store/StoreEntityActions';

/** One validated write. A `blocked` create keeps the form open without an error. */
export type EntitySave = () => Promise<CreateResult<unknown> | void>;

/** The form state and callbacks one entity form hands to {@link useEditSubmit}. */
export interface EditSubmitInput<T extends Entity> {
  /** The row the form edits; absent when the form creates a row. */
  editing: T | undefined;
  /** The current rows of the edited entity, used to refuse an edit whose row changed or vanished. */
  rows: readonly T[];
  /** The form-level message for a stale edit. */
  staleMessage: () => string;
  /** Shown instead of the generic message when the save rejects with a value that is not an `Error`. */
  failedMessage?: () => string;
  fail: (field: string | null, message: string) => void;
  onSaved: () => void;
}

/** The pending flag for the form's controls and the submit entry point. */
export interface EditSubmit {
  pending: boolean;
  /**
   * Runs `prepare` and, when it returns a save, refuses a stale edit, then saves and calls
   * `onSaved`. A second submit while one is in flight is ignored; a failed save stays on the form.
   */
  submit: (prepare: () => EntitySave | null) => Promise<void>;
}

/**
 * Owns the submit protocol shared by the entity forms: the in-flight guard, the stale-edit check
 * against the supplied rows and the handling of a save the user cancelled.
 */
export function useEditSubmit<T extends Entity>(input: EditSubmitInput<T>): EditSubmit {
  // The ref refuses a double submit before React can disable the controls.
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  const submit = async (prepare: () => EntitySave | null) => {
    if (inFlight.current) return;
    const save = prepare();
    if (!save) return;
    const { editing } = input;
    if (editing && isStaleEdit(input.rows, editing.id, editing.updatedAt)) {
      input.fail(null, input.staleMessage());
      return;
    }
    inFlight.current = true;
    setPending(true);
    try {
      const result = await save();
      if (result && result.kind === 'blocked') return;
      input.onSaved();
    } catch (error) {
      // The user declined the save in the restoration cleanup dialog: the draft stays open, unsaved and without an error.
      if (error instanceof PlanningSaveCancelledError) return;
      // Any other rejection is shown on the form so the unsaved draft can be corrected and retried.
      input.fail(
        null,
        input.failedMessage && !(error instanceof Error)
          ? input.failedMessage()
          : resolveErrorMessage(error),
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return { pending, submit };
}
