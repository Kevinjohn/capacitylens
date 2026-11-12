import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllEnvs());

describe('apiConfig', () => {
  it('uses the same-origin server when no API origin is configured', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', '');
    vi.resetModules();
    const { API_BASE } = await import('./apiConfig');
    expect(API_BASE).toBe('');
  });

  it('canonicalizes a configured API origin', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', '  https://API.EXAMPLE.com:443///  ');
    vi.resetModules();
    const { API_BASE } = await import('./apiConfig');
    expect(API_BASE).toBe('https://api.example.com');
  });

  it.each([
    'https://user:secret@api.example.com',
    'https://api.example.com/base',
    'https://api.example.com?tenant=one',
    'https://api.example.com/#/',
    'https://api.example.com/#///',
    'file:///tmp/capacitylens-api',
  ])('rejects an API value that is not an HTTP(S) origin: %s', async (value) => {
    vi.stubEnv('VITE_CAPACITYLENS_API', value);
    vi.resetModules();
    await expect(import('./apiConfig')).rejects.toThrow(/HTTP\(S\) origin/);
  });
});
