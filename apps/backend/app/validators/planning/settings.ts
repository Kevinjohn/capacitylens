import vine from '@vinejs/vine'
import {
  CAPACITY_OVERVIEW_ACCESS_VALUES,
  DATE_STYLES,
  SCHEDULING_MODES,
} from '@capacitylens/shared/types/entities'
import { isSupportedTimeZone } from '@capacitylens/shared/types/entityFieldRules'
import {
  boolean,
  nameText,
  presetColor,
  requireChanges,
  weekdays,
} from '#validators/planning/fields'

export const settingsChanges = {
  name: nameText().optional(),
  color: presetColor().optional(),
  weekStartsOn: vine
    .enum([0, 1] as const)
    .nullable()
    .optional(),
  timezone: vine
    .string()
    .use(
      vine.createRule((value, _options, field) => {
        if (isSupportedTimeZone(value)) return
        field.report('The timezone must be supported.', 'timezone', field)
      })()
    )
    .nullable()
    .optional(),
  schedulingMode: vine.enum(SCHEDULING_MODES).nullable().optional(),
  workingDays: weekdays()
    .use(
      vine.createRule((value, _options, field) => {
        if (value === null || (Array.isArray(value) && value.length > 0)) return
        field.report('Working days must contain a working day.', 'workingDays', field)
      })()
    )
    .nullable()
    .optional(),
  disciplinesEnabled: boolean().nullable().optional(),
  placeholdersEnabled: boolean().nullable().optional(),
  externalEnabled: boolean().nullable().optional(),
  inlineActivityCreateEnabled: boolean().nullable().optional(),
  showTaskFieldInSchedule: boolean().nullable().optional(),
  capacityOverviewAccess: vine.enum(CAPACITY_OVERVIEW_ACCESS_VALUES).nullable().optional(),
  dateStyle: vine.enum(DATE_STYLES).nullable().optional(),
}

export const settingsIntent = vine.object({
  operation: vine.literal('settings.update'),
  // `language` is frozen at company creation, so the writable list here leaves it out.
  changes: vine.object(settingsChanges).use(requireChanges(Object.keys(settingsChanges))),
})
