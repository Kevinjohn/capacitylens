import { m } from '@/i18n';
import type { ScopedEntityKey } from '@capacitylens/shared/types/entities';

// Store message getters so import-summary labels follow the active locale at render time.
const SUMMARY: [ScopedEntityKey, () => string][] = [
  ['resources', () => m.data_summary_resources()],
  ['disciplines', () => m.data_summary_disciplines()],
  ['clients', () => m.data_summary_clients()],
  ['projects', () => m.data_summary_projects()],
  ['phases', () => m.data_summary_phases()],
  ['activities', () => m.data_summary_activities()],
  ['allocations', () => m.data_summary_allocations()],
  ['timeOff', () => m.data_summary_time_off()],
  ['closures', () => m.data_summary_closures()],
];

export function summarize(counts: Record<ScopedEntityKey, number>): string {
  const parts = SUMMARY.filter(([key]) => counts[key] > 0).map(
    ([key, label]) => `${counts[key]} ${label()}`,
  );
  return parts.length ? parts.join(', ') : m.data_summary_none();
}

export function buildSkippedMessage(skipped: number, variant: 'why' | 'note'): string {
  if (skipped === 0) return '';
  if (variant === 'why') {
    if (skipped === 1) return m.data_why_skipped_one({ count: skipped });
    return m.data_why_skipped_other({ count: skipped });
  }
  if (skipped === 1) return m.data_skipped_note_one({ count: skipped });
  return m.data_skipped_note_other({ count: skipped });
}
