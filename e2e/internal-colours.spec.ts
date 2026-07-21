import { test, expect } from '@playwright/test'
import { openApp, selectShadOption } from './helpers'

// Covers US-SET-14: Internal work is neutral by default without discarding saved project colours.
test('Internal work defaults grey and palette mode restores the project picker and colour', async ({ page }) => {
  await openApp(page, 'Studio North', '/settings')

  await expect(page.getByRole('radio', { name: 'Grey' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', { name: 'Use colour palette' })).toHaveAttribute('aria-checked', 'false')

  await page.getByRole('link', { name: 'Projects' }).click()
  await page.getByRole('button', { name: 'Add project' }).click()
  const addDialog = page.getByRole('dialog', { name: 'Add project' })
  await addDialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Quarterly planning')
  // The picker starts visible while no client is selected, then hides as soon as Internal owns it.
  await expect(addDialog.getByRole('button', { name: /^Colour/ })).toBeVisible()
  await selectShadOption(addDialog.getByLabel('Client'), { label: 'Internal' })
  await expect(addDialog.getByRole('button', { name: /^Colour/ })).toHaveCount(0)
  await addDialog.getByRole('button', { name: 'Save' }).click()

  const row = page.getByTestId('project-row').filter({ hasText: 'Quarterly planning' })
  await expect(row.locator('span.inline-block.rounded-sm').first()).toHaveCSS('background-color', 'rgb(156, 163, 175)')

  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('radio', { name: 'Use colour palette' }).click()
  await page.getByRole('link', { name: 'Projects' }).click()

  // The project kept its original default pink while grey was displayed; palette mode restores it.
  await expect(row.locator('span.inline-block.rounded-sm').first()).toHaveCSS('background-color', 'rgb(218, 45, 146)')
  await row.getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit project' }).getByRole('button', { name: /^Colour/ })).toBeVisible()
})
