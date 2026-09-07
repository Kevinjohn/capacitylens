import { AsyncLocalStorage } from "node:async_hooks";

interface LockState {
  held: ReadonlySet<string>;
  active: boolean;
}

/**
 * A bounded, process-local, keyed critical section. Keys are acquired in lexical order, which
 * prevents actor/target deadlocks. Re-entrancy is tracked per async call chain so AccountFlows may
 * hold a principal lock while calling a port method that protects the same mutation choke point.
 */
export class KeyedOperationLock {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly context = new AsyncLocalStorage<LockState>();

  async withKeys<T>(keys: readonly string[], operation: () => Promise<T> | T): Promise<T> {
    const wanted = [...new Set(keys.filter(Boolean))].sort();
    const inherited = this.context.getStore();
    const held = inherited?.active === true ? inherited.held : new Set<string>();
    const missing = wanted.filter((key) => !held.has(key));
    if (missing.length === 0) return operation();

    // A nested scope may extend its lock set only in the same global lexical order used by
    // top-level acquisition. Acquiring `a` while already holding `b` can deadlock with another
    // request that holds `a` and is waiting for `b`; fail loudly instead of hanging both account
    // commands forever. Coordinators must declare the complete key set before entering a scope.
    const greatestHeld = [...held].sort().at(-1);
    if (greatestHeld !== undefined && missing.some((key) => key < greatestHeld)) {
      throw new Error(
        `Account operation lock order violation: cannot acquire a key before already-held ${greatestHeld}.`,
      );
    }

    const releases: Array<() => void> = [];
    for (const key of missing) {
      const previous = this.tails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = previous.then(() => current);
      this.tails.set(key, tail);
      await previous;
      releases.push(() => {
        release();
        if (this.tails.get(key) === tail) this.tails.delete(key);
      });
    }

    const state: LockState = { held: new Set([...held, ...missing]), active: true };
    try {
      return await this.context.run(state, async () => operation());
    } finally {
      // Async resources spawned inside the operation inherit this object. Mark it inactive before
      // releasing the physical tails so a later continuation cannot mistake stale ALS context for
      // locks that are no longer held.
      state.active = false;
      for (const release of releases.reverse()) release();
    }
  }

  pendingKeyCount(): number {
    return this.tails.size;
  }
}
