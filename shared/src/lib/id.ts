/** Stable unique id. Wrapped so call sites don't depend on the crypto API directly. */
export function newId(): string {
  return crypto.randomUUID()
}
