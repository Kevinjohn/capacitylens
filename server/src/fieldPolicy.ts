import { canSeePrivateNames, canSeeTimeOffNote, type Role } from '@capacitylens/shared/domain/access'
import { redactPrivateName } from '@capacitylens/shared/domain/privateNames'
import type { Client, Project } from '@capacitylens/shared/types/entities'

// THE SINGLE SOURCE OF ROLE-GATED FIELD POLICY (Finding 8).
//
// Three independent behaviours enforce the SAME two field-confidentiality rules (owner/admin-only
// time-off `note`; owner-only private client/project real names):
//   1. REDACT ON READ — a write/conflict/lifecycle response echo is also a read and must strip a
//      field the caller may not see (redactWriteEcho / redactGatedEcho).
//   2. PIN ON WRITE — a redaction-blind writer's round-trip has NO key for the field the server
//      redacted from them; without a pin, upsertRow would store NULL and SILENTLY ERASE data the
//      writer never saw (sanitizeWrite → pinGatedFields).
//   3. INCLUDE/EXCLUDE ON EXPORT — the per-account read (/api/state, the P2.6 export) decides the
//      readSlice `include*` flags from the caller's role (visibilityForRole).
//
// The three used to hand-code the table names, field names and role predicate SEPARATELY. That was
// a latent data-integrity trap: miss the write-pin and a redacted editor's save silently erases a
// field they never saw; miss the export/include branch and the field LEAKS. This map is the single
// catalogue every site derives from, so a NEW gated field cannot be added to fewer than all three
// sites — one entry here wires redact + pin + include everywhere at once.

/** Caller-context options for {@link sanitizeWrite} and the read echo — facts about the WRITER/READER
 *  the row body alone cannot carry, so field-level gating runs at the single write funnel (not as
 *  per-route hacks). Owns the type here because the field-policy map is its single source of truth. */
export interface SanitizeWriteOptions {
  /**
   * P1.6 write-side counterpart of the read redaction: `false` when the caller's role may NOT see
   * the time-off `note` (the same `canSeeTimeOffNote` rule readSlice applies; auth OFF ⇒ always
   * `true`). A note-blind writer round-trips rows the server REDACTED — their PUT body has no
   * `note` key — so without a pin, upsertRow would store NULL (rowCodec: absent optional → SQL
   * NULL) and silently ERASE a note the writer never saw. Defaults to `true` (visible), which is
   * byte-identical to the pre-option behaviour, so callers writing tables other than `timeOff`
   * need not pass it.
   */
  canSeeTimeOffNote?: boolean
  /** Whether the writer may manage/read private client/project real-name fields. False for every
   * authenticated role except owner; trusted-local/off mode passes true. */
  canSeePrivateNames?: boolean
}

/** One role-gated confidentiality policy: the field list, the role predicate that decides who may
 *  see it, and the redact/pin operations the three sites reuse. */
export interface GatedFieldPolicy {
  /** Stable id for debugging/tests. */
  readonly id: string
  /** Tables this policy governs. */
  readonly tables: readonly string[]
  /** The gated field name(s) — the single list every site derives from. */
  readonly fields: readonly string[]
  /** The {@link SanitizeWriteOptions} flag that is `false` when the caller may NOT see these fields. */
  readonly visKey: keyof SanitizeWriteOptions
  /** Role predicate: `true` iff `role` may see the gated field(s). */
  readonly visibleTo: (role: Role) => boolean
  /** Redact the gated field(s) from a row about to be serialized to a caller who may not see them. */
  readonly redactEcho: (row: Record<string, unknown>) => Record<string, unknown>
  /** Pin the gated field(s) on a write from a caller who may not see them (create vs update). */
  readonly pin: (cleaned: Record<string, unknown>, existing: Record<string, unknown> | undefined) => void
}

export const GATED_FIELD_POLICIES: readonly GatedFieldPolicy[] = [
  {
    id: 'timeOffNote',
    tables: ['timeOff'],
    fields: ['note'],
    visKey: 'canSeeTimeOffNote',
    visibleTo: canSeeTimeOffNote,
    redactEcho: (row) => {
      const visible = { ...row }
      delete visible.note
      return visible
    },
    // When the writer's role cannot see the time-off `note` (readSlice redacted it from every row
    // they ever received), their write body is note-less BY CONSTRUCTION — pin `note` to the stored
    // value on an UPDATE, and strip it on a CREATE (existing === undefined ⇒ nothing to preserve; a
    // note-blind writer also can't legitimately AUTHOR a note they'd never be able to read back).
    pin: (cleaned, existing) => {
      if (typeof existing?.note === 'string') cleaned.note = existing.note
      else delete cleaned.note
    },
  },
  {
    id: 'privateNames',
    tables: ['clients', 'projects'],
    fields: ['name', 'isPrivate', 'codeName'],
    visKey: 'canSeePrivateNames',
    visibleTo: canSeePrivateNames,
    redactEcho: (row) =>
      redactPrivateName(row as unknown as Client | Project) as unknown as Record<string, unknown>,
    // A non-owner round-trips a private row whose `name` is already the quoted code name and whose
    // raw `codeName` was removed by the read projection; pin all three fields to disk so an unrelated
    // colour/client edit cannot overwrite the real name. For public rows/creates, strip attempted
    // privacy fields while still allowing the public name itself to be authored by ordinary editors.
    pin: (cleaned, existing) => {
      if (existing?.isPrivate === true) {
        cleaned.name = existing.name
        cleaned.isPrivate = true
        if (typeof existing.codeName === 'string') cleaned.codeName = existing.codeName
        else delete cleaned.codeName
      } else {
        delete cleaned.isPrivate
        delete cleaned.codeName
      }
    },
  },
]

/** True when any gated-field policy governs `table` (drives the write funnel's no-lookup short-circuit
 *  and the read-echo/pin fast paths). */
export function tableHasGatedFields(table: string): boolean {
  return GATED_FIELD_POLICIES.some((policy) => policy.tables.includes(table))
}

/** Apply every gated-field READ redaction (behaviour 1) whose policy governs `table` and whose flag
 *  is `false` on `vis`. A write response is also a read and must never bypass the state-read policy. */
export function redactGatedEcho(
  table: string,
  row: Record<string, unknown>,
  vis: SanitizeWriteOptions,
): Record<string, unknown> {
  let visible = row
  for (const policy of GATED_FIELD_POLICIES) {
    if (policy.tables.includes(table) && vis[policy.visKey] === false) {
      visible = policy.redactEcho(visible)
    }
  }
  return visible
}

/** Apply every gated-field WRITE pin (behaviour 2) whose policy governs `table` and whose flag is
 *  `false` on `opts`. Mutates `cleaned` in place, mirroring sanitizeWrite's tombstone pin. */
export function pinGatedFields(
  table: string,
  cleaned: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  opts: SanitizeWriteOptions,
): void {
  for (const policy of GATED_FIELD_POLICIES) {
    if (policy.tables.includes(table) && opts[policy.visKey] === false) {
      policy.pin(cleaned, existing)
    }
  }
}

/** Derive the visibility flags (behaviour 3's source of truth) from a role, or `null` for
 *  "no membership" (fail-closed: every gated field hidden). Each policy's predicate is applied to
 *  its own {@link SanitizeWriteOptions} flag, so the include/exclude decision can never disagree with
 *  the redact/pin decision. */
export function visibilityForRole(role: Role | null): SanitizeWriteOptions {
  const vis: SanitizeWriteOptions = {}
  for (const policy of GATED_FIELD_POLICIES) {
    vis[policy.visKey] = role !== null && policy.visibleTo(role)
  }
  return vis
}
