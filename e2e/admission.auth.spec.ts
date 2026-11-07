import { test, expect } from './fixtures';
import {
  AUTH_PASSWORD as PASSWORD,
  bootstrapOrg,
  printFixtureInvitation,
  signUpUser,
} from './authTestSupport';
import { waitForAppLanding } from './browserTestSupport';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

const STAMP = Date.now();
const OWNER = `admission-owner-${STAMP}@capacitylens.dev`;
const PERSON = `admission-person-${STAMP}@capacitylens.dev`;

// The E2E servers have no mail transport, so the operator command prints the acceptance link that
// an Owner's invitation would email.
test('an invited person accepts, waits for approval, and enters with the invited role', async ({
  page,
  newObservedContext,
  request,
}) => {
  test.setTimeout(60_000);
  const owner = await signUpUser(OWNER);
  await bootstrapOrg(request, owner.cookie, `Admission Studio ${STAMP}`);

  await page.goto(printFixtureInvitation(PERSON, 'editor'));
  await expect(page.getByTestId('invite-role')).toHaveText('Editor');
  await page.getByTestId('invite-name').fill('Barry Allen');
  await page.getByTestId('invite-password').fill(PASSWORD);
  await page.getByTestId('invite-submit').click();

  const admission = page.getByTestId('access-admission');
  await expect(admission).toBeVisible();
  await admission.getByTestId('access-request-admission').click();
  await expect(admission).toContainText('An Owner or Admin will approve your access');

  const ownerContext = await newObservedContext({ reducedMotion: 'reduce' });
  try {
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto('/');
    await ownerPage.getByLabel('Email').fill(OWNER);
    await ownerPage.getByLabel('Password').fill(PASSWORD);
    await ownerPage.getByRole('button', { name: 'Sign in' }).click();
    await waitForAppLanding(ownerPage, ownerPage.locator('#main'));
    await ownerPage.getByRole('link', { name: 'Team & access' }).click();
    const waiting = ownerPage.getByTestId('admission-request').filter({ hasText: PERSON });
    await expect(waiting).toContainText('Editor');
    await waiting.getByTestId('admission-approve').click();
    await expect(waiting).toHaveCount(0);
  } finally {
    await ownerContext.close();
  }

  // Approving an invited person also adds their membership, so the next check opens the company.
  await admission.getByRole('button', { name: 'Check again' }).click();
  await waitForAppLanding(page, page.locator('#main'));
  await page.getByRole('link', { name: 'Team & access' }).click();
  await expect(page.getByTestId('current-access')).toContainText('Editor');
});
