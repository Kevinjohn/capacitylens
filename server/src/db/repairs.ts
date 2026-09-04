import { type Db } from "../db";
import { tx } from "../txn";
import {
  availableInternalClientId,
  buildInternalClient,
  INTERNAL_CLIENT_NAME,
  INTERNAL_CLIENT_COLOR,
} from "@capacitylens/shared/data/internalClient";
import { insertRowRaw } from "./rows";
import { type Row } from "../rowCodec";
import { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import {
  V22_INACTIVE_BUILTIN_CLIENT_WHERE_SQL,
  V13_FALLBACK_PRESET_COLOR,
  V13_FROZEN_PRESET_COLORS,
} from "./migrations/definitions";
/**
 * Ensure EVERY account in the DB has exactly one built-in Internal client (`builtin: true`).
 * Missing rows are inserted; duplicate rows are deterministically folded into the generated id when
 * present (otherwise the oldest/id-first row), with dependent projects rewired before deletion. The
 * partial unique index is installed after this repair and prevents recurrence.
 *
 * Stays SQL (set-based, runs inside the DB) rather than calling the shared TS helper, but the CANONICAL
 * definition of "the account's builtin Internal" lives in shared `internalClientFor` /
 * `ensureInternalClients` — the `builtin = 'true'` predicate below is its SQL transcription, and the
 * inserted row is built by the shared `buildInternalClient` factory so the row shape can't drift.
 */
export function ensureInternalClients(db: Db): void {
  const accounts = db.prepare(`SELECT id FROM accounts ORDER BY id`).all() as Array<{ id: string }>;
  const now = new Date().toISOString();
  tx(db, () => {
    const usedIds = new Set((db.prepare(`SELECT id FROM clients`).all() as Array<{ id: string }>).map(({ id }) => id));
    for (const { id } of accounts) {
      const builtins = db
        .prepare(
          `SELECT id FROM clients WHERE accountId = ? AND builtin = 'true'
         ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, createdAt, id`,
        )
        .all(id, `internal:${id}`) as Array<{ id: string }>;
      if (builtins.length === 0) {
        const internalId = availableInternalClientId(id, usedIds);
        usedIds.add(internalId);
        insertRowRaw(db, "clients", buildInternalClient(id, now, internalId) as unknown as Row);
        continue;
      }
      const retainedId = builtins[0].id;
      db.prepare(`UPDATE clients SET name = ?, color = ?, builtin = 'true' WHERE id = ? AND accountId = ?`).run(
        INTERNAL_CLIENT_NAME,
        INTERNAL_CLIENT_COLOR,
        retainedId,
        id,
      );
      for (const duplicate of builtins.slice(1)) {
        db.prepare(`UPDATE projects SET clientId = ? WHERE clientId = ?`).run(retainedId, duplicate.id);
        db.prepare(`DELETE FROM clients WHERE id = ?`).run(duplicate.id);
      }
    }
  });
}

/** Every-boot data repair for alpha-era rows written before an empty company week became invalid. */
export function repairEmptyAccountWorkingDays(db: Db): void {
  const rows = db.prepare(`SELECT id, weekStartsOn FROM accounts WHERE workingDays = '[]'`).all() as Array<{
    id: string;
    weekStartsOn: string | null;
  }>;
  const update = db.prepare(`UPDATE accounts SET workingDays = ? WHERE id = ?`);
  for (const row of rows) {
    update.run(JSON.stringify(normalizeAccountWorkingDays([], row.weekStartsOn === "0" ? 0 : 1)), row.id);
  }
}

/** Database-v22 recovery for the historical generated-replacement path that could promote an
 * inactive ordinary client into the protected singleton. This is deliberately separate from the
 * released v8 repair: changing that migration would invalidate its immutable behavior and ledger. */
export function reactivateBuiltinInternalClientsV22(db: Db): void {
  const rows = db
    .prepare(
      `SELECT id, updatedAt FROM clients
     WHERE ${V22_INACTIVE_BUILTIN_CLIENT_WHERE_SQL}
     ORDER BY id`,
    )
    .all() as Array<{ id: string; updatedAt: string }>;
  const migrationClock = Date.now();
  const update = db.prepare(
    `UPDATE clients
     SET archivedAt = NULL, deletedAt = NULL, updatedAt = ?
     WHERE id = ? AND builtin = 'true'`,
  );
  for (const row of rows) {
    const previous = Date.parse(row.updatedAt);
    const revision = new Date(
      Number.isFinite(previous) ? Math.max(migrationClock, previous + 1) : migrationClock,
    ).toISOString();
    update.run(revision, row.id);
  }
}

export function assertBuiltinInternalClientsActiveV22(db: Db): void {
  const inactive = db
    .prepare(
      `SELECT id FROM clients
     WHERE ${V22_INACTIVE_BUILTIN_CLIENT_WHERE_SQL}
     LIMIT 1`,
    )
    .get() as { id: string } | undefined;
  if (inactive) {
    throw new Error(`Database v22 failed to reactivate built-in Internal client ${inactive.id}.`);
  }
}

/**
 * Released, palette-frozen v13 mapper. Its historical parser accepts per-chunk hexadecimal prefixes
 * and one embedded `#`, unlike the exact shared mapper. Preserve that checksummed compatibility
 * behavior; DECISIONS.md records why already-upgraded values cannot be reconstructed or corrected.
 */
function snapToFrozenPresetV13(value: string | null): string {
  if (typeof value !== "string") return V13_FALLBACK_PRESET_COLOR;
  const normalized = value.trim().toLowerCase();
  if (V13_FROZEN_PRESET_COLORS.includes(normalized)) return normalized;
  const rgb = hexToRgbV13(normalized);
  if (!rgb) return V13_FALLBACK_PRESET_COLOR;
  const [r, g, b] = rgb;
  let nearest = V13_FROZEN_PRESET_COLORS[0];
  let nearestDistance = Infinity;
  for (const preset of V13_FROZEN_PRESET_COLORS) {
    const presetRgb = hexToRgbV13(preset);
    if (!presetRgb) continue; // unreachable: every frozen entry is a valid 6-digit hex (pinned by a test)
    const [pr, pg, pb] = presetRgb;
    // Squared Euclidean distance in RGB space — no sqrt needed since we only compare magnitudes.
    const distance = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    // Strict `<` (not `<=`) so the FIRST minimal-distance preset wins on a tie — palette order is
    // the deterministic tie-break, matching shared `snapToPresetColor`.
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = preset;
    }
  }
  return nearest;
}

function hexToRgbV13(hex: string): [number, number, number] | null {
  const c = hex.replace("#", "");
  if (c.length !== 6) return null; // reject short AND overlong hex (the latter mis-slices)
  // HISTORICAL/FROZEN: parseInt accepts a valid prefix in each chunk. Do not tighten this shipped
  // parser in place; future frozen parsers must validate the complete /^#[0-9a-f]{6}$/i shape first.
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return [r, g, b].some(Number.isNaN) ? null : [r, g, b];
}

/**
 * v13 one-time data repair: BEFORE this migration, sanitizeWrite('accounts') replaced ANY stored
 * colour outside the current preset palette with one FIXED fallback hex on every single write —
 * so a legacy account colour that predated today's `PRESET_COLORS` (or any hex a hand-crafted
 * request supplied) would silently flip to that one fixed colour the next time its row was
 * touched, with no migration ever having repaired the rows already on disk. Run ONCE: snap every
 * stored account colour through {@link snapToFrozenPresetV13} — the palette-FROZEN transcription of
 * the shared mapper — so each legacy colour is repaired to its NEAREST preset (not a fixed colour)
 * and the write-time guard becomes a no-op for every already-migrated row. The frozen palette (not
 * the live shared one) keeps this checksummed step reproducible forever. See DECISIONS.md.
 */
export function snapLegacyAccountColors(db: Db): void {
  const rows = db.prepare(`SELECT id, color FROM accounts`).all() as Array<{
    id: string;
    color: string | null;
  }>;
  const update = db.prepare(`UPDATE accounts SET color = ? WHERE id = ?`);
  for (const row of rows) {
    const snapped = snapToFrozenPresetV13(row.color);
    if (snapped !== row.color) update.run(snapped, row.id);
  }
}
