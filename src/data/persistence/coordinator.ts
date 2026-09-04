import type { RefreshOutcome } from "./facades";
export interface PersistenceRegistration {
  refreshActive?: (id: string) => Promise<"reloaded" | "skipped" | "failed">;
  flushPending?: () => Promise<boolean>;
  suspendWrites?: () => (opts?: { dropParkedEdits?: boolean }) => void;
  switchAndAwaitHydration?: (id: string | null) => Promise<RefreshOutcome>;
  hasUnsavedWrites: () => boolean;
}

/**
 * One owner for the currently attached persistence lifecycle. Public seams delegate to this
 * instance instead of coordinating four independent module-global callbacks.
 */
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

  suspendWrites(): (opts?: { dropParkedEdits?: boolean }) => void {
    return this.registration?.suspendWrites?.() ?? (() => {});
  }

  async flushPending(): Promise<boolean> {
    return this.registration?.flushPending?.() ?? true;
  }

  async refreshActive(id: string): Promise<RefreshOutcome> {
    return this.registration?.refreshActive?.(id) ?? "unattached";
  }

  async switchAndAwaitHydration(id: string | null): Promise<RefreshOutcome> {
    return this.registration?.switchAndAwaitHydration?.(id) ?? "unattached";
  }
}

export const persistenceCoordinator = new PersistenceCoordinator();
