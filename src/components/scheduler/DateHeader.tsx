import { memo, useMemo } from 'react'
import { format } from 'date-fns'
import { parseDate, todayISO, weekdayOf } from '@floaty/shared/lib/dateMath'
import { DAY_COLUMN_MIN_WIDTH, WEEKDAY_LABEL_MIN_WIDTH } from '../../lib/schedulerConfig'

interface Span {
  key: string
  label: string
  days: number
}

/** Group visible days into calendar-month spans. */
function monthSpans(days: string[]): Span[] {
  const spans: Span[] = []
  for (const d of days) {
    const key = d.slice(0, 7) // YYYY-MM
    const last = spans[spans.length - 1]
    if (last && last.key === key) last.days += 1
    else spans.push({ key, label: format(parseDate(d), 'MMM yyyy'), days: 1 })
  }
  return spans
}

/** Group visible days into weeks (new block on Monday or at the window start). */
function weekBlocks(days: string[]): Span[] {
  const blocks: Span[] = []
  days.forEach((d, i) => {
    if (i === 0 || weekdayOf(d) === 1) blocks.push({ key: d, label: format(parseDate(d), 'd MMM'), days: 1 })
    else blocks[blocks.length - 1].days += 1
  })
  return blocks
}

// Memoised: its props (the memoised `days` array + numeric dayWidth) are stable
// across data mutations, so it stops re-rendering ~120 cells on every store change.
export const DateHeader = memo(function DateHeader({ days, dayWidth }: { days: string[]; dayWidth: number }) {
  const showDays = dayWidth >= DAY_COLUMN_MIN_WIDTH // per-day columns vs per-week blocks
  const showWeekday = dayWidth >= WEEKDAY_LABEL_MIN_WIDTH
  const today = todayISO()
  const totalWidth = days.length * dayWidth
  // Month/week groupings depend only on `days` — recompute on the day set changing,
  // not on a pure dayWidth (zoom) change that only re-widths the same blocks.
  const months = useMemo(() => monthSpans(days), [days])
  const weeks = useMemo(() => weekBlocks(days), [days])

  return (
    <div role="columnheader" aria-label="Dates" className="relative flex h-full shrink-0 flex-col" style={{ width: totalWidth }}>
      {/* Month tier — padding-driven height (not a fixed px) so it scales with font size. */}
      <div className="flex shrink-0 border-b border-line">
        {months.map((m) => (
          <div
            key={m.key}
            className="flex items-center overflow-hidden border-r border-line px-2 py-0.5 text-2xs font-semibold text-muted"
            style={{ width: m.days * dayWidth }}
          >
            <span className="truncate">{m.label}</span>
          </div>
        ))}
      </div>

      {/* Week / day tier. flex-auto (basis auto, not flex-1's basis 0) so the cells'
          real height counts toward the header — otherwise the date + weekday lines
          overflow the row and get clipped — while still filling any slack height. */}
      {showDays ? (
        <div className="flex flex-auto">
          {days.map((d) => {
            const wd = weekdayOf(d)
            const weekStart = wd === 1
            const weekend = wd === 0 || wd === 6
            const isToday = d === today
            const date = parseDate(d)
            return (
              <div
                key={d}
                className={`flex flex-col items-center justify-center py-1 text-xs leading-tight ${weekStart ? 'border-l border-line' : ''} ${
                  isToday ? 'bg-brand-soft font-semibold text-ink' : weekend ? 'bg-canvas text-muted' : 'text-muted'
                }`}
                style={{ width: dayWidth }}
              >
                <span className="font-medium">{format(date, 'd')}</span>
                {showWeekday && <span className="text-2xs uppercase">{format(date, 'EEE')}</span>}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-auto">
          {weeks.map((b) => (
            <div
              key={b.key}
              className="flex items-center overflow-hidden border-l border-line px-1 py-1 text-2xs text-muted"
              style={{ width: b.days * dayWidth }}
            >
              <span className="truncate font-medium">{b.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
