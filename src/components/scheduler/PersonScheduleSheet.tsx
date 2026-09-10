import { useEffect } from "react";

import { m } from "@/i18n";
import { formatScheduleDateRange } from "@/lib/dateDisplay";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { PersonScheduleEntry } from "./PersonScheduleEntry";
import type { PersonScheduleSheetProps } from "./personScheduleTypes";

export function PersonScheduleSheet({ open, schedule, onOpenChange, onRestoreFocus }: PersonScheduleSheetProps) {
  const available = schedule.kind === "available";

  useEffect(() => {
    if (open && !available) onOpenChange(false);
  }, [available, onOpenChange, open]);

  return (
    <Sheet open={open && available} onOpenChange={onOpenChange}>
      {available && (
        <SheetContent
          side="right"
          aria-modal="true"
          data-testid="person-schedule-sheet"
          className="w-full max-w-[400px] gap-0 p-0 sm:max-w-[400px]"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onRestoreFocus();
          }}
        >
          <SheetHeader data-testid="person-schedule-header" className="shrink-0 border-b py-4 pr-12 text-left">
            <SheetTitle>{m.scheduler_person_schedule_title({ name: schedule.model.title })}</SheetTitle>
            <SheetDescription>
              {m.scheduler_person_schedule_description({
                range: formatScheduleDateRange(schedule.model.window.startDate, schedule.model.window.endDate),
              })}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {schedule.model.entries.length === 0 ? (
              <p data-testid="person-schedule-empty" className="py-10 text-center text-sm text-muted-foreground">
                {m.scheduler_person_schedule_empty()}
              </p>
            ) : (
              <ul className="space-y-3">
                {schedule.model.entries.map((entry) => (
                  <PersonScheduleEntry key={entry.key} entry={entry} />
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}
