import { describe, expect, it } from 'vitest';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import { makeCompany, makeClient, makeProject } from '@/test/fixtures';
import type { AppData } from '@capacitylens/shared/types/entities';
import { scopeData } from './selectors';

function twoCompanyData(): AppData {
  return {
    ...emptyAppData(),
    accounts: [makeCompany({ id: 'a1', name: 'One' }), makeCompany({ id: 'a2', name: 'Two' })],
    clients: [
      makeClient({ id: 'c1', companyId: 'a1', name: 'Client A1' }),
      makeClient({ id: 'c2', companyId: 'a2', name: 'Client A2' }),
    ],
    projects: [
      makeProject({ id: 'p1', companyId: 'a1', name: 'Proj A1', clientId: 'c1' }),
      makeProject({ id: 'p2', companyId: 'a2', name: 'Proj A2', clientId: 'c2' }),
    ],
  };
}

describe('scopeData', () => {
  it('returns only the matching company rows and blanks the companies list', () => {
    const scoped = scopeData(twoCompanyData(), 'a1');
    expect(scoped.clients.map((client) => client.id)).toEqual(['c1']);
    expect(scoped.projects.map((project) => project.id)).toEqual(['p1']);
    expect(scoped.accounts).toEqual([]);
  });

  it('excludes company settings from a portable company slice', () => {
    const source = twoCompanyData();
    const company = source.accounts[0];
    if (!company) throw new Error('Expected the first company fixture');
    source.accounts[0] = {
      ...company,
      schedulingMode: 'days',
      placeholdersEnabled: true,
      dateStyle: 'month-day',
    };

    const scoped = scopeData(source, 'a1');
    expect(scoped.accounts).toEqual([]);
    expect(scoped.clients.map((client) => client.id)).toEqual(['c1']);
  });

  it('returns empty slices for an unknown company', () => {
    const scoped = scopeData(twoCompanyData(), 'nope');
    expect(scoped.clients).toEqual([]);
    expect(scoped.projects).toEqual([]);
  });
});
