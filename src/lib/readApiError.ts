/** Reads and validates the server's user-facing error from a failed response. Invalid or unreadable
 * JSON returns undefined so callers can use their fallback message. */
export async function readApiError(res: Response): Promise<string | undefined> {
  let readable: Response;
  try {
    if (res.bodyUsed) return undefined;
    readable = typeof res.clone === "function" ? res.clone() : res;
  } catch {
    return undefined;
  }
  const body: unknown = await readable.json().catch(() => null);
  return extractApiErrorMessage(body);
}

/** Best-effort read of a string API error code without consuming the response body. */
export async function readApiErrorCode(res: Response): Promise<string | null> {
  if (res.bodyUsed || typeof res.clone !== "function") return null;
  let readable: Response;
  try {
    readable = res.clone();
  } catch {
    // Classification is optional; the caller still handles the original response and its failure.
    return null;
  }
  const body: unknown = await readable.json().catch(() => null);
  if (typeof body !== "object" || body === null) return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** Validate an already-decoded API error body without reading a response. */
export function extractApiErrorMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "string") return undefined;
  const trimmed = error.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
