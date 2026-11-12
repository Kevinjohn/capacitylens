import { canonicalWeekdaySet } from '@capacitylens/shared/lib/accountWorkingDays';
import { normalizeCodeName } from '@capacitylens/shared/domain/privateNames';
import type { ScopedEntityKey, Weekday } from '@capacitylens/shared/types/entities';

interface NormalizeValidWriteInput {
  table: ScopedEntityKey;
  candidate: Record<string, unknown>;
  existing: Record<string, unknown> | undefined;
  canSeePrivateNames: boolean;
}

/** Canonicalize only values that already passed strict ordinary-write validation. */
export function normalizeValidWrite({
  table,
  candidate,
  existing,
  canSeePrivateNames,
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
  if (!canSeePrivateNames && existing?.isPrivate === true) return;
  if (candidate.isPrivate !== true) {
    delete candidate.isPrivate;
    delete candidate.codeName;
  } else {
    candidate.codeName = normalizeCodeName(candidate.codeName as string);
  }
}
