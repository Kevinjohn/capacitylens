/** Short process-local retry horizon for a response that contained a write-once bearer. The bearer
 * itself may remain valid longer, but this cache exists only to reconcile an immediate lost response. */
export const WRITE_ONCE_SECRET_REPLAY_WINDOW_MS = 5 * 60 * 1000;

interface ReservedReplayEntry {
  kind: "reserved";
}

interface StoredReplayEntry<T> {
  kind: "stored";
  value: T;
  retainedUntil: number;
  evictionTimer: ReturnType<typeof setTimeout>;
}

type ReplayEntry<T> = ReservedReplayEntry | StoredReplayEntry<T>;

export type ReplayReservation = { accepted: true } | { accepted: false; retryAfterMs: number };

/** Bounded process-local cache for a write-once response. Callers reserve capacity before minting
 * a bearer, so pressure rejects a new issuance instead of silently displacing a completed response.
 * Values are never persisted and become unreachable after the short retry horizon. */
export class WriteOnceSecretReplay<T> {
  readonly #entries = new Map<string, ReplayEntry<T>>();
  readonly #maxEntries: number;

  constructor(maxEntries: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error("Write-once replay capacity must be a positive safe integer.");
    }
    this.#maxEntries = maxEntries;
  }

  get(commandId: string, now = Date.now()): T | undefined {
    this.#prune(now);
    const entry = this.#entries.get(commandId);
    return entry?.kind === "stored" ? entry.value : undefined;
  }

  reserve(commandId: string, now = Date.now()): ReplayReservation {
    this.#prune(now);
    const duplicate = this.#entries.get(commandId);
    if (duplicate) {
      return {
        accepted: false,
        retryAfterMs: duplicate.kind === "stored" ? Math.max(1, duplicate.retainedUntil - now) : 1_000,
      };
    }
    if (this.#entries.size >= this.#maxEntries) {
      let earliestRelease = Number.POSITIVE_INFINITY;
      for (const entry of this.#entries.values()) {
        if (entry.kind === "stored") earliestRelease = Math.min(earliestRelease, entry.retainedUntil);
      }
      return {
        accepted: false,
        // Active reservations have no deadline because their provider call is still in progress.
        // Give callers a short, honest backoff when every slot is currently reserved.
        retryAfterMs: Number.isFinite(earliestRelease) ? Math.max(1, earliestRelease - now) : 1_000,
      };
    }
    this.#entries.set(commandId, { kind: "reserved" });
    return { accepted: true };
  }

  storeReserved(commandId: string, value: T, now = Date.now()): void {
    const reservation = this.#entries.get(commandId);
    if (reservation?.kind !== "reserved") {
      throw new Error("Write-once response was stored without reserved replay capacity.");
    }
    this.#entries.delete(commandId);
    const retainedUntil = now + WRITE_ONCE_SECRET_REPLAY_WINDOW_MS;
    // Capture only the command coordinate/deadline, never `value`, so early deletion also releases
    // the bearer from the timer queue. `unref` prevents a replay horizon from keeping shutdown alive.
    const evictionTimer = setTimeout(() => {
      const current = this.#entries.get(commandId);
      if (current?.kind === "stored" && current.retainedUntil === retainedUntil) {
        this.#delete(commandId);
      }
    }, WRITE_ONCE_SECRET_REPLAY_WINDOW_MS);
    evictionTimer.unref();
    this.#entries.set(commandId, {
      kind: "stored",
      value,
      retainedUntil,
      evictionTimer,
    });
  }

  releaseReservation(commandId: string): void {
    if (this.#entries.get(commandId)?.kind === "reserved") this.#entries.delete(commandId);
  }

  deleteWhere(predicate: (value: T) => boolean): void {
    for (const [commandId, entry] of this.#entries) {
      if (entry.kind === "stored" && predicate(entry.value)) this.#delete(commandId);
    }
  }

  #prune(now: number): void {
    for (const [commandId, entry] of this.#entries) {
      if (entry.kind === "stored" && entry.retainedUntil <= now) this.#delete(commandId);
    }
  }

  #delete(commandId: string): void {
    const entry = this.#entries.get(commandId);
    if (entry?.kind === "stored") clearTimeout(entry.evictionTimer);
    this.#entries.delete(commandId);
  }
}
