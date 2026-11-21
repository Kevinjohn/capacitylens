---
title: AdonisJS conventions
description: The AdonisJS 7 layout, naming, vocabulary and per-layer rules that the CapacityLens backend follows, and where it deliberately differs.
---

# AdonisJS conventions

This page is the standard for how `apps/backend` is laid out and written as an AdonisJS 7
application. It is for contributors and reviewers. Someone who knows AdonisJS should find every
file where the framework puts it, named as the framework names it and called what the framework
calls it.

The rules come from what the AdonisJS project publishes:

- the [AdonisJS documentation](https://docs.adonisjs.com) and the
  [Lucid documentation](https://lucid.adonisjs.com);
- the official starter kits, chiefly `api-monorepo`, in
  [`adonisjs/starter-kits`](https://github.com/adonisjs/starter-kits);
- the `@adonisjs/eslint-config`, `@adonisjs/eslint-plugin` and `@adonisjs/prettier-config`
  presets;
- the lint rules that [AdonisJS Plus](https://plus.adonisjs.com) publishes for application code.

Three rules decide every case:

1. **Follow the framework.** When this page is silent, the AdonisJS documentation decides.
2. **A deliberate difference is a numbered departure.** The list is "AdonisJS framework
   departures" in
   [`DECISIONS.md`](https://github.com/Kevinjohn/capacitylens/blob/main/DECISIONS.md). This page
   cites it as "departure 10". A new difference needs a new item there first.
3. **An existing difference is debt.** Code that differs without a departure is tracked in
   [#2334](https://github.com/Kevinjohn/capacitylens/issues/2334). It is not a pattern to copy.
   Rules marked **Open** wait for a decision in that issue; until then, match the surrounding
   code.

The rules that apply to every AdonisJS repository, applications and packages alike, are in the
[AdonisJS cookbook](./adonisjs-cookbook.md), and the
[pre-PR checklist](./adonisjs-checklist.md) turns each one into a check. This page says how
CapacityLens stands against them.

Names, errors, comments and TSDoc inside a file are in [Code standards](./code-standards.md).
Where each product capability lives is in [Architecture](./architecture.md).

## Vocabulary

Use the framework's word for a framework concept, in code, comments, commit messages and
documentation. Write "AdonisJS", never "Adonis". Package names keep their own spelling: Lucid,
VineJS, Japa, Tuyau, Ace, Edge.

| Term | Meaning |
| --- | --- |
| starter kit | The scaffold an application begins from. CapacityLens has the shape of the API monorepo kit. |
| preload file | A file in `start/` listed under `preloads` in `adonisrc.ts` and imported while the application boots. |
| service provider | A class in `providers/` with `register`, `boot`, `start`, `ready` and `shutdown` hooks. |
| container service | A ready-made singleton imported from a package, such as `@adonisjs/core/services/router`. |
| IoC container | The object that constructs classes and supplies their dependencies. |
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
| exception | A thrown error the exception handler turns into a response. |
| exception handler | The class in `app/exceptions/handler.ts`. |
| guard | An authentication method configured in `config/auth.ts`, such as `web`. |
| ability, policy | Bouncer's function and class for an authorization check. |
| model, schema class | A class in `app/models`, and the generated class it extends from `database/schema.ts`. |
| migration, seeder, factory | A schema change, a script that inserts data, and a generator of model rows for tests. |
| model query builder, database query builder | `Model.query()`, and `db.from()` or `trx.from()`. |
| transaction client | The object `db.transaction` gives; named `trx`. |
| Ace command | A class in `commands/` run with `node ace`. |
| suite, group | A set of test files with its own timeout, and a `test.group` inside one file. |
| registry | The generated route map the typed API client reads. |

Some of these words are taken. Do not use them for anything else in new code:

- **guard** is an authentication guard. A reusable set of route middleware is not a guard.
- **policy** and **ability** belong to Bouncer. CapacityLens has none of its own (departure 11),
  so no new file is named `*_policy.ts`.
- **exception** is the framework's word for a thrown, HTTP-aware error.
- **factory** and **seeder** name the Lucid concepts. Test data built by helpers is a fixture.
- **resource** in a transformer is `this.resource`, the item being transformed. In the product it
  is a scheduled person. Say which one a sentence means.
- **account** is a person's identity in Account Kit. The `accounts` table stores companies. Say
  "company" for the tenant and "user" for the person.

Product words with no framework equivalent keep their meaning: company, member, actor,
view-as-member, area (the grouping of route files).

## Layout

```
apps/backend/
  .adonisjs/        generated barrel files and client types, committed
  app/
    controllers/    route handlers
    exceptions/     the exception handler and custom exceptions
    middleware/     one class per file
    models/         one model per table
    services/       business logic
    transformers/   response shapes
    validators/     VineJS validators
  bin/              console.ts, server.ts, test.ts
  commands/         Ace commands
  config/           one file per package
  database/         migrations/, seeders/, schema.ts, schema_rules.ts
  providers/        service providers
  start/            env.ts, the preload files and the area route files
  tests/            bootstrap.ts, unit/, functional/, helpers/, types/
  ace.js            never edited
  adonisrc.ts       the application manifest
```

- Create every file with its generator, so the name, suffix and folder are the framework's:
  `node ace make:controller`, `make:middleware`, `make:validator`, `make:model`, `make:migration`,
  `make:service`, `make:exception`, `make:transformer`, `make:provider`, `make:preload`,
  `make:command`, `make:test`.
- A new kind of file goes in the framework's folder for it: `app/mails`, `app/events`,
  `app/listeners`, `app/policies`, `app/abilities`, `database/factories`. Add its `#` alias to
  `package.json` in the same change.
- Do not add catch-all folders such as `utils/`, `helpers/` or `lib/` under `app/`. Group by
  domain inside a framework folder (`app/services/planning/`).
- A framework folder holds only its own kind of file. `app/models` holds models and
  `app/validators` holds validators. `start/` holds files imported while the application boots:
  `env.ts`, the preload files listed in `adonisrc.ts` and the area route files. It holds no
  helper modules.
- `.adonisjs/` and `database/schema.ts` are generated and committed. Never edit them by hand.
  Regenerate `.adonisjs/` with `node ace codegen`, and `database/schema.ts` with
  `node ace schema:generate` or a migration run.
- `ace.js` is not modified. Code that must run before Ace goes in `bin/console.ts`.
- The frontend imports only generated code from the backend: the route registry through
  `./registry` and transformer types through `./data`. It never imports backend source. The
  shared package is departure 1.

## File and class names

Backend files are `snake_case`; `@unicorn/filename-case` enforces it. Each file default-exports
one class unless the table says otherwise.

| Kind | File | Export | Example |
| --- | --- | --- | --- |
| Controller | `app/controllers/<plural>_controller.ts` | `<Plural>Controller` | `members_controller.ts`, `MembersController` |
| Single action controller | `app/controllers/<operation>_controller.ts` | class with one `handle` method | `register_newsletter_subscription_controller.ts` |
| Model | `app/models/<singular>.ts` | `<Singular>` | `project.ts`, `Project`, table `projects` |
| Middleware | `app/middleware/<name>_middleware.ts` | `<Name>Middleware` | `company_scope_middleware.ts` |
| Validator | `app/validators/<singular resource>.ts` | named `<verb><Resource>Validator` | `createMemberValidator` |
| Transformer | `app/transformers/<singular>_transformer.ts` | `<Singular>Transformer` | `user_transformer.ts` |
| Exception | `app/exceptions/<name>_exception.ts` | `<Name>Exception` | `stale_revision_exception.ts` |
| Service | `app/services/<name>_service.ts` | `<Name>Service` | function modules with no `_service` suffix (departure 10) |
| Provider | `providers/<name>_provider.ts` | `<Name>Provider` | `backup_provider.ts` |
| Preload file | `start/<name>.ts` | none; imported for its effect | `start/validator.ts` |
| Ace command | `commands/<namespace>_<action>.ts` | `<NamespaceAction>` | `app_reset.ts`, `app:reset` |
| Migration | `database/migrations/<timestamp>_<name>.ts` | anonymous class | `..._create_posts_table.ts` |
| Seeder | `database/seeders/<name>_seeder.ts` | anonymous class | `main_seeder.ts` |
| Factory | `database/factories/<model>_factory.ts` | named `const <Model>Factory = Factory.define(...)` | |
| Test | `tests/<suite>/<path>/<subject>.spec.ts` | none | `tests/functional/auth/recovery.spec.ts` |

- `make:controller` pluralizes the name. Pass `--singular` for a single action controller or a
  resource there is one of.
- A command's file name mirrors its whole command name, and no two command files export a class
  of the same name.
- Types and classes are PascalCase, interfaces have no `I` prefix, and variables are camelCase,
  UPPER_CASE or PascalCase. The preset enforces this.
- Method names the framework calls (`handle`, `run`, `up`, `down`, `toObject` and the provider
  hooks) are exempt from the verb rules in [Code standards](./code-standards.md).

## Imports

- Import across folders through the `#` subpath aliases in `apps/backend/package.json`:
  `#controllers/*`, `#models/*`, `#services/*`, `#middleware/*`, `#validators/*`,
  `#transformers/*`, `#exceptions/*`, `#generated/*`, `#database/*`, `#config/*`, `#start/*`,
  `#providers/*`, `#tests/*`. Do not write relative imports in application code.
- Import a type with `import type`.
- Use `node:` for Node built-ins and ES modules only.
- Import a container service from its `services` path (`@adonisjs/core/services/app`,
  `@adonisjs/limiter/services/main`). Do not construct what a package already provides. A service
  that serves a request takes its transaction as an argument and does not import
  `@adonisjs/lucid/services/db` (departure 10).
- Routes import controllers through the barrel file, `import { controllers } from
  '#generated/controllers'`. A static controller import in a routes file breaks hot reload and is
  a lint error (`@adonisjs/prefer-lazy-controller-import`).

## Configuration and environment

Source: the Configuration and Folder structure pages of the AdonisJS start guide, and the
[`adonisrc.ts` reference](https://docs.adonisjs.com/reference/adonisrc-rcfile).

- Every environment variable is declared and validated in `start/env.ts` with `Env.schema`. A
  secret uses `Env.schema.secret()`.
- Only `config/` files read the `env` service. Controllers, middleware and services read
  configuration, never `env` and never `process.env`.
- Ask the application for its state with `app.inProduction`, `app.inDev` and `app.inTest`. Do not
  compare `NODE_ENV`.
- A `config/` file imports framework utilities and `env`, and exports a configuration object made
  with the package's `defineConfig`. It does not import application code: that fails at startup
  when the import needs a booted application.
- A config file that defines a named list (hash drivers, mailers, limiter stores, loggers, guards)
  also carries the `declare module` block that types it.
- `adonisrc.ts` stays free of environment checks and application logic. `providers`, `preloads`
  and `commands` are lazy imports, in the starter kit's order. **Open:** #2334 item 14.
- Resolve paths with `app.makePath()`, `app.publicPath()` and `app.tmpPath()`.
- `.env.example` lists every variable with a placeholder value. Values for tests belong in
  `.env.test`; `bin/test.ts` keeps only the values computed per port lane or that must override the shell.
- Product variables use the `CAPACITYLENS_` prefix (departure 5). Framework packages are pinned to
  exact versions (departure 16).

## Routes

Source: [Routing](https://docs.adonisjs.com/guides/basics/routing) and
[URL builder](https://docs.adonisjs.com/guides/basics/url-builder).

- Routes only map: path, controller action, middleware and name.
- A route points at a controller as `[controllers.Members, 'index']`.
- A route with a controller is named by the framework as `controller.method`
  (`members.index`). Name a route by hand only when it has no controller. **Open:** #2334 item 9.
- Put a shared prefix, middleware or name prefix on a `router.group()` with `.prefix()`, `.use()`
  and `.as()`. Do not repeat the prefix on every path.
- Attach middleware with `.use(middleware.name(options))`, importing `middleware` from
  `#start/kernel`.
- Use `router.resource()` for a resource with the standard actions, with `.apiOnly()` for an API.
  Planning edits use one mutation route instead (departure 13).
- Use the verb for what the route does: `GET` reads, `POST` creates or acts, `PUT` replaces,
  `PATCH` changes part, `DELETE` removes.
- Constrain a route parameter with `.where()` or `router.matchers`.
- An unmatched request raises `E_ROUTE_NOT_FOUND`, and the exception handler answers it.
- Routes are registered from one file per area in `start/` (departure 18). An area file exports
  one `register<Area>Routes()` function that `start/routes.ts` calls.
- The backend serves the SPA with a history fallback route (departure 6). Apart from that
  fallback, a routes file holds no logic.

## Controllers

Source: [Controllers](https://docs.adonisjs.com/guides/basics/controllers) and
[HTTP context](https://docs.adonisjs.com/guides/basics/http-context).

- A controller maps HTTP to the application: validate, call one service, return the result. It
  holds no business rule, so a command or another controller can reach the same behaviour.
- One controller per resource. Its actions are the resourceful names where they fit: `index`,
  `show`, `store`, `update`, `destroy` (and `create` and `edit` when it renders forms).
- An operation that is not one of those becomes its own controller, named for the thing it acts
  on and using a resourceful action (the starter kit's `NewAccountController.store`), or a single
  action controller with one `handle` method. Do not grow a controller into a list of verbs.
  **Open:** #2334 item 4.
- An action takes the HTTP context first and destructures only what it uses:
  `async store({ request, response }: HttpContext)`. **Open:** #2334 item 4.
- A controller has no `private` or `protected` methods. A step two actions share moves to a
  service or a model.
- A controller does not wrap its work in `try`/`catch` to build an error response. It lets the
  exception reach the exception handler.
- Return a value, or use the response helpers that name the status: `response.created()`,
  `response.notFound()`, `response.conflict()`.
- Controllers call function-module services, so they take nothing by `@inject` (departure 10), and
  they do not call Bouncer (departure 11).

## Validators

Source: [Validation](https://docs.adonisjs.com/guides/basics/validation).

- A validator is `vine.create({ ... })`, exported by name from `app/validators/<resource>.ts`. One
  file holds every validator for its resource.
- CapacityLens names a validator for its action and resource: `createMemberValidator`,
  `updateMemberValidator`, `listMembersValidator`. A name is unique across the application.
- Validate with `request.validateUsing(validator)` as the first step of the action. Nothing reads
  `request.body()`, `request.all()` or `request.qs()` unvalidated.
- CapacityLens passes the one request source a validator reads, `{ data: request.body() }` for a
  write and `{ data: request.qs() }` for a read, so the merged `request.all()` is never validated
  (departure 22).
- Validate route parameters, headers and cookies in the same validator, under its `params`,
  `headers` and `cookies` keys.
- Do not wrap `validateUsing` in `try`/`catch`. Use `request.tryValidateUsing` when the action
  must handle the failure itself.
- After validation the payload is trusted. Services do not validate shape again; they enforce
  rules that need the database.
- Global VineJS setup, such as shared messages, is in the `start/validator.ts` preload file.
- Small helpers that build a schema field may live beside the validators that use them.
- Validation failures use the product's flat error contract, and empty strings are not converted
  to `null` (departure 2).

## Middleware

Source: [Middleware](https://docs.adonisjs.com/guides/basics/middleware).

- `start/kernel.ts` registers three stacks, each with lazy imports:
  - **server middleware** runs for every request, including one with no route;
  - **router middleware** runs for every request that matches a route;
  - **named middleware**, exported as `middleware`, runs only on routes that ask for it.
- Authentication and the membership check for a route are named middleware on that route or its
  group. Router middleware does not decide what to do from the route's name. A company permission
  is authorized inside the transaction (departure 11).
- In the starter kit, body parsing, session, Shield and `initialize_auth` are router middleware.
  **Open:** #2334 item 10.
- A middleware is a class with `handle(ctx, next, options?)`. Code before `await next()` runs on
  the way in; code after it runs on the way out.
- A middleware refuses by throwing an exception or by sending a response and not calling `next`.
- Add a property to `HttpContext` only from server or router middleware, with the `declare module
  '@adonisjs/core/http'` block in the same file.
- The request logging middleware is first in the server stack.

## Exceptions

Source: [Exception handling](https://docs.adonisjs.com/guides/basics/exception-handling) and the
[exceptions reference](https://docs.adonisjs.com/reference/exceptions).

- `app/exceptions/handler.ts` holds one `HttpExceptionHandler` that extends `ExceptionHandler`.
  It is registered with `server.errorHandler` in `start/kernel.ts`.
- `handle` turns an exception into a response. `report` logs it and never sends a response.
  Expected errors are kept out of the log with `ignoreCodes` and `ignoreStatuses`.
- Recognise a known error with `instanceof` on its package's `errors` export, such as
  `errors.E_VALIDATION_ERROR` from `@vinejs/vine`, never by its message.
- A custom exception extends `Exception` from `@adonisjs/core/exceptions`, lives in
  `app/exceptions/<name>_exception.ts`, and sets `static status` and `static code`. A class whose
  status or code varies per throw passes them to the constructor instead:
  `super(message, { status, code })`.
- Framework exception codes are `E_UPPER_SNAKE`. Product codes on the wire are stable identifiers
  and keep their spelling.
- The handler shows debug output in development only (departure 19). Every error leaves in the
  flat error contract, and the handler does not call `super.handle` or `super.report`
  (departure 2).
- A 429 keeps the limiter's `X-RateLimit-*` and `Retry-After` headers. **Open:** #2334 item 11.

## Responses and transformers

Source: [Transformers](https://docs.adonisjs.com/guides/frontend/transformers).

- A transformer extends `BaseTransformer<T>` and implements `toObject()`. It runs no query:
  load relationships with `preload()` before transforming.
- Extra constructor arguments carry what the shape depends on, such as the reader's role.
- A transformer shapes output. It is never used to describe input; that is a validator.
- Never return a Lucid model from an action. Return a plain object or a transformer result.
- The framework's API response is `serialize(Transformer.transform(model))`, which wraps the
  result in `{ data }`, with `providers/api_provider.ts` supplying `serialize`. **Open:** #2334
  item 5.
- Columns are `snake_case`; the row transformer produces the camelCase wire format and the state
  transformer projects it for the reader's role (departure 4).

## Models and the database

Source: [Models](https://lucid.adonisjs.com/docs/models),
[schema classes](https://lucid.adonisjs.com/docs/schema-classes),
[hooks](https://lucid.adonisjs.com/docs/model-hooks),
[query scopes](https://lucid.adonisjs.com/docs/model-query-scopes),
[migrations](https://lucid.adonisjs.com/docs/migrations) and
[transactions](https://lucid.adonisjs.com/docs/transactions).

**Models**

- One model per table, singular PascalCase, in `app/models/<singular>.ts`. The table is the
  plural `snake_case` name; set `static table` only when it is not.
- A model extends its generated schema class, `class Project extends ProjectSchema`, imported from
  `#database/schema`. The model carries relationships, hooks, scopes and behaviour, not column
  declarations. **Open:** #2345 item 6.1 covers the `accounts` table.
- Change a generated type in `database/schema_rules.ts`. Redeclare a column on the model only for
  a one-model refinement or a custom `prepare` or `consume`.
- Hide a column from output with `serializeAs: null`.
- Columns are `snake_case` and model properties camelCase. A foreign key is the singular model
  name plus `_id`.
- A key the application generates needs `static selfAssignPrimaryKey = true`. Planning entities,
  companies and users have string keys (departure 14).
- Declare a relationship on the model with the related model as a function, `() => Project`, and
  declare both sides.
- A hook is a static method with its decorator. A filter that must cover every read is registered
  on both `beforeFind` and `beforeFetch`. Hooks do not run for bulk `update` and `delete`.
- A query scope is a static property made with `scope()` and applied with `withScopes`.
- Avoid native database enums. Store a short string and narrow its type with a schema rule.
- Product models fail closed without a tenant scope (departure 3).

**Queries and transactions**

- In the framework, reads and writes go through the model. Here, a planning table with a
  company-scoped model is read through that model; writes, eligibility checks inside a write,
  checks that must see other companies or soft-deleted rows, and tables without a model use the
  query builder on the caller's connection (departure 12).
- Inside a transaction, give every model query the client: `Model.query({ client: trx })`. A
  model write passes `{ client: trx }` or calls `model.useTransaction(trx)`.
- Prefer the managed form, `db.transaction(async (trx) => { ... })`, which commits on return and
  rolls back on a throw.
- Pass one `trx` through the whole unit of work. A mutating service takes it as an argument
  (departure 10). Network, mail and password hashing stay outside it (departure 7).
- Bind values in `db.rawQuery`. Never build SQL from input.

**Migrations, seeders and factories**

- A migration extends `BaseSchema`, has `up()` and `down()`, and makes one reviewable change. Its
  file is named by `node ace make:migration`.
- A released migration is never edited. A fix is a new migration.
- Put data changes in `this.defer()` and raw DDL in `this.schema.raw()`.
- Declare a foreign key with `.references().inTable()` and an explicit `.onDelete()`.
- Production never rolls back: set `disableRollbacksInProduction: true`. The single baseline
  migration has no `down()` (departure 21).
- A seeder extends `BaseSeeder`, lives in `database/seeders`, uses `this.client`, and limits itself
  with `static environment`.
- A model factory lives in `database/factories` and is made with `node ace make:factory`.

## Services, providers and the container

Source: [Dependency injection](https://docs.adonisjs.com/guides/concepts/dependency-injection),
[service providers](https://docs.adonisjs.com/guides/concepts/service-providers),
[container services](https://docs.adonisjs.com/guides/concepts/container-services) and
[application lifecycle](https://docs.adonisjs.com/guides/concepts/application-lifecycle).

- Business logic lives in `app/services`. A service does not read the HTTP context; the
  controller passes it the verified actor and the transaction.
- In the framework a service is a class the container constructs, taken with `@inject()` and
  replaced in a test with `container.swap`. CapacityLens services are modules of exported
  functions without `@inject`, and a package service is resolved with `app.container.make` where
  it is used. Service files carry no `_service` suffix (departure 10).
- Write a provider only for container bindings, framework extensions, or work that must start and
  stop with the application. One-off setup is a preload file.
- In a provider: `register` only binds and is synchronous; `boot` configures; `start` also runs
  during codegen, so anything that connects or spawns is guarded by `app.getMode()`; long-running
  work starts in `ready` and stops in `shutdown`.
- A provider logs through the logger service, not `console`.
- Private state in a class is a `#field`.
- Attach event listeners in a `start/events.ts` preload file.

## Authentication, authorization and security

Source: [Authentication](https://docs.adonisjs.com/guides/auth/introduction),
[authorization](https://docs.adonisjs.com/guides/auth/authorization),
[rate limiting](https://docs.adonisjs.com/guides/security/rate-limiting),
[CORS](https://docs.adonisjs.com/guides/security/cors),
[hashing](https://docs.adonisjs.com/guides/security/hashing) and
[encryption](https://docs.adonisjs.com/guides/security/encryption).

- Guards are defined in `config/auth.ts`. The session guard is named `web`.
- Protect a route with the named `auth` middleware: `.use(middleware.auth({ guards: ['web'] }))`.
  CapacityLens member routes use the `web_effective` guard (#2334 item 1).
- In the framework, an action reads the user with `auth.getUserOrFail()` and the `User` model
  composes `withAuthFinder`. In CapacityLens, Account Kit owns sign-in, sessions and credential
  checks, and an action receives the verified actor (departure 24, provisional).
- Authorization in the framework is a Bouncer ability in `app/abilities/main.ts` or a policy in
  `app/policies`, called from the controller. CapacityLens authorizes a company permission inside
  the product transaction through the Access Control package (departure 11).
- Hash with the `hash` service and encrypt with the `encryption` service. No custom hashing.
- A rate limit is a named throttle defined in `start/limiter.ts` with `limiter.define` and
  applied with `.use()`. **Open:** #2334 item 11.
- `config/cors.ts` lists real origins. Never pair `credentials: true` with a wildcard origin.
- `config/shield.ts` carries CSP, HSTS, frame and content-type settings. CSRF is the Origin and
  Sec-Fetch-Site check, not Shield's token (departure 8).

## Logging, mail, events and health checks

Source: [Logger](https://docs.adonisjs.com/guides/digging-deeper/logger),
[mail](https://docs.adonisjs.com/guides/digging-deeper/mail),
[emitter](https://docs.adonisjs.com/guides/digging-deeper/emitter) and
[health checks](https://docs.adonisjs.com/guides/digging-deeper/health-checks).

- Inside a request, log with `ctx.logger` so the line carries the request id. Use the logger
  service only outside a request.
- Log an error under the `err` key. Hide sensitive values with the logger's `redact` option.
- The request id is always generated by the server (departure 15).
- A mail is a class in `app/mails`. Account Kit sends every CapacityLens message, so the backend
  has none.
- An event is a class in `app/events` and a listener a class in `app/listeners` with a `handle`
  method. Listeners are imported lazily through `#generated/listeners`.
- Health checks are registered in `start/health.ts` as `healthChecks`. A `HealthChecksController`
  serves `/health/live` and `/health/ready`. A custom check extends `BaseCheck` and ends in
  `Check`.

## Ace commands

Source: [Creating commands](https://docs.adonisjs.com/guides/ace/creating-commands).

- A command is a default-exported class in `commands/` that extends `BaseCommand` and sets
  `static commandName` and `static description`.
- The name is `namespace:action`.
- A command that touches models or services sets `static options = { startApp: true }`.
- Declare inputs with `@args` and `@flags`, each with a description.
- A command that catches its own error sets `this.error` and `this.exitCode = 1`.
- Run another command with `this.kernel.exec`.
- A command calls the same service a controller would. It holds no business rule of its own.

## Tests

Source: [Testing](https://docs.adonisjs.com/guides/testing/introduction),
[API tests](https://docs.adonisjs.com/guides/testing/api-tests),
[resetting state](https://docs.adonisjs.com/guides/testing/resetting-state-between-tests) and
[test doubles](https://docs.adonisjs.com/guides/testing/test-doubles).

- Tests run on Japa. Suites are declared in `adonisrc.ts`: `unit` and `functional`. Browser tests
  of the SPA are Playwright specs in the repository's `e2e/` folder.
- A test file is `<subject>.spec.ts`, in a folder that mirrors the area it tests.
- A test file contains tests only. Reusable code goes in `tests/helpers/`, imported through
  `#tests/helpers/*`.
- Related tests sit in a `test.group` with a noun-phrase title. A test title is a lowercase
  sentence that says what happens.
- State a test needs is created inside the test or in a group hook. Do not share `let` variables
  across tests. A setup hook returns its cleanup function.
- `tests/bootstrap.ts` exports `plugins`, `runnerHooks` and `configureSuite`, and is the only
  place plugins are registered.
- Tests use the real database and fake only what leaves the process, such as mail with
  `mail.fake()`.
- Assert on rows by reading them with the query builder (`db.from(table).where(...)`) and
  checking the result with `assert`. The `dbAssertions` plugin is not registered.
- The framework tests a command with `ace.create(Command, args)` and `command.assertSucceeded()`.
  CapacityLens operator commands are tested by starting the CLI (departure 23).
- An API test calls a route by its name with `client.visit('members.index')`.
- Every database group starts from wipe and migrate, and only groups that send no HTTP request
  use the global transaction (departure 17).
- Sign-in in a test goes through the real endpoint, because Account Kit owns the session.
  **Open:** #2334 item 1.

## The frontend API client

Source: [API client](https://docs.adonisjs.com/guides/frontend/api-client) and
[TanStack Query](https://docs.adonisjs.com/guides/frontend/tanstack-query).

- The backend generates the registry with `generateRegistry()` in the `init` hook and exports it
  as `./registry`. Transformer types are exported as `./data`.
- The frontend creates one Tuyau client and calls a route by its name. It does not write a URL by
  hand.
- A request's body, query and response types come from the registry. Do not restate them.
- With TanStack Query, a read is `useQuery(api.route.queryOptions(...))`, a write is
  `useMutation(api.route.mutationOptions(...))`, and cache keys come from the adapter.
- The TanStack Query cache holds account and admin reads only; planning data lives in the planning
  slice (departure 9).

## Lint, format and tooling

- `apps/backend/eslint.config.js` starts from `configApp()` in `@adonisjs/eslint-config`. It adds
  type-aware rules, allows `== null`, and turns Prettier off for the generated
  `database/schema.ts`. Prettier starts from `@adonisjs/prettier-config`: single quotes, 100 columns, ES5
  trailing commas. Semicolons are kept (departure 18).
- `tsconfig.json` extends `@adonisjs/tsconfig/tsconfig.app.json`.
- The backend scripts keep the starter kit's names and commands: `dev` (`node ace serve --hmr`),
  `build` (`node ace build`), `start` (`node bin/server.js`), `test` (`node ace test`),
  `codegen`, `lint`, `format` and `typecheck`.
- Node is version 24 or later, as the framework requires.

## Stricter rules from AdonisJS Plus

AdonisJS Plus publishes lint rules that state its author's view of application code more firmly
than the documentation does. CapacityLens does not install them. This is where it stands on each.

| Rule | What it asks | CapacityLens |
| --- | --- | --- |
| `no-private-controller-methods` | No `private` or `protected` method on a controller. | Adopted; see Controllers. |
| `test-files-contain-tests` | A test file defines tests only; shared code is in `tests/helpers/`. | Adopted; see Tests. |
| `no-shared-mutable-test-state` | No `let` or `var` outside a test callback. | Adopted; see Tests. |
| `test-helpers-contain-runtime-code` | Types for test helpers live in `tests/helpers/types.ts`. | Adopted, with the types in the existing `tests/types/` folder. |
| `playwright-locators-are-exact` | A text locator states `exact`. | Applies to `e2e/` specs. |
| `no-top-level-functions` | Behaviour is a class method, not a top-level function. | Not followed (departure 10). |
| `exported-functions-are-factories` | An exported function only builds and returns a class instance. | Not followed (departure 10). |
| `types-live-in-types-directory` | Types and interfaces live in a `types/` folder. | Not followed (departure 20). |

Its code style guide adds one rule this page adopts: return early. Check each condition that ends
the work at the top of the function, and do not wrap the main logic in an `if`.

## Review checklist

1. Every new file is in the framework's folder for its kind, with the framework's name and suffix.
2. No relative import crosses a folder; no controller is imported statically into a routes file.
3. `env` and `process.env` are read only in `config/` and `start/env.ts`.
4. Each action validates first with `validateUsing`, calls a service, and returns.
5. No `try`/`catch` in a controller builds an error response; no controller has a private method.
6. Route middleware is named middleware on the route or its group.
7. A model extends its schema class; a query inside a transaction carries `{ client: trx }`.
8. A new migration has `up()` and `down()`; no released migration changed.
9. A test file holds only tests; shared code is in `tests/helpers/`.
10. Framework words are used for framework concepts, and "guard", "policy", "exception" and
    "factory" are not reused for anything else.
11. Any difference from the framework cites a numbered departure, or adds one.
