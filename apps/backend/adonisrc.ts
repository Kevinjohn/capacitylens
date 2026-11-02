import { indexEntities } from '@adonisjs/core/generators';
import { defineConfig } from '@adonisjs/core/app';
import { indexPolicies } from '@adonisjs/bouncer';
import { generateRegistry } from '@tuyau/core/hooks';

async function accountKitCommands() {
  const commands = await import('adonisjs-account-kit/commands');
  return {
    getMetaData: async () => {
      const metadata = await commands.getMetaData();
      return metadata.filter(
        (commandMetadata) => commandMetadata.commandName !== 'account-kit:reset-link'
      );
    },
    getCommand: commands.getCommand,
  };
}

export default defineConfig({
  /*
  |--------------------------------------------------------------------------
  | Experimental flags
  |--------------------------------------------------------------------------
  |
  | The following features will be enabled by default in the next major release
  | of AdonisJS. You can opt into them today to avoid any breaking changes
  | during upgrade.
  |
  */
  experimental: {},

  /*
  |--------------------------------------------------------------------------
  | Commands
  |--------------------------------------------------------------------------
  |
  | List of ace commands to register from packages. The application commands
  | will be scanned automatically from the "./commands" directory.
  |
  */
  commands: [
    () => import('@adonisjs/core/commands'),
    () => import('@adonisjs/lucid/commands'),
    () => import('@adonisjs/session/commands'),
    () => import('@adonisjs/bouncer/commands'),
    accountKitCommands,
    () => import('adonisjs-account-kit/admission/commands'),
  ],

  /*
  |--------------------------------------------------------------------------
  | Service providers
  |--------------------------------------------------------------------------
  |
  | List of service providers to import and register when booting the
  | application
  |
  */
  providers: [
    () => import('@adonisjs/core/providers/app_provider'),
    () => import('@adonisjs/core/providers/hash_provider'),
    {
      file: () => import('@adonisjs/core/providers/repl_provider'),
      environment: ['repl', 'test'],
    },
    () => import('@adonisjs/core/providers/vinejs_provider'),
    () => import('@adonisjs/session/session_provider'),
    () => import('@adonisjs/shield/shield_provider'),
    () => import('@adonisjs/lucid/database_provider'),
    () => import('@adonisjs/cors/cors_provider'),
    () => import('@adonisjs/static/static_provider'),
    () => import('@adonisjs/auth/auth_provider'),
    () => import('@adonisjs/bouncer/bouncer_provider'),
    () => import('@adonisjs/mail/mail_provider'),
    () => import('@adonisjs/limiter/limiter_provider'),
    () => import('adonisjs-account-kit/account_kit_provider'),
    () => import('adonisjs-account-kit/admission/provider'),
    () => import('@kevinjohn/lucid-soft-deletes/provider'),
    () => import('#providers/configuration_provider'),
    () => import('#providers/backup_provider'),
  ],

  /*
  |--------------------------------------------------------------------------
  | Preloads
  |--------------------------------------------------------------------------
  |
  | List of modules to import before starting the application.
  |
  */
  preloads: [
    () => import('#start/resource_limits'),
    () => import('#start/routes'),
    () => import('#start/kernel'),
    () => import('#start/validator'),
  ],

  /*
  |--------------------------------------------------------------------------
  | Tests
  |--------------------------------------------------------------------------
  |
  | List of test suites to organize tests by their type. Feel free to remove
  | and add additional suites.
  |
  */
  tests: {
    suites: [
      {
        files: ['tests/unit/**/*.spec.{ts,js}'],
        name: 'unit',
        timeout: 2000,
      },
      {
        files: ['tests/functional/**/*.spec.{ts,js}'],
        name: 'functional',
        timeout: 30000,
      },
    ],
    forceExit: false,
  },

  /*
  |--------------------------------------------------------------------------
  | Metafiles
  |--------------------------------------------------------------------------
  |
  | A collection of files you want to copy to the build folder when creating
  | the production build.
  |
  */
  metaFiles: [{ pattern: 'public/**', reloadServer: false }],

  hooks: {
    init: [
      indexPolicies(),
      indexEntities({
        transformers: { enabled: true },
      }),
      // Validation refusals use our flat 400 adapter, rather than Vine's default 422 body.
      generateRegistry({ validationErrorType: false }),
    ],
  },
});
