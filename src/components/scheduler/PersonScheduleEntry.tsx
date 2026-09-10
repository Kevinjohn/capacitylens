import { CalendarOff } from "lucide-react";

import { m } from "@/i18n";
import { formatDayMonth } from "@/lib/dateDisplay";
import { resolveTimeOffTypeLabel } from "@/lib/metadata";

import type {
  PersonScheduleAllocationEntry,
  PersonScheduleEntry as PersonScheduleEntryModel,
  PersonScheduleTimeOffEntry,
} from "./personScheduleTypes";

interface PersonScheduleEntryProps {
  entry: PersonScheduleEntryModel;
}

const roundDisplayHours = (hours: number) => Math.round(hours * 100) / 100;

const formatCompactDateRange = (
  startDate: PersonScheduleAllocationEntry["startDate"],
  endDate: PersonScheduleAllocationEntry["endDate"],
) => (startDate === endDate ? formatDayMonth(startDate) : `${formatDayMonth(startDate)} – ${formatDayMonth(endDate)}`);

function EntryNote({ note }: { note: string }) {
  return (
    <p className="mt-3 whitespace-pre-wrap break-words border-t border-line pt-3 text-sm text-muted-foreground">
      {note}
    </p>
  );
}

function AllocationEntry({ entry }: { entry: PersonScheduleAllocationEntry }) {
  const attribution = [entry.project, entry.client].filter(Boolean).join(" · ");
  return (
    <>
      <div className="flex min-w-0 items-start gap-2">
        <span
          aria-hidden="true"
          data-testid="person-schedule-colour"
          className="mt-1.5 size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
          style={{ backgroundColor: entry.color }}
        />
        <div className="min-w-0">
          <h3 className="break-words font-semibold text-foreground">{entry.activity}</h3>
          {attribution && <p className="break-words text-sm text-muted-foreground">{attribution}</p>}
        </div>
      </div>
      <p className="mt-2 break-words text-sm text-muted-foreground">
        {formatCompactDateRange(entry.startDate, entry.endDate)}
        {entry.hoursPerDay === undefined
          ? ""
          : m.scheduler_bar_pop_hours({ hours: roundDisplayHours(entry.hoursPerDay) })}
      </p>
      {entry.task && <p className="mt-3 break-words text-sm text-muted-foreground">{entry.task}</p>}
      {entry.note && <EntryNote note={entry.note} />}
    </>
  );
}

function TimeOffEntry({ entry }: { entry: PersonScheduleTimeOffEntry }) {
  return (
    <>
      <div className="flex items-start gap-2">
        <CalendarOff aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <h3 className="font-semibold text-foreground">{resolveTimeOffTypeLabel(entry.type)}</h3>
      </div>
      <p className="mt-2 break-words text-sm text-muted-foreground">
        {formatCompactDateRange(entry.startDate, entry.endDate)}
      </p>
      {entry.note && <EntryNote note={entry.note} />}
    </>
  );
}

export function PersonScheduleEntry({ entry }: PersonScheduleEntryProps) {
  return (
    <li
      data-testid="person-schedule-entry"
      data-entry-id={entry.key}
      data-entry-kind={entry.kind}
      className={`rounded-md border bg-card p-4 ${entry.kind === "timeOff" ? "relative overflow-hidden pl-6" : ""}`}
    >
      {entry.kind === "timeOff" && (
        <span
          aria-hidden="true"
          data-testid="person-schedule-timeoff-accent"
          className="absolute inset-y-0 left-0 w-2 bg-faint"
          style={{
            background:
              "repeating-linear-gradient(45deg, color-mix(in oklab, var(--color-faint) 28%, transparent) 0 5px, transparent 5px 10px)",
          }}
        />
      )}
      {entry.kind === "allocation" ? <AllocationEntry entry={entry} /> : <TimeOffEntry entry={entry} />}
    </li>
  );
}
