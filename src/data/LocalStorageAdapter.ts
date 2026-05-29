import { emptyAppData, SCHEMA_VERSION } from '../types/entities'
import type { AppData, PersistedState } from '../types/entities'
import type { PersistenceAdapter } from './PersistenceAdapter'
import { migrate } from './migrate'

const DEFAULT_KEY = 'floaty/v1'

export class LocalStorageAdapter implements PersistenceAdapter {
  private readonly key: string

  constructor(key: string = DEFAULT_KEY) {
    this.key = key
  }

  async loadAll(): Promise<AppData> {
    try {
      const raw = localStorage.getItem(this.key)
      if (!raw) return emptyAppData()
      return migrate(JSON.parse(raw))
    } catch {
      // Corrupt or unreadable storage shouldn't brick the app.
      return emptyAppData()
    }
  }

  async hasExisting(): Promise<boolean> {
    try {
      return localStorage.getItem(this.key) !== null
    } catch {
      return false
    }
  }

  async saveAll(data: AppData): Promise<void> {
    const state: PersistedState = { schemaVersion: SCHEMA_VERSION, data }
    // Let quota / private-mode failures reject so callers can surface them
    // instead of silently losing changes.
    localStorage.setItem(this.key, JSON.stringify(state))
  }
}
