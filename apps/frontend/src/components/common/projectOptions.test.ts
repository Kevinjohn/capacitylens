import { describe, expect, it } from 'vitest';
import { makeClient, makeProject } from '@/test/fixtures';
import { buildProjectOptions, formatProjectLabel } from './projectOptions';

const wayne = makeClient({ id: 'c-wayne', name: 'Wayne Enterprises' });
const batmobile = makeProject({ id: 'p-batmobile', name: 'Batmobile', clientId: 'c-wayne' });
const batcave = makeProject({ id: 'p-batcave', name: 'Batcave', clientId: 'c-missing' });

describe('formatProjectLabel', () => {
  it('prefixes the client name when there is one', () => {
    expect(formatProjectLabel('Batmobile', 'Wayne Enterprises')).toBe(
      'Wayne Enterprises / Batmobile',
    );
    expect(formatProjectLabel('Batmobile', undefined)).toBe('Batmobile');
  });
});

describe('buildProjectOptions', () => {
  const active = { projects: [batmobile], clients: [wayne] };

  it('labels an active project with its client', () => {
    expect(
      buildProjectOptions({
        ...active,
        rawProjects: [],
        rawClients: [],
        currentProjectId: undefined,
      }),
    ).toEqual([{ value: 'p-batmobile', label: 'Wayne Enterprises / Batmobile' }]);
  });

  it('labels a project whose client is absent with the project name only', () => {
    expect(
      buildProjectOptions({
        projects: [batcave],
        clients: [wayne],
        rawProjects: [],
        rawClients: [],
        currentProjectId: undefined,
      }),
    ).toEqual([{ value: 'p-batcave', label: 'Batcave' }]);
  });

  it('adds no option when the current project is active or unset', () => {
    for (const currentProjectId of ['p-batmobile', undefined]) {
      expect(
        buildProjectOptions({ ...active, rawProjects: [], rawClients: [], currentProjectId }),
      ).toHaveLength(1);
    }
  });

  it('keeps an archived current project as a disabled, labelled option', () => {
    const options = buildProjectOptions({
      projects: [],
      clients: [],
      rawProjects: [batmobile],
      rawClients: [wayne],
      currentProjectId: 'p-batmobile',
    });
    expect(options).toEqual([
      { value: 'p-batmobile', label: 'Wayne Enterprises / Batmobile (archived)', disabled: true },
    ]);
  });

  it('keeps a missing current project as a disabled placeholder option', () => {
    const options = buildProjectOptions({
      ...active,
      rawProjects: [batmobile],
      rawClients: [wayne],
      currentProjectId: 'p-gone',
    });
    expect(options.at(-1)).toEqual({
      value: 'p-gone',
      label: '(current, archived)',
      disabled: true,
    });
  });
});
