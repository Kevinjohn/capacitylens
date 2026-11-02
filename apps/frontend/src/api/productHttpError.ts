import { TuyauHTTPError } from '@tuyau/core/client';
import { readHttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import type { HttpErrorBody } from '@capacitylens/shared/api/httpErrors';

/** The product's flat HTTP boundary; network and abort failures have no HTTP status or body. */
export interface ProductHttpFailure {
  status: number;
  body: HttpErrorBody;
}

/** Adapts generated-client HTTP failures without relying on its 422 validation convention. */
export function readProductHttpFailure(
  error: unknown,
  fallback: string,
): ProductHttpFailure | null {
  if (!(error instanceof TuyauHTTPError) || typeof error.status !== 'number') return null;
  return { status: error.status, body: readHttpErrorBody(error.response, fallback) };
}
