import { describe, expect, it } from 'vitest';
import { getInternalClient } from '@capacitylens/shared/data/internalClient';
import type { Activity } from '@capacitylens/shared/types/entities';
import { makeActivity, makeAllocation, makeClient, makeProject } from '@/test/fixtures';
import { buildAllocationAttribution } from './buildAllocationAttribution';

function withoutProjectId(activity: Activity): Activity {
  const copy = { ...activity };
  copy.projectId = null;
  return copy;
}

describe('buildAllocationAttribution', () => {
  const internal = makeClient({ id: 'internal', builtin: true, name: 'Internal' });
  const client = makeClient({ id: 'client', name: 'Wayne Foundation' });
  const project = makeProject({ id: 'project', clientId: client.id, name: 'Watchtower' });
  const projectsById = new Map([[project.id, project]]);
  const clientsById = new Map([
    [internal.id, internal],
    [client.id, client],
  ]);

  it('uses activity attribution for project work and allocation attribution for reusable work', () => {
    const projectActivity = makeActivity({
      id: 'project-activity',
      kind: 'project',
      projectId: project.id,
    });
    const allProjectsActivity = withoutProjectId(
      makeActivity({ id: 'allProjects', kind: 'allProjects' }),
    );
    const activitiesById = new Map([
      [projectActivity.id, projectActivity],
      [allProjectsActivity.id, allProjectsActivity],
    ]);

    expect(
      buildAllocationAttribution({
        allocation: makeAllocation({ activityId: projectActivity.id }),
        activitiesById,
        projectsById,
        clientsById,
        internalClient: internal,
      }),
    ).toEqual({ projectId: project.id, project, client });
    expect(
      buildAllocationAttribution({
        allocation: makeAllocation({ activityId: allProjectsActivity.id, projectId: project.id }),
        activitiesById,
        projectsById,
        clientsById,
        internalClient: internal,
      }),
    ).toEqual({ projectId: project.id, project, client });
  });

  it('uses Internal only for a known project-less activity and never for a missing project reference', () => {
    const activity = withoutProjectId(makeActivity({ id: 'internal-activity', kind: 'internal' }));
    const activitiesById = new Map([[activity.id, activity]]);

    expect(
      buildAllocationAttribution({
        allocation: makeAllocation({ activityId: activity.id }),
        activitiesById,
        projectsById,
        clientsById,
        internalClient: getInternalClient([...clientsById.values()], 'a1'),
      }),
    ).toEqual({ projectId: undefined, project: undefined, client: internal });
    expect(
      buildAllocationAttribution({
        allocation: makeAllocation({ activityId: activity.id, projectId: 'missing-project' }),
        activitiesById,
        projectsById,
        clientsById,
        internalClient: internal,
      }),
    ).toEqual({ projectId: 'missing-project', project: undefined, client: undefined });
  });
});
