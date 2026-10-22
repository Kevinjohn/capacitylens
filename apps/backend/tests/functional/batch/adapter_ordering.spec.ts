import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { freshDatabase } from '../../helpers/fresh_database.js'
import { createServer, type ViteDevServer } from 'vite'
import type { AppData, Discipline } from '@capacitylens/shared/types/entities'
import { readStudioState, resetSeed } from './ordering_helpers.js'

interface SyncAdapter {
  loadAll(accountId?: string): Promise<AppData>
  saveAll(data: AppData, options?: { unload?: boolean }): Promise<void>
}

interface SyncAdapterConstructor {
  new (baseUrl: string, fetchImpl: typeof fetch): SyncAdapter
}

type ArrivalOrder = 'ordinary-first' | 'teardown-first'

let vite: ViteDevServer
let ServerSyncAdapter: SyncAdapterConstructor
let previousLocalStorage: PropertyDescriptor | undefined

test.group('M2a ServerSyncAdapter and SQLite ordering', (group) => {
  group.setup(async () => {
    previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Reflect.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    })
    const frontendRoot = fileURLToPath(new URL('../../../../frontend/', import.meta.url))
    // Avoid loading unrelated frontend plugins; Paraglide's native plugin is not needed for this adapter SSR test.
    vite = await createServer({
      configFile: false,
      root: frontendRoot,
      resolve: {
        alias: {
          '@capacitylens/shared': fileURLToPath(
            new URL('../../../../../packages/shared/src/', import.meta.url)
          ),
          '@': fileURLToPath(new URL('../../../../frontend/src/', import.meta.url)),
        },
      },
      server: { middlewareMode: true, hmr: false, watch: null },
      appType: 'custom',
    })
    const adapterModule = (await vite.ssrLoadModule('/src/data/ServerSyncAdapter.ts')) as {
      ServerSyncAdapter: SyncAdapterConstructor
    }
    ServerSyncAdapter = adapterModule.ServerSyncAdapter
  })
  group.teardown(async () => {
    await vite?.close()
    if (previousLocalStorage) {
      Reflect.defineProperty(globalThis, 'localStorage', previousLocalStorage)
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })
  group.setup(() => freshDatabase())

  async function exercise(
    client: ApiClient,
    arrivalOrder: ArrivalOrder,
    edit: (base: AppData) => { ordinary: AppData; teardown: AppData }
  ) {
    await resetSeed(client)
    const baseUrl = process.env.APP_URL
    if (!baseUrl) throw new Error('APP_URL must be supplied by the active Japa port lane.')
    const parsedBaseUrl = new URL(baseUrl)
    if (!['http:', 'https:'].includes(parsedBaseUrl.protocol) || !parsedBaseUrl.port) {
      throw new Error('APP_URL must be a validated lane URL with an explicit port.')
    }
    let holdFirst = true
    let releaseFirst: (() => void) | undefined
    let firstReached: (() => void) | undefined
    const reached = new Promise<void>((resolve) => {
      firstReached = resolve
    })
    const nativeFetch = globalThis.fetch.bind(globalThis)
    const fetchImpl: typeof fetch = async (input, init) => {
      const original = input instanceof Request ? input : new Request(input, init)
      const headers = new Headers(original.headers)
      headers.set('sec-fetch-site', 'same-origin')
      const request = new Request(original, { headers })
      if (holdFirst && new URL(request.url).pathname === '/api/batch') {
        holdFirst = false
        firstReached?.()
        if (arrivalOrder === 'ordinary-first') {
          const response = await nativeFetch(request)
          return new Promise<Response>((resolve) => {
            releaseFirst = () => resolve(response)
          })
        }
        return new Promise<Response>((resolve, reject) => {
          releaseFirst = () => {
            void nativeFetch(request).then(resolve, reject)
          }
        })
      }
      return nativeFetch(request)
    }
    const adapter = new ServerSyncAdapter(baseUrl, fetchImpl)
    const base = await adapter.loadAll('a-studio')
    const edited = edit(structuredClone(base))
    const ordinary = adapter.saveAll(edited.ordinary)
    await reached
    const teardown = adapter.saveAll(edited.teardown, { unload: true })
    for (let attempt = 0; !releaseFirst && attempt < 50; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    if (!releaseFirst) throw new Error('The first batch request was not intercepted.')
    releaseFirst()
    await Promise.all([ordinary, teardown])
    return readStudioState(client)
  }

  test('preserves the teardown availability boundary in both request arrival orders', async ({
    client,
    assert,
  }) => {
    for (const arrivalOrder of ['ordinary-first', 'teardown-first'] as const) {
      const state = await exercise(client, arrivalOrder, (base) => {
        const row = base.resources.find((item) => item.id === 'r-tyler')!
        return {
          ordinary: {
            ...base,
            resources: base.resources.map((item) =>
              item.id === row.id
                ? {
                    ...item,
                    firstAvailableDate: '2026-07-01',
                    updatedAt: '2026-06-02T00:00:00.000Z',
                  }
                : item
            ),
          },
          teardown: {
            ...base,
            resources: base.resources.map((item) =>
              item.id === row.id ? { ...item, updatedAt: '2026-06-03T00:00:00.000Z' } : item
            ),
          },
        }
      })
      assert.isNull(state.resources.find((row) => row.id === 'r-tyler')?.firstAvailableDate)
    }
  })

  test('preserves the newer discipline edit in both request arrival orders', async ({
    client,
    assert,
  }) => {
    for (const arrivalOrder of ['ordinary-first', 'teardown-first'] as const) {
      const state = await exercise(client, arrivalOrder, (base) => {
        const original = base.disciplines.find((row) => row.id === 'd-design')!
        const first = { ...original, name: 'First edit', updatedAt: '2026-06-02T00:00:00.000Z' }
        const newest = { ...original, name: 'Newest edit', updatedAt: '2026-06-03T00:00:00.000Z' }
        return {
          ordinary: {
            ...base,
            disciplines: base.disciplines.map((row) => (row.id === original.id ? first : row)),
          },
          teardown: {
            ...base,
            disciplines: base.disciplines.map((row) => (row.id === original.id ? newest : row)),
          },
        }
      })
      const discipline = state.disciplines.find((row) => row.id === 'd-design')
      assert.equal(discipline?.name, 'Newest edit')
    }
  })

  test('does not resurrect an unacknowledged non-lifecycle creation in either arrival order', async ({
    client,
    assert,
  }) => {
    for (const arrivalOrder of ['ordinary-first', 'teardown-first'] as const) {
      const state = await exercise(client, arrivalOrder, (base) => {
        const source = base.disciplines.find((row) => row.id === 'd-design')!
        const row: Discipline = {
          ...source,
          id: 'm2a-unacknowledged-discipline',
          name: 'Temporary',
          updatedAt: '2026-06-02T00:00:00.000Z',
        }
        return {
          ordinary: { ...base, disciplines: [...base.disciplines, row] },
          teardown: base,
        }
      })
      assert.isFalse(state.disciplines.some((row) => row.id === 'm2a-unacknowledged-discipline'))
    }
  })
})
