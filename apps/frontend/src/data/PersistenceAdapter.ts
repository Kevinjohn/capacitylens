import type { AppData, ISOTimestamp } from "@capacitylens/shared/types/entities";

/** Client revision metadata used to guard server-side allocation rewrites. */
export interface AllocationRewriteRevision {
  id: string;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  /** Client revision of the allocation in the committed batch snapshot. */
  flushedUpdatedAt: ISOTimestamp;
}

/** A committed row revision paired with the client stamp it acknowledges. */
export interface CommittedRowRevision {
  table: keyof AppData;
  id: string;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  flushedUpdatedAt: ISOTimestamp;
}

/** Load and save contract implemented by local and server-backed persistence. */
export interface PersistenceAdapter {
  /** Load persisted data. `accountId` (server adapter only) loads only that account's scoped slice
   * and re-seeds the diff snapshot to it; omitted requests the whole tree (off mode and a pre-pick
   * bootstrap without live identity). `skipRemoteRead` seeds an empty server snapshot for a
   * live-authenticated pre-pick bootstrap. The in-memory demo adapter ignores both arguments. */
  loadAll(accountId?: string, options?: { skipRemoteRead?: boolean }): Promise<AppData>;
  /** Saves the next complete application state. An unload save dispatches its ordered final
   * state before awaiting confirmation so teardown cannot abandon later writes.
   * Ordinary saves await confirmation.
   */
  saveAll(data: AppData, options?: { unload?: boolean }): Promise<void>;
  /** Publishes acknowledged timestamp-only changes without overwriting newer local edits. */
  setCommittedRevisionHandler?(handler: ((revisions: readonly CommittedRowRevision[]) => void) | null): void;
  /** Optional server-rewrite bridge. Receipts identify the client revision they committed so the
   * persistence coordinator can decline to rewrite a row edited while the batch was in flight. */
  setAllocationRewriteHandler?(handler: ((revisions: readonly AllocationRewriteRevision[]) => void) | null): void;
  /** True when a dataset was ever persisted, lets bootstrap distinguish a
   * genuine first run from a user who deliberately cleared everything.
   *
   * May throw (e.g. a server `/api/meta` round-trip can fail). A throw is indeterminate,
   * not "no data": callers must compensate non-destructively (bootstrap falls back to
   * `!isEmpty(loaded)`) and must never react to a throw by discarding already-loaded data or
   * skipping the persistence attach (that would strand the user unable to save). */
  hasExisting?(): Promise<boolean>;
}

// Normal remote load failures recover by retrying; a corrupt payload requires a distinct recovery surface.
type LoadErrorKind = "corrupt" | "unavailable";

/** Thrown by an adapter's loadAll when stored data couldn't be read. The `kind`
 * tells bootstrap which recovery path applies; a plain Error (or any other throw)
 * defaults to the conservative local 'corrupt' path. */
export class LoadError extends Error {
  readonly kind: LoadErrorKind;

  // Accepts ErrorOptions so adapters reclassifying a caught failure (parse/migrate/storage/network)
  // can forward `{ cause }` and preserve the full error chain, not just a re-worded message.
  constructor(kind: LoadErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.kind = kind;
    this.name = "LoadError";
  }
}
