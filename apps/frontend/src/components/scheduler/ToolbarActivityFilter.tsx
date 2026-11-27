import type { Activity } from '@capacitylens/shared/types/entities'
import { m } from '@/i18n'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Selected activity and change handler for the activity filter. */
export interface ToolbarActivityFilterProps {
  activityId: string | null
  activityKind: 'internal' | 'allProjects' | null
  internalActivities: Activity[]
  allProjectsActivities: Activity[]
  onChange: (patch: {
    activityId: string | null
    activityKind: 'internal' | 'allProjects' | null
  }) => void
}

function buildActivityFilterPatch(
  value: string
): Parameters<ToolbarActivityFilterProps['onChange']>[0] {
  if (value === 'kind:internal') return { activityKind: 'internal', activityId: null }
  if (value === 'kind:allProjects') return { activityKind: 'allProjects', activityId: null }
  return { activityId: value === 'all' ? null : value, activityKind: null }
}

/** Selects an activity lens for the schedule. */
export function ToolbarActivityFilter({
  activityId,
  activityKind,
  internalActivities,
  allProjectsActivities,
  onChange,
}: ToolbarActivityFilterProps) {
  const selectedValue = activityKind ? `kind:${activityKind}` : (activityId ?? 'all')
  const availableValues = new Set([
    'all',
    ...internalActivities.map((activity) => activity.id),
    ...allProjectsActivities.map((activity) => activity.id),
    ...(internalActivities.length > 0 ? ['kind:internal'] : []),
    ...(allProjectsActivities.length > 0 ? ['kind:allProjects'] : []),
  ])
  const selectionUnavailable = selectedValue !== 'all' && !availableValues.has(selectedValue)

  return (
    <Select
      value={selectedValue}
      onValueChange={(value) => onChange(buildActivityFilterPatch(value))}
    >
      <SelectTrigger size="sm" aria-label={m.scheduler_filter_activity_aria()} className="w-auto">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {selectionUnavailable && (
          <SelectItem value={selectedValue} disabled>
            {m.scheduler_filter_activity_unavailable()}
          </SelectItem>
        )}
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
        {allProjectsActivities.length > 0 && (
          <SelectGroup>
            <SelectLabel>{m.scheduler_filter_all_projects_group()}</SelectLabel>
            <SelectItem value="kind:allProjects">
              {m.scheduler_filter_all_projects_all()}
            </SelectItem>
            {allProjectsActivities.map((activity) => (
              <SelectItem key={activity.id} value={activity.id}>
                {activity.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  )
}
