import { emptyAppData, SCHEMA_VERSION } from '@capacitylens/shared/types/entities'
import type { AppData, PersistedState } from '@capacitylens/shared/types/entities'
import { LoadError, type PersistenceAdapter } from './PersistenceAdapter'
import { migrate } from '@capacitylens/shared/data/migrate'

// The canonical table keys (accounts + every scoped table), derived from emptyAppData so
// this never drifts from the schema. A stored blob whose table is present but NOT an array
// is structurally damaged — migrate() would silently coerce it to [] and drop the data.
const TABLE_KEYS = Object.keys(emptyAppData())

function hasNonArrayTable(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const obj = raw as Record<string, unknown>
  // The blob is `{ schemaVersion, data }` or a bare AppData. If `data` is present it must
  // be the table container; a non-object `data` is itself corruption.
  let data: Record<string, unknown>
  if ('data' in obj) {
    if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) return true
    data = obj.data as Record<string, unknown>
  } else {
    data = obj
  }
  return TABLE_KEYS.some((k) => k in data && !Array.isArray(data[k]))
}

export class LocalStorageConflictError extends Error {
  constructor() {
    super('This data changed in another tab. Reload before saving again.')
    this.name = 'LocalStorageConflictError'
  }
}

export class LocalStorageAdapter implements PersistenceAdapter {
  private readonly key: string
  private revision = 0

  // The storage key is required (no default): the live key is versioned
  // (`capacitylens/v3`, see main.tsx) and a silent default would read/write an
  // orphaned older key.
  constructor(key: string) {
    this.key = key
  }

  async loadAll(): Promise<AppData> {
    let raw: string | null
    try {
      raw = localStorage.getItem(this.key)
    } catch (e) {
      // Reading storage ITSELF failed (SecurityError / storage disabled in a sandboxed or
      // private-mode context) — the bytes aren't corrupt, the store is UNAVAILABLE. Classify it
      // as such so bootstrap shows the non-destructive retry screen, NOT the corrupt → reset/import
      // path (which the previously-unguarded read fell into via bootstrap's default 'corrupt'
      // branch — and reset would wipe storage to "fix" a problem that was never corruption). The
      // sibling methods (hasExisting / readRaw / clear) already guard getItem this same way.
      console.warn('LocalStorageAdapter.loadAll: reading local storage failed', e)
      throw new LoadError('unavailable', 'Local storage could not be read on this device.', { cause: e })
    }
    if (!raw) {
      this.revision = 0
      return emptyAppData()
    }
    // A parse/migrate failure here means the stored bytes are CORRUPT, not absent.
    // Rethrow rather than returning empty: bootstrap must tell these apart so it
    // can refuse to overwrite recoverable-but-unreadable data with a blank save.
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      throw new LoadError('corrupt', 'Stored CapacityLens data could not be parsed.', { cause: e })
    }
    // Parseable but STRUCTURALLY damaged (e.g. a partial write left a table as a string):
    // migrate() would coerce it to [] and silently drop the data, then the next autosave
    // would overwrite the recoverable bytes. Treat it as corrupt so the recovery UI
    // (export-raw / reset) fires instead.
    if (hasNonArrayTable(parsed)) {
      throw new LoadError('corrupt', 'Stored CapacityLens data is damaged.')
    }
    try {
      this.revision =
        typeof (parsed as { revision?: unknown }).revision === 'number'
          ? (parsed as { revision: number }).revision
          : 0
      return migrate(parsed)
    } catch (e) {
      throw new LoadError('corrupt', 'Stored CapacityLens data could not be parsed.', { cause: e })
    }
  }

  async hasExisting(): Promise<boolean> {
    try {
      return localStorage.getItem(this.key) !== null
    } catch {
      return false
    }
  }

  /** The raw stored string, for a recovery UI to offer "export raw" before reset.
   *  Returns null when nothing is stored or storage is unreadable. */
  readRaw(): string | null {
    try {
      return localStorage.getItem(this.key)
    } catch {
      return null
    }
  }

  /** Remove the stored dataset entirely (corrupt-data recovery → reset). */
  clear(): void {
    try {
      localStorage.removeItem(this.key)
      this.revision = 0
    } catch {
      // Nothing to clear / storage unavailable — the reload will reseed anyway.
    }
  }

  async saveAll(data: AppData): Promise<void> {
    const raw = localStorage.getItem(this.key)
    if (raw) {
      try {
        const current = JSON.parse(raw) as { revision?: unknown }
        const currentRevision = typeof current.revision === 'number' ? current.revision : 0
        if (currentRevision !== this.revision) throw new LocalStorageConflictError()
      } catch (error) {
        if (error instanceof LocalStorageConflictError) throw error
        throw new LoadError('corrupt', 'Stored CapacityLens data could not be compared before saving.', {
          cause: error,
        })
      }
    } else if (this.revision !== 0) {
      throw new LocalStorageConflictError()
    }
    const revision = this.revision + 1
    const state: PersistedState = { schemaVersion: SCHEMA_VERSION, data, revision }
    // Let quota / private-mode failures reject so callers can surface them
    // instead of silently losing changes.
    localStorage.setItem(this.key, JSON.stringify(state))
    this.revision = revision
  }

  subscribeExternal(listener: (data: AppData) => boolean): () => void {
    if (typeof window === 'undefined') return () => {}
    const onStorage = (event: StorageEvent) => {
      if ((event.key !== this.key && event.key !== null) || event.storageArea !== localStorage) return
      try {
        if (event.newValue === null) {
          if (listener(emptyAppData())) this.revision = 0
          return
        }
        const parsed: unknown = JSON.parse(event.newValue)
        if (hasNonArrayTable(parsed)) return
        const data = migrate(parsed)
        if (!listener(data)) return
        const revision = (parsed as { revision?: unknown }).revision
        this.revision = typeof revision === 'number' ? revision : 0
      } catch (error) {
        console.warn('LocalStorageAdapter: ignored an unreadable cross-tab update', error)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }
}
