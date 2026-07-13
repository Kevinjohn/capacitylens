import { appendFileSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Append-only JSONL audit sink (P1.15, flag CAPACITYLENS_AUDIT — ON BY DEFAULT, opt-out =off).
// One line per AppData mutation, SERVER-MODE ONLY: the sink lives in the server (built in
// index.ts from env), so the default local/no-server deploy never runs it — buildApp's factory
// defaults to noopAuditSink(), keeping the default deploy and every test byte-identical unless a
// sink is explicitly passed.
//
// THE #1 INVARIANT — NO RAW PII EVER REACHES A LINE. `changedFields` is field NAMES only
// (Object.keys of the wire body/row); a VALUE, a ROW, or a request BODY must NEVER be handed to
// append(). Names + ids are operational metadata (who changed what, when); values are tenant PII
// (a time-off note, a person's name) and are deliberately excluded. The callers in app.ts compute
// changedFields with `Object.keys` and pass a typed AuditRecord — never an object — so the type
// itself is the guardrail. See app.ts's post-commit audit() hooks (one per mutating route).

/**
 * One audit line. ALL fields are operational metadata — never tenant data.
 *
 * `changedFields` is field NAMES ONLY (e.g. `['accountId','note','startDate']`), NEVER their
 * values. NEVER construct one of these by spreading a row/body; build `changedFields` with
 * `Object.keys(...)` so a value can't leak into the audit trail (the #1 privacy invariant).
 */
export interface AuditRecord {
  /** ISO-8601 instant the mutation committed (server runtime clock). */
  ts: string
  /** The acting principal's id (DEMO_USER 'demo' in OFF mode; a real session id auth-on). */
  userId: string
  /** The tenant the mutation targeted. */
  accountId: string
  /** The kind of mutation. The lifecycle quartet (P2.5a) is distinct from the generic CRUD verbs:
   *  `archive`/`unarchive` flip the `archivedAt` tombstone, `softDelete` sets `deletedAt` (and, for a
   *  resource, scrubs the PII `name`), and `purge` is the HARD cascade row-delete of a ≥30-day-old
   *  tombstone. They stay distinct from `delete` (the generic by-id row delete) so the audit trail
   *  tells a reversible soft-delete apart from an irreversible purge. changedFields stay field NAMES
   *  only (e.g. `['archivedAt']`, `['deletedAt','name']`) — never values (the #1 no-PII invariant). */
  action: 'create' | 'update' | 'patch' | 'delete' | 'batch' | 'import' | 'archive' | 'unarchive' | 'softDelete' | 'purge'
    | 'memberRole' | 'memberRemove' | 'ownershipTransfer' | 'inviteCreate' | 'inviteAccept'
    | 'inviteRevoke' | 'passwordResetIssue'
  /** The entity/table touched (e.g. 'timeOff', 'clients'), or 'account' for an import slice. */
  entity: string
  /** The affected row id (the import record uses the accountId as its id). */
  id: string
  /** Field NAMES that changed — Object.keys of the wire body/row. NEVER values. */
  changedFields: string[]
}

/**
 * The audit write port. `append` is SYNCHRONOUS and MUST NOT throw: a broken audit sink can never
 * fail a request (the mutation already committed). It returns `true` on a successful write, `false`
 * on a write failure; on the first failure it sets `degraded` (a latch deep-health reads) and logs
 * ONE redacted, message-only line (never the record — that could carry the very ids we keep, and
 * keeps a broken sink from spamming the log).
 */
export interface AuditSink {
  /** Write one line. Never throws; returns false on failure (and latches `degraded`). */
  append(record: AuditRecord): boolean
  /** Latched true once any append failed — the soft signal deep-health surfaces. */
  readonly degraded: boolean
}

/** fileAuditSink's rotation knob. */
export interface FileAuditSinkOptions {
  /** Rotate once the file reaches this size, in bytes. Default 64 MiB (see DEFAULT_MAX_BYTES) —
   *  an unbounded JSONL append-forever log eventually fills the disk, which then fails SQLite
   *  writes too, so this bounds it. */
  maxBytes?: number
}

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024 // 64 MiB

/**
 * A file-backed sink: one `\n`-terminated `appendFileSync` per record. The single synchronous,
 * newline-terminated write is partial-line-safe for this single-process, single-writer server
 * (a torn line can't interleave with another writer). A write failure (disk full, bad path,
 * permissions) is caught, never thrown — it latches `degraded` and logs ONE redacted line.
 *
 * Size-based rotation (bounds disk usage to ~2x `maxBytes`): before a write, if the file is
 * already at/over the cap, it is renamed to `<file>.1` (replacing any prior `.1` — POSIX rename
 * atomically replaces an existing destination) and a fresh file is started. Only ONE prior
 * generation is kept; this is a disk-usage bound, not a retention/archival feature.
 *
 * @param file the JSONL file to append to (created on first write by appendFileSync)
 * @param log  where the single redacted failure line goes (index.ts passes console.error)
 * @param opts `maxBytes` — see FileAuditSinkOptions
 */
export function fileAuditSink(file: string, log: (msg: string) => void, opts: FileAuditSinkOptions = {}): AuditSink {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  let degraded = false
  let loggedOnce = false
  return {
    append(record: AuditRecord): boolean {
      try {
        // statSync throws ENOENT before the very first write (no file yet) — that's size 0, not a
        // failure, so it's swallowed here; any OTHER stat error (permissions, a broken mount) falls
        // through to the catch below exactly like an append failure would.
        let size = 0
        try {
          size = statSync(file).size
        } catch (statErr) {
          if ((statErr as NodeJS.ErrnoException).code !== 'ENOENT') throw statErr
        }
        if (size >= maxBytes) renameSync(file, `${file}.1`)
        appendFileSync(file, JSON.stringify(record) + '\n', 'utf8')
        return true
      } catch (err) {
        // FAIL-NEVER: the mutation already committed — an audit write failure (append, OR the
        // stat/rename that guards rotation) must not throw back into the request path. Latch
        // degraded (deep-health surfaces it) and log ONCE, MESSAGE ONLY — never the record (it
        // carries ids we keep off the failure log) — so a persistently broken sink can't flood stdout.
        degraded = true
        if (!loggedOnce) {
          loggedOnce = true
          log(`capacitylens-server: audit write FAILED — ${err instanceof Error ? err.message : String(err)}`)
        }
        return false
      }
    },
    get degraded() {
      return degraded
    },
  }
}

/**
 * The no-op sink: every `append` succeeds (returns true) and `degraded` is always false. This is
 * the factory default (buildApp) so the default local/no-server deploy and the whole test suite are
 * byte-identical unless a real sink is explicitly injected.
 */
export function noopAuditSink(): AuditSink {
  return {
    append: () => true,
    degraded: false,
  }
}

/**
 * Parse the audit config from env. ON BY DEFAULT (`CAPACITYLENS_AUDIT !== 'off'`) — the deliberate
 * flag-OFF exception to the repo's usual fail-closed default, because an audit trail you forgot to
 * enable is the failure mode that matters here. The file defaults BESIDE the DB
 * (`capacitylens-audit.jsonl` in the DB's directory); a `:memory:` DB (dirname '.') falls back to a
 * CWD-relative file.
 *
 * @param env    process.env (or a test stub)
 * @param dbPath the resolved DB path, used only to site the default audit file
 * @returns `{ enabled, file }` — index.ts builds a fileAuditSink when enabled, else a noopAuditSink
 */
export function parseAuditConfig(
  env: Record<string, string | undefined>,
  dbPath: string,
): { enabled: boolean; file: string } {
  const enabled = env.CAPACITYLENS_AUDIT !== 'off'
  // dirname(':memory:') is '.', which join() resolves to CWD-relative — exactly the fallback we
  // want for an in-memory DB (no on-disk DB to sit beside).
  const file = env.CAPACITYLENS_AUDIT_FILE ?? join(dirname(dbPath), 'capacitylens-audit.jsonl')
  return { enabled, file }
}
