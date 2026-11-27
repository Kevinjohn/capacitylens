import { requireCreated } from '@/test/requireCreated'

import { expect } from 'vitest'
import { render } from '@testing-library/react'
import type { RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import { OwnerPermissions } from '@/test/ownerPermissions'
import type userEvent from '@testing-library/user-event'
import { useStore } from '@/store/useStore'
import type { AppData, Weekday } from '@capacitylens/shared/types/entities'
import {
  resetStoreWithData,
  DEFAULT_COMPANY_ID,
  makeActivity,
  makeAppData,
  makeClient,
  makeProject,
  makeResourceDraft,
} from '@/test/fixtures'
import { chooseOption } from './schedulerTestKit'

/** Fails the test when a required value is absent. */
export function required<T>(value: T | undefined | null, message: string): T {
  expect(value).toBeDefined()
  if (value === undefined || value === null) throw new Error(message)
  return value
}

/** Returns the first test result or fails when the list is empty. */
export function first<T>(values: T[]): T {
  return required(values[0], 'Expected a non-empty test result.')
}

/** Finds the enclosing form or fails the test. */
export function closestForm(control: HTMLElement): HTMLFormElement {
  return required(control.closest('form'), 'Expected the allocation control to belong to a form.')
}

/** Render an ordinary dialog as a resolved Owner; tests may still supply inner access boundaries. */
export function renderAsOwner(ui: ReactElement, options: Omit<RenderOptions, 'wrapper'> = {}) {
  return render(ui, { ...options, wrapper: OwnerPermissions })
}

/** Company fixture ID used by allocation dialog tests. */
export const ACC = DEFAULT_COMPANY_ID
const originalAddAllocation = useStore.getState().addAllocation
const originalAddRepeatedAllocation = useStore.getState().addRepeatedAllocation
const originalAddActivity = useStore.getState().addActivity

/** Builds the base company data for allocation dialog tests. */
export function base(): AppData {
  return makeAppData({
    clients: [makeClient({ companyId: ACC, color: '#2d75da' })],
    projects: [
      makeProject({ companyId: ACC }),
      makeProject({ id: 'p2', companyId: ACC, name: 'Other', color: '#06b6d4' }),
    ],
    activities: [
      makeActivity({ companyId: ACC }),
      makeActivity({ id: 't2', companyId: ACC, name: 'Other activity', projectId: 'p2' }),
    ],
  })
}

/** Restores original allocation and activity actions after a test replaces them. */
export function restoreStoreAllocationActions(): void {
  // Zustand state writes replace the state object while retaining action references. Restore these
  // explicitly so a spy installed in one test cannot survive on a later state object.
  useStore.setState({
    addAllocation: originalAddAllocation,
    addRepeatedAllocation: originalAddRepeatedAllocation,
    addActivity: originalAddActivity,
  })
}

/** Resets allocation dialog fixtures and patched actions between tests. */
export async function resetAllocationDialogStore(): Promise<void> {
  restoreStoreAllocationActions()
  await resetStoreWithData(base(), ACC)
  // Enable placeholders for assignment fixtures because the picker hides them by default. A current hidden assignee remains selectable while editing.
  await useStore.getState().updateCompany(ACC, { placeholdersEnabled: true })
}

/** Builds a person fixture with the supplied display name. */
export const person = (name: string) =>
  makeResourceDraft({ name, jobTitle: 'Dev', color: '#2d75da' })

/** Enables day scheduling for the test company. */
export const enableDays = (workingDays?: Weekday[]) =>
  useStore
    .getState()
    .updateCompany(ACC, { schedulingMode: 'days', ...(workingDays && { workingDays }) })

/** Adds a person fixture to the test company. */
export const addPerson = () =>
  requireCreated(
    useStore.getState().addResource(makeResourceDraft({ name: 'Tyler', color: '#111111' }))
  )

/** Completes the visible allocation assignment fields in a dialog test. */
export const completeAssignment = async (user: ReturnType<typeof userEvent.setup>) => {
  await chooseOption(user, 'Project', 'Ferris / Lightning')
  await chooseOption(user, 'Activity', 'Wireframes')
}
