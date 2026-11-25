import 'reflect-metadata';
import { Ignitor } from '@adonisjs/core/ignitor';
import { AccountKit } from '@kevinjohn/adonisjs-account-kit';

const appRoot = new URL('../', import.meta.url);
const importer = (filePath) => {
  if (filePath.startsWith('./') || filePath.startsWith('../'))
    return import(new URL(filePath, appRoot).href);
  return import(filePath);
};

const email = process.argv[2];
const refuse = () => {
  console.error('The reset-link fixture requires the disposable auth E2E environment.');
  process.exit(1);
};
if (!email?.endsWith('@capacitylens.dev')) refuse();

const ignitor = new Ignitor(appRoot, { importer }).tap((app) => {
  app.booting(async () => {
    await import('#start/env');
  });
});
const app = ignitor.createApp('console');
let initialized = false;

try {
  await app.init();
  initialized = true;
  const { default: capacitylens } = await import('#config/capacitylens');
  if (!app.inDev || capacitylens.databasePath !== '.auth-e2e.db') {
    await app.terminate();
    refuse();
  }
  await app.boot();
  const accountKit = await app.container.make(AccountKit);
  const result = await accountKit.operator.resetLink({ email, deliver: 'print' });
  if (!result.url) throw new Error();
  process.stdout.write(JSON.stringify({ url: result.url }));
} catch {
  console.error('The auth E2E reset-link fixture failed.');
  process.exitCode = 1;
} finally {
  if (initialized) {
    try {
      await app.terminate();
    } catch {
      console.error('The auth E2E reset-link fixture did not shut down cleanly.');
      process.exitCode = 1;
    }
  }
}
