import { describe, expect, it } from 'vitest';
import { MAX_EMAIL_LENGTH } from '../lib/strings.js';
import {
  isAccountCommandId,
  isAccountEmail,
  isAccountIdempotencyKey,
  normalizeAccountEmail,
} from './validation.js';

const opaqueCredentialValidators = [
  ['account command id', isAccountCommandId],
  ['account idempotency key', isAccountIdempotencyKey],
] as const;

describe.each(opaqueCredentialValidators)('%s validation', (_name, validate) => {
  it.each([
    ['a'.repeat(16), true],
    ['A0_-'.repeat(32), true],
    ['a'.repeat(15), false],
    ['a'.repeat(129), false],
    ['contains+plus', false],
    [undefined, false],
  ])('classifies %j', (value, expected) => {
    expect(validate(value)).toBe(expected);
  });
});

describe('identity input validation', () => {
  it.each([
    [' Person@Example.COM ', 'person@example.com'],
    ['ALICE@EXAMPLE.COM', 'alice@example.com'],
  ])('normalizes account email %j', (input, expected) => {
    expect(normalizeAccountEmail(input)).toBe(expected);
  });

  it.each([
    ['Person@Example.COM', true],
    ['', false],
    [' person@example.com', false],
    ['person@example.com ', false],
    ['person.example.com', false],
    ['person@', false],
    ['person@@example.com', false],
    ['person name@example.com', false],
  ])('classifies basic email shape %j', (email, expected) => {
    expect(isAccountEmail(email)).toBe(expected);
  });
});

describe('identity input validation boundaries', () => {
  it.each([
    'invite\0@example.com',
    'invite\u202e@example.com',
    'invite\u200b@example.com',
    'invite\ud800@example.com',
    'invite\ue000@example.com',
    'invite\u0378@example.com',
  ])('rejects disallowed email code points in %j', (email) => {
    expect(isAccountEmail(email)).toBe(false);
  });

  it('accepts the exact email limit and rejects the next code unit', () => {
    expect(isAccountEmail(`${'a'.repeat(MAX_EMAIL_LENGTH - 4)}@x.y`)).toBe(true);
    expect(isAccountEmail(`${'a'.repeat(MAX_EMAIL_LENGTH - 3)}@x.y`)).toBe(false);
  });

  it('applies the email limit to UTF-8 bytes', () => {
    expect(isAccountEmail(`${'é'.repeat(125)}@x.y`)).toBe(true);
    expect(isAccountEmail(`${'é'.repeat(126)}@x.y`)).toBe(false);
  });

  it('rejects an in-limit address whose normalized form expands beyond the limit', () => {
    const email = `${'İ'.repeat(MAX_EMAIL_LENGTH - 2)}@a`;
    expect(email).toHaveLength(MAX_EMAIL_LENGTH);
    expect(normalizeAccountEmail(email).length).toBeGreaterThan(MAX_EMAIL_LENGTH);
    expect(isAccountEmail(email)).toBe(false);
  });
});
