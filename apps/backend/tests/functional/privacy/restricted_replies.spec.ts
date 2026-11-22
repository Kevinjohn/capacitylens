import { randomUUID } from 'node:crypto';
import { test } from '@japa/runner';
import type { ApiClient, ApiRequest, ApiResponse } from '@japa/api-client';
import router from '@adonisjs/core/services/router';
import db from '@adonisjs/lucid/services/db';
import { seed } from '@capacitylens/shared/data/seed';
import { freshDatabase } from '../../helpers/fresh_database.js';
import {
  companyId,
  configureAuth,
  resetPlanningFixture,
  session,
  signIn,
} from '../planning/helpers.js';

// Every named route is classified by whether its reply can carry a restricted value. Routes that can
// are called for every test user, and the raw reply must not contain a value that user's
// effective role may not see. A new route fails the classification test until it is reviewed here.

const MARKER_CLIENT = 'MARKER_CLIENT_KANE';
const MARKER_ARCHIVED_CLIENT = 'MARKER_ARCHIVED_FALCONE';
const MARKER_PROJECT = 'MARKER_PROJECT_MONARCH';
const MARKER_NOTE = 'MARKER_NOTE_ARKHAM';
/** The code name each private name marker carries; a reader who may not see the name gets it quoted. */
const codeNamesByMarker: Record<string, string> = {
  [MARKER_CLIENT]: 'Nightwing',
  [MARKER_ARCHIVED_CLIENT]: 'Oracle',
  [MARKER_PROJECT]: 'Aurora',
};

type Role = 'owner' | 'admin' | 'editor' | 'viewer';

interface TestUser {
  label: string;
  effective: Role;
  masquerade: boolean;
  /** The signed-in role behind a view-as test user; Owner when absent. */
  actor?: Role;
  /** A view-as target the server must refuse; the test user then reads as itself. */
  refusedTarget?: Role;
}

interface Fixture {
  client: ApiClient;
  ownerCookie: string;
  cookie: string;
  clientId: string;
  projectId: string;
  timeOffId: string;
  resourceId: string;
}

const testUsers: TestUser[] = [
  { label: 'Owner', effective: 'owner', masquerade: false },
  { label: 'Admin', effective: 'admin', masquerade: false },
  { label: 'Editor', effective: 'editor', masquerade: false },
  { label: 'Viewer', effective: 'viewer', masquerade: false },
  { label: 'Owner viewing as Admin', effective: 'admin', masquerade: true },
  { label: 'Owner viewing as Editor', effective: 'editor', masquerade: true },
  { label: 'Owner viewing as Viewer', effective: 'viewer', masquerade: true },
  { label: 'Admin viewing as Admin', effective: 'admin', masquerade: true, actor: 'admin' },
  { label: 'Admin viewing as Editor', effective: 'editor', masquerade: true, actor: 'admin' },
  { label: 'Admin viewing as Viewer', effective: 'viewer', masquerade: true, actor: 'admin' },
  {
    label: 'Admin refused a view as Owner',
    effective: 'admin',
    masquerade: false,
    refusedTarget: 'owner',
  },
];

/** Names are visible to an effective Owner only; the time-off note to an effective Owner or Admin. */
function listHiddenMarkers(role: Role) {
  const hidden: string[] = [];
  if (role !== 'owner') hidden.push(MARKER_CLIENT, MARKER_ARCHIVED_CLIENT, MARKER_PROJECT);
  if (role !== 'owner' && role !== 'admin') hidden.push(MARKER_NOTE);
  return hidden;
}

/** Only an effective Owner or Admin gets archived rows from the state and export routes. */
function canReadInactive(role: Role) {
  return role === 'owner' || role === 'admin';
}

const IDENTITY = 'identity or account reply with no client, project or time-off rows';
const COUNTS = 'counts, ids or no body';
const PREVIEW =
  "Owner only, refused while viewing as: the caller document's name and counts, the revision and a changed flag";

async function readRevision() {
  const row = await db.from('company_planning_revisions').where('company_id', companyId).first();
  return Number(row?.revision ?? 0);
}

async function send<T extends ApiRequest>(request: T, cookie: string, intent: object) {
  return session(request, cookie)
    .json({ mutationId: randomUUID(), baseRevision: await readRevision(), intent })
    .send();
}

const buildCompanyRoute = (path: string) => `/api/companies/${companyId}/${path}`;

/** A preset colour used by a seeded client that differs from the row's own, so the update is a real
 * change. */
async function pickOtherColor(table: 'clients' | 'projects', id: string) {
  // Both tables store `color` as a non-null preset string.
  const own = (await db.from(table).where('id', id).first()) as { color: string };
  const presets = (await db
    .from('clients')
    .where('company_id', companyId)
    .select('color')) as Array<{ color: string }>;
  const other = presets.find((row) => row.color !== own.color);
  if (!other) throw new Error('The seed needs two client colours');
  return other.color;
}

async function archiveAsOwner(fixture: Fixture, intent: object) {
  const archived = await send(
    fixture.client.post(buildCompanyRoute('planning/mutations')),
    fixture.ownerCookie,
    intent
  );
  archived.assertStatus(200);
}

/** Recolours the marked client under a history, a change every writer may make and undo. */
async function recolourClient(fixture: Fixture, historyId: string) {
  return session(fixture.client.post(buildCompanyRoute('planning/mutations')), fixture.cookie)
    .json({
      mutationId: randomUUID(),
      baseRevision: await readRevision(),
      historyId,
      intent: {
        operation: 'catalogue.update',
        entity: {
          entity: 'clients',
          id: fixture.clientId,
          changes: { color: await pickOtherColor('clients', fixture.clientId) },
        },
      },
    })
    .send();
}

async function stepHistory(fixture: Fixture, step: 'undo' | 'redo', historyId: string) {
  return session(fixture.client.post(buildCompanyRoute(`planning/${step}`)), fixture.cookie)
    .json({ mutationId: randomUUID(), baseRevision: await readRevision(), historyId })
    .send();
}

type Exposure =
  | {
      call: (fixture: Fixture, testUser: TestUser) => Promise<ApiResponse>;
      write: boolean;
      /** Markers the reply carries for a reader allowed to see them. */
      carries: string[] | ((testUser: TestUser) => string[]);
    }
  | { none: string };

const replies: Record<string, Exposure> = {
  'api.planning.show': {
    write: false,
    carries: [MARKER_CLIENT, MARKER_PROJECT, MARKER_NOTE],
    call: (fixture) =>
      session(fixture.client.get(buildCompanyRoute('planning')), fixture.cookie).send(),
  },
  'api.planning.archive': {
    write: false,
    carries: [MARKER_ARCHIVED_CLIENT],
    call: (fixture) =>
      session(fixture.client.get(buildCompanyRoute('planning/archive')), fixture.cookie).send(),
  },
  'api.export': {
    write: false,
    carries: (testUser) => [
      MARKER_CLIENT,
      MARKER_PROJECT,
      MARKER_NOTE,
      ...(canReadInactive(testUser.effective) ? [MARKER_ARCHIVED_CLIENT] : []),
    ],
    call: (fixture) =>
      session(fixture.client.get(buildCompanyRoute('export')), fixture.cookie).send(),
  },
  'api.state': {
    write: false,
    carries: (testUser) => [
      MARKER_CLIENT,
      MARKER_PROJECT,
      MARKER_NOTE,
      ...(canReadInactive(testUser.effective) ? [MARKER_ARCHIVED_CLIENT] : []),
    ],
    call: (fixture, testUser) => {
      const inactive = canReadInactive(testUser.effective);
      return session(
        fixture.client.get(
          `/api/state?companyId=${companyId}${inactive ? '&includeInactive=1' : ''}`
        ),
        fixture.cookie
      ).send();
    },
  },
  'api.planning.mutate#catalogue.update clients': {
    write: true,
    carries: [MARKER_CLIENT],
    call: async (fixture) =>
      send(fixture.client.post(buildCompanyRoute('planning/mutations')), fixture.cookie, {
        operation: 'catalogue.update',
        entity: {
          entity: 'clients',
          id: fixture.clientId,
          changes: { color: await pickOtherColor('clients', fixture.clientId) },
        },
      }),
  },
  'api.planning.mutate#catalogue.unarchive clients': {
    write: true,
    carries: [MARKER_CLIENT],
    call: async (fixture) => {
      const entity = { entity: 'clients', id: fixture.clientId };
      await archiveAsOwner(fixture, {
        operation: 'catalogue.archive',
        entity,
      });
      return send(fixture.client.post(buildCompanyRoute('planning/mutations')), fixture.cookie, {
        operation: 'catalogue.unarchive',
        entity,
      });
    },
  },
  'api.planning.mutate#catalogue.update projects': {
    write: true,
    carries: [MARKER_PROJECT],
    call: async (fixture) =>
      send(fixture.client.post(buildCompanyRoute('planning/mutations')), fixture.cookie, {
        operation: 'catalogue.update',
        entity: {
          entity: 'projects',
          id: fixture.projectId,
          changes: { color: await pickOtherColor('projects', fixture.projectId) },
        },
      }),
  },
  'api.planning.mutate#catalogue.unarchive projects': {
    write: true,
    carries: [MARKER_PROJECT],
    call: async (fixture) => {
      const entity = { entity: 'projects', id: fixture.projectId };
      await archiveAsOwner(fixture, {
        operation: 'catalogue.archive',
        entity,
      });
      return send(fixture.client.post(buildCompanyRoute('planning/mutations')), fixture.cookie, {
        operation: 'catalogue.unarchive',
        entity,
      });
    },
  },
  'api.planning.mutate#timeOff.update': {
    write: true,
    carries: [MARKER_NOTE],
    call: async (fixture) => {
      const row = await db.from('time_off').where('id', fixture.timeOffId).first();
      const type = row?.type === 'holiday' ? 'sick' : 'holiday';
      return send(fixture.client.post(buildCompanyRoute('planning/mutations')), fixture.cookie, {
        operation: 'timeOff.update',
        id: fixture.timeOffId,
        changes: { type },
      });
    },
  },
  'api.planning.mutate#resource.unarchive': {
    write: true,
    carries: [],
    call: async (fixture) => {
      await archiveAsOwner(fixture, {
        operation: 'resource.archive',
        id: fixture.resourceId,
      });
      return send(fixture.client.post(buildCompanyRoute('planning/mutations')), fixture.cookie, {
        operation: 'resource.unarchive',
        id: fixture.resourceId,
      });
    },
  },
  'api.planning.mutate#planning.restoreGroup': {
    write: true,
    carries: [MARKER_NOTE],
    call: async (fixture) => {
      const deleted = await send(
        fixture.client.post(buildCompanyRoute('planning/mutations')),
        fixture.cookie,
        {
          operation: 'timeOff.delete',
          id: fixture.timeOffId,
        }
      );
      const groupId =
        deleted.status() === 200
          ? // A committed delete reply always carries its replacement restoration group.
            (deleted.body() as { data: { restoration: { replacementGroupId: string } } }).data
              .restoration.replacementGroupId
          : randomUUID();
      return send(fixture.client.post(buildCompanyRoute('planning/mutations')), fixture.cookie, {
        operation: 'planning.restoreGroup',
        restorationGroupId: groupId,
      });
    },
  },
  'api.planning.undo': {
    write: true,
    carries: [MARKER_CLIENT],
    call: async (fixture) => {
      const historyId = randomUUID();
      await recolourClient(fixture, historyId);
      return stepHistory(fixture, 'undo', historyId);
    },
  },
  'api.planning.redo': {
    write: true,
    carries: [MARKER_CLIENT],
    call: async (fixture) => {
      const historyId = randomUUID();
      await recolourClient(fixture, historyId);
      await stepHistory(fixture, 'undo', historyId);
      return stepHistory(fixture, 'redo', historyId);
    },
  },
  'api.companies.anonymise': { none: COUNTS },
  'api.companies.index': { none: IDENTITY },
  'api.admission.approve': { none: IDENTITY },
  'api.admission.complete': { none: IDENTITY },
  'api.admission.index': { none: IDENTITY },
  'api.admission.reject': { none: IDENTITY },
  'api.admission.request': { none: IDENTITY },
  'api.admission.revoke': { none: IDENTITY },
  'api.admission.show': { none: IDENTITY },
  'api.auth.change-password': { none: IDENTITY },
  'api.auth.delete-account': { none: IDENTITY },
  'api.auth.inspect-reset': { none: IDENTITY },
  'api.auth.me': { none: IDENTITY },
  'api.auth.password-confirmation': { none: IDENTITY },
  'api.auth.request-reset': { none: IDENTITY },
  'api.auth.reset-password': { none: IDENTITY },
  'api.auth.sign-in': { none: IDENTITY },
  'api.auth.sign-out': { none: IDENTITY },
  'api.auth.sign-up': { none: IDENTITY },
  'api.auth.verification.complete': { none: IDENTITY },
  'api.auth.verification.inspect': { none: IDENTITY },
  'api.auth.verification.send': { none: IDENTITY },
  'api.diagnostics': { none: IDENTITY },
  'api.example-data': { none: COUNTS },
  'api.getting-started.show': { none: IDENTITY },
  'api.getting-started.update': { none: IDENTITY },
  'api.health': { none: IDENTITY },
  'health_checks.live': { none: IDENTITY },
  'health_checks.ready': { none: IDENTITY },
  'api.installation.company': { none: IDENTITY },
  'api.invites.create': { none: IDENTITY },
  'api.invites.index': { none: IDENTITY },
  'api.invites.preview': { none: IDENTITY },
  'api.invites.resend': { none: IDENTITY },
  'api.invites.revoke': { none: IDENTITY },
  'api.invites.sign-up': { none: IDENTITY },
  'api.masquerade.end': { none: IDENTITY },
  'api.masquerade.start': { none: IDENTITY },
  'api.masquerade.status': { none: IDENTITY },
  'api.member-resources.clear': { none: IDENTITY },
  'api.member-resources.set': { none: IDENTITY },
  'api.members.index': { none: IDENTITY },
  'api.members.role': { none: IDENTITY },
  'api.members.status': { none: IDENTITY },
  'api.members.tracking': { none: IDENTITY },
  'api.not-found': { none: IDENTITY },
  'api.ownership.transfer': { none: IDENTITY },
  'api.resources.anonymise': { none: COUNTS },
  'api.transfer.apply': { none: COUNTS },
  'api.transfer.preview': { none: PREVIEW },
};

/** Marks one client, project and time-off note, and adds an archived private client. */
async function prepareMarkers(client: ApiClient, ownerCookie: string) {
  const fixture = seed();
  const clientRow = fixture.clients.find((row) => row.companyId === companyId && !row.builtin);
  const projectRow = fixture.projects.find((row) => row.clientId === clientRow?.id);
  const timeOffRow = fixture.timeOff.find((row) => row.companyId === companyId);
  if (!clientRow || !projectRow || !timeOffRow) throw new Error('Seed data lacks the marker rows');
  await db.from('clients').where({ id: clientRow.id }).update({
    name: MARKER_CLIENT,
    is_private: true,
    code_name: codeNamesByMarker[MARKER_CLIENT],
  });
  await db.from('projects').where({ id: projectRow.id }).update({
    name: MARKER_PROJECT,
    is_private: true,
    code_name: codeNamesByMarker[MARKER_PROJECT],
  });
  await db.from('time_off').where({ id: timeOffRow.id }).update({ note: MARKER_NOTE });
  const archivedId = randomUUID();
  const created = await send(client.post(buildCompanyRoute('planning/mutations')), ownerCookie, {
    operation: 'catalogue.create',
    entity: {
      entity: 'clients',
      id: archivedId,
      fields: {
        name: MARKER_ARCHIVED_CLIENT,
        color: clientRow.color,
        isPrivate: true,
        codeName: codeNamesByMarker[MARKER_ARCHIVED_CLIENT],
      },
    },
  });
  created.assertStatus(200);
  const archived = await send(client.post(buildCompanyRoute('planning/mutations')), ownerCookie, {
    operation: 'catalogue.archive',
    entity: { entity: 'clients', id: archivedId },
  });
  archived.assertStatus(200);
  return {
    clientId: clientRow.id,
    projectId: projectRow.id,
    timeOffId: timeOffRow.id,
    resourceId: timeOffRow.resourceId,
  };
}

async function readContextToken(client: ApiClient, cookie: string) {
  const status = await session(client.get('/api/masquerade'), cookie).send();
  status.assertStatus(200);
  // The status reply is checked by String(); a missing token fails the masquerade start.
  return String((status.body()!.data as { contextToken: unknown }).contextToken);
}

async function startMasqueradeAs(client: ApiClient, viewerCookie: string, targetUserId: string) {
  return session(
    client
      .post(buildCompanyRoute('masquerade'))
      .header('X-Masquerade-Context', await readContextToken(client, viewerCookie)),
    viewerCookie
  )
    .json({ targetUserId })
    .send();
}

test.group('restricted values in replies', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetPlanningFixture();
  });

  test('every named route has a reviewed reply exposure', ({ assert }) => {
    const names = Object.values(router.toJSON())
      .flat()
      .flatMap((registered) => (registered.name ? [registered.name] : []));
    // A key may name one case of a route after `#`; the mutation route has one case per write.
    const classified = new Set(Object.keys(replies).map((key) => key.split('#')[0]));
    assert.sameMembers([...classified], names);
  });

  test('no reply carries a restricted value to {label}')
    .with(testUsers)
    .run(async ({ client, assert, cleanup }, testUser) => {
      configureAuth(cleanup);
      const owner = await signIn(client, 'owner');
      const markers = await prepareMarkers(client, owner.cookie);
      let cookie: string;
      let viewToken: string | undefined;
      if (testUser.masquerade) {
        const viewer = await signIn(client, testUser.actor ?? 'owner');
        const target = await signIn(client, testUser.effective);
        const started = await startMasqueradeAs(client, viewer.cookie, target.userId);
        started.assertStatus(200);
        cookie = viewer.cookie;
        viewToken = await readContextToken(client, cookie);
      } else {
        const member =
          testUser.effective === 'owner' ? owner : await signIn(client, testUser.effective);
        cookie = member.cookie;
        if (testUser.refusedTarget) {
          const target =
            testUser.refusedTarget === 'owner'
              ? owner
              : await signIn(client, testUser.refusedTarget);
          const refused = await startMasqueradeAs(client, cookie, target.userId);
          refused.assertStatus(403);
        }
      }
      const fixture: Fixture = { client, ownerCookie: owner.cookie, cookie, ...markers };
      const hidden = listHiddenMarkers(testUser.effective);
      for (const [name, exposure] of Object.entries(replies)) {
        if ('none' in exposure) continue;
        const reply = await exposure.call(fixture, testUser);
        const text = reply.text();
        const where = `${name} to ${testUser.label}`;
        for (const marker of hidden) assert.notInclude(text, marker, where);
        if (exposure.write) {
          const refused = testUser.masquerade || testUser.effective === 'viewer';
          assert.equal(reply.status(), refused ? 403 : 200, where);
        } else if (name === 'api.planning.archive') {
          if (testUser.masquerade) assert.equal(reply.status(), 403, where);
          else if (testUser.effective === 'owner' || testUser.effective === 'admin')
            assert.equal(reply.status(), 200, where);
        } else {
          assert.equal(reply.status(), 200, where);
        }
        // Positive control: a reply that succeeds carries every marker this reader may see, and the
        // quoted code name, as JSON text, in place of each name it may not.
        if (reply.status() === 200) {
          const { carries } = exposure;
          for (const marker of typeof carries === 'function' ? carries(testUser) : carries) {
            const codeName = codeNamesByMarker[marker];
            if (!hidden.includes(marker)) assert.include(text, marker, where);
            else if (codeName) assert.include(text, `\\"${codeName}\\"`, where);
          }
        }
        // The export is labelled full only for an effective Owner, whoever is signed in.
        if (name === 'api.export' && reply.status() === 200) {
          const { completeness } = JSON.parse(text) as { completeness: string };
          assert.equal(completeness, testUser.effective === 'owner' ? 'full' : 'redacted', where);
        }
      }
      if (viewToken) {
        const ended = await session(client.delete('/api/masquerade'), cookie)
          .json({ token: viewToken, reason: 'explicit' })
          .send();
        ended.assertStatus(200);
      }
    });
});
