import { format } from 'date-fns'
import { parseDate, todayISO, weekdayOf } from '../../lib/dateMath'

export function DateHeader({ days, dayWidth }: { days: string[]; dayWidth: number }) {
  const showWeekday = dayWidth >= 36
  const today = todayISO()

  return (
    <div className="relative flex h-full shrink-0" style={{ width: days.length * dayWidth }}>
      {days.map((d) => {
        const wd = weekdayOf(d)
        const weekend = wd === 0 || wd === 6
        const isToday = d === today
        const date = parseDate(d)
        return (
          <div
            key={d}
            className={`flex flex-col items-center justify-center border-r border-line text-xs ${
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
  )
}
