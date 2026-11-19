import vine from '@vinejs/vine';
import { daysInclusive } from '@capacitylens/shared/lib/dateMath';
import { isValidISODate } from '@capacitylens/shared/lib/isoDates';
import { calendarDate, uuid } from '#validators/planning/fields';

/** The longest capacity range one planning read computes. */
const MAX_PLANNING_READ_DAYS = 366;

const readRange = vine.createRule((value, _options, field) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  const { from, to } = value as { from?: unknown; to?: unknown };
  if ((from === undefined) !== (to === undefined)) {
    field.report('Send both from and to, or neither.', 'readRange', field);
    return;
  }
  if (!isValidISODate(from) || !isValidISODate(to)) return;
  if (from > to) {
    field.report('The to date must be on or after the from date.', 'readRange', field);
  } else if (daysInclusive(from, to) > MAX_PLANNING_READ_DAYS) {
    field.report(`The range may cover at most ${MAX_PLANNING_READ_DAYS} days.`, 'readRange', field);
  }
});

/** The planning read's query: the capacity window, both dates or neither, the reading page's
 * history, and the revision the reader already holds. The query carries strings, so `ifRevision` is
 * converted rather than strict. Other fields are ignored. */
export const planningReadValidator = vine.compile(
  vine
    .object({
      from: calendarDate().optional(),
      to: calendarDate().optional(),
      historyId: uuid().optional(),
      ifRevision: vine.number().min(0).withoutDecimals().optional(),
    })
    .use(readRange())
);
