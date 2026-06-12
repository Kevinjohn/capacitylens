import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

test.use({ reducedMotion: 'reduce' })

// P1.7 + P5.2: the build stamp and the Send-feedback link only exist in builds made with
// VITE_FLOATY_BUILD_SHA / VITE_FLOATY_FEEDBACK_MAILTO set (the deploy script does that).
// The dev server never sets them, so against this suite the correct behaviour is ABSENCE —
// today's Settings, byte for byte (US-SET-03 / US-SET-04).

test.describe('Settings build stamp + feedback link', () => {
  test('no build stamp in the default dev build', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    // The page is fully rendered (last section visible) before asserting the absence.
    await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible()
    await expect(page.getByTestId('build-stamp')).toHaveCount(0)
  })

  test('no Send feedback link in the default dev build', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible()
    await expect(page.getByTestId('send-feedback')).toHaveCount(0)
  })
})
