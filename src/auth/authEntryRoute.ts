export type PublicAuthEntry = 'password-reset' | 'invitation' | null

/** Classify the only routes allowed to render before authentication. Exact one-segment matching
 * keeps malformed or nested URLs behind the normal login wall. */
export function publicAuthEntryForPath(pathname: string): PublicAuthEntry {
  if (/^\/reset-password\/[^/]+$/.test(pathname)) return 'password-reset'
  if (/^\/invite\/[^/]+$/.test(pathname)) return 'invitation'
  return null
}
