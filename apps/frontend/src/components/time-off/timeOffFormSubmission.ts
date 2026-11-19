import { format } from 'date-fns';
import { parseDate } from '@capacitylens/shared/lib/dateMath';
import { isValidISODate } from '@capacitylens/shared/lib/isoDates';
import {
  maximumTimeOffRepeatUntilDate,
  RepeatingDateError,
} from '@capacitylens/shared/lib/repeatingDates';
import { buildRepeatedTimeOffDrafts } from '@capacitylens/shared/lib/repeatingOccurrences';
import { isExternalResource } from '@capacitylens/shared/types/entities';
import type { ISODate, Resource, TimeOff, TimeOffType } from '@capacitylens/shared/types/entities';
import { readActiveDateLocale, m } from '@/i18n';
import type { EntitySave } from '@/hooks/useEditSubmit';
import { resolveTimeOffRepeatPattern } from '@/lib/repeatingTimeOff';
import type { TimeOffRepeatSelection } from '@/lib/repeatingTimeOff';
import { parseText } from '@/lib/validation';
import type { useStore } from '@/store/useStore';
import type { Draft } from '@/store/useStore';
import type { CreateResult, RepeatRange } from '@/store/StoreEntityActions';
import type { TimeOffRepeatChoice } from './useTimeOffRepeat';

type Fail = (field: string | null, message: string) => void;

/** Fields and mutation callbacks needed to validate and prepare a time-off save. */
export interface SaveTimeOffOptions {
  timeOff: TimeOff | undefined;
  resources: readonly Resource[];
  resourceId: string;
  startDate: ISODate | '';
  endDate: ISODate | '';
  type: TimeOffType;
  note: string;
  canEditNote: boolean;
  fail: Fail;
  add: ReturnType<typeof useStore.getState>['addTimeOff'];
  addRepeated: ReturnType<typeof useStore.getState>['addRepeatedTimeOff'];
  update: ReturnType<typeof useStore.getState>['updateTimeOff'];
  repeat: TimeOffRepeatChoice;
  repeatUntil: ISODate | '';
  acceptedSubmission: { current: boolean };
}

function parseTimeOffDraft(options: SaveTimeOffOptions) {
  const { resources, resourceId, startDate, endDate, type, note, canEditNote, fail } = options;
  const chosen = resources.find((resource) => resource.id === resourceId);
  if (!chosen || isExternalResource(chosen)) {
    fail('resource', m.form_time_off_err_choose_resource());
    return null;
  }
  if (!startDate || !endDate) {
    fail('dates', m.form_time_off_err_dates_required());
    return null;
  }
  if (endDate < startDate) {
    fail('dates', m.form_time_off_err_end_before_start());
    return null;
  }
  let cleanNote: string | undefined;
  if (canEditNote) {
    const validatedNote = parseText(note, fail, {
      field: 'note',
      required: false,
      multiline: true,
    });
    if (validatedNote === null) return null;
    cleanNote = validatedNote || undefined;
  }
  return { basePatch: { resourceId, startDate, endDate, type }, cleanNote };
}

/** A repeat the form accepted, with the number of entries it makes. */
interface AcceptedRepeat {
  range: RepeatRange;
  count: number;
}

async function persistNewTimeOff(options: {
  baseDraft: Draft<TimeOff>;
  repeated: AcceptedRepeat | null;
  add: SaveTimeOffOptions['add'];
  addRepeated: SaveTimeOffOptions['addRepeated'];
  acceptedSubmission: SaveTimeOffOptions['acceptedSubmission'];
}): Promise<CreateResult<unknown>> {
  if (options.acceptedSubmission.current) return { kind: 'blocked' };
  options.acceptedSubmission.current = true;
  try {
    const { repeated } = options;
    const result = await (repeated
      ? options.addRepeated(options.baseDraft, repeated.range, repeated.count)
      : options.add(options.baseDraft));
    if (result.kind === 'blocked') options.acceptedSubmission.current = false;
    return result;
  } catch (error) {
    // Release the accepted-submission marker before propagating failure so later attempts are not suppressed.
    options.acceptedSubmission.current = false;
    throw error;
  }
}

/** The repeat to send and its entry count, or `null` after reporting a field error. The count
 * comes from the shared projection the server also runs; the server refuses a different count. */
function acceptRepeat(
  baseDraft: Draft<TimeOff>,
  options: Pick<SaveTimeOffOptions, 'repeatUntil' | 'fail'> & { repeat: TimeOffRepeatSelection },
): AcceptedRepeat | null {
  if (!isValidISODate(options.repeatUntil)) {
    options.fail('repeatUntil', m.form_time_off_err_repeat_until_required());
    return null;
  }
  const maximum = maximumTimeOffRepeatUntilDate(baseDraft.startDate);
  if (options.repeatUntil > maximum) {
    options.fail('repeatUntil', m.form_time_off_err_repeat_until_after_max({ max: maximum }));
    return null;
  }
  const range = {
    pattern: resolveTimeOffRepeatPattern(options.repeat),
    until: options.repeatUntil,
  };
  try {
    const { drafts } = buildRepeatedTimeOffDrafts(baseDraft, range.until, range.pattern);
    return { range, count: drafts.length };
  } catch (error) {
    // Route repeat-generation failures to the appropriate form field rather than letting them escape submit.
    return resolveRepeatFailure(baseDraft.startDate, error, options.fail);
  }
}

function resolveRepeatFailure(startDate: ISODate, error: unknown, fail: Fail): null {
  if (error instanceof RepeatingDateError) {
    const messages: Partial<Record<RepeatingDateError['code'], () => void>> = {
      'invalid-last-weekday-start': () => {
        const weekday = format(parseDate(startDate), 'EEEE', { locale: readActiveDateLocale() });
        fail('dates', m.form_time_off_err_repeat_last_weekday({ weekday }));
      },
      'no-repeat': () => fail('repeatUntil', m.form_time_off_err_repeat_until_no_occurrence()),
      'cutoff-before-start': () =>
        fail('repeatUntil', m.form_time_off_err_repeat_until_before_start()),
      'occurrence-limit': () => fail('repeatUntil', m.form_time_off_err_repeat_occurrence_limit()),
    };
    const report = messages[error.code];
    if (report) report();
    else fail('repeatUntil', m.form_time_off_err_repeat_date_domain());
    return null;
  }
  if (error instanceof RangeError) {
    fail('repeatUntil', m.form_time_off_err_repeat_date_domain());
    return null;
  }
  throw error;
}

/** Validates a time-off form and returns the save for its single entry or repeated batch, or `null` after reporting a field error. */
export function prepareTimeOffSave(options: SaveTimeOffOptions): EntitySave | null {
  const draft = parseTimeOffDraft(options);
  if (!draft) return null;
  const { basePatch, cleanNote } = draft;
  const { timeOff } = options;
  if (timeOff) {
    const patch = options.canEditNote ? { ...basePatch, note: cleanNote } : basePatch;
    return () => options.update(timeOff.id, patch, timeOff.updatedAt);
  }
  const baseDraft = { ...basePatch, ...(cleanNote ? { note: cleanNote } : {}) };
  const { repeat } = options;
  if (repeat === 'none') return () => persistNewTimeOff({ ...options, baseDraft, repeated: null });
  const repeated = acceptRepeat(baseDraft, { ...options, repeat });
  if (!repeated) return null;
  return () => persistNewTimeOff({ ...options, baseDraft, repeated });
}
