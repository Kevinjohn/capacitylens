import { emptyAppData, type AppData } from '@capacitylens/shared/types/entities'
import type { PersistenceAdapter } from './PersistenceAdapter'

/** Ephemeral persistence for the zero-setup browser demo. It deliberately survives React/store
 * writes only for the current page lifetime: refreshing restores the canonical seed, so a visitor
 * can freely explore without creating a second, browser-owned production data model. */
export class InMemoryDemoAdapter implements PersistenceAdapter {
  private data = emptyAppData()
  private initialized = false

  async loadAll(): Promise<AppData> {
    return this.data
  }

  async saveAll(data: AppData): Promise<void> {
    this.data = data
    this.initialized = true
  }

  async hasExisting(): Promise<boolean> {
    return this.initialized
  }
}
