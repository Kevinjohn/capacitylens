import type { HttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import { accountErrorResponse } from '@kevinjohn/adonisjs-account-kit';

/** An Account Kit refusal in the product wire shape: the Kit's status and headers, a flat body. */
export interface KitRefusal {
  status: number;
  headers: Record<string, string>;
  body: HttpErrorBody;
}

/**
 * Builds the product refusal for an Account Kit error, or `undefined` for any other error. Pure.
 * The Kit envelope carries one entry per refusal; the flat body keeps the frontend contract.
 */
export function buildKitRefusal(error: unknown): KitRefusal | undefined {
  const response = accountErrorResponse(error);
  const entry = response?.body.errors[0];
  if (!response || !entry) return undefined;
  const { code, message, committed } = entry;
  return {
    status: response.status,
    headers: response.headers,
    body: { error: message, code, ...(committed ? { committed } : {}) },
  };
}
