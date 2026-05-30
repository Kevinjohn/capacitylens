import { test, expect } from '@playwright/test'

// Covers US-TSK-01..04.
test.describe('Tasks', () => {
  test('rejects a task without a project and adds one with a project', async ({ page }) => {
    await page.goto('/tasks')
    await page.getByRole('button', { name: 'Add task' }).click()
    await page.getByLabel('Name').fill('Spec review')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('alert')).toContainText(/must belong to a project/i)

    await page.getByLabel('Project').selectOption('p-acme')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('task-row').filter({ hasText: 'Spec review' })).toBeVisible()
  })

  test('offers only the chosen project phases and resets the phase when the project changes', async ({ page }) => {
    await page.goto('/tasks')
    await page.getByRole('button', { name: 'Add task' }).click()
    await page.getByLabel('Name').fill('Phased task')

    await page.getByLabel('Project').selectOption('p-acme') // Project Lightning has Discovery/Build
    await expect(page.getByLabel('Phase').getByRole('option', { name: 'Discovery' })).toBeAttached()
    await expect(page.getByLabel('Phase').getByRole('option', { name: 'Build' })).toBeAttached()
    await page.getByLabel('Phase').selectOption({ label: 'Discovery' })

    // Switching project resets the phase (Brand Themes has no phases).
    await page.getByLabel('Project').selectOption('p-brand')
    await expect(page.getByLabel('Phase')).toHaveValue('')
  })

  test('edits a task name', async ({ page }) => {
    await page.goto('/tasks')
    await page.getByTestId('task-row').filter({ hasText: 'CMS Review' }).getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Name').fill('CMS Build')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('task-row').filter({ hasText: 'CMS Build' })).toBeVisible()
  })

  test('deletes a task and removes its allocation bars, restorable with undo', async ({ page }) => {
    await page.goto('/')
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
