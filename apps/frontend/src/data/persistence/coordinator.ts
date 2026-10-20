import type { FlushPendingWritesResult, RefreshOutcome } from "./facades";
/** Callbacks registered by the planning runtime for refresh and command coordination. */
export interface PersistenceRegistration {
  refreshActive?: (id: string) => Promise<Exclude<RefreshOutcome, { kind: "unattached" }>>;
  flushPending?: () => Promise<FlushPendingWritesResult>;
  suspendWrites?: () => (options?: { dropParkedEdits?: boolean }) => void;
  switchAndAwaitHydration?: (id: string | null) => Promise<RefreshOutcome>;
  retryActiveAccountLoad?: (id: string) => Promise<RefreshOutcome>;
  hasUnsavedWrites: () => boolean;
}

// Owns the currently attached planning runtime so public seams share one coordinator.
class PersistenceCoordinator {
  private registration: PersistenceRegistration | null = null;

  attach(registration: PersistenceRegistration): () => void {
    if (this.registration) {
      throw new Error("Persistence is already attached.");
    }
    this.registration = registration;
    return () => {
      if (this.registration === registration) this.registration = null;
    };
  }

  hasUnsavedWrites(): boolean {
    return this.registration?.hasUnsavedWrites() ?? false;
  }

  suspendWrites(): (options?: { dropParkedEdits?: boolean }) => void {
    return this.registration?.suspendWrites?.() ?? (() => {});
  }

  async flushPending(): Promise<FlushPendingWritesResult> {
    return this.registration?.flushPending?.() ?? { kind: "clean" };
  }

  async refreshActive(id: string): Promise<RefreshOutcome> {
    return this.registration?.refreshActive?.(id) ?? { kind: "unattached" };
  }

  async switchAndAwaitHydration(id: string | null): Promise<RefreshOutcome> {
    return this.registration?.switchAndAwaitHydration?.(id) ?? { kind: "unattached" };
  }

  async retryActiveAccountLoad(id: string): Promise<RefreshOutcome> {
    return this.registration?.retryActiveAccountLoad?.(id) ?? { kind: "unattached" };
  }
}

/** Shared coordinator for planning refreshes and command reconciliation. */
export const persistenceCoordinator = new PersistenceCoordinator();
