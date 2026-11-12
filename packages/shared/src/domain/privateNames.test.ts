import { NULLABLE_FIELDS } from '../types/nullableFields.js';
import { describe, expect, it } from 'vitest';
import type { Client } from '../types/entities.js';
import {
  normalizeCodeName,
  nameForQuotedContext,
  privateCodeNameFallback,
  quoteCodeName,
  redactPrivateName,
} from './privateNames.js';

const meta = { accountId: 'a1', createdAt: 't', updatedAt: 't' };
const privateClient: Client = {
  ...NULLABLE_FIELDS.clients,
  ...meta,
  id: 'c1',
  name: 'Real Client',
  color: '#112233',
  isPrivate: true,
  codeName: 'Nightwing',
};
describe('private-name projection', () => {
  it('stores code names without user-supplied outer quotes and displays one consistent quote pair', () => {
    expect(normalizeCodeName('  “Nightwing”  ')).toBe('Nightwing');
    expect(normalizeCodeName('““  Nightwing  ””')).toBe('Nightwing');
    expect(normalizeCodeName('North"star')).toBe('North"star');
    expect(quoteCodeName('"Nightwing"')).toBe('"Nightwing"');
    expect(nameForQuotedContext('"Nightwing"')).toBe('Nightwing');
  });

  it('normalizes a long interior quote run in linear time', () => {
    const interior = `Nightwing${'"'.repeat(100_000)}Robin`;
    const started = performance.now();
    expect(normalizeCodeName(`""${interior}""`)).toBe(interior);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('redacts a private row without mutating it and removes the raw codeName field', () => {
    const redacted = redactPrivateName(privateClient);
    expect(redacted.name).toBe('"Nightwing"');
    expect(redacted.codeName).toBeNull();
    expect(privateClient).toMatchObject({ name: 'Real Client', codeName: 'Nightwing' });
  });
});

describe('private-name projection safeguards', () => {
  it('is idempotent for a projected row', () => {
    const once = redactPrivateName(privateClient);
    expect(redactPrivateName(once)).toBe(once);
    expect(redactPrivateName(once).name).toBe('"Nightwing"');
  });

  it('fails closed to a neutral code name when a private row has no usable code name', () => {
    const malformed = { ...privateClient, name: 'Secret Real Name' };
    malformed.codeName = null;
    const redacted = redactPrivateName(malformed);
    expect(redacted.name).toBe('"Confidential #c1"');
    expect(redacted.name).not.toContain('Secret Real Name');
    expect(redacted.codeName).toBeNull();
  });

  it('does not mistake a quoted private real name for a trusted prior projection', () => {
    const malformed = { ...privateClient, name: '"Secret Real Name"' };
    malformed.codeName = null;
    const redacted = redactPrivateName(malformed);
    expect(redacted.name).toBe('"Confidential #c1"');
    expect(redacted.name).not.toContain('Secret Real Name');
  });

  it('redacts a trusted projection again if it is subsequently mutated', () => {
    const projected = redactPrivateName(privateClient);
    projected.name = 'Secret replacement';
    const redacted = redactPrivateName(projected);
    expect(redacted.name).toBe('"Confidential #c1"');
    expect(redacted.codeName).toBeNull();
  });

  it('fails closed instead of throwing when an untrusted private row has a non-string code name', () => {
    const malformed = { ...privateClient, codeName: 42 } as unknown as Client;
    expect(redactPrivateName(malformed).name).toBe('"Confidential #c1"');
  });
});

describe('private-name projection across data', () => {
  it.each([1, 'true', 'yes'])(
    'fails closed for a truthy non-boolean privacy flag (%j)',
    (isPrivate) => {
      const malformed = { ...privateClient, isPrivate } as unknown as Client;
      const redacted = redactPrivateName(malformed);
      expect(redacted.name).toBe('"Nightwing"');
      expect(redacted.codeName).toBeNull();
    },
  );

  it('derives distinct stable fallbacks from record ids without using private names', () => {
    expect(privateCodeNameFallback('client-1234')).toBe('Confidential #client1234');
    expect(privateCodeNameFallback('client-5678')).toBe('Confidential #client5678');
    expect(privateCodeNameFallback('----')).toBe('Confidential #0000');
  });
});
