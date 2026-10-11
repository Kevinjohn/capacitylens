import { SchedulerToolbar } from "./SchedulerToolbar";
import { SchedulerGrid } from "./SchedulerGrid";

/** Combines schedule controls with the week grid. */
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
