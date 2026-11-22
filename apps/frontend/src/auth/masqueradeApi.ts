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

function parseBootstrapPrincipal(
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
  principal?: { id: string; name?: string | null; email: string };
};

async function readMasqueradeBody(response: Response, fallback: string): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractApiErrorMessage(body) ?? fallback);
  }
  return body;
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

/** Reads and changes the current user’s temporary account masquerade. */
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
      const contextToken = (body as { contextToken?: unknown }).contextToken;
      if (
        !Object.hasOwn(body, 'contextToken') ||
        (contextToken !== null && (typeof contextToken !== 'string' || contextToken.length === 0))
      ) {
        throw new Error('The server returned an invalid masquerade status.');
      }
      return { active: false, contextToken };
    }
    const state = parseMasqueradeState(body, companyId);
    if (!state || (body as { active?: unknown }).active !== true) {
      throw new Error(
        extractApiErrorMessage(body) ?? 'The server returned an invalid masquerade status.',
      );
    }
    const contextToken = (body as { contextToken?: unknown }).contextToken;
    if (
      typeof contextToken !== 'string' ||
      contextToken.length === 0 ||
      contextToken !== state.token
    ) {
      throw new Error('The server returned an invalid masquerade status.');
    }
    const principal = parseBootstrapPrincipal((body as { principal?: unknown }).principal);
    if (!principal) {
      throw new Error('The server returned an invalid masquerade principal.');
    }
    return { active: true, ...state, contextToken, principal };
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
