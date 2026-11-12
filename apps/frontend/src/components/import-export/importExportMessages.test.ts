import { describe, expect, it } from 'vitest';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import { makeAppData, makeAllocation, makeResource } from '@/test/fixtures';
import { buildSkippedMessage, summarize } from './importExportMessages';

describe('import messages', () => {
  it('names skipped records for the no-records reason and the success note', () => {
    expect(buildSkippedMessage(0, 'why')).toBe('');
    expect(buildSkippedMessage(1, 'why')).toBe(' — 1 invalid record skipped');
    expect(buildSkippedMessage(3, 'why')).toBe(' — 3 invalid records skipped');
    expect(buildSkippedMessage(1, 'note')).toBe(' (1 invalid record skipped)');
    expect(buildSkippedMessage(2, 'note')).toBe(' (2 invalid records skipped)');
  });

  it('summarises only the tables that hold rows', () => {
    const data = makeAppData({ resources: [makeResource()], allocations: [makeAllocation()] });
    expect(summarize({ ...data, accounts: [] })).toBe('1 resources, 1 allocations');
    expect(summarize(emptyAppData())).toBe('no entities');
  });
});
