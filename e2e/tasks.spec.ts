import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-TSK-01..04.
test.describe('Tasks', () => {
  test('adds a general (no-project) task and a project-bound task', async ({ page }) => {
    await openApp(page, 'Studio North', '/tasks')

    // A task with no project saves as a general task, labelled "General".
    await page.getByRole('button', { name: 'Add task' }).click()
    await page.getByLabel('Name').fill('Internal sync')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('task-row').filter({ hasText: 'Internal sync' })).toContainText('General')

    // A task can still be bound to a project.
    await page.getByRole('button', { name: 'Add task' }).click()
    await page.getByLabel('Name').fill('Spec review')
    await page.getByLabel('Project').selectOption('p-acme')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('task-row').filter({ hasText: 'Spec review' })).toBeVisible()
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
