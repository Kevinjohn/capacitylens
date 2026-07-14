import { useCallback, useId, useState } from 'react'

export interface FieldError {
  /** The current error message, or null. */
  error: string | null
  /** Which field the error belongs to (drives aria-invalid on that control). */
  errorField: string | null
  /** Stable id shared by the error <FieldError> and each field's aria-describedby. */
  errorId: string
  /** Record an error against a field (pass null for a form-level error). */
  fail: (field: string | null, message: string) => void
}

/** The error/errorField/errorId/fail quartet every CRUD form hand-rolled. One copy.
 *  Associating the error with the offending field (aria-invalid + aria-describedby)
 *  means it's announced when navigating to that field, not only via the alert. */
export function useFieldError(): FieldError {
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<string | null>(null)
  const errorId = useId()
  const fail = useCallback((field: string | null, message: string) => {
    setError(message)
    setErrorField(field)
  }, [])
  return { error, errorField, errorId, fail }
}
