import { archive } from '@capacitylens/shared/domain/lifecycle';
import type { AppData } from '@capacitylens/shared/types/entities';
import { requireExistingRow } from '#services/planning/writer';

declare const data: AppData;

// A stored row keeps its table's type, so a lifecycle helper accepts a lifecycle table's row.
export const archivable = () =>
  archive(requireExistingRow(data, 'resources', 'resource-hulk'), '2026-11-01T00:00:00.000Z');

export const refused = () =>
  archive(
    // @ts-expect-error Allocations carry no lifecycle fields.
    requireExistingRow(data, 'allocations', 'allocation-hulk'),
    '2026-11-01T00:00:00.000Z'
  );
