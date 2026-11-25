---
title: AdonisJS cookbook
description: House rules, vocabulary and recipes for every AdonisJS application and package we maintain, each traced to its AdonisJS source.
---

# AdonisJS cookbook

Draft 2, 2026-11-21. Written against AdonisJS 7 (`@adonisjs/core` 7.x), Lucid 22, VineJS 4, Japa
and Tuyau 1.

This is the coding guidebook for every AdonisJS repository we own: applications, and the
`@kevinjohn/adonisjs-*` packages that applications consume. It belongs to no single repository.
Someone who knows AdonisJS should open any of our repositories and find every file where the
framework puts it, named as the framework names it and called what the framework calls it.

## How to read it

- **Part 1** applies to every repository.
- **Part 2** applies to applications.
- **Part 3** applies to packages.
- **Part 4** lists the house decisions still to agree.
- **Part 5** holds the two review checklists.

Every rule has an id (`CTL-3`) so a review, an issue or a commit can cite it. Every rule carries
its origin:

| Tag | Origin | Weight |
| --- | --- | --- |
| **F** | The AdonisJS or Lucid documentation, an official starter kit, an official package, or the official lint and format presets. | Follow it. |
| **P** | A lint rule or style note on the public pages of AdonisJS Plus. Stricter than the documentation. The rule sources are paid and were not read. | Follow it unless Part 4 says otherwise. |
| **H** | A house rule: ours, where the framework is silent or we chose between two framework options. | Follow it; listed in Part 4 until agreed. |

The origin says where a rule comes from. What a failure does is the rule's tier (law, rule or
guideline), which the [pre-PR checklist](./adonisjs-checklist.md) sets.

Three rules decide every case:

1. **Follow the framework.** When this book is silent, the AdonisJS documentation decides, then
   the `api` starter kit, then the official packages' source.
2. **A deliberate difference is written down.** Each repository keeps a numbered list of its
   departures from this book, with the reason. A new difference is added to that list before the
   code is merged.
3. **An unrecorded difference is debt.** It gets an issue. It is not a pattern to copy.

Sources: [AdonisJS documentation](https://docs.adonisjs.com),
[Lucid documentation](https://lucid.adonisjs.com),
[`adonisjs/starter-kits`](https://github.com/adonisjs/starter-kits),
[`adonisjs/pkg-starter-kit`](https://github.com/adonisjs/pkg-starter-kit), the official packages
(`@adonisjs/limiter`, `@adonisjs/session`, `@adonisjs/lock`), `@adonisjs/eslint-config`,
`@adonisjs/prettier-config`, `@adonisjs/tsconfig`, and the public pages of
[AdonisJS Plus](https://plus.adonisjs.com). Recipes are taken from those sources, shortened where
marked.

---

# Part 1: every repository

## Vocabulary

- **VOC-1 (F)** Use the framework's word for a framework concept, in code, comments, commit
  messages, issues and documentation.
- **VOC-2 (H)** Write "AdonisJS", never "Adonis", in prose. Package names keep their spelling:
  Lucid, VineJS, Japa, Tuyau, Ace, Edge, Bouncer, Shield.
- **VOC-3 (H)** A word in the table below is not reused for anything else. Pick a different word
  for a product concept that happens to resemble one.

| Term | Meaning |
| --- | --- |
| starter kit | The scaffold a project begins from: `api`, `api-monorepo`, `inertia-react`, or the package starter kit. |
| preload file | A file in `start/` listed under `preloads` in `adonisrc.ts`, imported while the application boots. |
| service provider | A class in `providers/` with `register`, `boot`, `start`, `ready` and `shutdown` hooks. |
| container service | A ready-made singleton imported from a package's `services` path, such as `@adonisjs/core/services/router`. |
| container binding | A value registered in the IoC container under a name or a class. |
| IoC container | The object that constructs classes and supplies their dependencies. |
| config provider | The lazy value a package's `defineConfig` returns, resolved once the application has booted. |
| barrel file | A generated index under `.adonisjs/server`, imported through `#generated/*`. |
| codegen | The step that writes `.adonisjs/`; run with `node ace codegen`. |
| assembler hook | A build-time callback registered under `hooks` in `adonisrc.ts`. |
| HTTP context | The per-request object, `ctx`, of type `HttpContext`. |
| route handler | The controller method or function a route runs. |
| action | A controller method that handles a route. |
| server, router and named middleware | The three middleware stacks registered in `start/kernel.ts`. |
| validator | A compiled VineJS schema exported from `app/validators`. |
| payload | The validated data `request.validateUsing` returns. |
| transformer | A class in `app/transformers` that turns backend data into the JSON sent to the client. |
| exception | A thrown, HTTP-aware error the exception handler turns into a response. |
| exception handler | The class in `app/exceptions/handler.ts`. |
| guard | An authentication method configured in `config/auth.ts`, such as `web` or `api`. |
| ability, policy | Bouncer's function and class for an authorization check. |
| model, schema class | A class in `app/models`, and the generated class it extends from `database/schema.ts`. |
| mixin | A function that adds behaviour to a class, applied with `compose`. |
| migration, seeder, factory | A schema change, a script that inserts data, and a generator of model rows for tests. |
| model query builder, database query builder | `Model.query()`, and `db.from()` or `trx.from()`. |
| transaction client | The object `db.transaction` gives; named `trx`. |
| Ace command | A class in `commands/` run with `node ace`. |
| event, listener | A class in `app/events`, and a class in `app/listeners` with a `handle` method. |
| suite, group | A set of test files with its own timeout, and a `test.group` inside one file. |
| registry | The generated route map the typed API client reads. |
| configure hook | A package's `configure` function, run by `node ace configure <package>`. |
| stub | A template file a package or command writes into an application. |
| codemods | The API a configure hook uses to edit an application's source files. |

Words most often misused: **guard** (an authentication guard, not any check), **policy** (a
Bouncer class, not any rule set), **exception** (not "error" or "refusal" for a thrown HTTP-aware
class), **factory** and **seeder** (the Lucid concepts, not any test fixture), **service** (a class
in `app/services` or a container service, not any module), **command** (an Ace command), **login**
and **logout** (the framework's words for starting and ending a session).

## Names

- **NAM-1 (F)** Files and folders are `snake_case`. The official ESLint preset enforces it with
  `@unicorn/filename-case`.
- **NAM-2 (F)** Classes and types are PascalCase. Interfaces have no `I` prefix. Variables and
  functions are camelCase; constants may be UPPER_CASE.
- **NAM-3 (F)** A file holds one class and exports it as the generator does: a default export for a
  controller, model, middleware, exception, event, listener, mail, policy, transformer, provider,
  seeder and command; a named export for a service (`export class AvatarService`). Validators,
  factories, config helpers and errors are named exports.
- **NAM-4 (F)** Create a file with its generator (`node ace make:*`), so the name, suffix and folder
  are the framework's.

## Imports and modules

- **IMP-1 (F)** ES modules only: `"type": "module"`, `import`, top-level `await`.
- **IMP-2 (F)** Import a type with `import type`, or the inline form `import { type X }`.
- **IMP-3 (F)** Use the `node:` prefix for Node built-ins.
- **IMP-4 (F)** In an application, import across folders through the `#` subpath aliases declared
  under `imports` in `package.json`. Do not write relative imports.
- **IMP-5 (F)** In a package, a static import is a relative path that ends in `.ts`; a lazy
  `import()` of a built module ends in `.js`. Packages declare no `#` aliases, as the official
  packages do not.
- **IMP-6 (F)** Import a container service from its `services` path. Do not construct what a package
  already provides.

## Lint, format and TypeScript

- **TOOL-1 (F)** ESLint starts from `@adonisjs/eslint-config`: `configApp()` in an application,
  `configPkg()` in a package. Add rules; do not remove the preset's.
- **TOOL-2 (F)** Prettier starts from `@adonisjs/prettier-config`: single quotes, 100 columns, ES5
  trailing commas, `arrowParens: always`, `quoteProps: consistent`, no semicolons.
- **TOOL-3 (F)** `tsconfig.json` extends `@adonisjs/tsconfig/tsconfig.app.json` in an application
  and `@adonisjs/tsconfig/tsconfig.package.json` in a package.
- **TOOL-4 (H)** Node is version 24 or later, declared under `engines`. The framework requires it;
  the package starter kit declares it.
- **TOOL-5 (F)** Script names are the starter kit's: `dev`, `build`, `start`, `test`, `lint`,
  `format`, `typecheck`, plus `codegen` in a monorepo backend and `compile`, `quick:test` and
  `release` in a package.
- **TOOL-6 (H)** The repository root has `.editorconfig`, `.gitignore`, `.prettierignore`,
  `README.md` and `LICENSE.md`. The kits ship the first four.
- **TOOL-7 (P)** Return early. Check each condition that ends the work at the top of the function;
  do not wrap the main logic in an `if`.
- **TOOL-8 (H)** Private state in a class is a `#field` or `#method`. Use `protected` only for a
  member a subclass or the framework reads.

---

# Part 2: applications

## Layout

```
.adonisjs/        generated barrel files and client types
app/
  abilities/      Bouncer abilities (main.ts)
  controllers/    route handlers
  events/         event classes
  exceptions/     the exception handler and custom exceptions
  listeners/      event listeners
  mails/          mail classes
  middleware/     one class per file
  models/         one model per table
  policies/       Bouncer policies
  services/       business logic
  transformers/   response shapes
  validators/     VineJS validators
bin/              console.ts, server.ts, test.ts
commands/         Ace commands
config/           one file per package
database/         migrations/, seeders/, factories/, schema.ts, schema_rules.ts
providers/        service providers
start/            env.ts and the preload files
tests/            bootstrap.ts, unit/, functional/
ace.js            never edited
adonisrc.ts       the application manifest
```

- **LAY-1 (F)** A new kind of file goes in the framework's folder for it. Create the folder when the
  first file needs it and add its `#` alias in the same change.
- **LAY-2 (F)** A framework folder holds only its own kind of file. `app/models` holds models.
  `start/` holds `env.ts` and files imported while the application boots.
- **LAY-3 (H)** No catch-all folders (`utils/`, `helpers/`, `lib/`) under `app/`. Group by domain
  inside a framework folder: `app/services/billing/`.
- **LAY-4 (F)** `.adonisjs/` and `database/schema.ts` are generated. Never edit them. Regenerate
  with `node ace codegen` and with a migration run.
- **LAY-5 (F)** `ace.js` is not modified. Code that must run before Ace goes in `bin/console.ts`.
- **LAY-6 (F)** In a monorepo the backend is `apps/backend` and the frontend `apps/frontend`. The
  frontend imports only what the backend exports: `./registry` and `./data`.

The alias set, from the `api-monorepo` kit:

```json
"imports": {
  "#controllers/*": "./app/controllers/*.js",
  "#exceptions/*": "./app/exceptions/*.js",
  "#models/*": "./app/models/*.js",
  "#mails/*": "./app/mails/*.js",
  "#services/*": "./app/services/*.js",
  "#listeners/*": "./app/listeners/*.js",
  "#events/*": "./app/events/*.js",
  "#generated/*": "./.adonisjs/server/*.js",
  "#middleware/*": "./app/middleware/*.js",
  "#transformers/*": "./app/transformers/*.js",
  "#validators/*": "./app/validators/*.js",
  "#providers/*": "./providers/*.js",
  "#policies/*": "./app/policies/*.js",
  "#abilities/*": "./app/abilities/*.js",
  "#database/*": "./database/*.js",
  "#tests/*": "./tests/*.js",
  "#start/*": "./start/*.js",
  "#config/*": "./config/*.js"
}
```

## File and class names

| Kind | File | Export | Example |
| --- | --- | --- | --- |
| Controller | `app/controllers/<plural>_controller.ts` | `<Plural>Controller` | `posts_controller.ts`, `PostsController` |
| Controller for one thing | `app/controllers/<singular>_controller.ts` | `<Singular>Controller` | `profile_controller.ts`, `new_account_controller.ts` |
| Single action controller | `app/controllers/<operation>_controller.ts` | `<Operation>Controller` with one `handle` | `register_newsletter_subscription_controller.ts` |
| Model | `app/models/<singular>.ts` | `<Singular>` | `post.ts`, `Post`, table `posts` |
| Middleware | `app/middleware/<name>_middleware.ts` | `<Name>Middleware` | `auth_middleware.ts` |
| Validator | `app/validators/<singular resource>.ts` | named, ends in `Validator` | `user.ts`, `signupValidator` |
| Transformer | `app/transformers/<singular>_transformer.ts` | `<Singular>Transformer` | `user_transformer.ts` |
| Exception | `app/exceptions/<name>_exception.ts` | `<Name>Exception` | `payment_failed_exception.ts` |
| Service | `app/services/<name>_service.ts` | named `<Name>Service` | `avatar_service.ts` |
| Policy | `app/policies/<singular>_policy.ts` | `<Singular>Policy` | `post_policy.ts` |
| Event | `app/events/<what happened or is happening>.ts` | same, PascalCase | `user_registered.ts`, `UserRegistered`; `mail_sending.ts` |
| Listener | `app/listeners/<imperative>.ts` | `<Imperative>` | `send_verification_email.ts` |
| Mail | `app/mails/<name>_notification.ts` (the `make:mail` default; `--intent` changes the suffix) | `<Name>Notification` | `verify_email_notification.ts` |
| Provider | `providers/<name>_provider.ts` | `<Name>Provider` | `app_provider.ts`, `AppProvider` |
| Preload file | `start/<name>.ts` | none, or the object it builds | `start/kernel.ts`, `start/validator.ts` |
| Ace command | `commands/<name>.ts` | `<Name>` | `greet.ts`, `Greet`, `greet` |
| Migration | `database/migrations/<epoch ms>_<name>.ts` | anonymous class | `1761885935168_create_users_table.ts` |
| Seeder | `database/seeders/<name>_seeder.ts` | `<Name>Seeder` | `user_seeder.ts`, `UserSeeder` |
| Factory | `database/factories/<model>_factory.ts` | named `<Model>Factory` | `user_factory.ts` |
| Test | `tests/<suite>/<path>/<subject>.spec.ts` | none | `tests/functional/posts/create.spec.ts` |

- **NAM-5 (F)** `make:controller` pluralizes the name. Pass `--singular` for a controller over one
  thing.
- **NAM-6 (H)** A namespaced command's file mirrors its whole name: `app:reset` lives in
  `commands/app_reset.ts` and exports `AppReset`.

## Configuration and environment

- **CFG-1 (F)** Every environment variable is declared and validated in `start/env.ts`. A secret
  uses `Env.schema.secret()`.
- **CFG-2 (F)** Only `config/` files read the `env` service. Controllers, middleware, services and
  models read configuration, never `env` and never `process.env`.
- **CFG-3 (F)** Ask the application for its state with `app.inProduction`, `app.inDev` and
  `app.inTest`. Do not compare `NODE_ENV`.
- **CFG-4 (F)** A `config/` file imports `env`, framework helpers and the package's `defineConfig`,
  and default-exports the result. It does not import application code.
- **CFG-5 (F)** A config file that defines a named list (mailers, hash drivers, limiter stores,
  guards) carries the `declare module` block that types it.
- **CFG-6 (F)** `adonisrc.ts` is environment-agnostic: no `process.env`, no logic. `providers`,
  `preloads` and `commands` are lazy imports. A provider or preload that belongs to some
  environments says so with `{ file, environment }`.
- **CFG-7 (F)** Resolve paths with `app.makePath()`, `app.publicPath()`, `app.tmpPath()` and
  `app.configPath()`.
- **CFG-8 (F)** `.env.example` lists every variable with a placeholder, never a real secret. Values
  for tests are in `.env.test`.
- **CFG-9 (H)** A product's own variables share one prefix (`MYAPP_`). Framework variables keep the
  framework's names (`APP_KEY`, `PORT`, `HOST`, `LOG_LEVEL`).
- **CFG-10 (F)** Add a variable with `node ace env:add`, which writes `.env`, `.env.example` and the
  `start/env.ts` validation together.
- **CFG-11 (F)** `adonisrc.ts` keeps `indexEntities(...)` and, for a typed client,
  `generateRegistry()` in `hooks.init`.

Recipe, `start/env.ts` (kit, shortened):

```ts
import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),
  DB_DATABASE: Env.schema.string(),
})
```

## Routes

- **RTE-1 (F)** A routes file only maps: path, controller action, middleware, name.
- **RTE-2 (F)** A route points at a controller through the barrel file:
  `[controllers.Posts, 'index']`, with `import { controllers } from '#generated/controllers'`. A
  static controller import in a routes file breaks hot reload and is a lint error
  (`@adonisjs/prefer-lazy-controller-import`).
- **RTE-3 (F)** A route with a controller is named by the framework: `<controller_snake>.<method>`
  (`posts.index`), prefixed by any group `.as()` (`auth.new_account.store`); a single action
  controller is named `<controller_snake>` alone. Name a route by hand only when it has no
  controller.
- **RTE-4 (F)** A shared path prefix, middleware or name prefix goes on a `router.group()` with
  `.prefix()`, `.use()` and `.as()`. Do not repeat it on every route.
- **RTE-5 (F)** Attach middleware with `.use(middleware.name(options))`, importing `middleware`
  from `#start/kernel`.
- **RTE-6 (F)** Use `router.resource()` for a resource with the standard actions, and `.apiOnly()`
  for an API.
- **RTE-7 (F)** The verb says what the route does: `GET` reads, `POST` creates or acts, `PUT`
  replaces, `PATCH` changes part, `DELETE` removes.
- **RTE-8 (F)** Constrain a route parameter with `.where()` or `router.matchers`.
- **RTE-9 (H)** An API is versioned in the outer group's prefix: `/api/v1`.
- **RTE-10 (H)** When `start/routes.ts` grows past one screen, split it by area into
  `start/routes/<area>.ts` files that `start/routes.ts` imports. Each stays a plain route file.

Recipe, `start/routes.ts` (kit):

```ts
import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'

router
  .group(() => {
    router
      .group(() => {
        router.post('signup', [controllers.NewAccount, 'store'])
        router.post('login', [controllers.AccessTokens, 'store'])
      })
      .prefix('auth')
      .as('auth')

    router
      .group(() => {
        router.get('profile', [controllers.Profile, 'show'])
        router.post('logout', [controllers.AccessTokens, 'destroy'])
      })
      .prefix('account')
      .as('profile')
      .use(middleware.auth())
  })
  .prefix('/api/v1')
```

## Controllers

- **CTL-1 (F)** A controller maps HTTP to the application: validate, do the work or call a service,
  return the result.
- **CTL-2 (F)** One controller per resource. Its actions are the resourceful names: `index`,
  `show`, `store`, `update`, `destroy` (and `create` and `edit` when it renders forms).
- **CTL-3 (F)** An operation that is not one of those becomes its own controller: a noun controller
  with a resourceful action (the kit: sign-up is `NewAccountController.store`, login and logout are
  `AccessTokensController.store` and `.destroy`), or a single action controller with one `handle`
  method, made with `node ace make:controller <name> handle --singular` (the documentation). Do not
  grow a controller into a list of verbs.
- **CTL-4 (F)** An action destructures what it uses from the HTTP context:
  `async store({ request, serialize }: HttpContext)`.
- **CTL-5 (P)** A controller has no `private` or `protected` method. A step two actions share moves
  to a service or the model.
- **CTL-6 (F)** A controller does not wrap its work in `try`/`catch` to build an error response. It
  lets the exception reach the exception handler.
- **CTL-7 (F)** Return a value, or use the response helper that names the status:
  `response.created()`, `response.notFound()`, `response.forbidden()`.
- **CTL-8 (F)** A dependency comes through the constructor with `@inject()`, or as an action
  argument with `@inject()` on the action.
- **CTL-9 (H)** Business rules that a command, a listener or a second controller also needs live in
  a service, not in the action.
- **CTL-10 (F)** Create a resource controller with `node ace make:controller <name> --resource` (or
  `--api`), and its validators with `node ace make:validator <name> --resource`.

Recipe, a controller (kit):

```ts
import User from '#models/user'
import { signupValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import UserTransformer from '#transformers/user_transformer'

export default class NewAccountController {
  async store({ request, serialize }: HttpContext) {
    const { fullName, email, password } = await request.validateUsing(signupValidator)

    const user = await User.create({ fullName, email, password })
    const token = await User.accessTokens.create(user)

    return serialize({
      user: UserTransformer.transform(user),
      token: token.value!.release(),
    })
  }
}
```

## Validators

- **VAL-1 (F)** A validator is `vine.create({ ... })`, exported by name from
  `app/validators/<resource>.ts`. One file holds every validator for its resource.
- **VAL-2 (F)** The export ends in `Validator` and says what it validates: `signupValidator`,
  `createPostValidator`, `updatePostValidator`.
- **VAL-3 (H)** A validator's name is unique across the application.
- **VAL-4 (H)** Validate with `request.validateUsing(validator)` as the first step of the action.
  Nothing reads `request.body()`, `request.all()`, `request.qs()`, `request.input()`,
  `request.only()` or `request.except()` unvalidated. The framework allows it; we do not.
- **VAL-5 (F)** When an action uses route parameters, headers or cookies, they are validated in the
  same validator, under its `params`, `headers` and `cookies` keys.
- **VAL-6 (F)** Do not wrap `validateUsing` in `try`/`catch`. Use `request.tryValidateUsing` when
  the action must handle the failure itself.
- **VAL-7 (F)** Database rules (`unique`, `exists`) belong in the validator.
- **VAL-8 (F)** Global VineJS setup (messages, custom rules) is in the `start/validator.ts` preload
  file.
- **VAL-9 (F)** Small helpers that build a shared field sit at the top of the validator file.
- **VAL-10 (F)** A rule that depends on the request, such as unique-except-self, takes the value
  through `withMetaData<T>()` and `validateUsing(validator, { meta })`.

Recipe, `app/validators/user.ts` (kit):

```ts
import vine from '@vinejs/vine'

const email = () => vine.string().email().maxLength(254)
const password = () => vine.string().minLength(8).maxLength(32)

export const signupValidator = vine.create({
  fullName: vine.string().nullable(),
  email: email().unique({ table: 'users', column: 'email' }),
  password: password(),
  passwordConfirmation: password().sameAs('password'),
})

export const loginValidator = vine.create({
  email: email(),
  password: vine.string(),
})
```

## Middleware

- **MID-1 (F)** `start/kernel.ts` registers three stacks, each with lazy imports: server middleware
  (every request, including one with no route), router middleware (every request that matches a
  route) and named middleware (only routes that ask for it), exported as `middleware`.
- **MID-2 (F)** Body parsing, session, Shield and `initialize_auth` are router middleware. CORS,
  forced JSON and container bindings are server middleware.
- **MID-3 (F)** A middleware is a class with `handle(ctx, next, options?)`. Code before
  `await next()` runs on the way in; code after it runs on the way out.
- **MID-4 (F)** A middleware refuses by throwing an exception, or by sending a response and not
  calling `next`.
- **MID-5 (F)** What a route requires is named middleware on that route or its group. Router
  middleware does not branch on the route's name or path.
- **MID-6 (F)** A middleware that adds a property to `HttpContext` carries the
  `declare module '@adonisjs/core/http'` block in the same file.

Recipes (kit; the kernel omits the kit's `silent_auth_middleware`):

```ts
// start/kernel.ts
import router from '@adonisjs/core/services/router'
import server from '@adonisjs/core/services/server'

server.errorHandler(() => import('#exceptions/handler'))

server.use([
  () => import('#middleware/force_json_response_middleware'),
  () => import('#middleware/container_bindings_middleware'),
  () => import('@adonisjs/cors/cors_middleware'),
])

router.use([
  () => import('@adonisjs/core/bodyparser_middleware'),
  () => import('@adonisjs/session/session_middleware'),
  () => import('@adonisjs/shield/shield_middleware'),
  () => import('@adonisjs/auth/initialize_auth_middleware'),
])

export const middleware = router.named({
  auth: () => import('#middleware/auth_middleware'),
})
```

```ts
// app/middleware/auth_middleware.ts
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'

export default class AuthMiddleware {
  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: { guards?: (keyof Authenticators)[] } = {}
  ) {
    await ctx.auth.authenticateUsing(options.guards)
    return next()
  }
}
```

## Exceptions

- **EXC-1 (F)** `app/exceptions/handler.ts` holds one `HttpExceptionHandler` that extends
  `ExceptionHandler`, registered with `server.errorHandler` in `start/kernel.ts`.
- **EXC-2 (F)** `handle` turns an exception into a response; `report` logs it and never sends one.
  `handle` falls through to `super.handle` for anything it does not answer itself. A custom `report`
  calls `super.report`, or checks `this.shouldReport(...)` first.
- **EXC-3 (F)** Debug output is on outside production: `protected debug = !app.inProduction`.
- **EXC-4 (F)** Expected errors are kept out of the log with `ignoreCodes` and `ignoreStatuses`.
- **EXC-5 (F)** A custom exception extends `Exception` from `@adonisjs/core/exceptions`, lives in
  `app/exceptions/<name>_exception.ts`, and sets `static status`. It sets `static code` when a
  client or a handler matches on it.
- **EXC-6 (H)** An exception that needs its own response or log line implements `handle` and
  `report` on itself (framework option). We prefer that to an `instanceof` branch per exception in
  the handler.
- **EXC-7 (F)** Exception codes are `E_UPPER_SNAKE`.
- **EXC-8 (F)** Recognise a framework error with `instanceof` on its package's `errors` export
  (`errors.E_VALIDATION_ERROR`, `errors.E_ROUTE_NOT_FOUND`), never by its message.
- **EXC-9 (H)** Application code throws exceptions, never a bare `Error`, for anything a client can
  cause.
- **EXC-10 (H)** One exception class per cause. `static status`, `static code` and, when the
  sentence never varies, `static message` say what it is. No constructor takes a status or a code;
  it takes only what the message or the response needs (an id, a detail sentence, `{ cause }`). The
  framework's packages are written this way (PKG-31).

Recipes:

```ts
// app/exceptions/handler.ts (kit)
import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'

export default class HttpExceptionHandler extends ExceptionHandler {
  protected debug = !app.inProduction

  async handle(error: unknown, ctx: HttpContext) {
    return super.handle(error, ctx)
  }

  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
```

```ts
// app/exceptions/payment_failed_exception.ts (adapted from the documentation)
import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'

export default class PaymentFailedException extends Exception {
  static status = 400
  static code = 'E_PAYMENT_FAILED'

  async handle(error: this, { response }: HttpContext) {
    response.status(error.status).send({ errors: [{ code: error.code, message: error.message }] })
  }
}
```

```ts
// The throw site names the cause. The class supplies the status, the code and the message.
export default class StaleRevisionException extends Exception {
  static status = 409
  static code = 'E_STALE_REVISION'
  static message = 'The record changed since it was read.'
}

throw new StaleRevisionException()
```

## Responses and transformers

- **RES-1 (H)** Never return a Lucid model from an action. Return a transformer result or a plain
  object. The framework recommends transformers; we require them.
- **RES-2 (F)** A transformer extends `BaseTransformer<T>` and implements `toObject()`. Pick fields
  with `this.pick(this.resource, [...])`.
- **RES-3 (F)** A transformer runs no query. Load relationships with `preload()` first.
- **RES-4 (F)** An API answers with `serialize(Transformer.transform(model))`, which wraps the
  result in `{ data }`. The `serialize` helper is added to the HTTP context by
  `providers/api_provider.ts`, as in the kit.
- **RES-5 (F)** A paginated list is `serialize(Transformer.paginate(...))`, so the metadata has the
  framework's shape.
- **RES-6 (F)** A transformer shapes output. Input is described by a validator.
- **RES-7 (H)** Wire field names are camelCase; columns are `snake_case`.
- **RES-8 (F)** A second shape for the same model is a transformer variant: a `for<Purpose>()`
  method chosen with `.useVariant()`. It is not a second transformer class.
- **RES-9 (F)** An answer that must not be wrapped uses `serialize.withoutWrapping(...)`.

Recipe (kit, shortened):

```ts
import type User from '#models/user'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class UserTransformer extends BaseTransformer<User> {
  toObject() {
    return this.pick(this.resource, ['id', 'fullName', 'email', 'createdAt', 'updatedAt'])
  }
}
```

## Models and the database

- **MOD-1 (F)** One model per table, singular PascalCase, in `app/models/<singular>.ts`. The table
  is the plural `snake_case` name; set `static table` only when it is not.
- **MOD-2 (F)** A model extends its generated schema class from `#database/schema`. The model
  carries relationships, hooks, scopes, computed getters and behaviour. It re-declares a generated
  column only to refine that one column: `serializeAs`, `prepare` or `consume`, or a narrower type.
- **MOD-3 (F)** Change a generated type that applies across tables in `database/schema_rules.ts`.
- **MOD-4 (F)** Add shared behaviour with a mixin applied through `compose`:
  `class User extends compose(UserSchema, withAuthFinder(hash))`.
- **MOD-5 (F)** Columns are `snake_case`; model properties are camelCase. A foreign key is the
  singular model name plus `_id`. Timestamps are `created_at` and `updated_at`.
- **MOD-6 (F)** Hide a column from output by re-declaring it with `@column({ serializeAs: null })`.
- **MOD-7 (H)** Declare a relationship with the related model as a function (`() => Post`), and
  declare both sides.
- **MOD-8 (F)** A hook is a static method with its decorator. A filter that must cover every read
  is on both `beforeFind` and `beforeFetch`. Hooks do not run for bulk `update` and `delete`.
- **MOD-9 (F)** A query scope is a static property made with `scope()`.
- **MOD-10 (F)** A key the application generates needs `static selfAssignPrimaryKey = true`.
- **MOD-11 (F)** Avoid native database enums. Store a short string and narrow its type.

**Queries and transactions**

- **DB-1 (F)** Read and write through the model. Use the database query builder for what a model
  cannot express.
- **DB-2 (F)** Prefer the managed transaction, `db.transaction(async (trx) => { ... })`, which
  commits on return and rolls back on a throw.
- **DB-3 (F)** Inside a transaction every query carries the client: `Model.query({ client: trx })`,
  `Model.create(data, { client: trx })` or `model.useTransaction(trx)`.
- **DB-4 (F)** Bind values in `db.rawQuery`. Never build SQL from input.
- **DB-5 (H)** Network calls, mail and password hashing stay outside a transaction.

**Migrations, seeders and factories**

- **DB-6 (F)** A migration extends `BaseSchema`, sets `protected tableName`, has `up()` and
  `down()`, and makes one reviewable change. Its file is named by `node ace make:migration`.
- **DB-7 (F)** A released migration is never edited. A fix is a new migration.
- **DB-8 (F)** Data changes go in `this.defer()`.
- **DB-9 (H)** A foreign key is declared with `.references().inTable()` and an explicit
  `.onDelete()`.
- **DB-10 (H)** Production does not roll back: `disableRollbacksInProduction: true` in
  `config/database.ts`. The framework offers it as an option.
- **DB-11 (F)** A seeder is a default-exported `<Name>Seeder` that extends `BaseSeeder`. One that
  holds development or test data limits itself with `static environment`. A model factory lives in
  `database/factories`.

Recipes (kit; the model omits its access-token lines):

```ts
// app/models/user.ts
import { UserSchema } from '#database/schema'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'

export default class User extends compose(UserSchema, withAuthFinder(hash)) {
  get initials() {
    const [first, last] = this.fullName ? this.fullName.split(' ') : this.email.split('@')
    return first && last ? `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() : first.slice(0, 2).toUpperCase()
  }
}
```

```ts
// database/migrations/1761885935168_create_users_table.ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('full_name').nullable()
      table.string('email', 254).notNullable().unique()
      table.string('password').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
```

## Services, providers and the container

- **SVC-1 (F)** Business logic that more than one entry point needs lives in a class in
  `app/services/<name>_service.ts`, created with `node ace make:service`, which writes a named
  export.
- **SVC-2 (F)** A service is taken through the constructor with `@inject()`. The container builds
  it; nothing calls `new` on it.
- **SVC-3 (F)** A service does not read the HTTP context unless it is injected with it. Prefer
  passing the values it needs.
- **SVC-4 (F)** Replace a service in a test with the test context's `swap(Service, fake)`, which
  restores itself.
- **SVC-5 (P)** Behaviour is a class method. A file does not export loose top-level functions; an
  exported function only builds and returns an instance.
- **SVC-6 (F)** Write a provider only for container bindings, framework extensions (macros,
  `HttpContext` properties), or work that starts and stops with the application. One-off setup is
  a preload file.
- **SVC-7 (F)** In a provider: `register` only binds and is synchronous; `boot` configures.
  `register`, `boot` and `start` also run in console, test and tooling runs, and preload files are
  imported after `start`, so nothing there connects, listens or spawns. Long-running work starts in
  `ready` and stops in `shutdown`.
- **SVC-8 (F)** Application code logs through the logger, not `console`.

Recipe (documentation, shortened):

```ts
// app/services/avatar_service.ts
export class AvatarService {
  getAvatarFor(email: string) {
    /* ... */
  }
}
```

```ts
// app/controllers/users_controller.ts
import { inject } from '@adonisjs/core'
import { AvatarService } from '#services/avatar_service'

@inject()
export default class UsersController {
  constructor(protected avatarService: AvatarService) {}

  async store({ request }: HttpContext) {
    /* this.avatarService.getAvatarFor(...) */
  }
}
```

## Authentication and authorization

- **AUT-1 (F)** Guards are defined in `config/auth.ts`. The session guard is named `web`; the
  access-token guard is `api`.
- **AUT-2 (F)** The `User` model composes `withAuthFinder(hash)`. Credentials are checked with
  `User.verifyCredentials(email, password)`, which resists timing attacks.
- **AUT-3 (F)** A route is protected by the named `auth` middleware:
  `.use(middleware.auth())` or `.use(middleware.auth({ guards: ['api'] }))`.
- **AUT-4 (F)** An action reads the user with `auth.getUserOrFail()` behind the `auth` middleware,
  and `auth.user` where a user is optional.
- **AUT-5 (F)** Authorization is Bouncer: an ability in `app/abilities/main.ts` for a simple check,
  a policy in `app/policies/<model>_policy.ts` for checks about one model.
- **AUT-6 (F)** A policy has one method per action, even when two have the same body.
- **AUT-7 (F)** An action authorizes with `bouncer.with(PostPolicy).authorize('edit', post)`, or
  `.denies()` when it answers itself.
- **AUT-8 (F)** Hash with the `hash` service; encrypt with the `encryption` service. No custom
  hashing.
- **AUT-9 (H)** The server authorizes every request itself. A hidden button is not authorization.

Recipe (documentation):

```ts
// app/policies/post_policy.ts
import User from '#models/user'
import Post from '#models/post'
import { BasePolicy } from '@adonisjs/bouncer'
import type { AuthorizerResponse } from '@adonisjs/bouncer/types'

export default class PostPolicy extends BasePolicy {
  edit(user: User, post: Post): AuthorizerResponse {
    return user.id === post.userId
  }

  delete(user: User, post: Post): AuthorizerResponse {
    return user.id === post.userId
  }
}
```

## Security

- **SEC-1 (F)** A rate limit is a named throttle defined in `start/limiter.ts` with
  `limiter.define` and applied to routes with `.use(throttle)`.
- **SEC-2 (F)** A 429 keeps the limiter's `X-RateLimit-*` and `Retry-After` headers.
- **SEC-3 (F)** `config/cors.ts` lists real origins. Never pair `credentials: true` with a wildcard
  origin.
- **SEC-4 (F)** `config/shield.ts` carries CSRF, CSP, HSTS, frame and content-type settings. A
  server-rendered or session application keeps CSRF protection on.
- **SEC-5 (F)** `APP_KEY` is a secret, generated with `node ace generate:key`, never committed.
- **SEC-6 (H)** Bearers (reset tokens, invitation tokens, session ids) are never logged.

Recipe (documentation):

```ts
// start/limiter.ts
import limiter from '@adonisjs/limiter/services/main'

export const throttle = limiter.define('global', () => {
  return limiter.allowRequests(10).every('1 minute')
})
```

## Logging, mail, events and health checks

- **OPS-1 (F)** Inside a request, log with `ctx.logger`, so the line carries the request id. Use
  the logger service outside a request.
- **OPS-2 (F)** Log an error under the `err` key. Hide sensitive values with the logger's `redact`
  option.
- **OPS-3 (F)** A mail is a class in `app/mails`, created with `node ace make:mail`.
- **OPS-4 (F)** An event is a class in `app/events` that extends `BaseEvent` and only carries data.
  It is dispatched with `events.UserRegistered.dispatch(user)`.
- **OPS-5 (F)** A listener is a class in `app/listeners` with a `handle` method. Listeners are
  attached in the `start/events.ts` preload file, through the `#generated/events` and
  `#generated/listeners` barrel files.
- **OPS-6 (F)** Health checks are registered in `start/health.ts` as `healthChecks`. A
  `HealthChecksController` serves `/health/live` and `/health/ready`. A custom check extends
  `BaseCheck` and its name ends in `Check`.
- **OPS-7 (F)** Listeners are referenced lazily through the barrel file; a static listener import in
  `start/events.ts` is a lint error (`@adonisjs/prefer-lazy-listener-import`).

Recipes (documentation):

```ts
// app/events/user_registered.ts
import { BaseEvent } from '@adonisjs/core/events'
import User from '#models/user'

export default class UserRegistered extends BaseEvent {
  constructor(public user: User) {
    super()
  }
}
```

```ts
// start/events.ts
import emitter from '@adonisjs/core/services/emitter'
import { events } from '#generated/events'
import { listeners } from '#generated/listeners'

emitter.on(events.UserRegistered, [listeners.SendVerificationEmail])
```

```ts
// app/controllers/health_checks_controller.ts
import { healthChecks } from '#start/health'
import type { HttpContext } from '@adonisjs/core/http'

export default class HealthChecksController {
  async live({ response }: HttpContext) {
    return response.ok()
  }

  async ready({ response }: HttpContext) {
    const report = await healthChecks.run()
    if (report.isHealthy) {
      return response.ok(report)
    }
    return response.serviceUnavailable(report)
  }
}
```

## Ace commands

- **CMD-1 (F)** A command is a default-exported class in `commands/` that extends `BaseCommand` and
  sets `static commandName` and `static description`.
- **CMD-2 (F)** A grouped command is named `namespace:action`.
- **CMD-3 (F)** A command that touches models or services sets
  `static options = { startApp: true }`.
- **CMD-4 (F)** Inputs are declared with `@args` and `@flags`, each with a description.
- **CMD-5 (F)** Output goes through `this.logger` and `this.ui`, not `console`.
- **CMD-6 (F)** A command does not catch an error only to report it. The error reaches Ace, which
  sets `this.error` and `this.exitCode = 1`; `completed()` logs one safe line and returns `true`
  so Ace does not print the raw error.
- **CMD-7 (H)** A command calls the same service a controller would. It holds no business rule of
  its own.
- **CMD-8 (F)** A file in `commands/` that is not a command starts with `_`.

## Tests

- **TST-1 (F)** Tests run on Japa. Suites are declared in `adonisrc.ts`: `unit` and `functional`,
  plus `browser` when there are browser tests.
- **TST-2 (F)** A test file is `<subject>.spec.ts`, in a folder that mirrors what it tests.
- **TST-3 (F)** `tests/bootstrap.ts` exports `plugins`, `runnerHooks` and `configureSuite`, and is
  the only place plugins are registered.
- **TST-4 (F)** Related tests sit in a `test.group`. State is reset in a group hook:
  `group.each.setup(() => testUtils.db().wrapInGlobalTransaction())`, or `truncate()`.
- **TST-5 (H)** An API test calls a route by its name: `client.visit('posts.store')`. The framework
  also allows a URL; we use the name.
- **TST-6 (F)** An API test signs in with `.loginAs(user)`, with `.withGuard('api')` before it for a
  guard that is not the default.
- **TST-7 (F)** Rows are asserted with the `dbAssertions` plugin: `db.assertHas`,
  `db.assertMissing`, `db.assertCount`.
- **TST-8 (H)** Test rows come from model factories.
- **TST-9 (F)** Fake what leaves the process, with the forms that restore themselves: `using fake =
  mail.fake()` and the test context's `swap`. The database is real.
- **TST-10 (F)** A command is tested with `ace.create(Command, args)`, `command.exec()` and
  `command.assertSucceeded()`.
- **TST-11 (P)** A test file contains tests only. Reusable code is in `tests/helpers/`.
- **TST-12 (P)** No `let` or `var` is shared across tests at file scope. A test creates what it
  needs, or a group hook does.
- **TST-13 (P)** Every `getByText('...')` call given a string passes `exact: true` or `exact: false`. A role locator or a `filter` call needs none.
- **TST-14 (H)** A test title is a lowercase sentence that says what happens. A group title is a
  noun phrase.
- **TST-15 (F)** `.env.test` sets `SESSION_DRIVER=memory`, so `loginAs` and `withSession` work in
  API tests.

Recipe (adapted from the documentation; the route name assumes no group prefix):

```ts
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

test.group('New account', (group) => {
  group.each.setup(() => testUtils.db().wrapInGlobalTransaction())

  test('rejects a sign-up without an email', async ({ client }) => {
    const response = await client.visit('new_account.store').json({ password: 'secret-pass' })
    response.assertStatus(422)
  })
})
```

## The frontend API client

- **API-1 (F)** The backend generates the registry with `generateRegistry()` in the `init` hook of
  `adonisrc.ts`, and exports `./registry` and `./data` from its `package.json`.
- **API-2 (F)** The frontend creates one Tuyau client and calls a route by its name. It does not
  write a URL by hand.
- **API-3 (F)** Request and response types come from the registry. Do not restate them.
- **API-4 (F)** With TanStack Query, a read is `useQuery(api.<route>.queryOptions(...))` and a
  write is `useMutation(api.<route>.mutationOptions(...))`.

---

# Part 3: packages

A package is anything published for an AdonisJS application to install. It starts from
[`adonisjs/pkg-starter-kit`](https://github.com/adonisjs/pkg-starter-kit) and reads like an
official `@adonisjs/*` package.

## Layout

```
bin/test.ts        Japa entry point
commands/          Ace commands the package ships
factories/         test factories the package exports for its consumers
providers/         <name>_provider.ts
services/main.ts   the container service
src/               the implementation
  define_config.ts
  errors.ts
  debug.ts
  types.ts
stubs/             main.ts and the .stub templates
tests/             *.spec.ts
configure.ts       the configure hook
index.ts           the entry point
```

- **PKG-1 (F)** The implementation is in `src/`. The repository root holds only `index.ts`,
  `configure.ts` and configuration.
- **PKG-2 (F)** Create only the folders the package needs. A package with no container binding has
  no `providers/` and no `services/`.
- **PKG-3 (F)** A static import is a relative path that ends in `.ts`; a lazy `import()` ends in
  `.js` (IMP-5).

## Name and manifest

- **PKG-4 (H)** The npm name is `@kevinjohn/adonisjs-<name>`; the repository is
  `oss-adonisjs-<name>`. The name says what the package does in the framework's vocabulary.
- **PKG-5 (F)** `"type": "module"`, `engines.node >= 24`, `"files": ["build", "!build/bin",
  "!build/tests"]`, and an `exports` map.
- **PKG-6 (F)** `@adonisjs/core` and every other framework package the code imports
  (`@adonisjs/lucid`, `@adonisjs/session`, `@adonisjs/assembler`) is a `peerDependency`, and a
  `devDependency` for the package's own tests. Optional ones are marked in
  `peerDependenciesMeta`.
- **PKG-7 (F)** A peer range names the major: `^7.0.0`. Do not pin a peer to an exact version.
- **PKG-8 (F)** The package builds with `tsdown` plus `tsc --emitDeclarationOnly --declaration`, and
  copies `stubs/**/*.stub` into `build` with `copyfiles --up=1`, as the official packages do.
- **PKG-9 (F)** `publishConfig` sets `access: public` and `provenance: true`.

## The export map

The subpaths are the framework's. An application developer guesses them without reading the
README.

| Subpath | File | Holds |
| --- | --- | --- |
| `.` | `index.ts` | `configure`, `stubsRoot`, `defineConfig`, `errors`, the public classes |
| `./types` | `src/types.ts` | every public type |
| `./<name>_provider` | `providers/<name>_provider.ts` | the service provider |
| `./services/main` | `services/main.ts` | the container service |
| `./<name>_middleware` | `src/<name>_middleware.ts` | a middleware the application registers |
| `./commands` | `build/commands/main.js`, generated | the package's Ace commands |
| `./plugins/<tool>` | `src/plugins/...` | Japa or Edge plugins (`./plugins/api_client`) |
| `./factories` | `factories/main.ts` | factories for the consumer's tests |
| `./mixins/<name>` | `src/mixins/...` | model mixins |

- **PKG-10 (F)** Nothing outside the export map is importable. A consumer never imports from
  `build/src/...`.
- **PKG-11 (F)** Public types live in `src/types.ts`, exported from `./types`; the file may re-export from other type files. Lists the application extends (`LimitersList`) are interfaces there, augmented from the application's config file. Types that need an optional peer dependency are exported from `./types/<name>` instead, as `@adonisjs/auth` exports `./types/session`.
- **PKG-12 (H)** The export map is public API. Removing or renaming a subpath is a breaking change.

Recipe, `index.ts` (`@adonisjs/limiter`, shortened):

```ts
export * as errors from './src/errors.ts'
export { configure } from './configure.ts'
export { Limiter } from './src/limiter.ts'
export { stubsRoot } from './stubs/main.ts'
export { LimiterManager } from './src/limiter_manager.ts'
export { defineConfig, stores } from './src/define_config.ts'
```

## The configure hook and stubs

- **PKG-13 (F)** A package that needs anything in the application (a config file, a provider, a
  middleware, an environment variable, a migration) ships a `configure` function, so
  `node ace add <package>` sets it up. The README does not ask for manual edits the hook could
  make.
- **PKG-14 (F)** The hook changes the application only through codemods: `makeUsingStub`,
  `updateRcFile` (`addProvider`, `addCommand`, `addPreloadFile`), `registerMiddleware`,
  `defineEnvVariables`, `defineEnvValidations`, `registerJapaPlugin`, `registerPolicies`.
  `@adonisjs/assembler` is an optional peer dependency because the codemods need it.
- **PKG-15 (H)** The hook is safe to run twice.
- **PKG-16 (F)** Choices come from a flag first, then a prompt: `command.parsedFlags.store`, else `command.prompt.choice(...)`. An invalid choice sets `command.exitCode = 1`, logs through `command.logger` and returns. With no flag and no terminal to prompt on, the hook does the same and names the missing flag.
- **PKG-17 (F)** Templates are `.stub` files under `stubs/`, in folders that mirror where they
  land: `stubs/config/<name>.stub`, `stubs/start/<name>.stub`, `stubs/make/migration/<name>.stub`.
  Each stub states its destination with `exports({ to: app.configPath('<name>.ts') })`.
- **PKG-18 (F)** `stubs/main.ts` exports `stubsRoot = import.meta.dirname`.
- **PKG-19 (F)** A stub writes code the application owns afterwards, in this book's application
  style: `env` read in the config file, `defineConfig`, the `declare module` block.

Recipe, `configure.ts` (`@adonisjs/limiter`, shortened):

```ts
import type Configure from '@adonisjs/core/commands/configure'
import { stubsRoot } from './stubs/main.ts'

const KNOWN_STORES = ['database', 'redis']

export async function configure(command: Configure) {
  let selectedStore: string | undefined = command.parsedFlags.store
  if (!selectedStore) {
    selectedStore = await command.prompt.choice('Select the storage layer you want to use', KNOWN_STORES)
  }
  if (!KNOWN_STORES.includes(selectedStore!)) {
    command.exitCode = 1
    command.logger.logError(`Invalid limiter store "${selectedStore}"`)
    return
  }

  const codemods = await command.createCodemods()

  await codemods.makeUsingStub(stubsRoot, 'config/limiter.stub', { store: selectedStore })
  await codemods.makeUsingStub(stubsRoot, 'start/limiter.stub', {})

  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('@adonisjs/limiter/limiter_provider')
  })

  await codemods.defineEnvVariables({ LIMITER_STORE: selectedStore! })
  await codemods.defineEnvValidations({
    leadingComment: 'Variables for configuring the limiter package',
    variables: { LIMITER_STORE: `Env.schema.enum(['${selectedStore}', 'memory'] as const)` },
  })
}
```

## Configuration

- **PKG-20 (F)** The application configures the package in `config/<name>.ts`, with the package's
  `defineConfig`.
- **PKG-21 (F)** `defineConfig` validates its input and throws `InvalidArgumentsException` or
  `RuntimeException` from `@adonisjs/core/exceptions`, with a message that names the package's
  config and the key.
- **PKG-22 (F)** When configuration needs the booted application or a lazily imported driver,
  `defineConfig` returns a config provider (`configProvider.create`), and the service provider
  resolves it with `configProvider.resolve`.
- **PKG-23 (F)** The code a package ships (`src/`, `providers/`, `services/`, `commands/`) never reads `process.env` or the `env` service. The application's config file does. The repository's own `bin/` scripts are not shipped and may read `process.env`.
- **PKG-24 (F)** Environment variables a package introduces are UPPER_SNAKE with the package's
  name first: `LIMITER_STORE`, `SESSION_DRIVER`.

## Provider and container service

- **PKG-25 (F)** The provider is `providers/<name>_provider.ts`, default-exporting
  `<Name>Provider` with `constructor(protected app: ApplicationService) {}`.
- **PKG-26 (F)** `register` binds a singleton: under a dotted name (`'<name>.manager'`) when the
  application imports it as a container service, otherwise by class. A named binding is added to
  `ContainerBindings` with `declare module '@adonisjs/core/types'` in the same file.
- **PKG-27 (F)** The binding is lazy: configuration is read and the object built inside the
  singleton callback, not in `register` itself.
- **PKG-28 (F)** Events the package emits are typed in `EventsList` in the same block and named
  `<namespace>:<event>` (`session:initiated`, `limit:exceeded`).
- **PKG-29 (F)** A named binding has a `services/main.ts` that resolves it after boot and
  default-exports it, so the application writes `import limiter from
  '@adonisjs/limiter/services/main'`.
- **PKG-30 (F)** A property a middleware sets on `HttpContext` is typed in that middleware's file (MID-6), as `@adonisjs/session` does. Macros, getters and Edge plugins the provider registers have their type augmentation in the provider file. A Japa plugin is exported from `./plugins/<tool>` for the application to register in `tests/bootstrap.ts`.

Recipes (`@adonisjs/limiter`; the provider omits its `EventsList` line):

```ts
// providers/limiter_provider.ts
import { configProvider } from '@adonisjs/core'
import { type ApplicationService } from '@adonisjs/core/types'
import { RuntimeException } from '@adonisjs/core/exceptions'
import { LimiterManager } from '../index.ts'
import type { LimiterService } from '../src/types.ts'

declare module '@adonisjs/core/types' {
  export interface ContainerBindings {
    'limiter.manager': LimiterService
  }
}

export default class LimiterProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton('limiter.manager', async () => {
      const limiterConfigProvider = this.app.config.get('limiter', {})
      const config = await configProvider.resolve<any>(this.app, limiterConfigProvider)

      if (!config) {
        throw new RuntimeException(
          'Invalid "config/limiter.ts" file. Make sure you are using the "defineConfig" method'
        )
      }

      const emitter = await this.app.container.make('emitter')
      return new LimiterManager(config, emitter)
    })
  }
}
```

```ts
// services/main.ts
import app from '@adonisjs/core/services/app'
import { type LimiterService } from '../src/types.ts'

let limiter: LimiterService

await app.booted(async () => {
  limiter = await app.container.make('limiter.manager')
})

export { limiter as default }
```

## Errors, logging and style

- **PKG-31 (F)** Every exception the package throws is defined in `src/errors.ts`, one class per
  cause: `<Cause>Exception extends Exception`, with `static code = 'E_<CODE>'` and `static status`.
  Each distinct cause has its own raw code, including distinct failures previously thrown by one
  class. A cause is the rule or contract that failed; a different field, value, message or route alone is not a different cause.
  A subclass that answers with its parent's response keeps its parent's code and is still exported
  under its own `E_<CODE>` name.
  The file exports each class under its code, `export const E_<CODE> = <Cause>Exception`, and
  `index.ts` exports the file as the `errors` namespace: `import { errors } from '<package>'`.
  `@adonisjs/limiter` pairs `ThrottleException` with `E_TOO_MANY_REQUESTS` and `@adonisjs/bouncer`
  pairs `AuthorizationException` with `E_AUTHORIZATION_FAILURE`.
- **PKG-32 (F)** The code is stable. The package throws by it, `throw new E_<CODE>()`, and an
  application recognises it with `instanceof errors.E_<CODE>` or by `code`, never by message.
  A wire code may cover multiple raw codes only to prevent enumeration or conceal configuration
  details. Each such mapping has a one-line comment naming what it protects. Existing clients
  alone do not justify a collapse; update the consuming application instead.
- **PKG-46 (H)** No exported exception constructor takes a status or a code, including through
  an inherited constructor. Declare a constructor where necessary to narrow that signature. It
  takes only what the message or response needs (an id, a name, a detail sentence, `{ cause }`);
  code and status are static on the class, and a sentence that never varies is `static message`.
  Enforce this through the constructor signature, without runtime mutation guards. An application
  changes its own response status in its exception handler, not through a package option. A
  package does not use `createError`, so every exception has one shape.
- **PKG-47 (F)** A package never throws a bare `Error`. Wrong configuration or wrong use by the
  application's developer throws `InvalidArgumentsException` or `RuntimeException` from
  `@adonisjs/core/exceptions` (PKG-21); everything else is a class in `src/errors.ts`.
- **PKG-33 (F)** An exception whose response needs more than its status, code and message (a header, a redirect, a different body) implements `handle` on itself, so the application's handler needs no special case. Every other exception is left for the framework to render.
- **PKG-34 (F)** Diagnostics use `debuglog('<scope>:<name>')` from `node:util` in `src/debug.ts`. A package does not write to `console`. It logs through the application's logger only when the application's configuration passes a logger or selects a reporting mode that says so.
- **PKG-35 (F)** State, I/O and anything that takes a dependency is a class. An exported function is one of: `defineConfig`; `configure`; a factory that returns an instance or a config provider; a decorator; a mixin; a plugin for Edge, Japa or the assembler; or a pure function, which takes every input as an argument, awaits nothing and reads no module-level variable.
- **PKG-36 (F)** A middleware the package ships is a class with `handle(ctx, next, options?)`, exported from its own subpath. A function that returns middleware builds on that class. The configure hook registers the middleware, except one that must run after the application's own authentication middleware: the README tells the application where to mount that one.
- **PKG-37 (F)** A command the package ships is a file in `commands/`. The build writes
  `build/commands/main.js` with `adonis-kit index build/commands`, exported as `./commands` and
  registered with `rcFile.addCommand('<package>/commands')`.
- **PKG-38 (H)** A package does not import from an application and makes no assumption about its
  folder names beyond the framework's.
- **PKG-48 (H)** Everything an application calls from the export map has an `@example` in its
  TSDoc: each exported function, class, decorator and mixin, and each public method on an exported
  class or service. The example is the application's code, fenced as `ts`. A top-level export's
  example starts with its import from the public subpath; a method's starts from the instance. One
  example is enough; a second is for a second way to call it. Types, exception classes and what
  the framework calls instead of the application (the configure hook, the provider, commands, a
  middleware's `handle`, a controller's actions) need none.

Recipe, `src/errors.ts` and a throw site:

```ts
import { Exception } from '@adonisjs/core/exceptions'

export class BackupLockedException extends Exception {
  static code = 'E_BACKUP_LOCKED'
  static status = 500

  constructor(directory: string, options?: ErrorOptions) {
    super(`backup directory ${directory} is locked`, { cause: options?.cause })
  }
}

export class BackupDisabledException extends Exception {
  static code = 'E_BACKUP_DISABLED'
  static status = 500
  static message = 'backups are disabled'

  constructor() {
    super()
  }
}

export const E_BACKUP_LOCKED = BackupLockedException
export const E_BACKUP_DISABLED = BackupDisabledException
```

```ts
import { E_BACKUP_LOCKED } from './errors.ts'

throw new E_BACKUP_LOCKED(directory, { cause })
```

Recipe, an `@example` on a top-level export and on a method (PKG-48):

````ts
/**
 * Composes a Lucid model with the soft-delete lifecycle: `delete()` marks the row, and reads
 * leave marked rows out.
 *
 * @example
 * ```ts
 * import { compose } from '@adonisjs/core/helpers'
 * import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete'
 *
 * export default class Client extends compose(ClientSchema, SoftDeletes) {}
 * ```
 */
export function SoftDeletes<T extends NormalizeConstructor<typeof BaseModel>>(superclass: T) {
````

````ts
export class SqliteBackup {
  /**
   * Copies the live database into a new bundle and publishes it once it verifies.
   *
   * @throws `E_BACKUP_LOCKED` when another backup holds the directory; nothing was published.
   *
   * @example
   * ```ts
   * const bundle = await backup.create()
   * logger.info({ name: bundle.name, bytes: bundle.manifest.bytes }, 'backup created')
   * ```
   */
  create(): Promise<CreateResult> {
````

The first example carries its import because the reader has not imported anything yet. The second
starts from `backup`; the class's own `@example` shows the import from `services/main` that produces
it.

### Compound failures

**PKG-49 (H)** Native `AggregateError` is the exception to PKG-31's one-class-per-cause rule and PKG-47's `src/errors.ts` rule in two cases only: the work fails and its cleanup fails too, or the work succeeds and more than one cleanup step fails. `errors[0]` is the work's failure, or the first cleanup failure when the work succeeded; later failures follow in the order observed. An `AggregateError` received from another layer is passed on unchanged. Every function that throws one or passes one on documents it in `@throws`. Never use it for an expected 4xx outcome or a case on which a caller needs to branch; use a package exception class for that case instead.

## Tests and release

- **PKG-39 (F)** Tests run on Japa through `bin/test.ts`, in `tests/**/*.spec.ts`. Shared test code is in `tests/helpers.ts`, or in files under `tests/helpers/`.
- **PKG-40 (F)** The configure hook has a test (`tests/configure.spec.ts`) that runs it against a
  scratch application with `@japa/file-system` and asserts the files it wrote.
- **PKG-41 (F)** The provider has a test that boots an application with it and resolves the
  binding.
- **PKG-42 (F)** Public types are tested with `@japa/expect-type` where inference matters.
- **PKG-43 (H)** Coverage is collected with `c8`, as the package starter kit sets up.
- **PKG-44 (H)** Versions follow semver. Each release has a changelog entry and a git tag
  `v<version>`.
- **PKG-45 (H)** The README has, in this order: what it does, `node ace add <package>`, what the
  configure hook changed, configuration, usage, errors, and the supported AdonisJS versions.

---

# Part 4: decisions to agree

The draft takes the framework's side by default. These are the places where we either already
differ or must choose. Each has a recommendation. A decision leaves this table once it is agreed;
the answer is recorded in the repository's departures list.

| Id | Question | Framework | Recommendation |
| --- | --- | --- | --- |
| D4 | API response envelope | `serialize(...)` wraps in `{ data }`. | Adopt for new APIs (RES-4). An existing wire contract records a departure. |
| D7 | Package manager | Kits ship npm scripts and work with any manager. | pnpm everywhere; scripts written so they do not name the manager. |
| D8 | Authentication in applications that use Account Kit | `@adonisjs/auth` guards, `withAuthFinder`, `loginAs`. | Account Kit is itself an AdonisJS package, so it should expose the framework's surface (guards, `auth.user`, a `loginAs`-style test plugin) rather than each application recording a departure. Audit it against Part 3 first. |
| D9 | Authorization in applications that use Access Control | Bouncer abilities and policies called from the controller. | Same as D8: the package should present Bouncer's vocabulary (`ability`, `policy`, `authorize`), and the application calls it from the controller. |
| D10 | Which AdonisJS Plus rules are binding | Published as optional lint rules. | Binding: CTL-5, TST-11, TST-12, TST-13, TOOL-7, SVC-5. |

---

# Part 5: review checklists

## Application

1. Every new file is in the framework's folder for its kind, with the framework's name and suffix,
   created by its generator (LAY-1, NAM-4).
2. No relative import crosses a folder; no controller is imported statically into a routes file
   (IMP-4, RTE-2).
3. `env` and `process.env` are read only in `config/` and `start/env.ts`; no config file imports
   application code (CFG-2, CFG-4).
4. Each action destructures the context, validates first with `validateUsing`, and returns a
   transformer result (CTL-4, VAL-4, RES-1).
5. No `try`/`catch` in a controller builds an error response; no controller has a private method
   (CTL-5, CTL-6).
6. A new operation is a resourceful action on a noun controller, not a new verb (CTL-3).
7. Thrown errors are `Exception` subclasses in `app/exceptions`, one per cause, with a static
   status and code (EXC-5, EXC-10).
8. Route requirements are named middleware on the route or its group (MID-5).
9. A model extends its schema class; a query inside a transaction carries the client (MOD-2, DB-3).
10. A new migration has `up()` and `down()`; no released migration changed (DB-6, DB-7).
11. Tests call routes by name, hold no shared mutable state and contain only tests
    (TST-5, TST-11, TST-12).
12. Framework words are used for framework concepts and for nothing else (VOC-1, VOC-3).
13. Any difference from this book is in the repository's departures list.

## Package

1. The layout is the package starter kit's; the implementation is in `src/` (PKG-1).
2. The export map uses the framework's subpaths, and nothing else is imported by consumers
   (PKG-10).
3. Framework packages are caret peer dependencies (PKG-6, PKG-7).
4. `node ace add` leaves a working install: config file, provider, middleware, environment
   variables and validations, migration (PKG-13, PKG-14).
5. The package reads no environment variable itself (PKG-23).
6. The provider binds lazily, types its binding, and has a matching `services/main.ts`
   (PKG-26, PKG-27, PKG-29).
7. Every thrown exception is a class in `src/errors.ts`, one per cause, exported and thrown under
   its stable code; no constructor takes a status or a code (PKG-31, PKG-32, PKG-46, PKG-47).
8. No `console` output; diagnostics use `debuglog` (PKG-34).
9. Everything an application calls from the export map has an `@example` (PKG-48).
10. Public types are in `src/types.ts` and exported from `./types` (PKG-11).
11. The configure hook and the provider each have a test (PKG-40, PKG-41).
12. The README follows PKG-45, and its vocabulary is the framework's (VOC-1).
13. Any difference from this book is in the repository's departures list.
