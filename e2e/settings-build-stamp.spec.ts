import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

test.use({ reducedMotion: 'reduce' })

// P1.7: the build stamp only exists in builds made with VITE_FLOATY_BUILD_SHA set (the
// deploy script does that). The dev server never sets it, so against this suite the
// correct behaviour is ABSENCE — today's Settings, byte for byte (US-SET-03).

test.describe('Settings build stamp', () => {
  test('no build stamp in the default dev build', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    // The page is fully rendered (last section visible) before asserting the absence.
    await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible()
    await expect(page.getByTestId('build-stamp')).toHaveCount(0)
  })
})
