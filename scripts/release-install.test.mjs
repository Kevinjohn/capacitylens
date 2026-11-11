import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { configureCaddy, readSetupLink } from '../packaging/release/install.mjs';

const release = fileURLToPath(new URL('../packaging/release/', import.meta.url));
const installer = join(release, 'install.mjs');
const firstInstall = [
  '--public-url',
  'https://capacity.example.com',
  '--owner-email',
  'diana@themyscira.example',
];

function runInstaller(args) {
  return spawnSync(process.execPath, [installer, ...args], { encoding: 'utf8', input: '' });
}

async function makeRoot(context) {
  const root = await mkdtemp(join(tmpdir(), 'capacitylens-install-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

// The mail options, with the password in a file outside the staging root.
async function makeMail(context) {
  const directory = await makeRoot(context);
  const passwordFile = join(directory, 'smtp-password');
  await writeFile(passwordFile, 's3cr$t pw\\x\n');
  return [
    '--mail-host',
    'smtp.example.com',
    '--mail-user',
    'diana',
    '--mail-password-file',
    passwordFile,
    '--mail-from',
    'capacity@example.com',
  ];
}

const readEnv = async (root) =>
  Object.fromEntries(
    (await readFile(join(root, 'etc', 'capacitylens.env'), 'utf8'))
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );

test('a first install writes the environment with secrets, the unit, the Caddy site and the release link', async (context) => {
  const root = await makeRoot(context);
  const result = runInstaller(['--root', root, ...firstInstall, ...(await makeMail(context))]);
  assert.equal(result.status, 0, result.stderr);

  const env = await readEnv(root);
  assert.match(env.APP_KEY, /^[\w-]{43}$/);
  assert.match(env.CAPACITYLENS_SECRET, /^[\w-]{43}$/);
  assert.notEqual(env.APP_KEY, env.CAPACITYLENS_SECRET);
  assert.equal(env.APP_URL, 'https://capacity.example.com');
  assert.equal(env.CAPACITYLENS_PUBLIC_URL, 'https://capacity.example.com');
  assert.equal(env.CAPACITYLENS_MAIL_HOST, 'smtp.example.com');
  assert.equal(env.CAPACITYLENS_MAIL_PORT, '587');
  assert.equal(env.CAPACITYLENS_MAIL_PASSWORD, "'s3cr$t pw\\x'");
  assert.equal(env.CAPACITYLENS_BACKUP_DIR, '/var/lib/capacitylens/backups');
  assert.equal((await lstat(join(root, 'etc', 'capacitylens.env'))).mode & 0o777, 0o600);
  for (const secret of [env.APP_KEY, env.CAPACITYLENS_SECRET, 's3cr$t'])
    assert.ok(!result.stdout.includes(secret), 'Secrets must not be printed.');

  assert.equal(
    await readFile(join(root, 'etc', 'systemd', 'system', 'capacitylens.service'), 'utf8'),
    await readFile(join(release, 'capacitylens.service'), 'utf8'),
  );
  const site = await readFile(join(root, 'etc', 'caddy', 'capacitylens.caddy'), 'utf8');
  assert.match(
    site,
    /^capacity\.example\.com \{\n\tencode zstd gzip\n\treverse_proxy 127\.0\.0\.1:8787\n\}$/m,
  );
  assert.equal(
    await readFile(join(root, 'etc', 'caddy', 'Caddyfile'), 'utf8'),
    'import /etc/caddy/capacitylens.caddy\n',
  );
  assert.equal(await readlink(join(root, 'opt', 'capacitylens', 'current')), release.slice(0, -1));
  assert.equal(
    (await lstat(join(root, 'var', 'lib', 'capacitylens', 'backups'))).mode & 0o777,
    0o700,
  );

  const commands = result.stdout.split('\n');
  const indexOf = (text) => commands.findIndex((line) => line.includes(text));
  for (const text of [
    'useradd --system',
    'chown capacitylens:capacitylens /var/lib/capacitylens /var/lib/capacitylens/backups',
    'systemctl stop capacitylens',
    '--uid=capacitylens -p WorkingDirectory=/opt/capacitylens/current/backend -p EnvironmentFile=/etc/capacitylens.env',
    'ace.js app:upgrade',
    'systemctl enable --now capacitylens',
    'systemctl reload caddy',
    'wait for http://127.0.0.1:8787/health/ready',
    'ace.js account-kit:admission:bootstrap diana@themyscira.example --role=viewer',
  ])
    assert.ok(indexOf(text) >= 0, text);
  // The old release stops before current moves; the service starts only after the upgrade.
  const order = [
    'systemctl stop capacitylens',
    'linked /opt/capacitylens/current',
    'ace.js app:upgrade',
    'systemctl enable --now capacitylens',
    'caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile',
    'systemctl reload caddy',
    'wait for http://127.0.0.1:8787/health/ready',
    'admission:bootstrap',
  ].map(indexOf);
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
});

test('a re-run keeps the environment and its secrets and adds the Caddy import once', async (context) => {
  const root = await makeRoot(context);
  assert.equal(runInstaller(['--root', root, ...firstInstall]).status, 0);
  const caddyfile = join(root, 'etc', 'caddy', 'Caddyfile');
  await writeFile(caddyfile, `:80 {\n\tfile_server\n}\n${await readFile(caddyfile, 'utf8')}`);
  const env = await readFile(join(root, 'etc', 'capacitylens.env'), 'utf8');

  const again = runInstaller(['--root', root, '--public-url', 'https://capacity.example.com']);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(await readFile(join(root, 'etc', 'capacitylens.env'), 'utf8'), env);
  assert.equal(
    await readFile(caddyfile, 'utf8'),
    ':80 {\n\tfile_server\n}\nimport /etc/caddy/capacitylens.caddy\n',
  );
  assert.match(again.stdout, /kept \/etc\/capacitylens\.env/);
  assert.doesNotMatch(again.stdout, /setup link|admission:bootstrap/i);
});

test('a changed setting is refused unless --update-env, which keeps the secrets', async (context) => {
  const root = await makeRoot(context);
  assert.equal(runInstaller(['--root', root, ...firstInstall]).status, 0);
  const before = await readEnv(root);

  const refused = runInstaller(['--root', root, '--public-url', 'https://plan.example.com']);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /already sets APP_URL, CAPACITYLENS_PUBLIC_URL differently/);
  assert.deepEqual(await readEnv(root), before);

  const updated = runInstaller([
    '--root',
    root,
    '--update-env',
    '--public-url',
    'https://plan.example.com',
  ]);
  assert.equal(updated.status, 0, updated.stderr);
  const after = await readEnv(root);
  assert.equal(after.CAPACITYLENS_PUBLIC_URL, 'https://plan.example.com');
  assert.equal(after.APP_KEY, before.APP_KEY);
  assert.equal(after.CAPACITYLENS_SECRET, before.CAPACITYLENS_SECRET);
  assert.match(
    await readFile(join(root, 'etc', 'caddy', 'capacitylens.caddy'), 'utf8'),
    /^plan\.example\.com \{/m,
  );
});

test('--update-env replaces the active assignment and keeps commented ones', async (context) => {
  const root = await makeRoot(context);
  await mkdir(join(root, 'etc'));
  const env = join(root, 'etc', 'capacitylens.env');
  await writeFile(
    env,
    [
      'APP_URL=https://capacity.example.com',
      'CAPACITYLENS_PUBLIC_URL=https://first.example.com',
      '# CAPACITYLENS_PUBLIC_URL=https://commented.example.com',
      'CAPACITYLENS_PUBLIC_URL=https://capacity.example.com',
      '# CAPACITYLENS_MAIL_HOST=smtp.example.com',
      '',
    ].join('\n'),
  );
  const result = runInstaller([
    '--root',
    root,
    '--update-env',
    '--public-url',
    'https://plan.example.com',
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(env, 'utf8'),
    [
      'APP_URL=https://plan.example.com',
      'CAPACITYLENS_PUBLIC_URL=https://first.example.com',
      '# CAPACITYLENS_PUBLIC_URL=https://commented.example.com',
      'CAPACITYLENS_PUBLIC_URL=https://plan.example.com',
      '# CAPACITYLENS_MAIL_HOST=smtp.example.com',
      '',
    ].join('\n'),
  );
  assert.match(result.stdout, /Backups are not scheduled: .*CAPACITYLENS_BACKUP_DIR/);
  assert.doesNotMatch(result.stdout, /undefined/);
});

test('refuses incomplete or unsafe input without writing anything', async (context) => {
  const mail = await makeMail(context);
  const quoted = join(await makeRoot(context), 'quoted-password');
  await writeFile(quoted, "it's");
  const cases = [
    [
      ['--public-url', 'http://capacity.example.com', '--owner-email', 'diana@themyscira.example'],
      /HTTPS origin/,
    ],
    [
      [
        '--public-url',
        'https://capacity.example.com/app',
        '--owner-email',
        'diana@themyscira.example',
      ],
      /HTTPS origin/,
    ],
    [['--public-url', 'https://capacity.example.com'], /first install needs --owner-email/],
    [['--owner-email', 'diana@themyscira.example'], /first install needs --public-url/],
    [[...firstInstall, ...mail.slice(0, 2)], /also needs --mail-user, --mail-password-file/],
    [[...firstInstall, '--mail-user', 'diana'], /--mail-user needs --mail-host/],
    [
      [...firstInstall, ...mail.slice(0, 4), '--mail-password-file', quoted, ...mail.slice(6)],
      /single quote/,
    ],
    [[...firstInstall, '--mail-password', 'x'], /Unknown option '--mail-password'/],
    [[...firstInstall, '--proxy', 'apache'], /--proxy must be caddy or none/],
  ];
  for (const [args, message] of cases) {
    const root = await makeRoot(context);
    const result = runInstaller(['--root', root, ...args]);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, message);
    assert.deepEqual(await readdir(root), [], args.join(' '));
  }
});

test(
  'refuses to change the host without root',
  { skip: process.getuid?.() === 0 },
  async (context) => {
    const result = runInstaller(firstInstall);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Run as root/);

    const root = await makeRoot(context);
    await mkdir(join(root, 'etc'));
    await writeFile(join(root, 'etc', 'capacitylens.env'), 'APP_KEY=x\n');
    await chmod(join(root, 'etc', 'capacitylens.env'), 0o000);
    const unreadable = runInstaller(['--root', root, '--dry-run']);
    assert.equal(unreadable.status, 2);
    assert.match(
      unreadable.stderr,
      /^Refused: Cannot read .*capacitylens\.env\. Run with sudo\.\n$/,
    );
  },
);

test('refuses a staging root that is the real root and a release outside /opt/capacitylens', () => {
  for (const root of ['', '/', '/tmp/..']) {
    const result = runInstaller(['--root', root, ...firstInstall]);
    assert.equal(result.status, 2, root);
    assert.match(
      result.stderr,
      /--root (needs a staging directory|must be a staging directory, not \/)/,
    );
  }
  const placed = runInstaller(['--dry-run', ...firstInstall]);
  assert.equal(placed.status, 2);
  assert.match(placed.stderr, /Unpack the release into \/opt\/capacitylens/);
});

test('a dry run writes nothing and an existing proxy gets the settings printed', async (context) => {
  const root = await makeRoot(context);
  const dry = runInstaller(['--root', root, '--dry-run', ...firstInstall]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /would write \/etc\/capacitylens\.env/);
  assert.deepEqual(await readdir(root), []);

  const proxied = runInstaller(['--root', root, '--proxy', 'none', ...firstInstall]);
  assert.equal(proxied.status, 0, proxied.stderr);
  assert.match(
    proxied.stdout,
    /Point your HTTPS proxy for capacity\.example\.com at http:\/\/127\.0\.0\.1:8787/,
  );
  assert.match(proxied.stdout, /reverse_proxy 127\.0\.0\.1:8787/);
  assert.deepEqual(await readdir(join(root, 'etc')).then((names) => names.sort()), [
    'capacitylens.env',
    'systemd',
  ]);
});

test('reads the setup link from the bootstrap result line', () => {
  const url = 'https://capacity.example.com/invite/abc';
  assert.equal(readSetupLink(`{"result":"printed","url":"${url}"}\n`), url);
  assert.equal(readSetupLink(`notice\n{"result":"printed","url":"${url}","fault":{}}\n`), url);
  assert.equal(readSetupLink('{"result":"printed"}\n'), null);
  assert.equal(readSetupLink('{not json\nE_FAILED: no\n'), null);
  assert.equal(readSetupLink(''), null);
});

function makeEffects(files, failing) {
  const commands = [];
  return {
    commands,
    read: async (path) => files.get(path) ?? null,
    write: async (path, content) => void files.set(path, String(content)),
    remove: async (path) => void files.delete(path),
    run(argv) {
      commands.push(argv.join(' '));
      if (argv.join(' ').startsWith(failing)) throw new Error(`${failing} failed`);
      return '';
    },
  };
}

test('Caddy is validated before reload, and a refused configuration is put back', async () => {
  const stock = ':80 {\n\tfile_server\n}\n';
  for (const failing of ['caddy validate', 'systemctl reload caddy']) {
    const files = new Map([['/etc/caddy/Caddyfile', stock]]);
    const effects = makeEffects(files, failing);
    await assert.rejects(() => configureCaddy(effects, 'site {}\n'), /were restored/);
    assert.deepEqual([...files], [['/etc/caddy/Caddyfile', stock]], failing);
  }
  const files = new Map([['/etc/caddy/capacitylens.caddy', 'old {}\n']]);
  const effects = makeEffects(files, 'never');
  await configureCaddy(effects, 'site {}\n');
  assert.deepEqual(effects.commands, [
    'caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile',
    'systemctl enable --now caddy',
    'systemctl reload caddy',
  ]);
  assert.equal(files.get('/etc/caddy/capacitylens.caddy'), 'site {}\n');
  assert.equal(files.get('/etc/caddy/Caddyfile'), 'import /etc/caddy/capacitylens.caddy\n');
});
