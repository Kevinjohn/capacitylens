import { isRecord } from '@capacitylens/shared/lib/isRecord'

/**
 * Reads a 2xx JSON answer's `{ data }` envelope and returns `data`.
 *
 * @throws When the body is not JSON or carries no `data` key.
 */
export async function readApiData<T = unknown>(response: Response): Promise<T> {
  const body: unknown = await response.json()
  if (!isRecord(body) || !('data' in body)) {
    throw new Error('The response has no data envelope.')
  }
  return body.data as T
}
