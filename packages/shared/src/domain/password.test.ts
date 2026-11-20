import { describe, expect, it } from 'vitest';
import {
  MAX_PASSWORD_INPUT_CODE_UNITS,
  countPasswordCharacters,
  getPasswordLengthFailure,
} from './password.js';

describe('password length policy', () => {
  it('counts astral characters as one Unicode code point rather than two UTF-16 code units', () => {
    expect('🔐'.length).toBe(2);
    expect(countPasswordCharacters('🔐')).toBe(1);
    expect(MAX_PASSWORD_INPUT_CODE_UNITS).toBe(256);
  });

  it('enforces the 15–128 bounds in Unicode code points', () => {
    expect(getPasswordLengthFailure('🔐'.repeat(14))).toBe('too-short');
    expect(getPasswordLengthFailure('🔐'.repeat(15))).toBeNull();
    expect(getPasswordLengthFailure('🔐'.repeat(128))).toBeNull();
    expect(getPasswordLengthFailure('🔐'.repeat(129))).toBe('too-long');
  });
});
