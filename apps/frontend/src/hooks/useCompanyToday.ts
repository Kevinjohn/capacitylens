import { useStore } from '@/store/useStore';
import type { ISODate } from '@capacitylens/shared/types/entities';

/**
 * The company's calendar date, as sent by the server with the planning read. The app shell holds
 * every view behind its loader until a read has set it, so a null value here is a wiring fault.
 */
export function useCompanyToday(): ISODate {
  const today = useStore((state) => state.planning.today);
  if (today === null) throw new Error('The company date has not been read.');
  return today;
}
