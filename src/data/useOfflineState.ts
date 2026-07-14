import { useSyncExternalStore } from 'react'
import { offlineStateSnapshot, subscribeOfflineState } from './offlineCache'

/** Reactive view of the device's read-only offline state. */
export function useOfflineState() {
  return useSyncExternalStore(subscribeOfflineState, offlineStateSnapshot, offlineStateSnapshot)
}
