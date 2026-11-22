import { readApiData } from '@/api/readApiData';
import type {
  ClientMasqueradeEndReason,
  EndMasqueradePayload,
  MasqueradeState,
  MasqueradeStatus,
  StartMasqueradePayload,
} from '@capacitylens/shared/domain/masquerade';
import { isRole } from '@capacitylens/shared/account/types';
import { isRecord } from '@capacitylens/shared/lib/isRecord';
import { isTimestamp } from '@/account/accessResult';
import { masqueradeRequests } from './masqueradeRequests';
import { extractApiErrorMessage } from '@/lib/readApiError';
import { parseAccessGrant } from './accessGrant';

function parseMasqueradeState(value: unknown, companyIdFallback?: string): MasqueradeState | null {
  if (!isRecord(value)) return null;
  const state = value;
  const companyId = typeof state.companyId === 'string' ? state.companyId : companyIdFallback;
  if (
    typeof companyId !== 'string' ||
    companyId.length === 0 ||
    typeof state.targetUserId !== 'string' ||
    state.targetUserId.length === 0 ||
    typeof state.targetName !== 'string' ||
    !isRole(state.effectiveRole) ||
    !isTimestamp(state.startedAt) ||
    !isTimestamp(state.expiresAt) ||
    typeof state.token !== 'string' ||
    state.token.length === 0 ||
    !parseAccessGrant(state)
  ) {
    return null;
  }
  return { ...(state as unknown as MasqueradeState), companyId };
}

function parseBootstrapActor(
  value: unknown,
): { id: string; name?: string | null; email: string } | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.email !== 'string' ||
    !value.email
  ) {
    return null;
  }
  if (value.name !== undefined && value.name !== null && typeof value.name !== 'string') {
    return null;
  }
  return {
    id: value.id,
    ...(typeof value.name === 'string' || value.name === null ? { name: value.name } : {}),
    email: value.email,
  };
}

export type MasqueradeBootstrapStatus = MasqueradeStatus & {
  actor?: { id: string; name?: string | null; email: string };
};

async function readMasqueradeBody(response: Response, fallback: string): Promise<unknown> {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(extractApiErrorMessage(body) ?? fallback);
  }
  return readApiData(response);
}

async function assertMasqueradeState(response: Response): Promise<MasqueradeState> {
  const body = await readMasqueradeBody(
    response,
    `View as member request failed (${response.status}).`,
  );
  const state = parseMasqueradeState(body);
  if (!state) {
    throw new Error(
      extractApiErrorMessage(body) ?? 'The server returned an invalid masquerade state.',
    );
  }
  return state;
}

/** Reads and changes the current user’s temporary masquerade. */
export const masqueradeApi = {
  async status(companyId?: string): Promise<MasqueradeBootstrapStatus> {
    const response = await masqueradeRequests.masqueradeStatus(companyId);
    const body = await readMasqueradeBody(
      response,
      `View as member status could not be read (${response.status}).`,
    );
    if (
      typeof body === 'object' &&
      body !== null &&
      (body as { active?: unknown }).active === false
    ) {
      const masqueradeToken = (body as { masqueradeToken?: unknown }).masqueradeToken;
      if (
        !Object.hasOwn(body, 'masqueradeToken') ||
        (masqueradeToken !== null &&
          (typeof masqueradeToken !== 'string' || masqueradeToken.length === 0))
      ) {
        throw new Error('The server returned an invalid masquerade status.');
      }
      return { active: false, masqueradeToken };
    }
    const state = parseMasqueradeState(body, companyId);
    if (!state || (body as { active?: unknown }).active !== true) {
      throw new Error(
        extractApiErrorMessage(body) ?? 'The server returned an invalid masquerade status.',
      );
    }
    const masqueradeToken = (body as { masqueradeToken?: unknown }).masqueradeToken;
    if (
      typeof masqueradeToken !== 'string' ||
      masqueradeToken.length === 0 ||
      masqueradeToken !== state.token
    ) {
      throw new Error('The server returned an invalid masquerade status.');
    }
    const actor = parseBootstrapActor((body as { actor?: unknown }).actor);
    if (!actor) {
      throw new Error('The server returned an invalid masquerade actor.');
    }
    return { active: true, ...state, masqueradeToken, actor };
  },

  async start(companyId: string, targetUserId: string): Promise<MasqueradeState> {
    const body: StartMasqueradePayload = { targetUserId };
    return assertMasqueradeState(await masqueradeRequests.startMasquerade(companyId, body));
  },

  async end(token: string, reason: ClientMasqueradeEndReason): Promise<void> {
    const body: EndMasqueradePayload = { token, reason };
    const response = await masqueradeRequests.endMasquerade(body);
    await readMasqueradeBody(response, `View as member could not be ended (${response.status}).`);
  },
};
