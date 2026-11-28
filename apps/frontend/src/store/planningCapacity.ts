import { buildCapacitySection } from '@capacitylens/shared/lib/capacity'
import type { CapacitySection } from '@capacitylens/shared/lib/capacity'
import type { AppData, ISODate } from '@capacitylens/shared/types/entities'
import { buildVisibleRange } from './selectors'
import type { StoreState } from './types'

type PlanningCapacityInput = Pick<StoreState, 'data' | 'planning' | 'ui'>

let last: {
  data: AppData
  companyId: string
  today: ISODate
  from: ISODate
  to: ISODate
  section: CapacitySection
} | null = null

/**
 * The capacity section for the grid's window and the Capacity Overview horizon, built with the
 * server's own rule from the confirmed planning rows and the company date the server sent. Moving the
 * window therefore needs no request. Null until a read has supplied the date. Unchanged input returns
 * the same section, so this is safe as a store selector.
 */
export function buildPlanningCapacity({
  data,
  planning,
  ui,
}: PlanningCapacityInput): CapacitySection | null {
  const companyId = planning.context?.companyId
  const { today } = planning
  if (companyId === undefined || today === null) return null
  const { start: from, end: to } = buildVisibleRange(ui)
  if (
    last?.data === data &&
    last.companyId === companyId &&
    last.today === today &&
    last.from === from &&
    last.to === to
  ) {
    return last.section
  }
  const section = buildCapacitySection({
    data,
    company: data.companies.find((row) => row.id === companyId),
    today,
    window: { from, to },
  })
  last = { data, companyId, today, from, to, section }
  return section
}
