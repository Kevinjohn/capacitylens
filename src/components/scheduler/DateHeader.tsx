import { format } from 'date-fns'
import { parseDate, todayISO, weekdayOf } from '../../lib/dateMath'

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

export function DateHeader({ days, dayWidth }: { days: string[]; dayWidth: number }) {
  const showDays = dayWidth >= 18 // per-day columns vs per-week blocks
  const showWeekday = dayWidth >= 36
  const today = todayISO()
  const totalWidth = days.length * dayWidth

  return (
    <div className="relative flex h-full shrink-0 flex-col" style={{ width: totalWidth }}>
      {/* Month tier */}
      <div className="flex border-b border-line" style={{ height: 16 }}>
        {monthSpans(days).map((m) => (
          <div
            key={m.key}
            className="flex items-center overflow-hidden border-r border-line px-2 text-[11px] font-semibold text-muted"
            style={{ width: m.days * dayWidth }}
          >
            <span className="truncate">{m.label}</span>
          </div>
        ))}
      </div>

      {/* Week / day tier */}
      {showDays ? (
        <div className="flex flex-1">
          {days.map((d) => {
            const wd = weekdayOf(d)
            const weekStart = wd === 1
            const weekend = wd === 0 || wd === 6
            const isToday = d === today
            const date = parseDate(d)
            return (
              <div
                key={d}
                className={`flex flex-col items-center justify-center text-xs ${weekStart ? 'border-l border-line' : ''} ${
                  isToday ? 'bg-brand-soft font-semibold text-brand' : weekend ? 'bg-base text-faint' : 'text-muted'
                }`}
                style={{ width: dayWidth }}
              >
                <span className="font-medium">{format(date, 'd')}</span>
                {showWeekday && <span className="text-[10px] uppercase">{format(date, 'EEE')}</span>}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-1">
          {weekBlocks(days).map((b) => (
            <div
              key={b.key}
              className="flex items-center overflow-hidden border-l border-line px-1 text-[11px] text-muted"
              style={{ width: b.days * dayWidth }}
            >
              <span className="truncate font-medium">{b.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
