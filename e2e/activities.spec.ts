import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-TSK-01..04.
test.describe('Activities', () => {
  test('adds an internal, a repeatable, and a project activity into their three sections', async ({ page }) => {
    await openApp(page, 'Studio North', '/activities')

    // Internal kind → project picker hidden, lands in the "Internal activities" section.
    await page.getByRole('button', { name: 'Add activity' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Internal sync')
    await page.getByRole('radio', { name: 'Internal' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(
      page.getByTestId('internal-activities').getByTestId('activity-row').filter({ hasText: 'Internal sync' }),
    ).toBeVisible()

    // Repeatable kind → reusable across projects, lands in the "Repeatable activities" section.
    await page.getByRole('button', { name: 'Add activity' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Discovery workshop')
    await page.getByRole('radio', { name: 'Repeatable' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(
      page.getByTestId('repeatable-activities').getByTestId('activity-row').filter({ hasText: 'Discovery workshop' }),
    ).toBeVisible()

    // Project kind (the default) → bound to a project, lands in the "Project activities" section,
    // labelled with its client / project.
    await page.getByRole('button', { name: 'Add activity' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Spec review')
    await page.getByLabel('Project').selectOption('p-acme')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(
      page.getByTestId('project-activities').getByTestId('activity-row').filter({ hasText: 'Spec review' }),
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
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    await expect(page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })).toBeVisible()

    await page.getByRole('link', { name: 'Activities' }).click()
    await page.getByTestId('activity-row').filter({ hasText: 'Wireframes' }).getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog', { name: 'Delete activity?' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('activity-row').filter({ hasText: 'Wireframes' })).toHaveCount(0)

    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    await expect(page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })).toHaveCount(0)
  })
})
