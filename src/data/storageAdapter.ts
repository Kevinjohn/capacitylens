import { LocalStorageAdapter } from './LocalStorageAdapter'

// The single live persistence target, shared by the bootstrap (main.tsx) and the
// corrupt-data recovery UI (which needs readRaw/clear on the SAME key). The key is
// versioned — bumping it orphans older data on purpose (see migrate.ts).
export const STORAGE_KEY = 'floaty/v3'

export const storageAdapter = new LocalStorageAdapter(STORAGE_KEY)
