import { describe, expect, it } from 'vitest';
import { resolvePublicAuthEntry } from './authEntryRoute';

describe('publicAuthEntryForPath', () => {
  it.each([
    ['/reset-password/token', 'password-reset'],
    ['/reset-password/token/', 'password-reset'],
    ['/Reset-Password/token', 'password-reset'],
    ['/invitation/token', 'invitation'],
    ['/invitation/token/', 'invitation'],
    ['/Invitation/token', 'invitation'],
    ['/verify-email/token', 'email-verification'],
    ['/verify-email/token/extra', null],
    ['/join/a-studio', null],
    ['/reset-password/', null],
    ['/invitation/', null],
    ['/invitation/token/extra', null],
    ['/settings', null],
  ] as const)('classifies %s', (pathname, expected) => {
    expect(resolvePublicAuthEntry(pathname)).toBe(expected);
  });
});
