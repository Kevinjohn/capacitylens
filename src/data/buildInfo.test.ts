import { afterEach, describe, expect, it, vi } from 'vitest'

// buildStamp() reads VITE_FLOATY_BUILD_SHA at call time, but the server/local suffix comes
// from apiConfig's module-level API_BASE — frozen at first import. So, like apiConfig.test,
// each case stubs the env, resets the module registry, and dynamically re-imports.

afterEach(() => vi.unstubAllEnvs())

async function freshBuildStamp() {
  vi.resetModules()
  const { buildStamp } = await import('./buildInfo')
  return buildStamp
}

describe('buildStamp', () => {
  it('is null when VITE_FLOATY_BUILD_SHA is unset (today\'s UI — render nothing)', async () => {
    vi.stubEnv('VITE_FLOATY_BUILD_SHA', '')
    const buildStamp = await freshBuildStamp()
    expect(buildStamp()).toBeNull()
  })

  it('is null for a whitespace-only sha', async () => {
    vi.stubEnv('VITE_FLOATY_BUILD_SHA', '   ')
    const buildStamp = await freshBuildStamp()
    expect(buildStamp()).toBeNull()
  })

  it('reports local mode when no backend is configured', async () => {
    vi.stubEnv('VITE_FLOATY_BUILD_SHA', 'a1b2c3d')
    vi.stubEnv('VITE_FLOATY_API', '')
    const buildStamp = await freshBuildStamp()
    expect(buildStamp()).toBe('build a1b2c3d · local')
  })

  it('reports server mode when VITE_FLOATY_API is configured', async () => {
    vi.stubEnv('VITE_FLOATY_BUILD_SHA', 'a1b2c3d')
    vi.stubEnv('VITE_FLOATY_API', 'https://api.example.com')
    const buildStamp = await freshBuildStamp()
    expect(buildStamp()).toBe('build a1b2c3d · server')
  })
})
