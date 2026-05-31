import { emptyAppData, SCHEMA_VERSION } from '../types/entities'
import type { AppData, PersistedState } from '../types/entities'
import type { PersistenceAdapter } from './PersistenceAdapter'
import { migrate } from './migrate'

export class LocalStorageAdapter implements PersistenceAdapter {
  private readonly key: string

  // The storage key is required (no default): the live key is versioned
  // (`floaty/v3`, see main.tsx) and a silent default would read/write an
  // orphaned older key.
  constructor(key: string) {
    this.key = key
  }

  async loadAll(): Promise<AppData> {
    const raw = localStorage.getItem(this.key)
    if (!raw) return emptyAppData()
    // A parse/migrate failure here means the stored bytes are CORRUPT, not absent.
    // Rethrow rather than returning empty: bootstrap must tell these apart so it
    // can refuse to overwrite recoverable-but-unreadable data with a blank save.
    try {
      return migrate(JSON.parse(raw))
    } catch {
      throw new Error('Stored Floaty data could not be parsed.')
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
    } catch {
      // Nothing to clear / storage unavailable — the reload will reseed anyway.
    }
  }

  async saveAll(data: AppData): Promise<void> {
    const state: PersistedState = { schemaVersion: SCHEMA_VERSION, data }
    // Let quota / private-mode failures reject so callers can surface them
    // instead of silently losing changes.
    localStorage.setItem(this.key, JSON.stringify(state))
  }
}
