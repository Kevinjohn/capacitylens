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
const JOIN_OWNER = `admission-join-owner-${STAMP}@capacitylens.dev`;
const JOIN_PERSON = `admission-join-person-${STAMP}@capacitylens.dev`;

// The E2E servers have no mail transport, so the operator command prints the acceptance link that
// an Owner's invitation would email. A company invitation creates the membership on acceptance, so
// the approved person enters the application directly. An operator invitation for no company
// creates none, so the approved person joins the company explicitly with the invited role.
test('an invited person accepts, waits for approval, and enters with the invited role', async ({
  page,
  newObservedContext,
  request,
}) => {
  test.setTimeout(60_000);
  const owner = await signUpUser(OWNER);
  const companyId = await bootstrapOrg(request, owner.cookie, `Admission Studio ${STAMP}`);

  await page.goto(printFixtureInvitation(PERSON, 'editor', companyId));
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

  await admission.getByRole('button', { name: 'Check again' }).click();
  await waitForAppLanding(page, page.locator('#main'));
  await page.getByRole('link', { name: 'Team & access' }).click();
  await expect(page.getByTestId('current-access')).toContainText('Editor');
});

test('a person with an operator invitation for no company is approved and joins with the invited role', async ({
  page,
  newObservedContext,
  request,
}) => {
  test.setTimeout(60_000);
  const owner = await signUpUser(JOIN_OWNER);
  await bootstrapOrg(request, owner.cookie, `Admission Join Studio ${STAMP}`);

  await page.goto(printFixtureInvitation(JOIN_PERSON, 'editor'));
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
    await ownerPage.getByLabel('Email').fill(JOIN_OWNER);
    await ownerPage.getByLabel('Password').fill(PASSWORD);
    await ownerPage.getByRole('button', { name: 'Sign in' }).click();
    await waitForAppLanding(ownerPage, ownerPage.locator('#main'));
    await ownerPage.getByRole('link', { name: 'Team & access' }).click();
    const waiting = ownerPage.getByTestId('admission-request').filter({ hasText: JOIN_PERSON });
    await expect(waiting).toContainText('Editor');
    await waiting.getByTestId('admission-approve').click();
    await expect(waiting).toHaveCount(0);
  } finally {
    await ownerContext.close();
  }

  // The operator's invitation names no company, so the approved person joins with the invited role.
  await admission.getByRole('button', { name: 'Check again' }).click();
  await page.getByTestId('access-join-company').click();
  await waitForAppLanding(page, page.locator('#main'));
  await page.getByRole('link', { name: 'Team & access' }).click();
  await expect(page.getByTestId('current-access')).toContainText('Editor');
});
