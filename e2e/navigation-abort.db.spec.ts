import { test } from './dbFixtures';
import { openApp } from './browserTestSupport';

// WebKit refuses a fetch started while its document unloads and reports the refusal as a page
// error even though the application handles the rejection. The page-error gate ignores only the
// same-origin shape of that report.
function fetchOnPageHide(page: Parameters<typeof openApp>[0], url: string): Promise<void> {
  return page.evaluate((target) => {
    window.addEventListener('pagehide', () => {
      void fetch(target).catch(() => undefined);
    });
  }, url);
}

test('a handled same-origin fetch started during unload passes the page-error gate', async ({
  page,
}) => {
  await openApp(page);
  await fetchOnPageHide(page, '/api/accounts/a-studio/resource-avatars');
  await openApp(page);
});

test('a cross-origin fetch refused during unload still fails the page-error gate in WebKit', async ({
  page,
  browserName,
}) => {
  test.fail(browserName === 'webkit', 'The gate must keep reporting cross-origin refusals.');
  await openApp(page);
  const crossOrigin = new URL(page.url());
  crossOrigin.hostname = '127.0.0.1';
  crossOrigin.pathname = '/api/accounts/a-studio/resource-avatars';
  await fetchOnPageHide(page, crossOrigin.href);
  await openApp(page);
});
