import type { IsoInstant } from "@capacitylens/shared/account/types";

const MAX_PRUNE_PER_PASS = 64;

/** Internal server-only masquerade state. Tokens and session handles never cross into audit data. */
export interface MasqueradeRecord {
  sessionHandle: string;
  userId: string;
  accountId: string;
  targetUserId: string;
  token: string;
  startedAt: IsoInstant;
  expiresAt: IsoInstant;
}

/** Registry view that preserves an end whose audit enqueue has not committed yet. */
export type StoredMasqueradeRecord = MasqueradeRecord & { phase: "active" | "ending" };

/** Raised when a caller attempts to replace an active session projection. */
export class MasqueradeAlreadyActiveError extends Error {
  constructor() {
    super("This session is already masquerading.");
    this.name = "MasqueradeAlreadyActiveError";
  }
}

interface MasqueradeRegistryOptions {
  now?: () => number;
  expired?: (record: Readonly<StoredMasqueradeRecord>) => void;
}

/** Session-keyed, process-local masquerade registry with audit-before-state-change ordering. */
export class MasqueradeRegistry {
  readonly #bySession = new Map<string, StoredMasqueradeRecord>();
  readonly #byUser = new Map<string, Set<string>>();
  readonly #now: () => number;
  readonly #expired: (record: Readonly<StoredMasqueradeRecord>) => void;

  constructor(options: MasqueradeRegistryOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#expired = options.expired ?? (() => undefined);
  }

  /** Read without pruning. Reserved for lifecycle coordination and tests. */
  peek(sessionHandle: string): Readonly<StoredMasqueradeRecord> | null {
    return this.#bySession.get(sessionHandle) ?? null;
  }

  /** Read one session after a bounded expiry prune. An audit failure throws and retains the record. */
  lookup(sessionHandle: string): Readonly<StoredMasqueradeRecord> | null {
    this.pruneExpired();
    return this.peek(sessionHandle);
  }

  /** Insert only after `beforeInsert` durably accepts the matching start event. */
  start(record: MasqueradeRecord, beforeInsert: (record: Readonly<MasqueradeRecord>) => void): void {
    this.pruneExpired();
    if (this.#bySession.has(record.sessionHandle)) throw new MasqueradeAlreadyActiveError();
    beforeInsert(record);
    const stored: StoredMasqueradeRecord = { ...record, phase: "active" };
    this.#bySession.set(record.sessionHandle, stored);
    let sessions = this.#byUser.get(record.userId);
    if (!sessions) {
      sessions = new Set();
      this.#byUser.set(record.userId, sessions);
    }
    sessions.add(record.sessionHandle);
  }

  /** End a matching token idempotently. A failed audit leaves the record guarded as `ending`. */
  end(
    sessionHandle: string,
    expectedToken: string | null,
    beforeDelete: (record: Readonly<StoredMasqueradeRecord>) => void,
  ): boolean {
    if (!this.prepareEnd(sessionHandle, expectedToken, beforeDelete)) return false;
    this.commitEnd([sessionHandle]);
    return true;
  }

  /** Mark a matching record ending and enqueue its audit without removing it before commit. */
  prepareEnd(
    sessionHandle: string,
    expectedToken: string | null,
    beforeDelete: (record: Readonly<StoredMasqueradeRecord>) => void,
  ): boolean {
    const record = this.#bySession.get(sessionHandle);
    if (!record || (expectedToken !== null && record.token !== expectedToken)) return false;
    record.phase = "ending";
    beforeDelete(record);
    return true;
  }

  /** Remove records whose corresponding session deletion transaction committed. */
  commitEnd(sessionHandles: readonly string[]): void {
    for (const sessionHandle of sessionHandles) {
      const record = this.#bySession.get(sessionHandle);
      if (record) this.#delete(record);
    }
  }

  /** End every active handle owned by a principal. Used only by session-cleanup paths. */
  endUser(userId: string, beforeDelete: (record: Readonly<StoredMasqueradeRecord>) => void): number {
    const handles = [...(this.#byUser.get(userId) ?? [])];
    let ended = 0;
    for (const handle of handles) {
      if (this.end(handle, null, beforeDelete)) ended += 1;
    }
    return ended;
  }

  /** Audit and remove at most one bounded page of expired records. */
  pruneExpired(): number {
    const now = this.#now();
    let pruned = 0;
    for (const record of this.#bySession.values()) {
      if (pruned >= MAX_PRUNE_PER_PASS) break;
      if (Date.parse(record.expiresAt) > now) continue;
      record.phase = "ending";
      this.#expired(record);
      this.#delete(record);
      pruned += 1;
    }
    return pruned;
  }

  #delete(record: StoredMasqueradeRecord): void {
    this.#bySession.delete(record.sessionHandle);
    const sessions = this.#byUser.get(record.userId);
    sessions?.delete(record.sessionHandle);
    if (sessions?.size === 0) this.#byUser.delete(record.userId);
  }
}
