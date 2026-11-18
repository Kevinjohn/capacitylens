import { randomUUID } from 'node:crypto';
import { test } from '@japa/runner';
import {
  GENERATED_ALLOCATION_LIMIT,
  TIME_OFF_REPEAT_POLICY,
} from '@capacitylens/shared/lib/repeatingDates';
import { freshDatabase } from '../../helpers/fresh_database.js';
import db from '@adonisjs/lucid/services/db';
import { readState } from '#tests/helpers/state_fixture';
import { activeOnly } from '@capacitylens/shared/domain/lifecycle';
import {
  companyId,
  configureAuth,
  newAllocation,
  planningUrl,
  resetPlanningFixture,
  session,
  signIn,
  trusted,
} from './helpers.js';

const route = (path: string) => `/api/companies/${companyId}/${path}`;
const input = (baseRevision: number, intent: Record<string, unknown>) => ({
  mutationId: randomUUID(),
  baseRevision,
  intent,
});
const body = (response: { body(): unknown }) =>
  response.body() as {
    code?: string;
    error?: string;
    status?: string;
    mutationId?: string;
    revision?: number;
  };

test.group('independent typed planning operations', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetPlanningFixture();
  });

  test('creates one allocation series from a pattern and permits a later Sunday occurrence', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie } = await signIn(client);
    // Thursday 1 October repeats on the first of each month; 1 November is a Sunday.
    const first = { ...newAllocation(data), startDate: '2026-10-01', endDate: '2026-10-01' };
    const laterId = randomUUID();
    const committed = await session(client.post(route('allocations/create-group')), cookie)
      .json(
        input(0, {
          operation: 'allocation.createGroup',
          allocation: first,
          repeat: { pattern: { kind: 'monthly-date' }, until: '2026-11-01' },
          occurrenceIds: [laterId],
        })
      )
      .send();

    committed.assertStatus(200);
    assert.equal(body(committed).revision, 1);
    const saved = await readState(companyId, true);
    const created = [first.id, laterId].map((id) => saved.allocations.find((row) => row.id === id));
    assert.isDefined(created[0]);
    assert.isDefined(created[1]);
    assert.isNotEmpty(created[0]!.seriesId);
    assert.equal(created[1]!.seriesId, created[0]!.seriesId);
    assert.equal(created[1]!.startDate, '2026-11-01');
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 1);
  });

  test('refuses more occurrence ids than the shared ceiling allows', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const before = await readState(companyId, true);
    const refused = await session(client.post(route('allocations/create-group')), cookie)
      .json(
        input(0, {
          operation: 'allocation.createGroup',
          allocation: newAllocation(before),
          repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2027-05-02' },
          occurrenceIds: Array.from({ length: GENERATED_ALLOCATION_LIMIT }, () => randomUUID()),
        })
      )
      .send();

    refused.assertStatus(400);
    assert.equal(body(refused).code, 'VALIDATION_ERROR');
    assert.include(body(refused).error, 'occurrenceIds');
    assert.deepEqual(await readState(companyId, true), before);
  });

  test('refuses a repeated occurrence id or one that reuses the first id', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const before = await readState(companyId, true);
    const allocation = newAllocation(before);
    const repeated = randomUUID();
    for (const occurrenceIds of [
      [repeated, repeated],
      [allocation.id, randomUUID()],
    ]) {
      const refused = await session(client.post(route('allocations/create-group')), cookie)
        .json(
          input(0, {
            operation: 'allocation.createGroup',
            allocation,
            repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-11-16' },
            occurrenceIds,
          })
        )
        .send();
      refused.assertStatus(400);
      assert.equal(body(refused).error, 'Entity IDs must be unique.');
    }
    assert.deepEqual(await readState(companyId, true), before);
  });

  test('refuses time-off occurrence ids past the ceiling, repeated, or reusing the first id', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const before = await readState(companyId, true);
    const timeOff = {
      id: randomUUID(),
      resourceId: before.resources.find((row) => row.kind === 'person')!.id,
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      type: 'holiday',
    };
    const repeated = randomUUID();
    for (const [occurrenceIds, error] of [
      [
        Array.from({ length: TIME_OFF_REPEAT_POLICY.maxOccurrences }, () => randomUUID()),
        'occurrenceIds',
      ],
      [[repeated, repeated], 'Entity IDs must be unique.'],
      [[timeOff.id, randomUUID()], 'Entity IDs must be unique.'],
    ] as const) {
      const refused = await session(client.post(route('time-off/repeat')), cookie)
        .json(
          input(0, {
            operation: 'timeOff.repeat',
            timeOff,
            repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-11-16' },
            occurrenceIds,
          })
        )
        .send();
      refused.assertStatus(400);
      assert.equal(body(refused).code, 'VALIDATION_ERROR');
      assert.include(body(refused).error, error);
    }
    assert.deepEqual(await readState(companyId, true), before);
  });

  test('refuses occurrence ids that do not match the repeat before persisting any occurrence', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie } = await signIn(client);
    const first = newAllocation(data);
    const before = await readState(companyId, true);
    // Weekly from 2 November to 16 November makes three occurrences, so two later ids.
    for (const count of [1, 3]) {
      const refused = await session(client.post(route('allocations/create-group')), cookie)
        .json(
          input(0, {
            operation: 'allocation.createGroup',
            allocation: first,
            repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-11-16' },
            occurrenceIds: Array.from({ length: count }, () => randomUUID()),
          })
        )
        .send();

      refused.assertStatus(400);
      assert.equal(body(refused).code, 'VALIDATION_ERROR');
      assert.equal(body(refused).error, 'The occurrence identities do not match the repeat.');
    }
    assert.deepEqual(await readState(companyId, true), before);
    const snapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(snapshot.body().revision, 0);
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 0);
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, entity: 'planning' }),
      0
    );
  });

  test('archives and unarchives catalogue and resource rows by their same stable IDs', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie } = await signIn(client);
    const clientId = data.clients.find((row) => row.companyId === companyId && !row.builtin)!.id;
    const resourceId = data.resources.find(
      (row) => row.companyId === companyId && row.kind === 'person' && !row.archivedAt
    )!.id;
    const transitions = [
      {
        path: `clients/${clientId}/archive`,
        operation: 'catalogue.archive',
        entity: { entity: 'clients', id: clientId },
        entityTable: 'clients',
        id: clientId,
      },
      {
        path: `clients/${clientId}/unarchive`,
        operation: 'catalogue.unarchive',
        entity: { entity: 'clients', id: clientId },
        entityTable: 'clients',
        id: clientId,
      },
      {
        path: `resources/${resourceId}/archive`,
        operation: 'resource.archive',
        id: resourceId,
        entityTable: 'resources',
      },
      {
        path: `resources/${resourceId}/unarchive`,
        operation: 'resource.unarchive',
        id: resourceId,
        entityTable: 'resources',
      },
    ] as const;

    for (const [index, transition] of transitions.entries()) {
      const mutationId = randomUUID();
      const response = await session(client.post(route(transition.path)), cookie)
        .json({
          mutationId,
          baseRevision: index,
          intent: {
            operation: transition.operation,
            ...('entity' in transition ? { entity: transition.entity } : { id: transition.id }),
          },
        })
        .send();
      response.assertStatus(200);
      assert.equal(body(response).revision, index + 1);
      // Only a catalogue archive reports what it hid.
      if (transition.operation !== 'catalogue.archive')
        assert.notProperty(response.body() as object, 'archived');
      const row = await db.from(transition.entityTable).where({ id: transition.id }).first();
      assert.isDefined(row);
      assert.equal(row!.id, transition.id);
      assert.equal(Boolean(row!.archived_at), index === 0 || index === 2);
      const marker = await db
        .from('planning_mutations')
        .where({ company_id: companyId, mutation_id: mutationId })
        .first();
      assert.equal(Number(marker?.revision), index + 1);
      const audit = await db
        .from('audit_entries')
        .where({ company_id: companyId, entity: 'planning', entity_id: marker!.mutation_id })
        .first();
      assert.equal(audit?.action, transition.operation);
    }

    const final = await readState(companyId, true);
    assert.isNull(final.clients.find((row) => row.id === clientId)!.archivedAt);
    assert.isNull(final.resources.find((row) => row.id === resourceId)!.archivedAt);
    const snapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(snapshot.body().revision, 4);
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 4);
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, entity: 'planning' }),
      4
    );
  });

  test('missing targets and same-state lifecycle transitions keep their flat refusal codes', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie } = await signIn(client);
    const clientId = data.clients.find((row) => row.companyId === companyId && !row.builtin)!.id;
    const missingId = randomUUID();

    const alreadyActive = await session(client.post(route(`clients/${clientId}/unarchive`)), cookie)
      .json(
        input(0, { operation: 'catalogue.unarchive', entity: { entity: 'clients', id: clientId } })
      )
      .send();
    alreadyActive.assertStatus(400);
    assert.equal(body(alreadyActive).code, 'NO_CHANGE');
    assert.deepEqual(Object.keys(alreadyActive.body() as object).sort(), ['code', 'error']);

    const missing = await session(client.post(route(`clients/${missingId}/archive`)), cookie)
      .json(
        input(0, { operation: 'catalogue.archive', entity: { entity: 'clients', id: missingId } })
      )
      .send();
    missing.assertStatus(400);
    assert.equal(body(missing).code, 'VALIDATION_ERROR');
    assert.deepEqual(Object.keys(missing.body() as object).sort(), ['code', 'error']);

    const archived = await session(client.post(route(`clients/${clientId}/archive`)), cookie)
      .json(
        input(0, { operation: 'catalogue.archive', entity: { entity: 'clients', id: clientId } })
      )
      .send();
    archived.assertStatus(200);
    const repeated = await session(client.post(route(`clients/${clientId}/archive`)), cookie)
      .json(
        input(1, { operation: 'catalogue.archive', entity: { entity: 'clients', id: clientId } })
      )
      .send();
    repeated.assertStatus(400);
    assert.equal(body(repeated).code, 'NO_CHANGE');
    assert.deepEqual(Object.keys(repeated.body() as object).sort(), ['code', 'error']);

    const snapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(snapshot.body().revision, 1);
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 1);
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, entity: 'planning' }),
      1
    );
  });

  test('a client archive reports the active rows it hid', async ({ client, assert, cleanup }) => {
    configureAuth(cleanup);
    const before = await readState(companyId, true);
    const { cookie } = await signIn(client);
    const target = before.clients.find(
      (row) =>
        row.companyId === companyId &&
        !row.builtin &&
        before.projects.some((project) => project.clientId === row.id)
    )!;
    const archived = await session(client.post(route(`clients/${target.id}/archive`)), cookie)
      .json(
        input(0, { operation: 'catalogue.archive', entity: { entity: 'clients', id: target.id } })
      )
      .send();
    archived.assertStatus(200);
    const after = await readState(companyId, true);
    const hidden = (key: 'projects' | 'phases' | 'activities' | 'allocations' | 'timeOff') =>
      activeOnly(before)[key].filter((row) => row.companyId === companyId).length -
      activeOnly(after)[key].filter((row) => row.companyId === companyId).length;
    const reported = (archived.body() as { archived?: Record<string, number> }).archived;
    assert.deepEqual(reported, {
      projects: hidden('projects'),
      phases: hidden('phases'),
      activities: hidden('activities'),
      allocations: hidden('allocations'),
      timeOff: hidden('timeOff'),
    });
    assert.isAbove(reported!.projects, 0);
    assert.isAbove(reported!.activities, 0);
    assert.isAbove(reported!.allocations, 0);
  });

  test('the built-in Internal client rejects both lifecycle verbs without mutation', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie } = await signIn(client);
    const internal = data.clients.find((row) => row.companyId === companyId && row.builtin)!;
    const before = await db.from('clients').where({ id: internal.id }).first();
    assert.isDefined(before);

    for (const [action, operation] of [
      ['archive', 'catalogue.archive'],
      ['unarchive', 'catalogue.unarchive'],
    ] as const) {
      const response = await session(client.post(route(`clients/${internal.id}/${action}`)), cookie)
        .json(
          input(0, {
            operation,
            entity: { entity: 'clients', id: internal.id },
          })
        )
        .send();
      response.assertStatus(409);
      assert.deepEqual(await db.from('clients').where({ id: internal.id }).first(), before);
    }

    const snapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(snapshot.body().revision, 0);
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 0);
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, entity: 'planning' }),
      0
    );
  });

  test('the built-in Internal client rejects rename and strips client-supplied flags', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie } = await signIn(client);
    const internal = data.clients.find((row) => row.companyId === companyId && row.builtin)!;
    const before = await db.from('clients').where({ id: internal.id }).first();
    assert.isDefined(before);

    const renamed = await session(client.patch(route(`clients/${internal.id}`)), cookie)
      .json(
        input(0, {
          operation: 'catalogue.update',
          entity: { entity: 'clients', id: internal.id, changes: { name: 'Renamed Internal' } },
        })
      )
      .send();
    renamed.assertStatus(400);
    assert.equal(body(renamed).code, 'VALIDATION_ERROR');
    assert.deepEqual(await db.from('clients').where({ id: internal.id }).first(), before);
    const refusedSnapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(refusedSnapshot.body().revision, 0);
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 0);
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, entity: 'planning' }),
      0
    );

    const spoofedId = randomUUID();
    const createInput = input(0, {
      operation: 'catalogue.create',
      entity: {
        entity: 'clients',
        id: spoofedId,
        fields: { name: 'Second Internal', color: internal.color, builtin: true },
      },
    });
    const spoofed = await session(client.post(route('clients')), cookie)
      .json(createInput)
      .send();
    spoofed.assertStatus(200);
    assert.equal(body(spoofed).status, 'committed');
    assert.equal(body(spoofed).mutationId, createInput.mutationId);
    assert.equal(body(spoofed).revision, 1);
    const ordinary = await db.from('clients').where({ id: spoofedId }).first();
    assert.deepInclude(ordinary!, {
      id: spoofedId,
      name: 'Second Internal',
      color: internal.color,
      builtin: null,
    });
    assert.deepEqual(await db.from('clients').where({ id: internal.id }).first(), before);
    const createdSnapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(createdSnapshot.body().revision, 1);
    const createdClients = createdSnapshot.body().data.clients as Array<{
      id: string;
      name: string;
      builtin?: boolean;
    }>;
    assert.equal(createdClients.find((row) => row.id === spoofedId)?.name, 'Second Internal');
    assert.notEqual(createdClients.find((row) => row.id === spoofedId)?.builtin, true);
    assert.deepEqual(
      createdClients.filter((row) => row.builtin).map((row) => row.id),
      [internal.id]
    );
    const createdMarker = await db.from('planning_mutations').where('company_id', companyId);
    assert.lengthOf(createdMarker, 1);
    assert.equal(createdMarker[0].mutation_id, createInput.mutationId);
    assert.equal(Number(createdMarker[0].revision), 1);
    const createdAudit = await db
      .from('audit_entries')
      .where({ company_id: companyId, entity: 'planning' });
    assert.lengthOf(createdAudit, 1);
    assert.equal(createdAudit[0].entity_id, createInput.mutationId);
    assert.equal(createdAudit[0].action, 'catalogue.create');

    const renameInput = input(1, {
      operation: 'catalogue.update',
      entity: {
        entity: 'clients',
        id: spoofedId,
        changes: { name: 'Ordinary renamed', builtin: true },
      },
    });
    const normalRename = await session(client.patch(route(`clients/${spoofedId}`)), cookie)
      .json(renameInput)
      .send();
    normalRename.assertStatus(200);
    assert.equal(body(normalRename).status, 'committed');
    assert.equal(body(normalRename).mutationId, renameInput.mutationId);
    assert.equal(body(normalRename).revision, 2);
    const ordinaryRenamed = await db.from('clients').where({ id: spoofedId }).first();
    assert.equal(ordinaryRenamed!.name, 'Ordinary renamed');
    assert.isNull(ordinaryRenamed!.builtin);

    const flagOnlyInput = input(2, {
      operation: 'catalogue.update',
      entity: { entity: 'clients', id: spoofedId, changes: { builtin: true } },
    });
    const flagOnly = await session(client.patch(route(`clients/${spoofedId}`)), cookie)
      .json(flagOnlyInput)
      .send();
    flagOnly.assertStatus(400);
    assert.equal(body(flagOnly).code, 'VALIDATION_ERROR');
    assert.deepEqual(await db.from('clients').where({ id: spoofedId }).first(), ordinaryRenamed);
    assert.deepEqual(await db.from('clients').where({ id: internal.id }).first(), before);

    const snapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(snapshot.body().revision, 2);
    const canonicalClients = snapshot.body().data.clients as typeof createdClients;
    assert.equal(canonicalClients.find((row) => row.id === spoofedId)?.name, 'Ordinary renamed');
    assert.notEqual(canonicalClients.find((row) => row.id === spoofedId)?.builtin, true);
    assert.deepEqual(
      canonicalClients.filter((row) => row.builtin).map((row) => row.id),
      [internal.id]
    );
    const markers = await db.from('planning_mutations').where('company_id', companyId);
    assert.lengthOf(markers, 2);
    assert.sameMembers(
      markers.map((row) => row.mutation_id),
      [createInput.mutationId, renameInput.mutationId]
    );
    const renamedMarker = markers.find((row) => row.mutation_id === renameInput.mutationId);
    assert.equal(Number(renamedMarker!.revision), 2);
    const audits = await db
      .from('audit_entries')
      .where({ company_id: companyId, entity: 'planning' });
    assert.lengthOf(audits, 2);
    assert.deepInclude(
      audits.find((row) => row.entity_id === renameInput.mutationId)!,
      {
        action: 'catalogue.update',
      }
    );
  });

  test('refuses to archive a row owned by another company without changing it', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const allCompanies = await readState();
    const foreignProject = allCompanies.projects.find((row) => row.companyId === 'a-loft')!;
    const before = await db.from('projects').where({ id: foreignProject.id }).first();
    assert.isDefined(before);

    const refused = await session(
      client.post(route(`projects/${foreignProject.id}/archive`)),
      cookie
    )
      .json(
        input(0, {
          operation: 'catalogue.archive',
          entity: { entity: 'projects', id: foreignProject.id },
        })
      )
      .send();

    refused.assertStatus(400);
    assert.equal(body(refused).code, 'VALIDATION_ERROR');
    assert.deepEqual(await db.from('projects').where({ id: foreignProject.id }).first(), before);
    const snapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(snapshot.body().revision, 0);
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 0);
  });

  test('anonymous planning cannot read or write persisted allocations', async ({
    client,
    assert,
  }) => {
    const snapshot = await trusted(client.get(planningUrl)).send();
    snapshot.assertStatus(401);

    const allocation = newAllocation(await readState(companyId, true));
    const before = await readState(companyId, true);
    const write = await trusted(client.post(route('allocations')))
      .json(input(0, { operation: 'allocation.create', allocation }))
      .send();
    write.assertStatus(401);
    assert.deepEqual(write.body(), { error: 'Sign-in required.', code: 'SIGN_IN_REQUIRED' });
    assert.deepEqual(await readState(companyId, true), before);
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 0);
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, entity: 'planning' }),
      0
    );
  });

  test('updates a row whose id contains a colon, as imported and Internal client ids can', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const template = data.clients.find((row) => row.companyId === companyId && !row.builtin)!;
    const id = `client:${randomUUID()}`;
    const templateRow = await db.from('clients').where({ id: template.id }).first();
    await db.table('clients').insert({
      ...templateRow,
      id,
      name: 'Daily Planet',
    });
    const { cookie } = await signIn(client);
    const response = await session(client.patch(route(`clients/${id}`)), cookie)
      .json(
        input(0, {
          operation: 'catalogue.update',
          entity: { entity: 'clients', id, changes: { name: 'Daily Planet Press' } },
        })
      )
      .send();
    response.assertStatus(200);
    assert.equal(body(response).status, 'committed');
    const stored = await db.from('clients').where({ id }).first();
    assert.equal(stored?.name, 'Daily Planet Press');
  });
});
