import { format } from "date-fns";
import { parseDate } from "@capacitylens/shared/lib/dateMath";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import { maximumTimeOffRepeatUntilDate, RepeatingDateError } from "@capacitylens/shared/lib/repeatingDates";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import type { ISODate, Resource, TimeOff, TimeOffType } from "@capacitylens/shared/types/entities";
import { readActiveDateLocale, m } from "@/i18n";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { isStaleEdit } from "../../lib/isStaleEdit";
import { buildRepeatedTimeOffDrafts } from "../../lib/repeatingTimeOff";
import { validateText } from "../../lib/validation";
import { useStore, type Draft } from "../../store/useStore";
import type { TimeOffRepeatChoice } from "./useTimeOffRepeat";

type Fail = (field: string | null, message: string) => void;

export interface SaveTimeOffOptions {
  timeOff: TimeOff | undefined;
  resources: readonly Resource[];
  resourceId: string;
  startDate: ISODate | "";
  endDate: ISODate | "";
  type: TimeOffType;
  note: string;
  canEditNote: boolean;
  fail: Fail;
  add: ReturnType<typeof useStore.getState>["addTimeOff"];
  addMany: ReturnType<typeof useStore.getState>["addTimeOffs"];
  update: ReturnType<typeof useStore.getState>["updateTimeOff"];
  repeat: TimeOffRepeatChoice;
  repeatUntil: ISODate | "";
  acceptedSubmission: { current: boolean };
  onClose: () => void;
}

function validateTimeOffDraft(options: SaveTimeOffOptions) {
  const { resources, resourceId, startDate, endDate, type, note, canEditNote, fail } = options;
  const chosen = resources.find((resource) => resource.id === resourceId);
  if (!chosen || isExternalResource(chosen)) {
    fail("resource", m.form_timeoff_err_choose_resource());
    return null;
  }
  if (!startDate || !endDate) {
    fail("dates", m.form_timeoff_err_dates_required());
    return null;
  }
  if (endDate < startDate) {
    fail("dates", m.form_timeoff_err_end_before_start());
    return null;
  }
  let cleanNote: string | undefined;
  if (canEditNote) {
    const validatedNote = validateText(note, fail, { field: "note", required: false, multiline: true });
    if (validatedNote === null) return null;
    cleanNote = validatedNote || undefined;
  }
  return { basePatch: { resourceId, startDate, endDate, type }, cleanNote };
}

function persistNewTimeOff(options: {
  baseDraft: Draft<TimeOff>;
  repeatedDrafts: Draft<TimeOff>[];
  add: SaveTimeOffOptions["add"];
  addMany: SaveTimeOffOptions["addMany"];
  acceptedSubmission: SaveTimeOffOptions["acceptedSubmission"];
  repeat: TimeOffRepeatChoice;
}): boolean {
  if (options.acceptedSubmission.current) return false;
  options.acceptedSubmission.current = true;
  try {
    if (options.repeat === "none") options.add(options.baseDraft);
    else options.addMany(options.repeatedDrafts);
    return true;
  } catch (error) {
    options.acceptedSubmission.current = false;
    throw error;
  }
}

function buildTimeOffDraftsForSave(
  baseDraft: Draft<TimeOff>,
  options: Pick<SaveTimeOffOptions, "repeat" | "repeatUntil" | "fail">,
) {
  if (options.repeat === "none") return [baseDraft];
  if (!isValidISODate(options.repeatUntil)) {
    options.fail("repeatUntil", m.form_timeoff_err_repeat_until_required());
    return null;
  }
  const maximum = maximumTimeOffRepeatUntilDate(baseDraft.startDate);
  if (options.repeatUntil > maximum) {
    options.fail("repeatUntil", m.form_timeoff_err_repeat_until_after_max({ max: maximum }));
    return null;
  }
  try {
    return buildRepeatedTimeOffDrafts(baseDraft, options.repeatUntil, options.repeat).drafts;
  } catch (error) {
    return resolveRepeatFailure(baseDraft.startDate, error, options.fail);
  }
}

function resolveRepeatFailure(startDate: ISODate, error: unknown, fail: Fail): null {
  if (error instanceof RepeatingDateError) {
    const messages: Partial<Record<RepeatingDateError["code"], () => void>> = {
      "invalid-last-weekday-start": () => {
        const weekday = format(parseDate(startDate), "EEEE", { locale: readActiveDateLocale() });
        fail("dates", m.form_timeoff_err_repeat_last_weekday({ weekday }));
      },
      "no-repeat": () => fail("repeatUntil", m.form_timeoff_err_repeat_until_no_occurrence()),
      "cutoff-before-start": () => fail("repeatUntil", m.form_timeoff_err_repeat_until_before_start()),
      "occurrence-limit": () => fail("repeatUntil", m.form_timeoff_err_repeat_occurrence_limit()),
    };
    const report = messages[error.code];
    if (report) report();
    else fail("repeatUntil", m.form_timeoff_err_repeat_date_domain());
    return null;
  }
  if (error instanceof RangeError) {
    fail("repeatUntil", m.form_timeoff_err_repeat_date_domain());
    return null;
  }
  throw error;
}

export function saveTimeOff(options: SaveTimeOffOptions): void {
  const draft = validateTimeOffDraft(options);
  if (!draft) return;
  const { basePatch, cleanNote } = draft;
  const patch = options.canEditNote ? { ...basePatch, note: cleanNote } : basePatch;
  try {
    if (options.timeOff) {
      if (isStaleEdit(useStore.getState().data.timeOff, options.timeOff.id, options.timeOff.updatedAt)) {
        options.fail(null, m.form_timeoff_err_changed());
        return;
      }
      options.update(options.timeOff.id, patch);
    } else {
      const baseDraft = { ...basePatch, ...(cleanNote ? { note: cleanNote } : {}) };
      const repeatedDrafts = buildTimeOffDraftsForSave(baseDraft, options);
      if (!repeatedDrafts) return;
      if (!persistNewTimeOff({ ...options, baseDraft, repeatedDrafts })) return;
    }
    options.onClose();
  } catch (error) {
    options.fail(null, error instanceof Error ? resolveErrorMessage(error) : m.form_timeoff_err_save_failed());
  }
}
