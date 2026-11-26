import { randomUUID } from 'node:crypto';
import type { ApiClient } from '@japa/api-client';
import db from '@adonisjs/lucid/services/db';
import { readState } from '#tests/helpers/state_fixture';
import {
  companyId,
  newAllocation,
  session,
  signIn,
  type Credential,
} from '#tests/functional/planning/helpers';
import { stored } from '#tests/functional/planning/restoration_helpers';

export interface Reply {
  revision: number;
  code?: string;
  history: { canUndo: boolean; canRedo: boolean };
}

/** One page's view of the server: its cookie, its history id and the revision it last saw. */
export class Page {
  revision = 0;
  constructor(
    private client: ApiClient,
    private cookie: Credential,
    readonly historyId: string | null = randomUUID()
  ) {}

  private async post(
    route: 'api.planning_mutations.store' | 'api.planning_undo.store' | 'api.planning_redo.store',
    body: Record<string, unknown>
  ) {
    const response = await session(this.client.visit(route, { companyId }), this.cookie)
      .json({
        mutationId: randomUUID(),
        baseRevision: this.revision,
        ...(this.historyId === null ? {} : { historyId: this.historyId }),
        ...body,
      })
      .send();
    const answer: unknown = response.body();
    const reply = (response.status() === 200 ? (answer as { data: Reply }).data : answer) as Reply;
    if (response.status() === 200) this.revision = reply.revision;
    return { ...reply, status: response.status() };
  }

  write(intent: Record<string, unknown>) {
    return this.post('api.planning_mutations.store', { intent });
  }

  undo() {
    return this.post('api.planning_undo.store', {});
  }

  redo() {
    return this.post('api.planning_redo.store', {});
  }

  async read() {
    const query = this.historyId === null ? {} : { historyId: this.historyId };
    const response = await session(
      this.client.visit('api.planning.show', { companyId }).qs(query),
      this.cookie
    ).send();
    response.assertStatus(200);
    const reply = response.body().data as Reply & {
      data: { allocations: Array<{ id: string; updatedAt: string }> };
    };
    this.revision = reply.revision;
    return reply;
  }
}

export const histories = () => db.from('planning_histories').where('company_id', companyId);

export const cookieFor = async (client: ApiClient, role?: 'editor') => {
  const signedIn = await signIn(client, role);
  return signedIn.cookie;
};
export const statusOf = async (reply: Promise<{ status: number }>) => {
  const settled = await reply;
  return settled.status;
};
export const historyOf = async (reply: Promise<Pick<Reply, 'history'>>) => {
  const settled = await reply;
  return settled.history;
};
export const noteOf = async (id: string) => {
  const row = await stored(id);
  return row?.note;
};

export async function createAllocation(page: Page) {
  const allocation = { ...newAllocation(await readState(companyId, true)), note: 'Batcave audit' };
  const reply = await page.write({ operation: 'allocation.create', allocation });
  return { id: allocation.id, reply };
}

export const setNote = (page: Page, id: string, note: string) =>
  page.write({ operation: 'allocation.update', id, changes: { note } });
