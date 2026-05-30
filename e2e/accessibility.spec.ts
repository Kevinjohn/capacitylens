import { test, expect, type Locator } from '@playwright/test'

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no bounding box')
  return b
}

// Covers US-KBD-01..03, 05. (US-KBD-04 axe lives in e2e/a11y.spec.ts.)
test.describe('Keyboard & accessibility', () => {
  test('an allocation bar is focusable and Enter opens the editor', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    const bar = page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })
    await bar.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Edit allocation' })).toBeVisible()
  })

  test('arrow keys move a focused bar by a day', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    const bar = page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })
    await bar.focus()
    const b0 = await box(bar)
    await page.keyboard.press('ArrowRight')
    const b1 = await box(bar)
    expect(b1.x).toBeGreaterThan(b0.x)
  })

  test('a modal focuses a control on open and closes on Escape', async ({ page }) => {
    await page.goto('/resources')
    await page.getByRole('button', { name: 'Add resource' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // Focus is inside the dialog after open.
    const focusInside = await dialog.evaluate((node) => node.contains(document.activeElement))
    expect(focusInside).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('the scheduler exposes grid roles and an sr-only per-row capacity summary', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('grid', { name: 'Resource schedule' })).toBeVisible()
    await expect(page.getByRole('rowheader', { name: /Tyler Nix/ })).toBeVisible()
    await expect(page.getByText(/\d+ allocation/).first()).toBeAttached() // sr-only summary
  })

  test('an invalid field is marked aria-invalid and described by the error', async ({ page }) => {
    await page.goto('/clients')
    await page.getByRole('button', { name: 'Add client' }).click()
    await page.getByRole('button', { name: 'Save' }).click() // blank name

    const name = page.getByLabel('Name')
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    const describedBy = await name.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    await expect(page.getByRole('alert')).toHaveAttribute('id', describedBy!)
  })
})
