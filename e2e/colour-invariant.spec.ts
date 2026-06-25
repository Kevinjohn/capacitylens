import { test, expect, type Locator } from '@playwright/test'
import { openApp } from './helpers'

// The hard colour invariant, end-to-end (Phase 9 verification). CapacityLens allows colour to be
// set ONLY by picking a preset swatch (no hex/RGB entry — see ColorField + the "preset
// swatches only" rule), and that swatch must (a) PERSIST across a reload and (b) actually
// RENDER on the scheduler: a discipline's colour drives its group-header dot + every member's
// avatar, and a project's colour drives its allocation bars. This spec drives a real swatch
// pick through the ColorField popover, asserts the picked HEX renders (not merely "a colour"),
// and re-asserts it after a full page reload. Browser-agnostic (no UA branching) so it runs
// unchanged under e2e:browsers / e2e:webkit / e2e:firefox.

// "Blue dark" — flat index 47 in the 13×4 SWATCHES grid (swatchLabel(47) === 'Blue dark').
// Chosen because it ALREADY clears WCAG AA against its ink, so ensureBarColors() (the
// contrast-nudge applied to bars + avatars) returns it UNCHANGED — the rendered background is
// the picked hex exactly, which lets us assert the hex rather than an approximation. It also
// differs from every seeded entity colour, so the change is genuinely observable.
const PICK_LABEL = 'Blue dark'
// SWATCHES[47] is #1b4f98; computed `background-color` is reported as rgb(...) by every engine.
const PICK_RGB = 'rgb(27, 79, 152)'

/** Open a form's ColorField popover and click a swatch by its accessible label. The trigger's
 *  accessible name is `Colour (<current colour>)`, so match it by its "Colour" prefix; the
 *  swatch buttons are labelled by swatchLabel(i) (e.g. "Blue dark"). */
async function pickSwatch(scope: Locator, swatchLabel: string): Promise<void> {
  await scope.getByRole('button', { name: /^Colour/ }).click()
  // The grid is a role="group" labelled "Colour swatches"; click the named swatch within it.
  await scope.getByRole('group', { name: /Colour swatches/ }).getByRole('button', { name: swatchLabel, exact: true }).click()
}

/** The colour dot inside a scheduler discipline-group header (raw discipline colour). */
function disciplineDot(scope: Locator): Locator {
  // The header's only ring-1 rounded-full span is the colour dot.
  return scope.locator('span.rounded-full').first()
}

/** A resource row's identity avatar (left column), tinted with the discipline colour. */
function rowAvatar(row: Locator): Locator {
  // The avatar is the row header's rounded-full ring-2 span (the bars live in the lane, not here).
  return row.getByRole('rowheader').locator('span.rounded-full.ring-2').first()
}

test.describe('Colour invariant (preset swatch → persists → renders on the scheduler)', () => {
  test('a discipline colour pick persists across reload and tints its group dot + member avatars', async ({ page }) => {
    await openApp(page, 'Studio North', '/disciplines')

    // Edit the seeded "Design" discipline (Tyler Nix belongs to it) and pick a new swatch.
    await page.getByTestId('discipline-row').filter({ hasText: 'Design' }).getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit discipline' })
    await pickSwatch(dialog, PICK_LABEL)
    // The trigger now reports the picked colour by name — proves the pick registered pre-save.
    await expect(dialog.getByRole('button', { name: `Colour (${PICK_LABEL})` })).toBeVisible()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()

    // On the schedule the Design group-header dot AND Tyler's avatar must show the picked hex.
    await page.getByRole('link', { name: 'Schedule' }).click()
    const designGroup = page.getByTestId('discipline-group').filter({ hasText: 'Design' })
    await expect(designGroup).toBeVisible()
    await expect(disciplineDot(designGroup)).toHaveCSS('background-color', PICK_RGB)

    const tylerRow = page.getByTestId('scheduler-row').filter({ hasText: 'Tyler Nix' })
    await expect(rowAvatar(tylerRow)).toHaveCSS('background-color', PICK_RGB)

    // Reload: the colour is stored in the persisted AppData (localStorage capacitylens/v3), so it must
    // STILL render after a fresh load + re-entry through the account picker.
    await openApp(page, 'Studio North', '/')
    const designGroupAfter = page.getByTestId('discipline-group').filter({ hasText: 'Design' })
    await expect(designGroupAfter).toBeVisible()
    await expect(disciplineDot(designGroupAfter)).toHaveCSS('background-color', PICK_RGB)
    const tylerRowAfter = page.getByTestId('scheduler-row').filter({ hasText: 'Tyler Nix' })
    await expect(rowAvatar(tylerRowAfter)).toHaveCSS('background-color', PICK_RGB)
  })

  test('a project colour pick persists across reload and tints its allocation bars', async ({ page }) => {
    await openApp(page, 'Studio North', '/projects')

    // Edit the seeded "Project Lightning" (p-acme) — Tyler's "Wireframes" bar is one of its
    // allocations — and pick a new swatch.
    await page.getByTestId('project-row').filter({ hasText: 'Project Lightning' }).getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit project' })
    await pickSwatch(dialog, PICK_LABEL)
    await expect(dialog.getByRole('button', { name: `Colour (${PICK_LABEL})` })).toBeVisible()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()

    // The "Wireframes" bar (a Project Lightning activity) must render the picked hex. Seed bars
    // sit in early June and are visible at 4w with the grid scrolled fully left.
    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    const wireframesBar = page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })
    await expect(wireframesBar.first()).toBeVisible()
    await expect(wireframesBar.first()).toHaveCSS('background-color', PICK_RGB)

    // Reload → the bar colour persists.
    await openApp(page, 'Studio North', '/')
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    const wireframesBarAfter = page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })
    await expect(wireframesBarAfter.first()).toBeVisible()
    await expect(wireframesBarAfter.first()).toHaveCSS('background-color', PICK_RGB)
  })
})
