import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'
import {
  routeReport,
  reviewedUnclassified,
  sensitiveReads,
  signedInPersonRoutes,
} from '#tests/helpers/auth/masquerade_routes'

test.group('view-as route classification', () => {
  test('every route keeps its reviewed view-as classification', async ({ assert }) => {
    const lines = await routeReport()
    const pick = (pattern: RegExp) => lines.filter((line) => pattern.test(line))

    assert.sameMembers(pick(/\[UNCLASSIFIED /), reviewedUnclassified)
    assert.sameMembers(pick(/\(sensitive\)$/), sensitiveReads)
    assert.sameMembers(pick(/\[RAW-GUARD /), signedInPersonRoutes)
    // Everything else is an unmarked member route; no route may allow writes under view-as.
    const memberRoutes = lines.filter(
      (line) =>
        !reviewedUnclassified.includes(line) &&
        !sensitiveReads.includes(line) &&
        !signedInPersonRoutes.includes(line)
    )
    assert.isAbove(memberRoutes.length, 0)
    for (const line of memberRoutes) assert.match(line, /\[BUSINESS (READ|MUTATION)\]$/)
  })

  test('own-account routes carry the account blocker, and only sign-out is exempt', async ({
    assert,
  }) => {
    const blocked = Object.values(router.toJSON())
      .flat()
      .filter((route) =>
        [...route.middleware.all()].some(
          (entry) =>
            typeof entry === 'object' &&
            'name' in entry &&
            entry.name === 'accountKitAccountBlocker'
        )
      )
      .map((route) => route.pattern)
    const ownAccount = reviewedUnclassified
      .map((line) => line.split(' ')[1]!)
      .filter(
        (pattern) =>
          pattern.startsWith('/api/v1/auth/') || pattern.startsWith('/api/v1/invitations/')
      )
      .filter((pattern) => pattern !== '/api/v1/auth/sign-out')
    assert.sameMembers(blocked, ownAccount)
  })
})
