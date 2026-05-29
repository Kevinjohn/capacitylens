import type { AppData } from '../types/entities'

// The seam that makes "local now, shared backend later" an adapter swap rather
// than a rewrite. The async signature is deliberate: a fetch-based adapter must
// drop in without touching any call site.
export interface PersistenceAdapter {
  loadAll(): Promise<AppData>
  saveAll(data: AppData): Promise<void>
  /** True when a dataset was ever persisted — lets bootstrap distinguish a
   *  genuine first run from a user who deliberately cleared everything. */
  hasExisting?(): Promise<boolean>
}
