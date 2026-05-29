import { SchedulerToolbar } from './SchedulerToolbar'
import { SchedulerGrid } from './SchedulerGrid'

export function SchedulerView() {
  return (
    <div className="flex h-full flex-col">
      <SchedulerToolbar />
      <div className="min-h-0 flex-1">
        <SchedulerGrid />
      </div>
    </div>
  )
}
