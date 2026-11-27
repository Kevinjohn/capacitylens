import { readValidationMessage } from '@capacitylens/shared/api/httpErrors'

/**
 * Read the server's user-facing error from a failed response.
 * The response is cloned, so the caller can still read the original.
 * Invalid or unreadable JSON returns undefined so callers can use a fallback.
 */
export async function readApiError(res: Response): Promise<string | undefined> {
  let readable: Response
  try {
    if (res.bodyUsed) return undefined
    readable = res.clone()
  } catch {
    // A locked body cannot be cloned; callers still handle the original response with a fallback message.
    return undefined
  }
  // Unreadable JSON loses only the optional server detail; callers still handle the response.
  const body: unknown = await readable.json().catch(() => null)
  return extractApiErrorMessage(body)
}

/** Best-effort read of a string API error code without consuming the response body. */
export async function readApiErrorCode(res: Response): Promise<string | null> {
  if (res.bodyUsed) return null
  let readable: Response
  try {
    readable = res.clone()
  } catch {
    // Classification is optional; the caller still handles the original response and its failure.
    return null
  }
  // Unreadable JSON loses only the optional classification.
  const body: unknown = await readable.json().catch(() => null)
  if (typeof body !== 'object' || body === null) return null
  const code = (body as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

/**
 * Validate an already-decoded API error body without reading a response: the product's `error`, or
 * the first message of the framework's validation answer.
 */
export function extractApiErrorMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const error = (body as { error?: unknown }).error
  const message = typeof error === 'string' ? error : readValidationMessage(body)
  if (message === undefined) return undefined
  const trimmed = message.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
