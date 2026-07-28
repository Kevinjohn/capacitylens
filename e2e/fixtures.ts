import {
  expect,
  test as base,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test'

export { expect, type APIRequestContext, type Locator, type Page }

/** Every browser spec fails if application code raises an uncaught exception at any point. */
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: Error[] = []
    const recordError = (error: Error) => errors.push(error)
    page.on('pageerror', recordError)
    try {
      await use(page)
    } finally {
      page.off('pageerror', recordError)
    }
    if (errors.length > 0) {
      const details = errors
        .map((error, index) => `${index + 1}. ${error.stack ?? error.message}`)
        .join('\n\n')
      throw new Error(`Uncaught browser exception${errors.length === 1 ? '' : 's'}:\n\n${details}`)
    }
  },
})
