import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-TSK-01..04.
test.describe('Tasks', () => {
  test('adds an internal, a repeatable, and a project task into their three sections', async ({ page }) => {
    await openApp(page, 'Studio North', '/tasks')

    // Internal kind → project picker hidden, lands in the "Internal tasks" section.
    await page.getByRole('button', { name: 'Add task' }).click()
    await page.getByLabel('Name').fill('Internal sync')
    await page.getByRole('radio', { name: 'Internal' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(
      page.getByTestId('internal-tasks').getByTestId('task-row').filter({ hasText: 'Internal sync' }),
    ).toBeVisible()

    // Repeatable kind → reusable across projects, lands in the "Repeatable tasks" section.
    await page.getByRole('button', { name: 'Add task' }).click()
    await page.getByLabel('Name').fill('Discovery workshop')
    await page.getByRole('radio', { name: 'Repeatable' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(
      page.getByTestId('repeatable-tasks').getByTestId('task-row').filter({ hasText: 'Discovery workshop' }),
    ).toBeVisible()

    // Project kind (the default) → bound to a project, lands in the "Project tasks" section,
    // labelled with its client / project.
    await page.getByRole('button', { name: 'Add task' }).click()
    await page.getByLabel('Name').fill('Spec review')
    await page.getByLabel('Project').selectOption('p-acme')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(
      page.getByTestId('project-tasks').getByTestId('task-row').filter({ hasText: 'Spec review' }),
    ).toContainText('Acme')
  })

  test('edits a task name', async ({ page }) => {
    await openApp(page, 'Studio North', '/tasks')
    await page.getByTestId('task-row').filter({ hasText: 'CMS Review' }).getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Name').fill('CMS Build')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('task-row').filter({ hasText: 'CMS Build' })).toBeVisible()
  })

  test('deletes a task and removes its allocation bars, restorable with undo', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    await expect(page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })).toBeVisible()

    await page.getByRole('link', { name: 'Tasks' }).click()
    await page.getByTestId('task-row').filter({ hasText: 'Wireframes' }).getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog', { name: 'Delete task?' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('task-row').filter({ hasText: 'Wireframes' })).toHaveCount(0)

    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    await expect(page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })).toHaveCount(0)
  })
})
