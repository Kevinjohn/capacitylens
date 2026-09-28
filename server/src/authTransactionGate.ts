import { AsyncLocalStorage } from "node:async_hooks";
import type { Db } from "./db";

/** A request's claim on the shared side of the gate. `closed` is set when the request ends, even
 * while it is still waiting, so a slot granted after the client left is returned immediately. */
export interface GateSlot {
  held: boolean;
  closed: boolean;
}

/** The authentication library keeps its transactions open on the shared SQLite handle across
 * awaits, and tx() refuses to join them. Requests and background writers therefore hold a shared
 * slot while they may write; each library transaction runs exclusively, so their writes wait for it
 * instead of meeting an open foreign transaction. */
export class AuthTransactionGate {
  readonly #slots = new AsyncLocalStorage<GateSlot>();
  readonly #wakers = new Set<() => void>();
  #sharedHolders = 0;
  #exclusiveActive = false;
  #exclusiveWaiters = 0;

  /** Wait for any library transaction to finish, then hold a shared slot until {@link release}. */
  async enter(slot: GateSlot): Promise<void> {
    // Writers take precedence: a waiting library transaction is not starved by a stream of requests.
    await this.#acquire(
      () => slot.closed || (!this.#exclusiveActive && this.#exclusiveWaiters === 0),
      () => {
        if (slot.closed) return;
        slot.held = true;
        this.#sharedHolders++;
      },
    );
  }

  release(slot: GateSlot): void {
    slot.closed = true;
    this.#yield(slot);
  }

  /** Run code inside the slot's async context so a library transaction it starts can yield it. */
  runInSlot<Result>(slot: GateSlot, callback: () => Result): Result {
    return this.#slots.run(slot, callback);
  }

  /** Hold a shared slot for background work that writes outside any request. */
  async runShared<Result>(callback: () => Result): Promise<Result> {
    const slot: GateSlot = { held: false, closed: false };
    await this.enter(slot);
    try {
      return this.runInSlot(slot, callback);
    } finally {
      this.release(slot);
    }
  }

  /** Run one library transaction alone: wait for every shared holder, then block new ones. */
  async runExclusive<Result>(transaction: () => Promise<Result>): Promise<Result> {
    // A request that reaches the library (sign-up, provider callback) must not wait for itself.
    const own = this.#slots.getStore();
    const yielded = own?.held === true;
    if (own) this.#yield(own);
    this.#exclusiveWaiters++;
    await this.#acquire(
      () => this.#sharedHolders === 0 && !this.#exclusiveActive,
      () => {
        this.#exclusiveWaiters--;
        this.#exclusiveActive = true;
      },
    );
    try {
      return await transaction();
    } finally {
      this.#exclusiveActive = false;
      this.#wake();
      if (own && yielded) await this.enter(own);
    }
  }

  #yield(slot: GateSlot): void {
    if (!slot.held) return;
    slot.held = false;
    this.#sharedHolders--;
    this.#wake();
  }

  #wake(): void {
    const pending = [...this.#wakers];
    this.#wakers.clear();
    for (const resume of pending) resume();
  }

  /** Take the gate in the same turn that found it free; waking resumes every waiter, so a check
   * separated from its update by an await would let two waiters in at once. */
  async #acquire(ready: () => boolean, take: () => void): Promise<void> {
    while (!ready()) await new Promise<void>((resume) => this.#wakers.add(resume));
    take();
  }
}

const gates = new WeakMap<Db, AuthTransactionGate>();

/** The gate belongs to the handle, so the HTTP layer and the authentication library share it. */
export function authTransactionGateFor(db: Db): AuthTransactionGate {
  let gate = gates.get(db);
  if (!gate) {
    gate = new AuthTransactionGate();
    gates.set(db, gate);
  }
  return gate;
}
