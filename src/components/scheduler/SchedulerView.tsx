import { SchedulerToolbar } from "./SchedulerToolbar";
import { SchedulerGrid } from "./SchedulerGrid";

/** Renders the scheduler view interface. */
export function SchedulerView() {
  return (
    <div className="relative flex h-full flex-col">
      <SchedulerToolbar />
      <div className="relative min-h-0 flex-1">
        <SchedulerGrid />
      </div>
    </div>
  );
}
