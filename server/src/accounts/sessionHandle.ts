import { createHash } from 'node:crypto'

/** Stable, non-reversible application-local handle for a Better Auth bearer session token. */
export function applicationSessionHandle(applicationId: string, token: string): string {
  return createHash('sha256')
    .update(`${applicationId}-session-handle\0`)
    .update(token)
    .digest('base64url')
}
