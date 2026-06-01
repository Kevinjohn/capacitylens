import type { AppData } from '@floaty/shared/types/entities'

// The seam that makes "local now, shared backend later" an adapter swap rather
// than a rewrite. The async signature is deliberate: a fetch-based adapter must
// drop in without touching any call site.
export interface PersistenceAdapter {
  loadAll(): Promise<AppData>
  /** Persist the whole dataset. `opts.unload` signals a page-teardown flush: an async
   *  adapter must then DISPATCH every write up-front (a sequential await-loop would only
   *  get the first request out before the event loop dies). Synchronous adapters ignore it. */
  saveAll(data: AppData, opts?: { unload?: boolean }): Promise<void>
  /** True when a dataset was ever persisted — lets bootstrap distinguish a
   *  genuine first run from a user who deliberately cleared everything. */
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

  constructor(kind: LoadErrorKind, message: string) {
    super(message)
    this.kind = kind
    this.name = 'LoadError'
  }
}
