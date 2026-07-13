import type { AppData } from '@capacitylens/shared/types/entities'

// The seam that makes "local now, shared backend later" an adapter swap rather
// than a rewrite. The async signature is deliberate: a fetch-based adapter must
// drop in without touching any call site.
export interface PersistenceAdapter {
  /** Load the persisted dataset. `accountId` (P1.13, server adapter only) loads ONLY that account's
   *  scoped slice and re-seeds the diff snapshot to it; OMITTED is the whole-tree read (OFF/demo, and
   *  the pre-pick bootstrap). Synchronous/local adapters ignore the argument (the whole blob is the
   *  only thing they hold). */
  loadAll(accountId?: string): Promise<AppData>
  /** Persist the whole dataset. `opts.unload` signals a page-teardown flush: an async
   *  adapter must then DISPATCH every write up-front (a sequential await-loop would only
   *  get the first request out before the event loop dies). Synchronous adapters ignore it. */
  saveAll(data: AppData, opts?: { unload?: boolean }): Promise<void>
  /** Explicitly abandon a durable pending write after the user/application chooses server-wins
   *  conflict resolution. Ordinary failures must never call this. */
  discardPending?(accountId: string): void
  /** Subscribe to a whole-dataset change made by another local tab. Return true to accept the
   *  adapter's new revision, false when local unsaved work makes replacement unsafe. */
  subscribeExternal?(listener: (data: AppData) => boolean): () => void
  /** True when a dataset was ever persisted — lets bootstrap distinguish a
   *  genuine first run from a user who deliberately cleared everything.
   *
   *  MAY THROW (e.g. a server `/api/meta` round-trip can fail). A throw is INDETERMINATE,
   *  not "no data": callers MUST compensate non-destructively — bootstrap falls back to
   *  `!isEmpty(loaded)` — and must NEVER react to a throw by discarding already-loaded data or
   *  skipping the persistence attach (that would strand the user unable to save). */
  hasExisting?(): Promise<boolean>
}

/** How a load failure can be recovered from. 'corrupt' = the bytes are present
 *  locally but unreadable, so the user RESETS (clears local storage). 'unavailable'
 *  = a remote/server load failed, so the user RETRIES — clearing local storage would
 *  do nothing useful. bootstrap routes the two to different recovery UIs. */
export type LoadErrorKind = 'corrupt' | 'unavailable'

/** Thrown by an adapter's loadAll when stored data couldn't be read. The `kind`
 *  tells bootstrap which recovery path applies; a plain Error (or any other throw)
 *  defaults to the conservative local 'corrupt' path. */
export class LoadError extends Error {
  readonly kind: LoadErrorKind

  // Accepts ErrorOptions so adapters reclassifying a caught failure (parse/migrate/storage/network)
  // can forward `{ cause }` and preserve the FULL error chain, not just a re-worded message.
  constructor(kind: LoadErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.kind = kind
    this.name = 'LoadError'
  }
}
