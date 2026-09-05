import type { Activity } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../ui/select";

export interface ToolbarActivityFilterProps {
  activityId: string | null;
  activityKind: "internal" | "repeatable" | null;
  internalActivities: Activity[];
  repeatableActivities: Activity[];
  onChange: (patch: { activityId: string | null; activityKind: "internal" | "repeatable" | null }) => void;
}

export function ToolbarActivityFilter({
  activityId,
  activityKind,
  internalActivities,
  repeatableActivities,
  onChange,
}: ToolbarActivityFilterProps) {
  return (
    <Select
      // Encoded value: 'all' = all, 'kind:internal'/'kind:repeatable' = a whole group,
      // otherwise a specific activity id. An activityKind selection wins over a stale activityId.
      value={activityKind ? `kind:${activityKind}` : (activityId ?? "all")}
      onValueChange={(value) => {
        if (value === "kind:internal")
          onChange({
            activityKind: "internal",
            activityId: null,
          });
        else if (value === "kind:repeatable")
          onChange({
            activityKind: "repeatable",
            activityId: null,
          });
        else
          onChange({
            activityId: value === "all" ? null : value,
            activityKind: null,
          });
      }}
    >
      <SelectTrigger size="sm" aria-label={m.scheduler_filter_activity_aria()} className="w-auto">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="all">{m.scheduler_filter_all_activities()}</SelectItem>
        </SelectGroup>
        {internalActivities.length > 0 && (
          <SelectGroup>
            <SelectLabel>{m.scheduler_filter_internal_group()}</SelectLabel>
            <SelectItem value="kind:internal">{m.scheduler_filter_internal_all()}</SelectItem>
            {internalActivities.map((activity) => (
              <SelectItem key={activity.id} value={activity.id}>
                {activity.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {repeatableActivities.length > 0 && (
          <SelectGroup>
            <SelectLabel>{m.scheduler_filter_repeatable_group()}</SelectLabel>
            <SelectItem value="kind:repeatable">{m.scheduler_filter_repeatable_all()}</SelectItem>
            {repeatableActivities.map((activity) => (
              <SelectItem key={activity.id} value={activity.id}>
                {activity.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
