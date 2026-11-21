import { expect } from 'vitest';
import { memberRequests } from './memberRequests';

export const operation = { commandId: 'command-1', idempotencyKey: 'key-1' };

export function transferOwner(
  input: { name: string; color?: string },
  explicit?: typeof operation,
): Promise<Response> {
  return memberRequests.transferOwnership({
    companyId: 'a-studio',
    targetPrincipalId: input.name,
    confirmationId: input.color ?? 'proof-1',
    ...(explicit ? { operation: explicit } : {}),
  });
}

export function expectOperation(init: RequestInit, method: string): void {
  expect(init.method).toBe(method);
  const headers = new Headers(init.headers);
  expect(headers.get('idempotency-key')).toBe(operation.idempotencyKey);
  expect(headers.get('x-account-command-id')).toBe(operation.commandId);
}
