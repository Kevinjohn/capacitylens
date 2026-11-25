import { test } from '@japa/runner';
import app from '@adonisjs/core/services/app';
import db from '@adonisjs/lucid/services/db';
import hash from '@adonisjs/core/services/hash';
import env from '#start/env';
import { setSecretSetting } from '#tests/helpers/secret_settings';
import User from '#models/user';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { DevelopmentBootstrapService } from '#services/development_bootstrap_service';

const password = 'kal-el-fortress-2026';

test.group('development bootstrap credential', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(() => {
    const createAdmin = env.get('CAPACITYLENS_CREATE_ADMIN_ADMIN');
    const bootstrapPassword = env.get('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD');
    env.set('CAPACITYLENS_CREATE_ADMIN_ADMIN', true);
    setSecretSetting('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD', password);
    return () => {
      env.set('CAPACITYLENS_CREATE_ADMIN_ADMIN', createAdmin);
      setSecretSetting('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD', bootstrapPassword?.release());
    };
  });

  test('creates one confirmed administrator through the User model', async ({ assert }) => {
    const developmentBootstrap = await app.container.make(DevelopmentBootstrapService);
    await developmentBootstrap.bootstrapDevelopmentCredential();
    await developmentBootstrap.bootstrapDevelopmentCredential();

    const rows = await db.from('users');
    assert.lengthOf(rows, 1);
    const user = await User.findByOrFail('email', 'admin@admin.admin');
    assert.equal(user.displayName, 'admin');
    assert.isNull(user.unverifiedEmail);
    assert.isTrue(user.emailVerifiedAt?.isValid);
    assert.isTrue(await hash.verify(user.password!, password));
    assert.isString(user.createdAt);
    assert.isString(user.updatedAt);
  });
});
