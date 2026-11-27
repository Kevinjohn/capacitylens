import { test } from '@japa/runner'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import ConfigurationProvider, { assertProductionPosture } from '#providers/configuration_provider'
import { DevelopmentBootstrapService } from '#services/development_bootstrap_service'

test.group('configuration provider', () => {
  test('production refuses bootstrap, invalid limiter, and reset settings', ({ assert }) => {
    const safe = { allowReset: false, rateLimit: '300' }
    assert.doesNotThrow(() => assertProductionPosture(safe))
    assert.throws(() => assertProductionPosture({ ...safe, createAdmin: true }), /bootstrap/)
    assert.throws(
      () => assertProductionPosture({ ...safe, bootstrapPassword: 'secret' }),
      /bootstrap/
    )
    for (const rateLimit of ['0', ' 100 ', '1e3', '12.5', '+100', '2000000'])
      assert.throws(() => assertProductionPosture({ ...safe, rateLimit }), /RATE_LIMIT/)
    assert.throws(() => assertProductionPosture({ ...safe, allowReset: true }), /ALLOW_RESET/)
    assert.throws(
      () => assertProductionPosture({ ...safe, fixedToday: '2026-06-03' }),
      /FIXED_TODAY/
    )
  })

  test('git ignores the default and operator runtime database files', ({ assert }) => {
    const ignored = (path: string) => {
      try {
        execFileSync('git', ['check-ignore', '--no-index', '--quiet', path], {
          cwd: resolve(process.cwd(), '../..'),
          stdio: 'ignore',
        })
        return true
      } catch {
        return false
      }
    }
    assert.isTrue(ignored('capacitylens-local.db'))
    assert.isTrue(ignored('apps/backend/tmp/operator.db'))
  })

  for (const failedOperation of ['grantInvitation', 'approve'] as const) {
    test(`a ${failedOperation} bootstrap failure reports safe operator recovery`, async ({
      assert,
    }) => {
      const calls: string[] = []
      const operator = {
        grantInvitation: async () => {
          calls.push('grantInvitation')
          if (failedOperation === 'grantInvitation') throw new Error('private package detail')
          return {} as never
        },
        approve: async () => {
          calls.push('approve')
          if (failedOperation === 'approve') throw new Error('private package detail')
          return {} as never
        },
      }
      const developmentBootstrap = new DevelopmentBootstrapService({ operator } as never)
      let failure: unknown
      try {
        await developmentBootstrap.recordBootstrapAdmission('admin@admin.admin')
      } catch (error) {
        failure = error
      }
      assert.instanceOf(failure, Error)
      assert.include(
        (failure as Error).message,
        developmentBootstrap.buildBootstrapRecoveryMessage()
      )
      assert.notInclude((failure as Error).message, 'private package detail')
      assert.include((failure as Error).message, 'CAPACITYLENS_CREATE_ADMIN_ADMIN=false')
      assert.include((failure as Error).message, 'account-kit:admission:grant-invitation')
      assert.include((failure as Error).message, 'account-kit:admission:approve')
      assert.include((failure as Error).message, 'never changes an existing password')
      assert.instanceOf((failure as Error).cause, Error)
      assert.equal(((failure as Error).cause as Error).message, 'private package detail')
      assert.deepEqual(
        calls,
        failedOperation === 'grantInvitation' ? ['grantInvitation'] : ['grantInvitation', 'approve']
      )
    })
  }

  for (const state of ['isTerminating', 'isTerminated'] as const) {
    test(`a server whose shutdown already began (${state}) starts no maintenance`, async ({
      assert,
    }) => {
      const application = {
        container: { make: async () => ({ on() {} }) },
        getEnvironment: () => 'web',
        inTest: false,
        isTerminating: state === 'isTerminating',
        isTerminated: state === 'isTerminated',
        // The provider registers its shutdown hook before the first pass, so failing here stops a
        // regression before it opens the database and keeps the test run alive.
        terminating: () => assert.fail('Maintenance was set up after shutdown began'),
      }
      const provider = new ConfigurationProvider(application as never)
      await provider.ready()
      await provider.shutdown()
    })
  }

  test('a running server stops background maintenance when shutdown begins', async ({ assert }) => {
    const hooks: Array<() => unknown> = []
    const passes: string[] = []
    // The provider resolves its maintenance service from this application's container.
    const storageMaintenance = {
      createMaintenance: () => ({
        run: async () => void passes.push('run'),
        stop: async () => void passes.push('stop'),
      }),
    }
    const application = {
      container: { make: async () => storageMaintenance },
      getEnvironment: () => 'web',
      inTest: false,
      isTerminating: false,
      isTerminated: false,
      terminating: (hook: () => unknown) => hooks.push(hook),
    }
    const provider = new ConfigurationProvider(application as never)
    await provider.ready()
    assert.lengthOf(hooks, 1, 'the provider registers one shutdown hook')
    await hooks[0]()
    await provider.shutdown()
    assert.deepEqual(passes, ['run', 'stop'])
  })
})
