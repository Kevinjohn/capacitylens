import { randomUUID } from 'node:crypto';
import { test } from '@japa/runner';
import { freshDatabase } from '#tests/helpers/fresh_database';
import db from '@adonisjs/lucid/services/db';
import Activity from '#models/activity';
import Resource from '#models/resource';
import { encodeRow } from '#services/state_repository';
import { readState } from '#tests/helpers/state_fixture';
import {
  companyId,
  configureAuth,
  resetPlanningFixture,
  signIn,
} from '#tests/functional/planning/helpers';
import {
  send,
  restore,
  currentRevision,
  markers,
  planningAudit,
  consumedAt,
} from '#tests/functional/planning/restoration_helpers';

test.group('typed catalogue and time-off restoration', (suite) => {
  suite.setup(() => freshDatabase());
  suite.each.setup(async () => {
    await resetPlanningFixture();
  });

  test('discipline deletion nulls resource links and restores only those links', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const before = await readState(companyId, true);
    const resource = before.resources.find((row) => row.disciplineId !== null)!;
    const disciplineId = resource.disciplineId!;
    await Resource.query()
      .withScopes((scopes) => scopes.forCompany(companyId))
      .where('id', resource.id)
      .softDelete();
    const hiddenResource = await db.from('resources').where('id', resource.id).first();
    const childDeletedAt = hiddenResource.deleted_at;
    const deleted = await send(
      client,
      cookie,
      `/api/companies/${companyId}/planning/mutations`,
      0,
      {
        operation: 'catalogue.delete',
        entity: { entity: 'disciplines', id: disciplineId },
      }
    );
    deleted.assertStatus(200);
    const afterDelete = await readState(companyId, true);
    assert.isNull(afterDelete.resources.find((row) => row.id === resource.id)?.disciplineId);
    const detachedResource = await db.from('resources').where('id', resource.id).first();
    assert.equal(detachedResource.updated_at, hiddenResource.updated_at);
    assert.equal(detachedResource.deleted_at, childDeletedAt);
    await db
      .from('resources')
      .where('id', resource.id)
      .update({ job_title: 'Updated Gotham role' });
    const restored = await restore(
      client,
      cookie,
      deleted.body().data.restoration.replacementGroupId,
      1
    );
    restored.assertStatus(200);
    const after = await readState(companyId, true);
    assert.equal(after.resources.find((row) => row.id === resource.id)?.disciplineId, disciplineId);
    assert.equal(
      after.resources.find((row) => row.id === resource.id)?.jobTitle,
      'Updated Gotham role'
    );
    const relinkedResource = await db.from('resources').where('id', resource.id).first();
    assert.equal(relinkedResource.deleted_at, childDeletedAt);
    assert.isAbove(Date.parse(relinkedResource.updated_at), Date.parse(hiddenResource.updated_at));
  });

  test('a reassigned child prevents partial discipline relinking and leaves the group usable', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const before = await readState(companyId, true);
    const discipline = before.disciplines.find(
      (row) => before.resources.filter((resource) => resource.disciplineId === row.id).length >= 2
    )!;
    const children = before.resources.filter((row) => row.disciplineId === discipline.id);
    const other = before.disciplines.find((row) => row.id !== discipline.id)!;
    const deleted = await send(
      client,
      cookie,
      `/api/companies/${companyId}/planning/mutations`,
      0,
      { operation: 'catalogue.delete', entity: { entity: 'disciplines', id: discipline.id } }
    );
    deleted.assertStatus(200);
    const groupId = deleted.body().data.restoration.replacementGroupId;
    await db.from('resources').where('id', children[1]!.id).update({ discipline_id: other.id });
    const auditBefore = await planningAudit();
    const mutationsBefore = await markers();
    const refused = await restore(client, cookie, groupId, 1);
    refused.assertStatus(409);
    const after = await readState(companyId, true);
    assert.isUndefined(after.disciplines.find((row) => row.id === discipline.id));
    assert.isNull(after.resources.find((row) => row.id === children[0]!.id)?.disciplineId);
    assert.equal(after.resources.find((row) => row.id === children[1]!.id)?.disciplineId, other.id);
    assert.isNull(await consumedAt(groupId));
    assert.equal(await currentRevision(client, cookie), 1);
    assert.deepEqual(await markers(), mutationsBefore);
    assert.deepEqual(await planningAudit(), auditBefore);
  });

  test('phase deletion nulls activity links and refuses a changed project without consuming the group', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const before = await readState(companyId, true);
    const seededActivity = before.activities.find((row) => row.phaseId !== null)!;
    await Activity.query()
      .withScopes((scopes) => scopes.forCompany(companyId))
      .where('id', seededActivity.id)
      .softDelete();
    const activity = before.activities.find((row) => row.id === seededActivity.id)!;
    const hiddenActivity = await db.from('activities').where('id', activity.id).first();
    const childDeletedAt = hiddenActivity.deleted_at;
    const phaseId = activity.phaseId!;
    const deleted = await send(
      client,
      cookie,
      `/api/companies/${companyId}/planning/mutations`,
      0,
      {
        operation: 'catalogue.delete',
        entity: { entity: 'phases', id: phaseId },
      }
    );
    deleted.assertStatus(200);
    const groupId = deleted.body().data.restoration.replacementGroupId;
    const afterDelete = await readState(companyId, true);
    assert.isNull(afterDelete.activities.find((row) => row.id === activity.id)?.phaseId);
    const detachedActivity = await db.from('activities').where('id', activity.id).first();
    assert.equal(detachedActivity.updated_at, hiddenActivity.updated_at);
    assert.equal(detachedActivity.deleted_at, childDeletedAt);
    const otherProject = before.projects.find((row) => row.id !== activity.projectId)!;
    await db.from('activities').where('id', activity.id).update({ project_id: otherProject.id });
    const refused = await restore(client, cookie, groupId, 1);
    refused.assertStatus(409);
    assert.isNull(await consumedAt(groupId));
    const afterRefusal = await readState(companyId, true);
    assert.isUndefined(afterRefusal.phases.find((row) => row.id === phaseId));
    await db
      .from('activities')
      .where('id', activity.id)
      .update({ project_id: activity.projectId, name: 'Gotham review' });
    const restored = await restore(client, cookie, groupId, 1);
    restored.assertStatus(200);
    const after = await readState(companyId, true);
    assert.equal(after.activities.find((row) => row.id === activity.id)?.phaseId, phaseId);
    assert.equal(after.activities.find((row) => row.id === activity.id)?.name, 'Gotham review');
    const relinkedActivity = await db.from('activities').where('id', activity.id).first();
    assert.equal(relinkedActivity.deleted_at, childDeletedAt);
    assert.isAbove(Date.parse(relinkedActivity.updated_at), Date.parse(hiddenActivity.updated_at));
  });

  test('a missing phase project returns a restoration conflict without consuming its group', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const before = await readState(companyId, true);
    const clientId = before.clients.find((row) => !row.builtin)!.id;
    const projectId = randomUUID();
    const phaseId = randomUUID();
    const project = await send(
      client,
      cookie,
      `/api/companies/${companyId}/planning/mutations`,
      0,
      {
        operation: 'catalogue.create',
        entity: {
          entity: 'projects',
          id: projectId,
          fields: {
            name: 'Gotham restoration project',
            color: before.clients.find((row) => row.id === clientId)!.color,
            clientId,
          },
        },
      }
    );
    project.assertStatus(200);
    const phase = await send(client, cookie, `/api/companies/${companyId}/planning/mutations`, 1, {
      operation: 'catalogue.create',
      entity: { entity: 'phases', id: phaseId, fields: { name: 'Survey', projectId } },
    });
    phase.assertStatus(200);
    const deleted = await send(
      client,
      cookie,
      `/api/companies/${companyId}/planning/mutations`,
      2,
      { operation: 'catalogue.delete', entity: { entity: 'phases', id: phaseId } }
    );
    deleted.assertStatus(200);
    const groupId = deleted.body().data.restoration.replacementGroupId;
    await db.from('projects').where('id', projectId).delete();
    const auditBefore = await planningAudit();
    const mutationsBefore = await markers();
    const refused = await restore(client, cookie, groupId, 3);
    refused.assertStatus(409);
    const after = await readState(companyId, true);
    assert.isUndefined(after.phases.find((row) => row.id === phaseId));
    assert.isNull(await consumedAt(groupId));
    assert.equal(await currentRevision(client, cookie), 3);
    assert.deepEqual(await markers(), mutationsBefore);
    assert.deepEqual(await planningAudit(), auditBefore);
  });

  test('time-off subset deletion keeps other rows and restores a hidden note without exposing it', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client, 'editor');
    const before = await readState(companyId, true);
    const resourceId = before.resources.find((row) => row.kind === 'person')!.id;
    const ids: string[] = [randomUUID(), randomUUID(), randomUUID()];
    for (const id of ids)
      await db.table('time_off').insert(
        encodeRow('time_off', {
          id,
          companyId,
          resourceId,
          startDate: '2026-11-02',
          endDate: '2026-11-02',
          type: 'holiday',
          note: 'Gotham private note',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
    const deleted = await send(
      client,
      cookie,
      `/api/companies/${companyId}/planning/mutations`,
      0,
      { operation: 'timeOff.deleteGroup', ids: ids.slice(0, 2) }
    );
    deleted.assertStatus(200);
    assert.notInclude(deleted.text(), 'Gotham private note');
    const afterDelete = await readState(companyId, true);
    assert.deepEqual(
      afterDelete.timeOff.filter((row) => ids.includes(row.id)).map((row) => row.id),
      [ids[2]]
    );
    const restored = await restore(
      client,
      cookie,
      deleted.body().data.restoration.replacementGroupId,
      1
    );
    restored.assertStatus(200);
    assert.notInclude(restored.text(), 'Gotham private note');
    const afterRestore = await readState(companyId, true);
    assert.sameMembers(
      afterRestore.timeOff.filter((row) => ids.includes(row.id)).map((row) => row.id),
      ids
    );
    assert.equal(
      afterRestore.timeOff.find((row) => row.id === ids[0])?.note,
      'Gotham private note'
    );
  });

  test('closure deletion restores the same stored row and consumes its handle once', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const id = randomUUID();
    const created = await send(
      client,
      cookie,
      `/api/companies/${companyId}/planning/mutations`,
      0,
      {
        operation: 'closure.create',
        id,
        fields: { name: 'Gotham closure', startDate: '2026-11-02', endDate: '2026-11-02' },
      }
    );
    created.assertStatus(200);
    const afterCreate = await readState(companyId, true);
    const closure = afterCreate.closures.find((row) => row.id === id)!;
    const deleted = await send(
      client,
      cookie,
      `/api/companies/${companyId}/planning/mutations`,
      1,
      {
        operation: 'closure.delete',
        id,
      }
    );
    deleted.assertStatus(200);
    const afterDelete = await readState(companyId, true);
    assert.isUndefined(afterDelete.closures.find((row) => row.id === id));
    const groupId = deleted.body().data.restoration.replacementGroupId;
    const restored = await restore(client, cookie, groupId, 2);
    restored.assertStatus(200);
    const afterRestore = await readState(companyId, true);
    assert.deepEqual(
      afterRestore.closures.find((row) => row.id === id),
      closure
    );
    const again = await restore(client, cookie, groupId, 3);
    again.assertStatus(409);
  });
});
