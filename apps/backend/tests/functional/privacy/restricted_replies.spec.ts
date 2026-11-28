import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'
import { freshDatabase } from '#tests/helpers/fresh_database'
import {
  configureAuth,
  resetPlanningFixture,
  session,
  signIn,
} from '#tests/functional/planning/helpers'
import {
  codeNamesByMarker,
  type Fixture,
  listHiddenMarkers,
  prepareMarkers,
  readContextToken,
  replies,
  startMasqueradeAs,
  testUsers,
} from '#tests/helpers/privacy/restricted_replies'

test.group('restricted values in replies', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('every named route has a reviewed reply exposure', ({ assert }) => {
    const names = Object.values(router.toJSON())
      .flat()
      .flatMap((registered) => (registered.name ? [registered.name] : []))
    // A key may name one case of a route after `#`; the mutation route has one case per write.
    const classified = new Set(Object.keys(replies).map((key) => key.split('#')[0]))
    assert.sameMembers([...classified], names)
  })

  test('no reply carries a restricted value to {label}')
    .with(testUsers)
    .run(async ({ client, assert, cleanup }, testUser) => {
      configureAuth(cleanup)
      const owner = await signIn(client, 'owner')
      const markers = await prepareMarkers(client, owner.cookie)
      let cookie: string
      let viewToken: string | undefined
      if (testUser.masquerade) {
        const viewer = await signIn(client, testUser.actor ?? 'owner')
        const target = await signIn(client, testUser.effective)
        const started = await startMasqueradeAs(client, viewer.cookie, target.userId)
        started.assertStatus(200)
        cookie = viewer.cookie
        viewToken = await readContextToken(client, cookie)
      } else {
        const member =
          testUser.effective === 'owner' ? owner : await signIn(client, testUser.effective)
        cookie = member.cookie
        if (testUser.refusedTarget) {
          const target =
            testUser.refusedTarget === 'owner'
              ? owner
              : await signIn(client, testUser.refusedTarget)
          const refused = await startMasqueradeAs(client, cookie, target.userId)
          refused.assertStatus(403)
        }
      }
      const fixture: Fixture = { client, ownerCookie: owner.cookie, cookie, ...markers }
      const hidden = listHiddenMarkers(testUser.effective)
      for (const [name, exposure] of Object.entries(replies)) {
        if ('none' in exposure) continue
        const reply = await exposure.call(fixture, testUser)
        const text = reply.text()
        const where = `${name} to ${testUser.label}`
        for (const marker of hidden) assert.notInclude(text, marker, where)
        if (exposure.write) {
          const refused = testUser.masquerade || testUser.effective === 'viewer'
          assert.equal(reply.status(), refused ? 403 : 200, where)
        } else if (name === 'api.planning_archive.show') {
          if (testUser.masquerade) assert.equal(reply.status(), 403, where)
          else if (testUser.effective === 'owner' || testUser.effective === 'admin')
            assert.equal(reply.status(), 200, where)
        } else {
          assert.equal(reply.status(), 200, where)
        }
        // Positive control: a reply that succeeds carries every marker this reader may see, and the
        // quoted code name, as JSON text, in place of each name it may not.
        if (reply.status() === 200) {
          const { carries } = exposure
          for (const marker of typeof carries === 'function' ? carries(testUser) : carries) {
            const codeName = codeNamesByMarker[marker]
            if (!hidden.includes(marker)) assert.include(text, marker, where)
            else if (codeName) assert.include(text, `\\"${codeName}\\"`, where)
          }
        }
        // The export is labelled full only for an effective Owner, whoever is signed in.
        if (name === 'api.company_export.show' && reply.status() === 200) {
          const { completeness } = JSON.parse(text) as { completeness: string }
          assert.equal(completeness, testUser.effective === 'owner' ? 'full' : 'redacted', where)
        }
      }
      if (viewToken) {
        const ended = await session(client.visit('api.masquerade.destroy'), cookie)
          .json({ token: viewToken, reason: 'explicit' })
          .send()
        ended.assertStatus(200)
      }
    })
})
