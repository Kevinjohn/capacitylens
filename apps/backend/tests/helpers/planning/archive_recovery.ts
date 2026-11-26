import type { ApiClient, ApiRequest } from '@japa/api-client';
import type { AppData } from '@capacitylens/shared/types/entities';
import type { ArchiveRecovery, ArchiveRecoveryRow } from '@capacitylens/shared/domain/lifecycle';
import db from '@adonisjs/lucid/services/db';
import { readState } from '#tests/helpers/state_fixture';
import { companyId, intentSession, type Credential } from '#tests/functional/planning/helpers';
import { mutationInput } from '#tests/helpers/planning/mutations';

export const stamp = '2026-10-01T00:00:00.000Z';
export const privateClientName = 'Wayne Archive Client';
export const privateClientCode = 'Project Nightwing';
export const privateProjectName = 'Wayne Archive Project';
export const privateProjectCode = 'Project Bat Project';

export type PlanningBody = {
  revision: number;
  data: AppData;
};

export function recovery(response: { body(): unknown }) {
  return (response.body() as { data: ArchiveRecovery }).data;
}

export function planning(response: { body(): unknown }) {
  return (response.body() as { data: PlanningBody }).data;
}

export function requestWithContext<T extends ApiRequest>(
  request: T,
  cookie: string,
  context?: string
) {
  const authenticated = intentSession(request, cookie);
  return context ? authenticated.header('X-Masquerade-Context', context) : authenticated;
}

export function restoreOperation(entity: ArchiveRecoveryRow['entity'], id: string) {
  if (entity === 'resources')
    return {
      intent: { operation: 'resource.restore', id },
    };
  return {
    intent: { operation: 'catalogue.restore', entity: { entity, id } },
  };
}

export async function restore(
  client: ApiClient,
  cookie: Credential,
  entity: ArchiveRecoveryRow['entity'],
  id: string,
  baseRevision: number
) {
  const operation = restoreOperation(entity, id);
  return intentSession(client.visit('api.planning_mutations.store', { companyId }), cookie)
    .json(mutationInput(baseRevision, operation.intent))
    .send();
}

export function requireRow<T>(row: T | undefined, label: string): T {
  if (!row) throw new Error(`Missing archive-recovery fixture row: ${label}`);
  return row;
}

/** Add private, archived and inherited-hidden rows with data that must not leave the server. */
export async function prepareArchiveFixture(archiveProject = false) {
  const data = await readState(companyId, true);
  const client = requireRow(
    data.clients.find((row) => row.id === 'c-acme'),
    'c-acme'
  );
  const project = requireRow(
    data.projects.find((row) => row.id === 'p-brand'),
    'p-brand'
  );

  await db.from('clients').where({ id: client.id, company_id: companyId }).update({
    name: privateClientName,
    is_private: true,
    code_name: privateClientCode,
    archived_at: stamp,
  });
  await db.from('projects').where({ id: 'p-acme', company_id: companyId }).update({
    name: privateProjectName,
    is_private: true,
    code_name: privateProjectCode,
  });
  await db
    .from('projects')
    .where({ id: project.id, company_id: companyId })
    .update({
      is_private: true,
      code_name: null,
      ...(archiveProject ? { archived_at: stamp } : {}),
    });
  await db.from('resources').where({ id: 'r-tyler', company_id: companyId }).update({
    archived_at: stamp,
    job_title: 'Secret Designer Role',
    avatar_url: 'private-avatar-sentinel',
  });
  await db.from('resources').where({ id: 'r-alex', company_id: companyId }).update({
    archived_at: stamp,
    engagement: 'supplementary',
  });
  await db.from('resources').where({ id: 'r-ext-northstar', company_id: companyId }).update({
    archived_at: stamp,
  });
  await db.from('resources').where({ id: 'r-ph-designer', company_id: companyId }).update({
    project_id: project.id,
  });
  await db.from('activities').where({ id: 't-admin', company_id: companyId }).update({
    archived_at: stamp,
  });
  await db.from('clients').where({ id: 'c-internal-studio', company_id: companyId }).update({
    archived_at: stamp,
  });

  const verified = await readState(companyId, true);
  if (
    verified.clients.find((row) => row.id === client.id)?.isPrivate !== true ||
    verified.projects.find((row) => row.id === project.id)?.isPrivate !== true ||
    verified.projects.find((row) => row.id === project.id)?.codeName !== null
  )
    throw new Error('Private archive fixtures did not round-trip through the SQLite JSON columns.');

  return { data, clientId: client.id, projectId: project.id };
}
