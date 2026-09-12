import { Eye } from "lucide-react";
import type { ID } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { Avatar } from "../common/ui";
import { Button } from "../ui/button";

export interface PersonScheduleTriggerProps {
  resourceId: ID;
  /** Resolved title used in the "View {name}'s schedule" trigger label. */
  scheduleTitle: string;
  /** Name (or role, for an unnamed placeholder) the avatar derives initials from. */
  avatarName: string;
  color: string;
  placeholder: boolean;
  onViewSchedule: (resourceId: ID, opener: HTMLButtonElement) => void;
}

/**
 * The avatar-with-eye button that opens the person schedule drawer. Shared by the Schedule
 * grid rows and the Overview person rows so the hover/focus-to-eye interaction and its test ids
 * (person-schedule-trigger/-avatar/-eye) stay one piece of code.
 */
export function PersonScheduleTrigger({
  resourceId,
  scheduleTitle,
  avatarName,
  color,
  placeholder,
  onViewSchedule,
}: PersonScheduleTriggerProps) {
  const triggerLabel = m.scheduler_person_schedule_trigger({ name: scheduleTitle });
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      data-testid="person-schedule-trigger"
      aria-label={triggerLabel}
      title={triggerLabel}
      className="group relative size-7 shrink-0 cursor-pointer rounded-full p-0"
      onClick={(event) => onViewSchedule(resourceId, event.currentTarget)}
    >
      <span
        data-testid="person-schedule-avatar"
        className="transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0"
      >
        <Avatar name={avatarName} color={color} placeholder={placeholder} />
      </span>
      <Eye
        aria-hidden
        data-testid="person-schedule-eye"
        className="absolute opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </Button>
  );
}
