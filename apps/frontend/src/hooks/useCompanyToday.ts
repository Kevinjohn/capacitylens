import { useStore } from '@/store/useStore'
import type { ISODate } from '@capacitylens/shared/types/entities'

/**
 * The company's calendar date, as sent by the server with the planning read. `CompanyDateRoute` in
 * the router holds every view that calls this until a read has set it, so a null value here is a
 * wiring fault.
 */
export function useCompanyToday(): ISODate {
  const today = useStore((state) => state.planning.today)
  if (today === null) throw new Error('The company date has not been read.')
  return today
}
