/** Normalise anything thrown (an Error, a bare string, a React Router ErrorResponse, …)
 *  to a human message, so a non-Error throw never renders a blank screen.
 *
 *  @remarks This is intentionally TOTAL — every input maps to a string and it can never throw.
 *    It's the standard SINK for `catch` blocks across the app, so do NOT wrap it in its own
 *    try/catch (there is nothing to guard, and a wrapper would only add noise). */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (
    error &&
    typeof error === 'object' &&
    'statusText' in error &&
    typeof (error as { statusText?: unknown }).statusText === 'string'
  ) {
    return (error as { statusText: string }).statusText
  }
  return 'An unexpected error occurred.'
}
