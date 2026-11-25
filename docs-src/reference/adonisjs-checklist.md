---
title: AdonisJS pre-PR checklist
description: Every AdonisJS cookbook rule as a check to run before a pull request, with mechanical checks per section.
---

# AdonisJS pre-PR checklist

Draft 3, 2026-11-25. The working half of the [AdonisJS cookbook](./adonisjs-cookbook.md): every
rule in it, as a check. The cookbook holds the reasons, the origin of each rule, the vocabulary
table and the recipes. The rule id is the same in both; the tier and the wording that is checked
are here.

## The one question

A review with this page answers one question: does this code match these items? It does not ask
whether the code is good. Something no item covers is not a finding. It is an issue that proposes
a new item, and the review goes on without it.

## Tiers

Each item carries the tier that says what a failure does.

| Tier | A failed item | Departure |
| --- | --- | --- |
| **Law** | Blocks the merge. | None. A law has no departure. |
| **Rule** | Blocks the merge. | A numbered entry in the repository's departures list, decided in an issue before the code merges. |
| **Guideline** | Does not block. The reviewer notes it once and the author answers once, with a fix or a reason. | A reason that will stand is recorded as a departure, so the item is not noted again. |

- A law or a rule is decided by reading the files it names. An item that needs taste to decide is
  a guideline.
- A rule is a law unless one of these holds: a repository's departures list departs from it, an
  open issue proposes changing it, or deciding it takes more than reading the files it names.
- An item with several sentences passes only when every sentence holds.
- **n/a** is valid in two cases only: the section's *When* line does not match the change, or the
  thing the item names does not exist in the repository. "Does not apply here" is not a reason.
- A departure is decided in an issue and lands in its own change, before the code that needs it.
  The change that needs a departure never adds it.
- A tier or an item changes through an issue, between reviews. A review in progress keeps the
  draft it started with.

## How to use it

1. Run it before a pull request is opened, on the whole diff, not from memory.
2. Section 1 applies to every change. After that, do each section whose heading matches a file the
   diff touches. Applications use section 2, packages section 3.
3. Every law and rule ends as one of: **pass**; **n/a**, with the reason; or, for a rule only,
   **departure**, citing the numbered entry in the repository's departures list. A failed item is
   fixed before the pull request. There is no fourth state.
4. Run the mechanical checks first. They are the commands at the head of a section; each must come
   out as stated. They catch the common failures; the items below them still need reading.
5. Paste the summary block at the end into the pull request description.
6. Code the diff did not touch is not in scope. A failure seen there gets an issue.

## How to review with it

1. State the scope first: the lines a pull request changes, or the folders of a repository review.
2. Give every item in the sections that apply one result: pass, n/a, departure or fail. Check
   each n/a against the two valid cases, and each departure against the numbered entry it cites;
   one that does not hold is a fail.
3. A finding names the item id, the `path:line`, and quotes the sentence of the item that fails.
   Without all three it is not a finding.
4. The first pass covers every item that applies. The second pass covers only the first pass's
   findings and the lines changed to fix them. There is no third pass: what is left gets an issue.
5. Cite the draft of this page the review used.


---

# 1. Every change


## Vocabulary

*When:* Every change.

- [ ] **VOC-1** (Rule) Use the framework's word for a framework concept, in code, comments, commit messages, issues and documentation.
- [ ] **VOC-2** (Law) Write "AdonisJS", never "Adonis", in prose. Package names keep their spelling: Lucid, VineJS, Japa, Tuyau, Ace, Edge, Bouncer, Shield.
- [ ] **VOC-3** (Rule) A word in the table below is not reused for anything else. Pick a different word for a product concept that happens to resemble one.

## Names

*When:* Every change.

- [ ] **NAM-1** (Law) Files and folders are `snake_case`. The official ESLint preset enforces it with `@unicorn/filename-case`.
- [ ] **NAM-2** (Law) Classes and types are PascalCase. Interfaces have no `I` prefix. Variables and functions are camelCase; constants may be UPPER_CASE.
- [ ] **NAM-3** (Law) A file holds one class and exports it as the generator does: a default export for a controller, model, middleware, exception, event, listener, mail, policy, transformer, provider, seeder and command; a named export for a service (`export class AvatarService`). Validators, factories, config helpers and errors are named exports.
- [ ] **NAM-4** (Guideline) Create a file with its generator (`node ace make:*`), so the name, suffix and folder are the framework's.

## Imports and modules

*When:* Every change.

Mechanical checks:

- [ ] `grep -rnE "from '\.\.?/" app start config providers 2>/dev/null` prints nothing (application)

Items:

- [ ] **IMP-1** (Law) ES modules only: `"type": "module"`, `import`, top-level `await`.
- [ ] **IMP-2** (Law) Import a type with `import type`, or the inline form `import { type X }`.
- [ ] **IMP-3** (Law) Use the `node:` prefix for Node built-ins.
- [ ] **IMP-4** (Law) In an application, import across folders through the `#` subpath aliases declared under `imports` in `package.json`. Do not write relative imports.
- [ ] **IMP-5** (Law) In a package, a static import is a relative path that ends in `.ts`; a lazy `import()` of a built module ends in `.js`. Packages declare no `#` aliases, as the official packages do not.
- [ ] **IMP-6** (Rule) Import a container service from its `services` path. Do not construct what a package already provides.

## Lint, format and TypeScript

*When:* Every change.

Mechanical checks:

- [ ] the `lint` and `typecheck` scripts pass, and `format` leaves no diff

Items:

- [ ] **TOOL-1** (Law) ESLint starts from `@adonisjs/eslint-config`: `configApp()` in an application, `configPkg()` in a package. Add rules; do not remove the preset's.
- [ ] **TOOL-2** (Rule) Prettier starts from `@adonisjs/prettier-config`: single quotes, 100 columns, ES5 trailing commas, `arrowParens: always`, `quoteProps: consistent`, no semicolons.
- [ ] **TOOL-3** (Law) `tsconfig.json` extends `@adonisjs/tsconfig/tsconfig.app.json` in an application and `@adonisjs/tsconfig/tsconfig.package.json` in a package.
- [ ] **TOOL-4** (Rule) Node is version 24 or later, declared under `engines`. The framework requires it; the package starter kit declares it.
- [ ] **TOOL-5** (Rule) Script names are the starter kit's: `dev`, `build`, `start`, `test`, `lint`, `format`, `typecheck`, plus `codegen` in a monorepo backend and `compile`, `quick:test` and `release` in a package.
- [ ] **TOOL-6** (Law) The repository root has `.editorconfig`, `.gitignore`, `.prettierignore`, `README.md` and `LICENSE.md`. The kits ship the first four.
- [ ] **TOOL-7** (Guideline) Return early. Check each condition that ends the work at the top of the function; do not wrap the main logic in an `if`.
- [ ] **TOOL-8** (Law) Private state in a class is a `#field` or `#method`. Use `protected` only for a member a subclass or the framework reads.

---

# 2. Applications


## Layout

*When:* You added, moved or renamed a file.

- [ ] **LAY-1** (Rule) A new kind of file goes in the framework's folder for it. Create the folder when the first file needs it and add its `#` alias in the same change.
- [ ] **LAY-2** (Rule) A framework folder holds only its own kind of file. `app/models` holds models. `start/` holds `env.ts` and files imported while the application boots.
- [ ] **LAY-3** (Law) No catch-all folders (`utils/`, `helpers/`, `lib/`) under `app/`. Group by domain inside a framework folder: `app/services/billing/`.
- [ ] **LAY-4** (Law) `.adonisjs/` and `database/schema.ts` are generated. Never edit them. Regenerate with `node ace codegen` and with a migration run.
- [ ] **LAY-5** (Law) `ace.js` is not modified. Code that must run before Ace goes in `bin/console.ts`.
- [ ] **LAY-6** (Rule) In a monorepo the backend is `apps/backend` and the frontend `apps/frontend`. The frontend imports only what the backend exports: `./registry` and `./data`.

## File and class names

*When:* You added, moved or renamed a file.

- [ ] **NAM-5** (Rule) `make:controller` pluralizes the name. Pass `--singular` for a controller over one thing.
- [ ] **NAM-6** (Law) A namespaced command's file mirrors its whole name: `app:reset` lives in `commands/app_reset.ts` and exports `AppReset`.

## Configuration and environment

*When:* You touched `config/`, `start/env.ts`, `.env*` or `adonisrc.ts`.

Mechanical checks:

- [ ] `grep -rnE "process\.env|#start/env" app providers 2>/dev/null` prints nothing
- [ ] `grep -rnE "from '#(services|models|controllers)/" config` prints nothing
- [ ] every key in `start/env.ts` is in `.env.example`

Items:

- [ ] **CFG-1** (Law) Every environment variable is declared and validated in `start/env.ts`. A secret uses `Env.schema.secret()`.
- [ ] **CFG-2** (Law) Only `config/` files read the `env` service. Controllers, middleware, services and models read configuration, never `env` and never `process.env`.
- [ ] **CFG-3** (Law) Ask the application for its state with `app.inProduction`, `app.inDev` and `app.inTest`. Do not compare `NODE_ENV`.
- [ ] **CFG-4** (Rule) A `config/` file imports `env`, framework helpers and the package's `defineConfig`, and default-exports the result. It does not import application code.
- [ ] **CFG-5** (Law) A config file that defines a named list (mailers, hash drivers, limiter stores, guards) carries the `declare module` block that types it.
- [ ] **CFG-6** (Law) `adonisrc.ts` is environment-agnostic: no `process.env`, no logic. `providers`, `preloads` and `commands` are lazy imports. A provider or preload that belongs to some environments says so with `{ file, environment }`.
- [ ] **CFG-7** (Law) Resolve paths with `app.makePath()`, `app.publicPath()`, `app.tmpPath()` and `app.configPath()`.
- [ ] **CFG-8** (Law) `.env.example` lists every variable with a placeholder, never a real secret. Values for tests are in `.env.test`.
- [ ] **CFG-9** (Rule) A product's own variables share one prefix (`MYAPP_`). Framework variables keep the framework's names (`APP_KEY`, `PORT`, `HOST`, `LOG_LEVEL`).
- [ ] **CFG-10** (Guideline) Add a variable with `node ace env:add`, which writes `.env`, `.env.example` and the `start/env.ts` validation together.
- [ ] **CFG-11** (Law) `adonisrc.ts` keeps `indexEntities(...)` and, for a typed client, `generateRegistry()` in `hooks.init`.

## Routes

*When:* You touched a routes file.

Mechanical checks:

- [ ] `grep -rnE "from '#controllers/" start` prints nothing
- [ ] in `node ace list:routes`, every route with a controller has a name

Items:

- [ ] **RTE-1** (Rule) A routes file only maps: path, controller action, middleware, name.
- [ ] **RTE-2** (Law) A route points at a controller through the barrel file: `[controllers.Posts, 'index']`, with `import { controllers } from '#generated/controllers'`. A static controller import in a routes file breaks hot reload and is a lint error (`@adonisjs/prefer-lazy-controller-import`).
- [ ] **RTE-3** (Law) A route with a controller is named by the framework: `<controller_snake>.<method>` (`posts.index`), prefixed by any group `.as()` (`auth.new_account.store`); a single action controller is named `<controller_snake>` alone. Name a route by hand only when it has no controller.
- [ ] **RTE-4** (Rule) A shared path prefix, middleware or name prefix goes on a `router.group()` with `.prefix()`, `.use()` and `.as()`. Do not repeat it on every route.
- [ ] **RTE-5** (Law) Attach middleware with `.use(middleware.name(options))`, importing `middleware` from `#start/kernel`.
- [ ] **RTE-6** (Rule) Use `router.resource()` for a resource with the standard actions, and `.apiOnly()` for an API.
- [ ] **RTE-7** (Guideline) The verb says what the route does: `GET` reads, `POST` creates or acts, `PUT` replaces, `PATCH` changes part, `DELETE` removes.
- [ ] **RTE-8** (Guideline) Constrain a route parameter with `.where()` or `router.matchers`.
- [ ] **RTE-9** (Rule) An API is versioned in the outer group's prefix: `/api/v1`.
- [ ] **RTE-10** (Guideline) When `start/routes.ts` grows past one screen, split it by area into `start/routes/<area>.ts` files that `start/routes.ts` imports. Each stays a plain route file.

## Controllers

*When:* You touched a controller.

Mechanical checks:

- [ ] `grep -rnE "^\s*(private|protected) " app/controllers` prints nothing
- [ ] `grep -rnE "\((ctx|context): HttpContext\)" app/controllers` prints nothing
- [ ] `grep -rn "try {" app/controllers` prints nothing

Items:

- [ ] **CTL-1** (Guideline) A controller maps HTTP to the application: validate, do the work or call a service, return the result.
- [ ] **CTL-2** (Rule) One controller per resource. Its actions are the resourceful names: `index`, `show`, `store`, `update`, `destroy` (and `create` and `edit` when it renders forms).
- [ ] **CTL-3** (Rule) An operation that is not one of those becomes its own controller: a noun controller with a resourceful action (the kit: sign-up is `NewAccountController.store`, login and logout are `AccessTokensController.store` and `.destroy`), or a single action controller with one `handle` method, made with `node ace make:controller <name> handle --singular` (the documentation). Do not grow a controller into a list of verbs.
- [ ] **CTL-4** (Law) An action destructures what it uses from the HTTP context: `async store({ request, serialize }: HttpContext)`.
- [ ] **CTL-5** (Rule) A controller has no `private` or `protected` method. A step two actions share moves to a service or the model.
- [ ] **CTL-6** (Law) A controller does not wrap its work in `try`/`catch` to build an error response. It lets the exception reach the exception handler.
- [ ] **CTL-7** (Rule) Return a value, or use the response helper that names the status: `response.created()`, `response.notFound()`, `response.forbidden()`.
- [ ] **CTL-8** (Law) A dependency comes through the constructor with `@inject()`, or as an action argument with `@inject()` on the action.
- [ ] **CTL-9** (Guideline) Business rules that a command, a listener or a second controller also needs live in a service, not in the action.
- [ ] **CTL-10** (Guideline) Create a resource controller with `node ace make:controller <name> --resource` (or `--api`), and its validators with `node ace make:validator <name> --resource`.

## Validators

*When:* You touched a validator or an action that reads input.

Mechanical checks:

- [ ] `grep -rnE "request\.(all|body|qs|input|only|except)\(" app` prints nothing
- [ ] `grep -rhoE "export const \w+" app/validators | sort | uniq -d` prints nothing

Items:

- [ ] **VAL-1** (Law) A validator is `vine.create({ ... })`, exported by name from `app/validators/<resource>.ts`. One file holds every validator for its resource.
- [ ] **VAL-2** (Law) The export ends in `Validator` and says what it validates: `signupValidator`, `createPostValidator`, `updatePostValidator`.
- [ ] **VAL-3** (Law) A validator's name is unique across the application.
- [ ] **VAL-4** (Rule) Validate with `request.validateUsing(validator)` as the first step of the action. Nothing reads `request.body()`, `request.all()`, `request.qs()`, `request.input()`, `request.only()` or `request.except()` unvalidated. The framework allows it; we do not.
- [ ] **VAL-5** (Rule) When an action uses route parameters, headers or cookies, they are validated in the same validator, under its `params`, `headers` and `cookies` keys.
- [ ] **VAL-6** (Law) Do not wrap `validateUsing` in `try`/`catch`. Use `request.tryValidateUsing` when the action must handle the failure itself.
- [ ] **VAL-7** (Rule) Database rules (`unique`, `exists`) belong in the validator.
- [ ] **VAL-8** (Law) Global VineJS setup (messages, custom rules) is in the `start/validator.ts` preload file.
- [ ] **VAL-9** (Guideline) Small helpers that build a shared field sit at the top of the validator file.
- [ ] **VAL-10** (Rule) A rule that depends on the request, such as unique-except-self, takes the value through `withMetaData<T>()` and `validateUsing(validator, { meta })`.

## Middleware

*When:* You touched middleware or `start/kernel.ts`.

- [ ] **MID-1** (Law) `start/kernel.ts` registers three stacks, each with lazy imports: server middleware (every request, including one with no route), router middleware (every request that matches a route) and named middleware (only routes that ask for it), exported as `middleware`.
- [ ] **MID-2** (Rule) Body parsing, session, Shield and `initialize_auth` are router middleware. CORS, forced JSON and container bindings are server middleware.
- [ ] **MID-3** (Law) A middleware is a class with `handle(ctx, next, options?)`. Code before `await next()` runs on the way in; code after it runs on the way out.
- [ ] **MID-4** (Law) A middleware refuses by throwing an exception, or by sending a response and not calling `next`.
- [ ] **MID-5** (Law) What a route requires is named middleware on that route or its group. Router middleware does not branch on the route's name or path.
- [ ] **MID-6** (Rule) A middleware that adds a property to `HttpContext` carries the `declare module '@adonisjs/core/http'` block in the same file.

## Exceptions

*When:* You throw, catch or handle an error.

Mechanical checks:

- [ ] `grep -rnE "extends Error\b|throw new Error\(" app` prints nothing
- [ ] `ls app/exceptions` shows only `handler.ts` and `*_exception.ts`

Items:

- [ ] **EXC-1** (Law) `app/exceptions/handler.ts` holds one `HttpExceptionHandler` that extends `ExceptionHandler`, registered with `server.errorHandler` in `start/kernel.ts`.
- [ ] **EXC-2** (Law) `handle` turns an exception into a response; `report` logs it and never sends one. `handle` falls through to `super.handle` for anything it does not answer itself. A custom `report` calls `super.report`, or checks `this.shouldReport(...)` first.
- [ ] **EXC-3** (Rule) Debug output is on outside production: `protected debug = !app.inProduction`.
- [ ] **EXC-4** (Guideline) Expected errors are kept out of the log with `ignoreCodes` and `ignoreStatuses`.
- [ ] **EXC-5** (Law) A custom exception extends `Exception` from `@adonisjs/core/exceptions`, lives in `app/exceptions/<name>_exception.ts`, and sets `static status`. It sets `static code` when a client or a handler matches on it.
- [ ] **EXC-6** (Guideline) An exception that needs its own response or log line implements `handle` and `report` on itself (framework option). We prefer that to an `instanceof` branch per exception in the handler.
- [ ] **EXC-7** (Law) Exception codes are `E_UPPER_SNAKE`.
- [ ] **EXC-8** (Law) Recognise a framework error with `instanceof` on its package's `errors` export (`errors.E_VALIDATION_ERROR`, `errors.E_ROUTE_NOT_FOUND`), never by its message.
- [ ] **EXC-9** (Rule) Application code throws exceptions, never a bare `Error`, for anything a client can cause.
- [ ] **EXC-10** (Rule) One exception class per cause. `static status`, `static code` and, when the sentence never varies, `static message` say what it is. No constructor takes a status or a code; it takes only what the message or the response needs (an id, a detail sentence, `{ cause }`).

## Responses and transformers

*When:* You changed what an endpoint returns.

- [ ] **RES-1** (Law) Never return a Lucid model from an action. Return a transformer result or a plain object. The framework recommends transformers; we require them.
- [ ] **RES-2** (Rule) A transformer extends `BaseTransformer<T>` and implements `toObject()`. Pick fields with `this.pick(this.resource, [...])`.
- [ ] **RES-3** (Law) A transformer runs no query. Load relationships with `preload()` first.
- [ ] **RES-4** (Rule) An API answers with `serialize(Transformer.transform(model))`, which wraps the result in `{ data }`. The `serialize` helper is added to the HTTP context by `providers/api_provider.ts`, as in the kit.
- [ ] **RES-5** (Rule) A paginated list is `serialize(Transformer.paginate(...))`, so the metadata has the framework's shape.
- [ ] **RES-6** (Rule) A transformer shapes output. Input is described by a validator.
- [ ] **RES-7** (Rule) Wire field names are camelCase; columns are `snake_case`.
- [ ] **RES-8** (Rule) A second shape for the same model is a transformer variant: a `for<Purpose>()` method chosen with `.useVariant()`. It is not a second transformer class.
- [ ] **RES-9** (Rule) An answer that must not be wrapped uses `serialize.withoutWrapping(...)`.

## Models and the database

*When:* You touched a model, a query, a transaction or a migration.

Mechanical checks:

- [ ] `grep -rL "async down" database/migrations` prints nothing
- [ ] every `@column` in `app/models` refines one column (MOD-2)
- [ ] `git diff --name-status origin/main -- database/migrations` shows only `A` lines

Items:

- [ ] **MOD-1** (Law) One model per table, singular PascalCase, in `app/models/<singular>.ts`. The table is the plural `snake_case` name; set `static table` only when it is not.
- [ ] **MOD-2** (Rule) A model extends its generated schema class from `#database/schema`. The model carries relationships, hooks, scopes, computed getters and behaviour. It re-declares a generated column only to refine that one column: `serializeAs`, `prepare` or `consume`, or a narrower type.
- [ ] **MOD-3** (Rule) Change a generated type that applies across tables in `database/schema_rules.ts`.
- [ ] **MOD-4** (Rule) Add shared behaviour with a mixin applied through `compose`: `class User extends compose(UserSchema, withAuthFinder(hash))`.
- [ ] **MOD-5** (Law) Columns are `snake_case`; model properties are camelCase. A foreign key is the singular model name plus `_id`. Timestamps are `created_at` and `updated_at`.
- [ ] **MOD-6** (Rule) Hide a column from output by re-declaring it with `@column({ serializeAs: null })`.
- [ ] **MOD-7** (Rule) Declare a relationship with the related model as a function (`() => Post`), and declare both sides.
- [ ] **MOD-8** (Rule) A hook is a static method with its decorator. A filter that must cover every read is on both `beforeFind` and `beforeFetch`. Hooks do not run for bulk `update` and `delete`.
- [ ] **MOD-9** (Law) A query scope is a static property made with `scope()`.
- [ ] **MOD-10** (Law) A key the application generates needs `static selfAssignPrimaryKey = true`.
- [ ] **MOD-11** (Guideline) Avoid native database enums. Store a short string and narrow its type.
- [ ] **DB-1** (Guideline) Read and write through the model. Use the database query builder for what a model cannot express.
- [ ] **DB-2** (Guideline) Prefer the managed transaction, `db.transaction(async (trx) => { ... })`, which commits on return and rolls back on a throw.
- [ ] **DB-3** (Law) Inside a transaction every query carries the client: `Model.query({ client: trx })`, `Model.create(data, { client: trx })` or `model.useTransaction(trx)`.
- [ ] **DB-4** (Law) Bind values in `db.rawQuery`. Never build SQL from input.
- [ ] **DB-5** (Law) Network calls, mail and password hashing stay outside a transaction.
- [ ] **DB-6** (Rule) A migration extends `BaseSchema`, sets `protected tableName`, has `up()` and `down()`, and makes one reviewable change. Its file is named by `node ace make:migration`.
- [ ] **DB-7** (Law) A released migration is never edited. A fix is a new migration.
- [ ] **DB-8** (Rule) Data changes go in `this.defer()`.
- [ ] **DB-9** (Law) A foreign key is declared with `.references().inTable()` and an explicit `.onDelete()`.
- [ ] **DB-10** (Law) Production does not roll back: `disableRollbacksInProduction: true` in `config/database.ts`. The framework offers it as an option.
- [ ] **DB-11** (Law) A seeder is a default-exported `<Name>Seeder` that extends `BaseSeeder`. One that holds development or test data limits itself with `static environment`. A model factory lives in `database/factories`.

## Services, providers and the container

*When:* You touched a service or a provider.

Mechanical checks:

- [ ] `grep -rnE "^export (async )?function" app` prints nothing
- [ ] `grep -rnE "^\s*console\." app providers start` prints nothing

Items:

- [ ] **SVC-1** (Rule) Business logic that more than one entry point needs lives in a class in `app/services/<name>_service.ts`, created with `node ace make:service`, which writes a named export.
- [ ] **SVC-2** (Law) A service is taken through the constructor with `@inject()`. The container builds it; nothing calls `new` on it.
- [ ] **SVC-3** (Rule) A service does not read the HTTP context unless it is injected with it.
- [ ] **SVC-4** (Rule) Replace a service in a test with the test context's `swap(Service, fake)`, which restores itself.
- [ ] **SVC-5** (Rule) Behaviour is a class method. A file does not export loose top-level functions; an exported function only builds and returns an instance.
- [ ] **SVC-6** (Rule) Write a provider only for container bindings, framework extensions (macros, `HttpContext` properties), or work that starts and stops with the application. One-off setup is a preload file.
- [ ] **SVC-7** (Law) In a provider: `register` only binds and is synchronous; `boot` configures. `register`, `boot` and `start` also run in console, test and tooling runs, and preload files are imported after `start`, so nothing there connects, listens or spawns. Long-running work starts in `ready` and stops in `shutdown`.
- [ ] **SVC-8** (Law) Application code logs through the logger, not `console`.

## Authentication and authorization

*When:* You touched sign-in, sessions or a permission check.

- [ ] **AUT-1** (Rule) Guards are defined in `config/auth.ts`. The session guard is named `web`; the access-token guard is `api`.
- [ ] **AUT-2** (Rule) The `User` model composes `withAuthFinder(hash)`. Credentials are checked with `User.verifyCredentials(email, password)`, which resists timing attacks.
- [ ] **AUT-3** (Rule) A route is protected by the named `auth` middleware: `.use(middleware.auth())` or `.use(middleware.auth({ guards: ['api'] }))`.
- [ ] **AUT-4** (Rule) An action reads the user with `auth.getUserOrFail()` behind the `auth` middleware, and `auth.user` where a user is optional.
- [ ] **AUT-5** (Rule) Authorization is Bouncer: an ability in `app/abilities/main.ts` for a simple check, a policy in `app/policies/<model>_policy.ts` for checks about one model.
- [ ] **AUT-6** (Rule) A policy has one method per action, even when two have the same body.
- [ ] **AUT-7** (Rule) An action authorizes with `bouncer.with(PostPolicy).authorize('edit', post)`, or `.denies()` when it answers itself.
- [ ] **AUT-8** (Law) Hash with the `hash` service; encrypt with the `encryption` service. No custom hashing.
- [ ] **AUT-9** (Law) The server authorizes every request itself. A hidden button is not authorization.

## Security

*When:* You touched rate limits, CORS, Shield or secrets.

- [ ] **SEC-1** (Rule) A rate limit is a named throttle defined in `start/limiter.ts` with `limiter.define` and applied to routes with `.use(throttle)`.
- [ ] **SEC-2** (Rule) A 429 keeps the limiter's `X-RateLimit-*` and `Retry-After` headers.
- [ ] **SEC-3** (Law) `config/cors.ts` lists real origins. Never pair `credentials: true` with a wildcard origin.
- [ ] **SEC-4** (Rule) `config/shield.ts` carries CSRF, CSP, HSTS, frame and content-type settings. A server-rendered or session application keeps CSRF protection on.
- [ ] **SEC-5** (Law) `APP_KEY` is a secret, generated with `node ace generate:key`, never committed.
- [ ] **SEC-6** (Law) Bearers (reset tokens, invitation tokens, session ids) are never logged.

## Logging, mail, events and health checks

*When:* You log, send mail, emit an event or touch a health check.

- [ ] **OPS-1** (Rule) Inside a request, log with `ctx.logger`, so the line carries the request id. Use the logger service outside a request.
- [ ] **OPS-2** (Rule) Log an error under the `err` key. Hide sensitive values with the logger's `redact` option.
- [ ] **OPS-3** (Law) A mail is a class in `app/mails`, created with `node ace make:mail`.
- [ ] **OPS-4** (Law) An event is a class in `app/events` that extends `BaseEvent` and only carries data. It is dispatched with `events.UserRegistered.dispatch(user)`.
- [ ] **OPS-5** (Law) A listener is a class in `app/listeners` with a `handle` method. Listeners are attached in the `start/events.ts` preload file, through the `#generated/events` and `#generated/listeners` barrel files.
- [ ] **OPS-6** (Rule) Health checks are registered in `start/health.ts` as `healthChecks`. A `HealthChecksController` serves `/health/live` and `/health/ready`. A custom check extends `BaseCheck` and its name ends in `Check`.
- [ ] **OPS-7** (Law) Listeners are referenced lazily through the barrel file; a static listener import in `start/events.ts` is a lint error (`@adonisjs/prefer-lazy-listener-import`).

## Ace commands

*When:* You touched an Ace command.

Mechanical checks:

- [ ] `grep -rnE "^\s*console\." commands` prints nothing

Items:

- [ ] **CMD-1** (Law) A command is a default-exported class in `commands/` that extends `BaseCommand` and sets `static commandName` and `static description`.
- [ ] **CMD-2** (Law) A grouped command is named `namespace:action`.
- [ ] **CMD-3** (Law) A command that touches models or services sets `static options = { startApp: true }`.
- [ ] **CMD-4** (Law) Inputs are declared with `@args` and `@flags`, each with a description.
- [ ] **CMD-5** (Law) Output goes through `this.logger` and `this.ui`, not `console`.
- [ ] **CMD-6** (Rule) A command does not catch an error only to report it. The error reaches Ace, which sets `this.error` and `this.exitCode = 1`; `completed()` logs one safe line and returns `true` so Ace does not print the raw error.
- [ ] **CMD-7** (Guideline) A command calls the same service a controller would. It holds no business rule of its own.
- [ ] **CMD-8** (Law) A file in `commands/` that is not a command starts with `_`.

## Tests

*When:* You wrote or changed a test.

Mechanical checks:

- [ ] `grep -rnE "^(let|var) " tests` prints nothing
- [ ] `grep -rLE "\btest(\.group)?\(" tests --include='*.spec.ts'` prints nothing
- [ ] `grep -rn "withGlobalTransaction" tests` prints nothing (deprecated name)

Items:

- [ ] **TST-1** (Rule) Tests run on Japa. Suites are declared in `adonisrc.ts`: `unit` and `functional`, plus `browser` when there are browser tests.
- [ ] **TST-2** (Rule) A test file is `<subject>.spec.ts`, in a folder that mirrors what it tests.
- [ ] **TST-3** (Law) `tests/bootstrap.ts` exports `plugins`, `runnerHooks` and `configureSuite`, and is the only place plugins are registered.
- [ ] **TST-4** (Rule) Related tests sit in a `test.group`. State is reset in a group hook: `group.each.setup(() => testUtils.db().wrapInGlobalTransaction())`, or `truncate()`.
- [ ] **TST-5** (Rule) An API test calls a route by its name: `client.visit('posts.store')`. The framework also allows a URL; we use the name.
- [ ] **TST-6** (Rule) An API test signs in with `.loginAs(user)`, with `.withGuard('api')` before it for a guard that is not the default.
- [ ] **TST-7** (Rule) Rows are asserted with the `dbAssertions` plugin: `db.assertHas`, `db.assertMissing`, `db.assertCount`.
- [ ] **TST-8** (Rule) Test rows come from model factories.
- [ ] **TST-9** (Rule) Fake what leaves the process, with the forms that restore themselves: `using fake = mail.fake()` and the test context's `swap`. The database is real.
- [ ] **TST-10** (Rule) A command is tested with `ace.create(Command, args)`, `command.exec()` and `command.assertSucceeded()`.
- [ ] **TST-11** (Rule) A test file contains tests only. Reusable code is in `tests/helpers/`.
- [ ] **TST-12** (Rule) No `let` or `var` is shared across tests at file scope. A test creates what it needs, or a group hook does.
- [ ] **TST-13** (Rule) A Playwright text locator states `exact`.
- [ ] **TST-14** (Guideline) A test title is a lowercase sentence that says what happens. A group title is a noun phrase.
- [ ] **TST-15** (Rule) `.env.test` sets `SESSION_DRIVER=memory`, so `loginAs` and `withSession` work in API tests.

## The frontend API client

*When:* You call the API from the frontend.

- [ ] **API-1** (Law) The backend generates the registry with `generateRegistry()` in the `init` hook of `adonisrc.ts`, and exports `./registry` and `./data` from its `package.json`.
- [ ] **API-2** (Law) The frontend creates one Tuyau client and calls a route by its name. It does not write a URL by hand.
- [ ] **API-3** (Law) Request and response types come from the registry. Do not restate them.
- [ ] **API-4** (Rule) With TanStack Query, a read is `useQuery(api.<route>.queryOptions(...))` and a write is `useMutation(api.<route>.mutationOptions(...))`.

---

# 3. Packages


## Layout

*When:* You added, moved or renamed a file.

- [ ] **PKG-1** (Law) The implementation is in `src/`. The repository root holds only `index.ts`, `configure.ts` and configuration.
- [ ] **PKG-2** (Rule) Create only the folders the package needs. A package with no container binding has no `providers/` and no `services/`.
- [ ] **PKG-3** (Law) A static import is a relative path that ends in `.ts`; a lazy `import()` ends in `.js` (IMP-5).

## Name and manifest

*When:* You touched `package.json`.

Mechanical checks:

- [ ] `pnpm pack --dry-run` lists only `build/`, `README.md`, `LICENSE.md` and `package.json`
- [ ] no `@adonisjs/*` package is under `dependencies`

Items:

- [ ] **PKG-4** (Rule) The npm name is `@kevinjohn/adonisjs-<name>`; the repository is `oss-adonisjs-<name>`. The name says what the package does in the framework's vocabulary.
- [ ] **PKG-5** (Rule) `"type": "module"`, `engines.node >= 24`, `"files": ["build", "!build/bin", "!build/tests"]`, and an `exports` map.
- [ ] **PKG-6** (Rule) `@adonisjs/core` and every other framework package the code imports (`@adonisjs/lucid`, `@adonisjs/session`, `@adonisjs/assembler`) is a `peerDependency`, and a `devDependency` for the package's own tests. Optional ones are marked in `peerDependenciesMeta`.
- [ ] **PKG-7** (Rule) A peer range names the major: `^7.0.0`. Do not pin a peer to an exact version.
- [ ] **PKG-8** (Rule) The package builds with `tsdown` plus `tsc --emitDeclarationOnly --declaration`, and copies `stubs/**/*.stub` into `build` with `copyfiles --up=1`, as the official packages do.
- [ ] **PKG-9** (Rule) `publishConfig` sets `access: public` and `provenance: true`.

## The export map

*When:* You changed what the package exports.

Mechanical checks:

- [ ] every `exports` target exists after `build`

Items:

- [ ] **PKG-10** (Law) Nothing outside the export map is importable. A consumer never imports from `build/src/...`.
- [ ] **PKG-11** (Rule) Public types live in `src/types.ts` and are exported from `./types`. Lists the application extends (`LimitersList`) are interfaces there, augmented from the application's config file.
- [ ] **PKG-12** (Rule) The export map is public API. Removing or renaming a subpath is a breaking change.

## The configure hook and stubs

*When:* You touched `configure.ts` or a stub.

Mechanical checks:

- [ ] running the configure hook twice on a scratch application leaves no duplicate entry

Items:

- [ ] **PKG-13** (Rule) A package that needs anything in the application (a config file, a provider, a middleware, an environment variable, a migration) ships a `configure` function, so `node ace add <package>` sets it up. The README does not ask for manual edits the hook could make.
- [ ] **PKG-14** (Law) The hook changes the application only through codemods: `makeUsingStub`, `updateRcFile` (`addProvider`, `addCommand`, `addPreloadFile`), `registerMiddleware`, `defineEnvVariables`, `defineEnvValidations`, `registerJapaPlugin`, `registerPolicies`. `@adonisjs/assembler` is an optional peer dependency because the codemods need it.
- [ ] **PKG-15** (Law) The hook is safe to run twice.
- [ ] **PKG-16** (Rule) Choices come from a flag first, then a prompt: `command.parsedFlags.store`, else `command.prompt.choice(...)`. An invalid choice sets `command.exitCode = 1`, logs through `command.logger` and returns.
- [ ] **PKG-17** (Law) Templates are `.stub` files under `stubs/`, in folders that mirror where they land: `stubs/config/<name>.stub`, `stubs/start/<name>.stub`, `stubs/make/migration/<name>.stub`. Each stub states its destination with `exports({ to: app.configPath('<name>.ts') })`.
- [ ] **PKG-18** (Law) `stubs/main.ts` exports `stubsRoot = import.meta.dirname`.
- [ ] **PKG-19** (Rule) A stub writes code the application owns afterwards, in this book's application style: `env` read in the config file, `defineConfig`, the `declare module` block.

## Configuration

*When:* You changed how the package is configured.

Mechanical checks:

- [ ] `grep -rnE "process\.env|services/env" src providers services 2>/dev/null` prints nothing

Items:

- [ ] **PKG-20** (Law) The application configures the package in `config/<name>.ts`, with the package's `defineConfig`.
- [ ] **PKG-21** (Rule) `defineConfig` validates its input and throws `InvalidArgumentsException` or `RuntimeException` from `@adonisjs/core/exceptions`, with a message that names the package's config and the key.
- [ ] **PKG-22** (Rule) When configuration needs the booted application or a lazily imported driver, `defineConfig` returns a config provider (`configProvider.create`), and the service provider resolves it with `configProvider.resolve`.
- [ ] **PKG-23** (Rule) A package never reads `process.env` or the `env` service. The application's config file does.
- [ ] **PKG-24** (Law) Environment variables a package introduces are UPPER_SNAKE with the package's name first: `LIMITER_STORE`, `SESSION_DRIVER`.

## Provider and container service

*When:* You touched the provider or `services/main.ts`.

- [ ] **PKG-25** (Law) The provider is `providers/<name>_provider.ts`, default-exporting `<Name>Provider` with `constructor(protected app: ApplicationService) {}`.
- [ ] **PKG-26** (Rule) `register` binds a singleton: under a dotted name (`'<name>.manager'`) when the application imports it as a container service, otherwise by class. A named binding is added to `ContainerBindings` with `declare module '@adonisjs/core/types'` in the same file.
- [ ] **PKG-27** (Rule) The binding is lazy: configuration is read and the object built inside the singleton callback, not in `register` itself.
- [ ] **PKG-28** (Rule) Events the package emits are typed in `EventsList` in the same block and named `<namespace>:<event>` (`session:initiated`, `limit:exceeded`).
- [ ] **PKG-29** (Rule) A named binding has a `services/main.ts` that resolves it after boot and default-exports it, so the application writes `import limiter from '@adonisjs/limiter/services/main'`.
- [ ] **PKG-30** (Rule) Macros, `HttpContext` properties and Edge plugins are registered by the provider, with their type augmentation beside them. A Japa plugin is exported from `./plugins/<tool>` for the application to register in `tests/bootstrap.ts`.

## Errors, logging and style

*When:* You throw an error, log, or ship a middleware or command.

Mechanical checks:

- [ ] `grep -rnE "extends Error\b|throw new Error\(|^\s*console\." src providers services commands 2>/dev/null` prints nothing

Items:

- [ ] **PKG-31** (Rule) Every exception the package throws is defined in `src/errors.ts`, one class per cause: `<Cause>Exception extends Exception`, with a unique raw `static code = 'E_<CODE>'` for each distinct cause and `static status`. A subclass that answers with its parent's response keeps its parent's code and is still exported under its own `E_<CODE>` name. The file exports each class under its code, `export const E_<CODE> = <Cause>Exception`, and `index.ts` exports the file as the `errors` namespace: `import { errors } from '<package>'`.
- [ ] **PKG-32** (Rule) The code is stable. The package throws by it, `throw new E_<CODE>()`, and an application recognises it with `instanceof errors.E_<CODE>` or by `code`, never by message. A wire code covers several raw codes only to prevent enumeration or conceal configuration details, with a one-line comment naming what it protects; compatibility alone is not a reason.
- [ ] **PKG-46** (Law) No exported exception constructor, including an inherited one, takes a status or a code. Enforce this through its signature, without runtime mutation guards. Applications choose different response statuses in their own handlers. It takes only what the message or the response needs (an id, a name, a detail sentence, `{ cause }`); a sentence that never varies is `static message`. A package does not use `createError`.
- [ ] **PKG-47** (Rule) A package never throws a bare `Error`. Wrong configuration or wrong use by the application's developer throws `InvalidArgumentsException` or `RuntimeException` from `@adonisjs/core/exceptions`; everything else is a class in `src/errors.ts`.
- [ ] **PKG-49** (Rule) Compound failures follow the single [compound-failure rule](./adonisjs-cookbook.md#compound-failures).
- [ ] **PKG-33** (Rule) An exception that maps to an HTTP response implements `handle` on itself, so the application's handler needs no special case.
- [ ] **PKG-34** (Rule) Diagnostics use `debuglog('<scope>:<name>')` from `node:util` in `src/debug.ts`. A package does not write to `console` and does not log through the application's logger unless the application asked it to.
- [ ] **PKG-35** (Rule) A package is built from classes, with `defineConfig` and other small factory functions as the function exports.
- [ ] **PKG-36** (Rule) A middleware the package ships is a class with `handle(ctx, next, options?)`, exported from its own subpath and registered by the configure hook.
- [ ] **PKG-37** (Law) A command the package ships is a file in `commands/`. The build writes `build/commands/main.js` with `adonis-kit index build/commands`, exported as `./commands` and registered with `rcFile.addCommand('<package>/commands')`.
- [ ] **PKG-38** (Law) A package does not import from an application and makes no assumption about its folder names beyond the framework's.
- [ ] **PKG-48** (Rule) Everything an application calls from the export map has an `@example` in its TSDoc: each exported function, class, decorator and mixin, and each public method on an exported class or service. The example is the application's code, fenced as `ts`. A top-level export's example starts with its import from the public subpath; a method's starts from the instance. One example is enough; a second is for a second way to call it. Types, exception classes and what the framework calls instead of the application (the configure hook, the provider, commands, a middleware's `handle`, a controller's actions) need none.

## Tests and release

*When:* You wrote a test or are releasing.

- [ ] **PKG-39** (Rule) Tests run on Japa through `bin/test.ts`, in `tests/**/*.spec.ts`. Shared test code is in one helpers file.
- [ ] **PKG-40** (Rule) The configure hook has a test (`tests/configure.spec.ts`) that runs it against a scratch application with `@japa/file-system` and asserts the files it wrote.
- [ ] **PKG-41** (Rule) The provider has a test that boots an application with it and resolves the binding.
- [ ] **PKG-42** (Guideline) Public types are tested with `@japa/expect-type` where inference matters.
- [ ] **PKG-43** (Rule) Coverage is collected with `c8`, as the package starter kit sets up.
- [ ] **PKG-44** (Law) Versions follow semver. Each release has a changelog entry and a git tag `v<version>`.
- [ ] **PKG-45** (Rule) The README has, in this order: what it does, `node ace add <package>`, what the configure hook changed, configuration, usage, errors, and the supported AdonisJS versions.

---

# Summary block for the pull request

```
AdonisJS checklist (draft 3)
Sections run:
Mechanical checks: all as stated / exceptions:
Laws failed: none
Items n/a (id: reason):
Guideline notes answered (id: fix or reason):
Departures cited (id: departure number):
New departures recorded in this change:
```
