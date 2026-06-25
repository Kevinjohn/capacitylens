import { afterEach, describe, expect, it, vi } from 'vitest'

// buildStamp() reads VITE_CAPACITYLENS_BUILD_SHA at call time, but the server/local suffix comes
// from apiConfig's module-level API_BASE — frozen at first import. So, like apiConfig.test,
// each case stubs the env, resets the module registry, and dynamically re-imports.

afterEach(() => vi.unstubAllEnvs())

async function freshBuildInfo() {
  vi.resetModules()
  return import('./buildInfo')
}

async function freshBuildStamp() {
  const { buildStamp } = await freshBuildInfo()
  return buildStamp
}

describe('buildStamp', () => {
  it('is null when VITE_CAPACITYLENS_BUILD_SHA is unset (today\'s UI — render nothing)', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_BUILD_SHA', '')
    const buildStamp = await freshBuildStamp()
    expect(buildStamp()).toBeNull()
  })

  it('is null for a whitespace-only sha', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_BUILD_SHA', '   ')
    const buildStamp = await freshBuildStamp()
    expect(buildStamp()).toBeNull()
  })

  it('reports local mode when no backend is configured', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_BUILD_SHA', 'a1b2c3d')
    vi.stubEnv('VITE_CAPACITYLENS_API', '')
    const buildStamp = await freshBuildStamp()
    expect(buildStamp()).toBe('build a1b2c3d · local')
  })

  it('reports server mode when VITE_CAPACITYLENS_API is configured', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_BUILD_SHA', 'a1b2c3d')
    vi.stubEnv('VITE_CAPACITYLENS_API', 'https://api.example.com')
    const buildStamp = await freshBuildStamp()
    expect(buildStamp()).toBe('build a1b2c3d · server')
  })
})

describe('feedbackMailto', () => {
  it('is null when VITE_CAPACITYLENS_FEEDBACK_MAILTO is unset (render nothing)', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_FEEDBACK_MAILTO', '')
    const { feedbackMailto } = await freshBuildInfo()
    expect(feedbackMailto()).toBeNull()
  })

  it('pins the subject to the build stamp when there is one', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_FEEDBACK_MAILTO', 'owner@example.com')
    vi.stubEnv('VITE_CAPACITYLENS_BUILD_SHA', 'a1b2c3d')
    vi.stubEnv('VITE_CAPACITYLENS_API', 'https://api.example.com')
    const { feedbackMailto } = await freshBuildInfo()
    expect(feedbackMailto()).toBe(
      `mailto:owner@example.com?subject=${encodeURIComponent('CapacityLens feedback — build a1b2c3d · server')}`,
    )
  })

  it('falls back to a plain subject without a build stamp', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_FEEDBACK_MAILTO', 'owner@example.com')
    vi.stubEnv('VITE_CAPACITYLENS_BUILD_SHA', '')
    const { feedbackMailto } = await freshBuildInfo()
    expect(feedbackMailto()).toBe(`mailto:owner@example.com?subject=${encodeURIComponent('CapacityLens feedback')}`)
  })
})
