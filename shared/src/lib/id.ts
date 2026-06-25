/**
 * A fresh, globally-unique id (RFC-4122 v4 UUID). Wrapped so call sites don't depend on the
 * `crypto` API directly.
 *
 * **Runtime requirement:** `crypto.randomUUID` needs a *secure context* in the browser
 * (HTTPS or localhost) and Node 19+ / a modern runtime. `@capacitylens/shared` is published, so an
 * embedder could load it somewhere `crypto` is absent.
 *
 * @throws {Error} a clear message if `crypto.randomUUID` is unavailable, rather than a cryptic
 *   native `TypeError`. We deliberately do **not** fall back to `Math.random`: the import-remap
 *   engine (`domain/mutations.ts`) relies on ids being globally unique, and a weak fallback could
 *   silently mint a collision — exactly the kind of invisible corruption we refuse to risk. A loud
 *   failure in an unsupported runtime is the correct, surfaced outcome.
 */
export function newId(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error(
      'newId(): crypto.randomUUID is unavailable. CapacityLens needs a secure context (HTTPS or localhost) ' +
        'in the browser, or Node 19+ / a modern runtime, to generate unique ids.',
    )
  }
  return crypto.randomUUID()
}
