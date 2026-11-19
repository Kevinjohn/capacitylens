import { expect, test } from './fixtures';
import {
  AUTH_PASSWORD,
  bootstrapOrg,
  seedFixtureMember,
  sendPlanningFixtureCommand,
  signUpUser,
} from './authTestSupport';
import { waitForAppLanding } from './browserTestSupport';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

const STAMP = Date.now();
const OWNER = `lucius-fox-${STAMP}@capacitylens.dev`;
const EDITOR = `dick-grayson-${STAMP}@capacitylens.dev`;
const VIEWER = `tim-drake-${STAMP}@capacitylens.dev`;
const COMPANY = `Wayne Privacy Studio ${STAMP}`;
const REAL_CLIENT = 'Kane Industries Acquisition';
const REAL_PROJECT = 'Gotham Renewal';

async function signInAndOpen(page: import('@playwright/test').Page, email: string) {
  await page.goto('/');
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(AUTH_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a company' })).toHaveCount(0);
  await waitForAppLanding(page, page.getByRole('heading', { name: 'Schedule' }));
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
}

async function assertPrivateNamesForMember(
  page: import('@playwright/test').Page,
  context: import('@playwright/test').BrowserContext,
  role: 'editor' | 'viewer',
  email: string,
) {
  await context.clearCookies();
  await signInAndOpen(page, email);

  await page.getByRole('link', { name: 'Clients', exact: true }).click();
  const clientRow = page.getByTestId('client-row').filter({ hasText: '"Nightwing"' });
  await expect(clientRow).toBeVisible();
  if (role === 'viewer') {
    await expect(clientRow.getByRole('button', { name: /^Edit / })).toHaveCount(0);
  } else {
    await clientRow.getByRole('button', { name: /^Edit / }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit client' });
    await expect(dialog.getByLabel('Name', { exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('"Nightwing"');
    await expect(dialog.getByRole('switch', { name: 'Use code name' })).toHaveCount(0);
    await expect(dialog.getByLabel('Code name', { exact: true })).toHaveCount(0);
    await expect(
      dialog.getByText('Only an account owner can change this private name.'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  }

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  const projectRow = page.getByTestId('project-row').filter({ hasText: '"Aurora"' });
  await expect(projectRow).toBeVisible();
  if (role === 'viewer') {
    await expect(projectRow.getByRole('button', { name: /^Edit / })).toHaveCount(0);
  } else {
    await projectRow.getByRole('button', { name: /^Edit / }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit project' });
    await expect(dialog.getByLabel('Name', { exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('"Aurora"');
    await expect(dialog.getByRole('switch', { name: 'Use code name' })).toHaveCount(0);
    await expect(dialog.getByLabel('Code name', { exact: true })).toHaveCount(0);
    await expect(
      dialog.getByText('Only an account owner can change this private name.'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  }
}

function seedMembers(
  companyId: string,
  members: ReadonlyArray<{
    role: 'editor' | 'viewer';
    user: { cookie: string; email: string };
  }>,
) {
  for (const { role, user } of members) {
    seedFixtureMember(companyId, user.email, role);
  }
}

async function seedPrivateNames(
  request: import('@playwright/test').APIRequestContext,
  companyId: string,
  ownerCookie: string,
) {
  const clientId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  await sendPlanningFixtureCommand(request, ownerCookie, companyId, 'clients', {
    operation: 'catalogue.create',
    entity: {
      entity: 'clients',
      id: clientId,
      fields: { name: REAL_CLIENT, color: '#76a5e7', isPrivate: true, codeName: 'Nightwing' },
    },
  });
  await sendPlanningFixtureCommand(request, ownerCookie, companyId, 'projects', {
    operation: 'catalogue.create',
    entity: {
      entity: 'projects',
      id: projectId,
      fields: {
        clientId,
        name: REAL_PROJECT,
        color: '#e776b8',
        isPrivate: true,
        codeName: 'Aurora',
      },
    },
  });
}

test('non-owners see protected code names without owner controls', async ({
  page,
  request,
  context,
}) => {
  const [owner, editorUser, viewerUser] = await Promise.all([
    signUpUser(OWNER),
    signUpUser(EDITOR),
    signUpUser(VIEWER),
  ]);
  const members = [
    { role: 'editor', user: editorUser },
    { role: 'viewer', user: viewerUser },
  ] as const;

  const companyId = await bootstrapOrg(request, owner.cookie, COMPANY);
  seedMembers(companyId, members);
  await seedPrivateNames(request, companyId, owner.cookie);

  for (const { role, user } of members) {
    await assertPrivateNamesForMember(page, context, role, user.email);
  }
});
