import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { prepareContainerRuntime } from './prepare-container-runtime.mjs';

test('container assembly preserves compiled runtime and build policy while repairing package self links', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'capacitylens-container-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const deployment = join(root, 'deployment');
  const backend = join(root, 'runtime/backend');
  await mkdir(join(source, 'apps/backend/build/bin'), { recursive: true });
  await mkdir(join(source, 'apps/backend/build/tests'), { recursive: true });
  await mkdir(join(deployment, 'node_modules/@capacitylens'), { recursive: true });
  await writeFile(
    join(source, 'pnpm-workspace.yaml'),
    'allowBuilds:\n  better-sqlite3: true\n  esbuild: false\n',
  );
  await writeFile(join(source, 'apps/backend/build/bin/server.js'), 'export {};\n');
  await writeFile(join(source, 'apps/backend/build/bin/test.js'), 'export {};\n');
  await writeFile(join(source, 'apps/backend/build/bin/server.js.map'), '{}\n');
  await symlink('/not-a-runtime', join(deployment, 'node_modules/@capacitylens/backend'));
  await prepareContainerRuntime(source, deployment, backend);
  assert.equal(await readFile(join(backend, 'bin/server.js'), 'utf8'), 'export {};\n');
  assert.equal(await readlink(join(backend, 'node_modules/@capacitylens/backend')), '../..');
  for (const path of ['tests', 'bin/test.js', 'bin/server.js.map'])
    await assert.rejects(readFile(join(backend, path)), { code: 'ENOENT' });
  assert.match(
    await readFile(join(backend, 'pnpm-workspace.yaml'), 'utf8'),
    /better-sqlite3: true/,
  );
  await assert.rejects(readFile(join(backend, 'app/source.ts')), { code: 'ENOENT' });
});

test('Compose upgrades before API startup and preserves the private persistent deployment boundary', async () => {
  const { default: YAML } = await import('yaml');
  const compose = YAML.parse(
    await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8'),
  );
  assert.equal(compose.name, 'capacitylens');
  assert.deepEqual(compose.services.upgrade.tmpfs, ['/tmp:size=32m,mode=1777']);
  assert.deepEqual(compose.services.upgrade.command, ['node', 'ace.js', 'app:upgrade']);
  assert.equal(compose.services.api.depends_on.upgrade.condition, 'service_completed_successfully');
  assert.deepEqual(compose.services.upgrade.environment, compose.services.api.environment);
  assert.deepEqual(compose.services.api.volumes, [
    'capacitylens-db:/data',
    'capacitylens-backups:/backups',
  ]);
  // nginx reaches the API over the private Compose network, so loopback-only trust would key every
  // request by the nginx container.
  assert.equal(compose.services.api.environment.CAPACITYLENS_TRUST_PROXY_HEADERS, 'private');
  // With private trust, any host that reaches the web port can choose its client address, so the
  // published ports stay on loopback unless the operator binds them for a load balancer.
  for (const service of ['web', 'web-client'])
    assert.deepEqual(compose.services[service].ports, [
      '${WEB_BIND_IP:-127.0.0.1}:${WEB_PORT:-8080}:8080',
    ]);
  assert.equal(compose.services.api.ports, undefined);
  // Production refuses a plain-HTTP origin, so Compose requires the operator's address instead of a default.
  assert.match(
    compose.services.api.environment.CAPACITYLENS_PUBLIC_URL,
    /^\$\{CAPACITYLENS_PUBLIC_URL:\?/,
  );
  // Sign-in modes and open production access no longer exist, so Compose must not offer them.
  assert.equal(compose.services.api.environment.CAPACITYLENS_MODE, undefined);
  assert.equal(compose.services.api.environment.CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION, undefined);
  assert.deepEqual(Object.keys(compose.volumes).sort(), [
    'capacitylens-backups',
    'capacitylens-caddy-config',
    'capacitylens-caddy-data',
    'capacitylens-db',
  ]);
  const workflow = YAML.parse(
    await readFile(new URL('../.github/workflows/docker.yml', import.meta.url), 'utf8'),
  );
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.equal(Object.hasOwn(workflow.on, 'pull_request'), false);
  assert.equal(Object.hasOwn(workflow.on, 'workflow_dispatch'), true);
});

test('Compose runs the published release images by default and can still build them', async () => {
  const { default: YAML } = await import('yaml');
  const compose = YAML.parse(
    await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8'),
  );
  // No default version: an unset release must stop Compose instead of running an arbitrary image.
  const published = (name) =>
    new RegExp(`^ghcr\\.io/kevinjohn/capacitylens-${name}:\\$\\{CAPACITYLENS_VERSION:\\?[^}]+\\}$`);
  assert.match(compose.services.api.image, published('api'));
  assert.equal(compose.services.upgrade.image, compose.services.api.image);
  assert.match(compose.services.web.image, published('web'));
  assert.deepEqual(compose.services.api.build, { context: '.', target: 'api' });
  assert.deepEqual(compose.services.upgrade.build, { context: '.', target: 'api' });
  assert.equal(compose.services.web.build.target, 'web');
  // The remote-API client bakes its origin in at build time, so no published image can serve it.
  assert.equal(compose.services['web-client'].image, undefined);

  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.equal(
    dockerfile.split('org.opencontainers.image.source="https://github.com/Kevinjohn/capacitylens"')
      .length,
    3,
    'the api and web images each link to the repository',
  );

  const workflow = YAML.parse(
    await readFile(new URL('../.github/workflows/docker.yml', import.meta.url), 'utf8'),
  );
  assert.deepEqual(workflow.on.release.types, ['published']);
  const { publish, smoke } = workflow.jobs;
  assert.deepEqual(publish.permissions, { contents: 'read', packages: 'write' });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(smoke.permissions, undefined);
  const commands = publish.steps.map((step) => step.run ?? '');
  const position = (text) => commands.findIndex((run) => run.includes(text));
  // Images are smoked before they are pushed, and the pushed images are then run without a build.
  assert.ok(position('node scripts/smoke-docker-compose.mjs') >= 0);
  assert.ok(
    position('node scripts/smoke-docker-compose.mjs') < position('docker compose push api web'),
  );
  assert.ok(position('docker compose push api web') < position('--no-build --pull always'));
  assert.ok(smoke.steps.some((step) => (step.run ?? '').includes('--profile caddy up')));
});

test('the optional Caddy profile serves HTTPS in front of the web container only', async () => {
  const { default: YAML } = await import('yaml');
  const compose = YAML.parse(
    await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8'),
  );
  const { caddy } = compose.services;
  // Without the profile the stack is unchanged: no service outside it publishes 80 or 443.
  assert.deepEqual(caddy.profiles, ['caddy']);
  for (const [name, service] of Object.entries(compose.services))
    if (name !== 'caddy') assert.equal(service.profiles?.includes('caddy') ?? false, false);
  assert.deepEqual(caddy.ports, ['80:80', '443:443', '443:443/udp']);
  assert.match(caddy.image, /^docker\.io\/library\/caddy:[\d.]+-alpine@sha256:[0-9a-f]{64}$/);
  assert.deepEqual(caddy.command.slice(0, 3), ['caddy', 'reverse-proxy', '--from']);
  assert.match(caddy.command[3], /^\$\{CAPACITYLENS_PUBLIC_URL:\?/);
  assert.deepEqual(caddy.command.slice(4), ['--to', 'web:8080']);
  assert.equal(caddy.depends_on.web.condition, 'service_healthy');
  assert.equal(caddy.read_only, true);
  assert.deepEqual(caddy.cap_drop, ['ALL']);
  assert.deepEqual(caddy.cap_add, ['NET_BIND_SERVICE']);
  assert.deepEqual(caddy.security_opt, ['no-new-privileges:true']);
  assert.deepEqual(caddy.volumes, [
    'capacitylens-caddy-data:/data',
    'capacitylens-caddy-config:/config',
  ]);
});

test('native compilation tools are installed before dependencies and stay outside the runtime stage', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const stages = dockerfile.split(/(?=^FROM )/m);
  const dependencies = stages.find((stage) => / AS deps\n/.test(stage));
  const runtime = stages.find((stage) => / AS api\n/.test(stage));
  assert.ok(dependencies);
  assert.ok(runtime);
  assert.match(dependencies, /apt-get install --yes --no-install-recommends python3 make g\+\+/);
  assert.ok(
    dependencies.indexOf('apt-get install') <
      dependencies.indexOf('pnpm install --frozen-lockfile'),
  );
  assert.match(dependencies, /^FROM docker\.io\/library\/node:[^\n]+@sha256:[a-f0-9]{64} AS deps/m);
  assert.match(runtime, /^FROM docker\.io\/library\/node:[^\n]+ AS api/m);
  assert.doesNotMatch(runtime, /\b(?:python3|make|build-essential)\b|g\+\+/);
  const copies = [...runtime.matchAll(/^COPY --from=(.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(copies, ['server-deploy /prod/backend ./']);
});

test('the web image copies the Vite output consumed by the root standalone build', async () => {
  const ts = await import('typescript');
  const repository = fileURLToPath(new URL('../', import.meta.url));
  const configPath = join(repository, 'apps/frontend/vite.config.ts');
  const source = ts.createSourceFile(
    configPath,
    await readFile(configPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const outputDirectories = [];
  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === 'outDir' &&
      ts.isStringLiteral(node.initializer)
    )
      outputDirectories.push(node.initializer.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(outputDirectories.length, 1);
  const output = resolve(repository, 'apps/frontend', outputDirectories[0]);
  const containerOutput = `/app/${relative(repository, output).replaceAll('\\', '/')}`;
  const dockerfile = await readFile(join(repository, 'Dockerfile'), 'utf8');
  assert.ok(dockerfile.includes(`COPY --from=web-build ${containerOutput} /usr/share/nginx/html`));
  const manifest = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
  const build = manifest.scripts.build;
  assert.ok(
    build.indexOf('pnpm --dir apps/frontend build') <
      build.indexOf('node scripts/sync-adonis-public.mjs'),
  );
  assert.ok(
    build.indexOf('node scripts/sync-adonis-public.mjs') <
      build.indexOf('pnpm --dir apps/backend build'),
  );
  const sync = await readFile(join(repository, 'scripts/sync-adonis-public.mjs'), 'utf8');
  const syncedSource = /await cp\(new URL\('([^']+)'/.exec(sync)?.[1];
  assert.ok(syncedSource);
  assert.equal(
    fileURLToPath(
      new URL(syncedSource, new URL('../scripts/sync-adonis-public.mjs', import.meta.url)),
    ),
    `${output}/`,
  );
});
