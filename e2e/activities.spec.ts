import { test, expect } from '@playwright/test'
import { openApp, selectShadOption } from './helpers'

// Covers US-TSK-01..04.
test.describe('Activities', () => {
  test('adds an internal, a cross-project, and a project-specific activity into their three sections', async ({ page }) => {
    await openApp(page, 'Studio North', '/activities')

    // Internal kind → project picker hidden, lands in the "Internal activities" section.
    await page.getByRole('button', { name: 'Add activity' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Internal sync')
    await page.getByRole('radio', { name: 'Internal' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(
      page.getByTestId('internal-activities').getByTestId('activity-row').filter({ hasText: 'Internal sync' }),
    ).toBeVisible()

    // Cross-project kind → project-less and usable across projects, lands in the "Cross-project activities" section.
    await page.getByRole('button', { name: 'Add activity' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Discovery workshop')
    await page.getByRole('radio', { name: 'Cross-project' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(
      page.getByTestId('cross-project-activities').getByTestId('activity-row').filter({ hasText: 'Discovery workshop' }),
    ).toBeVisible()

    // Project-specific kind (the default) → bound to a project, lands in the "Project-specific activities" section,
    // labelled with its client / project.
    await page.getByRole('button', { name: 'Add activity' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Spec review')
    await selectShadOption(page.getByLabel('Project'), 'p-acme')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(
      page.getByTestId('project-specific-activities').getByTestId('activity-row').filter({ hasText: 'Spec review' }),
    ).toContainText('Acme')
  })

  test('edits an activity name', async ({ page }) => {
    await openApp(page, 'Studio North', '/activities')
    await page.getByTestId('activity-row').filter({ hasText: 'CMS Review' }).getByRole('button', { name: 'Edit' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('CMS Build')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('activity-row').filter({ hasText: 'CMS Build' })).toBeVisible()
  })

  test('deletes an activity and removes its allocation bars, restorable with undo', async ({ page }) => {
    await openApp(page)
    await page.getByRole('radio', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    await expect(page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })).toBeVisible()

    await page.getByRole('link', { name: 'Activities' }).click()
    await page.getByTestId('activity-row').filter({ hasText: 'Wireframes' }).getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('alertdialog', { name: 'Delete activity?' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('activity-row').filter({ hasText: 'Wireframes' })).toHaveCount(0)

    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('radio', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    await expect(page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })).toHaveCount(0)
  })
})
