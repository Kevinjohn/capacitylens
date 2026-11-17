import { randomUUID } from 'node:crypto';
import { test } from '@japa/runner';
import type { ApiClient, ApiRequest, ApiResponse } from '@japa/api-client';
import router from '@adonisjs/core/services/router';
import db from '@adonisjs/lucid/services/db';
import { seed } from '@capacitylens/shared/data/seed';
import { freshDatabase } from '../../helpers/fresh_database.js';
import {
  accountId,
  configureAuth,
  resetPlanningFixture,
  session,
  signIn,
} from '../planning/helpers.js';

// Every named route is classified by whether its reply can carry a restricted value. Routes that can
// are called for every principal, and the raw reply must not contain a value that principal's
// effective role may not see. A new route fails the classification test until it is reviewed here.

const MARKER_CLIENT = 'MARKER_CLIENT_KANE';
const MARKER_ARCHIVED_CLIENT = 'MARKER_ARCHIVED_FALCONE';
const MARKER_PROJECT = 'MARKER_PROJECT_MONARCH';
const MARKER_NOTE = 'MARKER_NOTE_ARKHAM';

type Role = 'owner' | 'admin' | 'editor' | 'viewer';

interface Principal {
  label: string;
  effective: Role;
  viewAs: boolean;
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

const principals: Principal[] = [
  { label: 'Owner', effective: 'owner', viewAs: false },
  { label: 'Admin', effective: 'admin', viewAs: false },
  { label: 'Editor', effective: 'editor', viewAs: false },
  { label: 'Viewer', effective: 'viewer', viewAs: false },
  { label: 'Owner viewing as Admin', effective: 'admin', viewAs: true },
  { label: 'Owner viewing as Editor', effective: 'editor', viewAs: true },
  { label: 'Owner viewing as Viewer', effective: 'viewer', viewAs: true },
];

/** Names are visible to an effective Owner only; the time-off note to an effective Owner or Admin. */
function markersHiddenFrom(role: Role) {
  const hidden: string[] = [];
  if (role !== 'owner') hidden.push(MARKER_CLIENT, MARKER_ARCHIVED_CLIENT, MARKER_PROJECT);
  if (role !== 'owner' && role !== 'admin') hidden.push(MARKER_NOTE);
  return hidden;
}

const IDENTITY = 'identity or account reply with no client, project or time-off rows';
const COUNTS = 'counts, ids or no body';
const UNRESTRICTED = 'changes no restricted table and replies with no restricted row';
const CALLER = 'replies with caller-sent fields or removed ids only';

async function readRevision() {
  const row = await db.from('company_planning_revisions').where('account_id', accountId).first();
  return Number(row?.revision ?? 0);
}

async function send<T extends ApiRequest>(request: T, cookie: string, intent: object) {
  return session(request, cookie)
    .json({ mutationId: randomUUID(), baseRevision: await readRevision(), intent })
    .send();
}

const companyRoute = (path: string) => `/api/accounts/${accountId}/${path}`;

/** A preset colour used by a seeded client that differs from the row's own, so the update is a real
 * change. */
async function pickOtherColor(table: 'clients' | 'projects', id: string) {
  // Both tables store `color` as a non-null preset string.
  const own = (await db.from(table).where('id', id).first()) as { color: string };
  const presets = (await db
    .from('clients')
    .where('account_id', accountId)
    .select('color')) as Array<{ color: string }>;
  const other = presets.find((row) => row.color !== own.color);
  if (!other) throw new Error('The seed needs two client colours');
  return other.color;
}

async function archiveAsOwner(f: Fixture, path: string, intent: object) {
  const archived = await send(f.client.post(companyRoute(path)), f.ownerCookie, intent);
  archived.assertStatus(200);
}

type Exposure =
  | {
      call: (f: Fixture, principal: Principal) => Promise<ApiResponse>;
      write: boolean;
      /** Markers the reply carries for a reader allowed to see them. */
      carries: string[];
    }
  | { none: string };

const replies: Record<string, Exposure> = {
  'api.planning.show': {
    write: false,
    carries: [MARKER_CLIENT, MARKER_PROJECT, MARKER_NOTE],
    call: (f) => session(f.client.get(companyRoute('planning')), f.cookie).send(),
  },
  'api.planning.archive': {
    write: false,
    carries: [MARKER_ARCHIVED_CLIENT],
    call: (f) => session(f.client.get(companyRoute('planning/archive')), f.cookie).send(),
  },
  'api.state': {
    write: false,
    carries: [MARKER_CLIENT, MARKER_ARCHIVED_CLIENT, MARKER_PROJECT, MARKER_NOTE],
    call: (f, principal) => {
      const inactive = principal.effective === 'owner' || principal.effective === 'admin';
      return session(
        f.client.get(`/api/state?accountId=${accountId}${inactive ? '&includeInactive=1' : ''}`),
        f.cookie
      ).send();
    },
  },
  'api.planning.client.update': {
    write: true,
    carries: [MARKER_CLIENT],
    call: async (f) =>
      send(f.client.patch(companyRoute(`clients/${f.clientId}`)), f.cookie, {
        operation: 'catalogue.update',
        entity: {
          entity: 'clients',
          id: f.clientId,
          changes: { color: await pickOtherColor('clients', f.clientId) },
        },
      }),
  },
  'api.planning.client.unarchive': {
    write: true,
    carries: [MARKER_CLIENT, MARKER_PROJECT],
    call: async (f) => {
      const entity = { entity: 'clients', id: f.clientId };
      await archiveAsOwner(f, `clients/${f.clientId}/archive`, {
        operation: 'catalogue.archive',
        entity,
      });
      return send(f.client.post(companyRoute(`clients/${f.clientId}/unarchive`)), f.cookie, {
        operation: 'catalogue.unarchive',
        entity,
      });
    },
  },
  'api.planning.project.update': {
    write: true,
    carries: [MARKER_PROJECT],
    call: async (f) =>
      send(f.client.patch(companyRoute(`projects/${f.projectId}`)), f.cookie, {
        operation: 'catalogue.update',
        entity: {
          entity: 'projects',
          id: f.projectId,
          changes: { color: await pickOtherColor('projects', f.projectId) },
        },
      }),
  },
  'api.planning.project.unarchive': {
    write: true,
    carries: [MARKER_PROJECT],
    call: async (f) => {
      const entity = { entity: 'projects', id: f.projectId };
      await archiveAsOwner(f, `projects/${f.projectId}/archive`, {
        operation: 'catalogue.archive',
        entity,
      });
      return send(f.client.post(companyRoute(`projects/${f.projectId}/unarchive`)), f.cookie, {
        operation: 'catalogue.unarchive',
        entity,
      });
    },
  },
  'api.planning.timeOff.update': {
    write: true,
    carries: [MARKER_NOTE],
    call: async (f) => {
      const row = await db.from('time_off').where('id', f.timeOffId).first();
      const type = row?.type === 'holiday' ? 'sick' : 'holiday';
      return send(f.client.patch(companyRoute(`time-off/${f.timeOffId}`)), f.cookie, {
        operation: 'timeOff.update',
        id: f.timeOffId,
        changes: { type },
      });
    },
  },
  'api.planning.resource.unarchive': {
    write: true,
    carries: [MARKER_NOTE],
    call: async (f) => {
      await archiveAsOwner(f, `resources/${f.resourceId}/archive`, {
        operation: 'resource.archive',
        id: f.resourceId,
      });
      return send(f.client.post(companyRoute(`resources/${f.resourceId}/unarchive`)), f.cookie, {
        operation: 'resource.unarchive',
        id: f.resourceId,
      });
    },
  },
  'api.planning.restoreGroup': {
    write: true,
    carries: [MARKER_NOTE],
    call: async (f) => {
      const deleted = await send(
        f.client.post(companyRoute(`time-off/${f.timeOffId}/delete`)),
        f.cookie,
        {
          operation: 'timeOff.delete',
          id: f.timeOffId,
        }
      );
      const groupId =
        deleted.status() === 200
          ? // A committed delete reply always carries its replacement restoration group.
            (deleted.body() as { restoration: { replacementGroupId: string } }).restoration
              .replacementGroupId
          : randomUUID();
      return send(f.client.post(companyRoute('planning/restore-group')), f.cookie, {
        operation: 'planning.restoreGroup',
        restorationGroupId: groupId,
      });
    },
  },
  'api.accounts.anonymise': { none: COUNTS },
  'api.accounts.index': { none: IDENTITY },
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
  'api.member-resources.avatars': { none: IDENTITY },
  'api.member-resources.clear': { none: IDENTITY },
  'api.member-resources.set': { none: IDENTITY },
  'api.members.index': { none: IDENTITY },
  'api.members.role': { none: IDENTITY },
  'api.members.status': { none: IDENTITY },
  'api.members.tracking': { none: IDENTITY },
  'api.not-found': { none: IDENTITY },
  'api.ownership.transfer': { none: IDENTITY },
  'api.planning.activity.archive': { none: UNRESTRICTED },
  'api.planning.activity.create': { none: UNRESTRICTED },
  'api.planning.activity.unarchive': { none: UNRESTRICTED },
  'api.planning.activity.update': { none: UNRESTRICTED },
  'api.planning.allocation.create': { none: UNRESTRICTED },
  'api.planning.allocation.createGroup': { none: UNRESTRICTED },
  'api.planning.allocation.delete': { none: UNRESTRICTED },
  'api.planning.allocation.deleteGroup': { none: UNRESTRICTED },
  'api.planning.allocation.duplicate': { none: UNRESTRICTED },
  'api.planning.allocation.repeat': { none: UNRESTRICTED },
  'api.planning.allocation.update': { none: UNRESTRICTED },
  'api.planning.client.archive': { none: CALLER },
  'api.planning.client.create': { none: CALLER },
  'api.planning.closure.create': { none: UNRESTRICTED },
  'api.planning.closure.delete': { none: UNRESTRICTED },
  'api.planning.closure.update': { none: UNRESTRICTED },
  'api.planning.discipline.create': { none: UNRESTRICTED },
  'api.planning.discipline.delete': { none: UNRESTRICTED },
  'api.planning.discipline.update': { none: UNRESTRICTED },
  'api.planning.lookup': { none: COUNTS },
  'api.planning.phase.create': { none: UNRESTRICTED },
  'api.planning.phase.delete': { none: UNRESTRICTED },
  'api.planning.phase.update': { none: UNRESTRICTED },
  'api.planning.project.archive': { none: CALLER },
  'api.planning.project.create': { none: CALLER },
  'api.planning.resource.archive': { none: UNRESTRICTED },
  'api.planning.resource.create': { none: UNRESTRICTED },
  'api.planning.resource.update': { none: UNRESTRICTED },
  'api.planning.settings.update': { none: UNRESTRICTED },
  'api.planning.timeOff.create': { none: CALLER },
  'api.planning.timeOff.delete': { none: CALLER },
  'api.planning.timeOff.deleteGroup': { none: CALLER },
  'api.planning.timeOff.repeat': { none: CALLER },
  'api.resources.anonymise': { none: COUNTS },
  'api.transfer.apply': { none: COUNTS },
  'api.transfer.preview': { none: COUNTS },
};

/** Marks one client, project and time-off note, and adds an archived private client. */
async function prepareMarkers(client: ApiClient, ownerCookie: string) {
  const fixture = seed();
  const clientRow = fixture.clients.find((row) => row.accountId === accountId && !row.builtin);
  const projectRow = fixture.projects.find((row) => row.clientId === clientRow?.id);
  const timeOffRow = fixture.timeOff.find((row) => row.accountId === accountId);
  if (!clientRow || !projectRow || !timeOffRow) throw new Error('Seed data lacks the marker rows');
  await db
    .from('clients')
    .where({ id: clientRow.id })
    .update({ name: MARKER_CLIENT, is_private: 'true', code_name: 'Nightwing' });
  await db
    .from('projects')
    .where({ id: projectRow.id })
    .update({ name: MARKER_PROJECT, is_private: 'true', code_name: 'Aurora' });
  await db.from('time_off').where({ id: timeOffRow.id }).update({ note: MARKER_NOTE });
  const archivedId = randomUUID();
  const created = await send(client.post(companyRoute('clients')), ownerCookie, {
    operation: 'catalogue.create',
    entity: {
      entity: 'clients',
      id: archivedId,
      fields: {
        name: MARKER_ARCHIVED_CLIENT,
        color: clientRow.color,
        isPrivate: true,
        codeName: 'Oracle',
      },
    },
  });
  created.assertStatus(200);
  const archived = await send(
    client.post(companyRoute(`clients/${archivedId}/archive`)),
    ownerCookie,
    {
      operation: 'catalogue.archive',
      entity: { entity: 'clients', id: archivedId },
    }
  );
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
  return String((status.body() as { contextToken: unknown }).contextToken);
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
    assert.sameMembers(Object.keys(replies), names);
  });

  test('no reply carries a restricted value to {label}')
    .with(principals)
    .run(async ({ client, assert, cleanup }, principal) => {
      configureAuth(cleanup);
      const owner = await signIn(client, 'owner');
      const markers = await prepareMarkers(client, owner.cookie);
      let cookie: string;
      let viewToken: string | undefined;
      if (principal.viewAs) {
        const viewer = await signIn(client, 'owner');
        const target = await signIn(client, principal.effective);
        const started = await session(
          client
            .post(companyRoute('masquerade'))
            .header('X-Masquerade-Context', await readContextToken(client, viewer.cookie)),
          viewer.cookie
        )
          .json({ targetUserId: target.userId })
          .send();
        started.assertStatus(200);
        cookie = viewer.cookie;
        viewToken = await readContextToken(client, cookie);
      } else {
        const member =
          principal.effective === 'owner' ? owner : await signIn(client, principal.effective);
        cookie = member.cookie;
      }
      const f: Fixture = { client, ownerCookie: owner.cookie, cookie, ...markers };
      const hidden = markersHiddenFrom(principal.effective);
      for (const [name, exposure] of Object.entries(replies)) {
        if ('none' in exposure) continue;
        const reply = await exposure.call(f, principal);
        const text = reply.text();
        for (const marker of hidden)
          assert.notInclude(text, marker, `${name} to ${principal.label}`);
        const where = `${name} to ${principal.label}`;
        if (exposure.write) {
          const refused = principal.viewAs || principal.effective === 'viewer';
          assert.equal(reply.status(), refused ? 403 : 200, where);
        } else if (name === 'api.planning.archive') {
          if (principal.viewAs) assert.equal(reply.status(), 403, where);
          else if (principal.effective === 'owner' || principal.effective === 'admin')
            assert.equal(reply.status(), 200, where);
        } else {
          assert.equal(reply.status(), 200, where);
        }
        // Positive control: a reply that succeeds carries every marker this reader may see.
        if (reply.status() === 200 && !principal.viewAs) {
          for (const marker of exposure.carries.filter((value) => !hidden.includes(value)))
            assert.include(text, marker, where);
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
