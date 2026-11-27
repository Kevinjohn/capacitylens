import { isValidISODate } from '@capacitylens/shared/lib/isoDates'
import type { ISODate } from '@capacitylens/shared/types/entities'

const reportedInvalidScheduleRows = new WeakSet<object>()

/** Return whether a schedule row's range can safely enter date indexing and layout paths. */
export function hasRenderableDateRange(row: {
  id: string
  startDate: ISODate
  endDate: ISODate
}): boolean {
  return (
    isValidISODate(row.startDate) && isValidISODate(row.endDate) && row.startDate <= row.endDate
  )
}

/** Report an omitted corrupt row once for its stable object identity. */
export function reportInvalidScheduleDateRangeOnce(row: { id: string }): void {
  if (reportedInvalidScheduleRows.has(row)) return
  reportedInvalidScheduleRows.add(row)
  console.error(`Scheduler omitted ${row.id}: invalid date range.`)
}

/** Keeps a row whose date range the scheduler can draw, reporting a corrupt one once. */
export function includeRenderableDateRange(row: {
  id: string
  startDate: ISODate
  endDate: ISODate
}): boolean {
  const renderable = hasRenderableDateRange(row)
  if (!renderable) reportInvalidScheduleDateRangeOnce(row)
  return renderable
}

/** Closures or time off the scheduler can honour. Day states, drawing, shading, forms and
 * announcements all read this list so the scheduler ignores a corrupt row in every path alike. */
export function listRenderableDateRanges<
  T extends { id: string; startDate: ISODate; endDate: ISODate },
>(rows: T[]): T[] {
  return rows.filter((row) => {
    const renderable = hasRenderableDateRange(row)
    if (!renderable) reportInvalidScheduleDateRangeOnce(row)
    return renderable
  })
}
