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
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  configureCaddy,
  issueSetupLink,
  readSetupLink,
  waitUntilReady,
} from '../packaging/release/install.mjs';

const release = fileURLToPath(new URL('../packaging/release/', import.meta.url));
const installer = join(release, 'install.mjs');
const firstInstall = [
  '--public-url',
  'https://capacity.example.com',
  '--owner-email',
  'diana@themyscira.example',
];

function runInstaller(args, options = {}) {
  return spawnSync(process.execPath, [installer, ...args], {
    encoding: 'utf8',
    input: '',
    ...options,
  });
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

// Everything a run left behind, except the empty folder that held its lock.
async function listWritten(root) {
  const names = await readdir(root);
  if (names.includes('run')) assert.deepEqual(await readdir(join(root, 'run')), []);
  return names.filter((name) => name !== 'run');
}

const readState = (root) => readFile(join(root, 'etc', 'capacitylens.install'), 'utf8');

const readEnv = async (root) =>
  Object.fromEntries(
    (await readFile(join(root, 'etc', 'capacitylens.env'), 'utf8'))
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );

test('a first install writes the environment with secrets, the unit, the Caddy site and the release link', async (context) => {
  const root = await makeRoot(context);
  // An existing Caddyfile keeps its restricted mode.
  await mkdir(join(root, 'etc', 'caddy'), { recursive: true });
  await writeFile(join(root, 'etc', 'caddy', 'Caddyfile'), '');
  await chmod(join(root, 'etc', 'caddy', 'Caddyfile'), 0o640);
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
  assert.equal((await lstat(join(root, 'etc', 'caddy', 'Caddyfile'))).mode & 0o777, 0o640);
  assert.match(await readState(root), /^proxy=caddy\nsetup=complete$/m);
  assert.deepEqual(await readdir(join(root, 'run')), [], 'The lock is released.');
  assert.equal(await readlink(join(root, 'opt', 'capacitylens', 'current')), release.slice(0, -1));
  assert.equal(
    (await lstat(join(root, 'var', 'lib', 'capacitylens', 'backups'))).mode & 0o777,
    0o700,
  );

  const commands = result.stdout.split('\n');
  const indexOf = (text) => commands.findIndex((line) => line.includes(text));
  for (const text of [
    'useradd --system',
    'chown -h capacitylens:capacitylens /var/lib/capacitylens /var/lib/capacitylens/backups',
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
    'wait for https://capacity.example.com/health/ready',
    'admission:bootstrap',
  ].map(indexOf);
  assert.ok(!order.includes(-1), String(order));
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
  assert.doesNotMatch(again.stdout, /setup link|admission:bootstrap|chown/i);
  assert.match(again.stdout, /wait for http:\/\/127\.0\.0\.1:8787\/health\/ready/);
});

test('a first install that stopped before its setup link is finished by the next run', async (context) => {
  const root = await makeRoot(context);
  assert.equal(runInstaller(['--root', root, ...firstInstall]).status, 0);
  await writeFile(join(root, 'etc', 'capacitylens.install'), 'proxy=caddy\nsetup=pending\n');

  const refused = runInstaller(['--root', root]);
  assert.equal(refused.status, 2);
  assert.match(
    refused.stderr,
    /first install did not finish\. Run the command again with --owner-email/,
  );

  const finished = runInstaller(['--root', root, '--owner-email', 'diana@themyscira.example']);
  assert.equal(finished.status, 0, finished.stderr);
  assert.match(finished.stdout, /Finishing the first installation/);
  assert.match(finished.stdout, /admission:bootstrap diana@themyscira\.example/);
  assert.match(await readState(root), /^setup=complete$/m);
});

test('an existing-proxy choice is remembered by later runs', async (context) => {
  const root = await makeRoot(context);
  assert.equal(runInstaller(['--root', root, '--proxy', 'none', ...firstInstall]).status, 0);
  const again = runInstaller(['--root', root]);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /Point your HTTPS proxy/);
  assert.doesNotMatch(again.stdout, /caddy validate|wrote \/etc\/caddy/);
  assert.match(await readState(root), /^proxy=none$/m);
});

test('a partial mail update is checked against the existing settings and changes only what is given', async (context) => {
  const root = await makeRoot(context);
  assert.equal(
    runInstaller(['--root', root, ...firstInstall, ...(await makeMail(context))]).status,
    0,
  );
  const before = await readEnv(root);
  const port = runInstaller(['--root', root, '--update-env', '--mail-port', '2525']);
  assert.equal(port.status, 0, port.stderr);
  const password = join(await makeRoot(context), 'new-password');
  await writeFile(password, 'n3w\n');
  const changed = runInstaller(['--root', root, '--update-env', '--mail-password-file', password]);
  assert.equal(changed.status, 0, changed.stderr);
  assert.deepEqual(await readEnv(root), {
    ...before,
    CAPACITYLENS_MAIL_PORT: '2525',
    CAPACITYLENS_MAIL_PASSWORD: 'n3w',
  });
  const invalid = runInstaller(['--root', root, '--update-env', '--mail-port', '70000']);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /mail port must be a number/);
});

test('an environment file outside the supported format is refused before anything changes', async (context) => {
  const root = await makeRoot(context);
  await mkdir(join(root, 'etc'));
  const text =
    'APP_URL=https://capacity.example.com\nCAPACITYLENS_PUBLIC_URL= "https://capacity.example.com"\n';
  await writeFile(join(root, 'etc', 'capacitylens.env'), text);
  const result = runInstaller(['--root', root]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Line 2 of \/etc\/capacitylens\.env is not KEY=value/);
  assert.equal(await readFile(join(root, 'etc', 'capacitylens.env'), 'utf8'), text);
  assert.deepEqual(await listWritten(root), ['etc']);
});

test('refuses links in place of service folders and links out of the staging root', async (context) => {
  const outside = await makeRoot(context);
  const linked = await makeRoot(context);
  await mkdir(join(linked, 'var', 'lib', 'capacitylens'), { recursive: true });
  await mkdir(join(linked, 'elsewhere'));
  await symlink(join(linked, 'elsewhere'), join(linked, 'var', 'lib', 'capacitylens', 'backups'));
  const backups = runInstaller(['--root', linked, ...firstInstall]);
  assert.equal(backups.status, 2);
  assert.match(backups.stderr, /\/var\/lib\/capacitylens\/backups must be a directory, not a link/);
  assert.deepEqual((await listWritten(linked)).sort(), ['elsewhere', 'var']);

  const escaping = await makeRoot(context);
  await symlink(outside, join(escaping, 'etc'));
  const etc = runInstaller(['--root', escaping, ...firstInstall]);
  assert.equal(etc.status, 2);
  assert.match(etc.stderr, /leads outside the staging root/);
  assert.deepEqual(await readdir(outside), []);
});

test('a second run is refused while the lock is held', async (context) => {
  const root = await makeRoot(context);
  await mkdir(join(root, 'run'));
  await writeFile(join(root, 'run', 'capacitylens-install.lock'), '1\n');
  const result = runInstaller(['--root', root, ...firstInstall]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Another install is running .*remove that file and run again/);
  assert.deepEqual(await readdir(root), ['run']);
  assert.deepEqual(await readdir(join(root, 'run')), ['capacitylens-install.lock']);
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
    assert.deepEqual(await listWritten(root), [], args.join(' '));
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

test('refuses a staging root that is the real root and a release outside /opt/capacitylens', async (context) => {
  // An empty root must not fall back to the working directory, so run from a scratch one.
  const cwd = await makeRoot(context);
  for (const root of ['', '/', '/tmp/..']) {
    const result = runInstaller(['--root', root, ...firstInstall], { cwd });
    assert.equal(result.status, 2, root);
    assert.match(
      result.stderr,
      /--root (needs a staging directory|must be a staging directory, not \/)/,
    );
  }
  const placed = runInstaller(['--dry-run', ...firstInstall]);
  assert.equal(placed.status, 2);
  assert.match(placed.stderr, /Unpack the release into \/opt\/capacitylens/);
  assert.deepEqual(await readdir(cwd), []);
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
    'capacitylens.install',
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

// Fails the named write or command once, as a real failure would not repeat on restore.
function makeEffects(files, failing) {
  const commands = [];
  let failed = false;
  const fail = (action) => {
    if (failed || !action.startsWith(failing)) return;
    failed = true;
    throw new Error(`${failing} failed`);
  };
  return {
    commands,
    read: async (path) => files.get(path) ?? null,
    async write(path, content) {
      fail(`write ${path}`);
      files.set(path, String(content));
    },
    remove: async (path) => void files.delete(path),
    run(argv) {
      commands.push(argv.join(' '));
      fail(argv.join(' '));
      return '';
    },
  };
}

test('Caddy is validated before reload, and a refused configuration is put back', async () => {
  const stock = ':80 {\n\tfile_server\n}\n';
  for (const failing of [
    'write /etc/caddy/Caddyfile',
    'caddy validate',
    'systemctl reload caddy',
  ]) {
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

test('readiness polling waits through pending answers and gives up at its deadline', async () => {
  const answers = [
    Promise.reject(new Error('connection refused')),
    Promise.resolve({ ok: false, status: 503 }),
    Promise.resolve({ ok: true, status: 200 }),
  ];
  let calls = 0;
  await waitUntilReady('http://127.0.0.1:8787/health/ready', {
    timeoutMs: 5_000,
    intervalMs: 1,
    fetch: () => answers[calls++],
  });
  assert.equal(calls, 3);

  await assert.rejects(
    () =>
      waitUntilReady('http://127.0.0.1:8787/health/ready', {
        timeoutMs: 40,
        intervalMs: 5,
        fetch: async () => ({ ok: false, status: 503 }),
      }),
    /http:\/\/127\.0\.0\.1:8787\/health\/ready was not ready after 0\.04 seconds \(status 503\)/,
  );
});

test('a setup link printed before a failing exit is shown once and kept out of the error', () => {
  const url = 'https://capacity.example.com/invite/secret-bearer';
  const logged = [];
  const capture = () => ({ status: 1, stdout: `{"result":"printed","url":"${url}","fault":{}}\n` });
  assert.throws(
    () => issueSetupLink(capture, 'diana@themyscira.example', (line) => logged.push(line)),
    (error) => {
      assert.match(error.message, /failed with status 1; the link above was still issued/);
      assert.ok(!JSON.stringify(error).includes('secret-bearer') && !error.message.includes(url));
      assert.equal(error.stdout, undefined);
      return true;
    },
  );
  assert.equal(logged.length, 1);
  assert.ok(logged[0].includes(url));

  const silent = [];
  assert.throws(
    () =>
      issueSetupLink(
        () => ({ status: 0, stdout: '' }),
        'diana@themyscira.example',
        (line) => silent.push(line),
      ),
    /printed no setup link/,
  );
  assert.deepEqual(silent, []);
});
