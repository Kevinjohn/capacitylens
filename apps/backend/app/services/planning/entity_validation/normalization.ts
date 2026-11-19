import { canonicalWeekdaySet } from '@capacitylens/shared/lib/companyWorkingDays';
import { normalizeCodeName } from '@capacitylens/shared/domain/privateNames';
import type { ScopedEntityKey, Weekday } from '@capacitylens/shared/types/entities';

interface NormalizeValidWriteInput {
  table: ScopedEntityKey;
  candidate: Record<string, unknown>;
  /** The caller cannot see this stored private row's names, so they stay as stored. */
  restrictedPrivateRow: boolean;
}

/** Canonicalize only values that already passed strict ordinary-write validation. */
export function normalizeValidWrite({
  table,
  candidate,
  restrictedPrivateRow,
}: NormalizeValidWriteInput): void {
  if (table === 'resources') {
    candidate.workingDays = canonicalWeekdaySet(candidate.workingDays as Weekday[]);
    candidate.halfDays = canonicalWeekdaySet(candidate.halfDays as Weekday[]);
    return;
  }
  if (table !== 'clients' && table !== 'projects') return;
  if (table === 'clients' && candidate.builtin !== true) delete candidate.builtin;
  if (table === 'clients' && candidate.builtin === true) {
    delete candidate.isPrivate;
    delete candidate.codeName;
    return;
  }
  if (restrictedPrivateRow) return;
  if (candidate.isPrivate !== true) {
    delete candidate.isPrivate;
    delete candidate.codeName;
  } else {
    candidate.codeName = normalizeCodeName(candidate.codeName as string);
  }
}
