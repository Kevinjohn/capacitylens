import { SchedulerToolbar } from './SchedulerToolbar'
import { SchedulerGrid } from './SchedulerGrid'
import { GettingStarted } from '../GettingStarted'

export function SchedulerView() {
  return (
    <div className="relative flex h-full flex-col">
      <GettingStarted />
      <SchedulerToolbar />
      <div className="min-h-0 flex-1">
        <SchedulerGrid />
      </div>
    </div>
  )
}
