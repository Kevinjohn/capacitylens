#!/usr/bin/env node
// Installs or upgrades this release on a Linux systemd host. Run from the unpacked release:
//   sudo node install.mjs --public-url https://capacity.example.com --owner-email owner@example.com
// Run with --help for every option. Uses only Node built-ins, so it runs before anything else is set up.
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, realpath, rename, symlink, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const usage = `Usage: sudo node install.mjs [options]

Installs this release, or upgrades to it, and prints the first setup link.

  --public-url <url>      Public HTTPS address, for example https://capacity.example.com
  --owner-email <email>   Address that receives the setup link (asked on a first install)
  --mail-host <host>      SMTP host; leave out to set up mail later
  --mail-port <port>      SMTP port (default 587)
  --mail-user <user>      SMTP user name
  --mail-password <pw>    SMTP password
  --mail-from <email>     Sender address
  --proxy caddy|none      Write a same-machine Caddy site (default) or print the proxy settings
  --update-env            Change the given settings in an existing environment file
  --root <dir>            Write files under <dir> and print system commands instead of running them
  --dry-run               Print what would happen without changing anything
  --help                  Show this help

Each setting can also come from its environment variable: CAPACITYLENS_PUBLIC_URL,
CAPACITYLENS_OWNER_EMAIL and CAPACITYLENS_MAIL_HOST, _PORT, _USER, _PASSWORD and _FROM.`;

const paths = {
  env: '/etc/capacitylens.env',
  unit: '/etc/systemd/system/capacitylens.service',
  current: '/opt/capacitylens/current',
  data: '/var/lib/capacitylens',
  backups: '/var/lib/capacitylens/backups',
  caddyfile: '/etc/caddy/Caddyfile',
  caddySite: '/etc/caddy/capacitylens.caddy',
};
const user = 'capacitylens';
const mailKeys = ['HOST', 'PORT', 'USER', 'PASSWORD', 'FROM'].map(
  (part) => `CAPACITYLENS_MAIL_${part}`,
);

class InstallRefusal extends Error {}

/** Parse KEY=VALUE lines as systemd reads them: single or double quotes around a value are removed. */
function parseEnvironmentFile(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const quoted = /^(['"])(.*)\1$/.exec(match[2]);
    values[match[1]] = quoted ? quoted[2] : match[2];
  }
  return values;
}

function formatValue(key, value) {
  if (/^[\w.,:/@+=-]*$/.test(value)) return value;
  // systemd takes single-quoted text literally, so only a quote or control character cannot be written.
  if (/['\p{Cc}]/u.test(value))
    throw new InstallRefusal(`${key} cannot contain a single quote or control character.`);
  return `'${value}'`;
}

/** Fill the shipped example: listed keys get their value, and a commented-out listed key is enabled. */
function buildEnvironmentFile(example, values) {
  const pending = new Map(Object.entries(values));
  const lines = example.split('\n').map((line) => {
    const key = /^(?:# )?([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];
    if (!key || !pending.has(key)) return line;
    const value = pending.get(key);
    pending.delete(key);
    return `${key}=${formatValue(key, value)}`;
  });
  const extra = [...pending].map(([key, value]) => `${key}=${formatValue(key, value)}`);
  return [...lines.slice(0, lines.at(-1) === '' ? -1 : undefined), ...extra, ''].join('\n');
}

function parsePublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new InstallRefusal(`The public URL ${value} is not a URL.`);
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username)
    throw new InstallRefusal(
      `The public URL must be an HTTPS origin such as https://capacity.example.com, not ${value}.`,
    );
  return url;
}

function requireEmail(value, label) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    throw new InstallRefusal(`${label} must be an email address, not ${value}.`);
  return value;
}

/** Return complete mail settings, or none when no mail host is given. */
function requireMailSettings(mail) {
  if (!mail.CAPACITYLENS_MAIL_HOST) {
    const stray = mailKeys.filter((key) => key !== 'CAPACITYLENS_MAIL_PORT' && mail[key]);
    if (stray.length > 0) throw new InstallRefusal(`${stray.join(', ')} needs --mail-host.`);
    return {};
  }
  const settings = { ...mail, CAPACITYLENS_MAIL_PORT: mail.CAPACITYLENS_MAIL_PORT || '587' };
  const missing = mailKeys.filter((key) => !settings[key]);
  if (missing.length > 0)
    throw new InstallRefusal(`Mail delivery also needs ${missing.join(', ')}.`);
  const port = Number(settings.CAPACITYLENS_MAIL_PORT);
  if (!/^\d+$/.test(settings.CAPACITYLENS_MAIL_PORT) || port < 1 || port > 65535)
    throw new InstallRefusal('The mail port must be a number from 1 to 65535.');
  requireEmail(settings.CAPACITYLENS_MAIL_FROM, 'The mail sender');
  return settings;
}

function createPrompter() {
  if (!process.stdin.isTTY) return null;
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const lines = createInterface({ input: process.stdin, output, terminal: true });
  return {
    async ask(question, { secret = false } = {}) {
      // The question is written when asked; only the typed answer is hidden.
      const pending = lines.question(question);
      muted = secret;
      const answer = await pending;
      if (secret) process.stdout.write('\n');
      muted = false;
      return answer.trim();
    },
    close: () => lines.close(),
  };
}

/** Resolve each setting from its flag, then its environment variable, then a prompt on a terminal. */
async function readSettings(flags, { needsAnswers }) {
  const given = (flag, variable) => flags[flag] ?? process.env[variable] ?? '';
  const settings = {
    publicUrl: given('public-url', 'CAPACITYLENS_PUBLIC_URL'),
    ownerEmail: given('owner-email', 'CAPACITYLENS_OWNER_EMAIL'),
    mail: Object.fromEntries(
      mailKeys.map((key) => [key, given(`mail-${key.split('_').at(-1).toLowerCase()}`, key)]),
    ),
  };
  const prompter = needsAnswers ? createPrompter() : null;
  if (prompter) {
    try {
      settings.publicUrl ||= await prompter.ask('Public HTTPS address (https://…): ');
      settings.ownerEmail ||= await prompter.ask('Owner email address for the setup link: ');
      if (!settings.mail.CAPACITYLENS_MAIL_HOST) {
        settings.mail.CAPACITYLENS_MAIL_HOST = await prompter.ask(
          'SMTP host (leave blank to set up mail later): ',
        );
        if (settings.mail.CAPACITYLENS_MAIL_HOST) {
          settings.mail.CAPACITYLENS_MAIL_PORT ||=
            (await prompter.ask('SMTP port [587]: ')) || '587';
          settings.mail.CAPACITYLENS_MAIL_USER ||= await prompter.ask('SMTP user name: ');
          settings.mail.CAPACITYLENS_MAIL_PASSWORD ||= await prompter.ask('SMTP password: ', {
            secret: true,
          });
          settings.mail.CAPACITYLENS_MAIL_FROM ||= await prompter.ask('Sender address: ');
        }
      }
    } finally {
      prompter.close();
    }
  }
  return settings;
}

async function readOptionalFile(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function serviceCommand(...args) {
  return [
    'systemd-run',
    '--pipe',
    '--wait',
    '--collect',
    '--quiet',
    `--uid=${user}`,
    '-p',
    `WorkingDirectory=${paths.current}/backend`,
    '-p',
    `EnvironmentFile=${paths.env}`,
    '-p',
    'Environment=NODE_ENV=production',
    '/usr/bin/env',
    'node',
    'ace.js',
    ...args,
  ];
}

/** Effects for a real host, for files under a staging root, or for a dry run. */
function createEffects({ root, dryRun }) {
  const at = (path) => join(root, path);
  const show = (line) => console.log(line);
  const shellWord = (word) => (/^[\w./=@:+-]+$/.test(word) ? word : `'${word}'`);
  const skip = (argv) => show(`  skipped: ${argv.map(shellWord).join(' ')}`);
  return {
    read: (path) => readOptionalFile(at(path)),
    async write(path, content, mode) {
      if (dryRun) return show(`  would write ${path}`);
      await mkdir(dirname(at(path)), { recursive: true });
      const temporary = `${at(path)}.${process.pid}.tmp`;
      await rm(temporary, { force: true });
      await writeFile(temporary, content, { mode, flag: 'wx' });
      await rename(temporary, at(path));
      show(`  wrote ${path}`);
    },
    async directory(path, mode) {
      if (dryRun) return show(`  would create ${path}`);
      await mkdir(at(path), { recursive: true, mode });
    },
    async link(path, target) {
      if (dryRun) return show(`  would link ${path} -> ${target}`);
      await mkdir(dirname(at(path)), { recursive: true });
      const temporary = `${at(path)}.${process.pid}.tmp`;
      await rm(temporary, { force: true });
      await symlink(target, temporary);
      await rename(temporary, at(path));
      show(`  linked ${path} -> ${target}`);
    },
    run(argv, { capture = false } = {}) {
      if (dryRun || root !== '/') {
        skip(argv);
        return '';
      }
      const result = spawnSync(argv[0], argv.slice(1), {
        encoding: 'utf8',
        stdio: ['inherit', capture ? 'pipe' : 'inherit', 'inherit'],
      });
      if (result.error) throw new Error(`${argv[0]} could not start: ${result.error.message}`);
      if (result.status !== 0)
        throw new Error(`${argv.slice(0, 3).join(' ')} failed with status ${result.status}.`);
      return result.stdout ?? '';
    },
    simulated: dryRun || root !== '/',
  };
}

function printSetupLink(output, ownerEmail) {
  const line = output.trim().split('\n').at(-1) ?? '';
  let url;
  try {
    url = JSON.parse(line).url;
  } catch (error) {
    // Show the command's own output rather than lose a link that was issued.
    console.log(output);
    throw new Error('The bootstrap output was not the expected JSON line.', { cause: error });
  }
  if (!url) throw new Error('The bootstrap command printed no setup link.');
  console.log(`\nSetup link for ${ownerEmail}. It works once; send it privately:\n\n  ${url}\n`);
}

/**
 * Install or upgrade the release that contains this script.
 * @throws InstallRefusal when the input or the host state is refused; Error when a step fails.
 */
export async function install(argv) {
  const { values: flags } = parseArgs({
    args: argv,
    options: {
      'public-url': { type: 'string' },
      'owner-email': { type: 'string' },
      'mail-host': { type: 'string' },
      'mail-port': { type: 'string' },
      'mail-user': { type: 'string' },
      'mail-password': { type: 'string' },
      'mail-from': { type: 'string' },
      proxy: { type: 'string', default: 'caddy' },
      'update-env': { type: 'boolean', default: false },
      root: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (flags.help) return console.log(usage);
  if (!['caddy', 'none'].includes(flags.proxy))
    throw new InstallRefusal('--proxy must be caddy or none.');
  const root = flags.root ?? '/';
  const effects = createEffects({ root, dryRun: flags['dry-run'] });
  if (!effects.simulated && process.getuid?.() !== 0)
    throw new InstallRefusal('Run as root: sudo node install.mjs …, or preview with --dry-run.');
  if (!effects.simulated && flags.proxy === 'caddy' && spawnSync('caddy', ['version']).error)
    throw new InstallRefusal('Caddy is not installed. Install it first, or use --proxy none.');

  const release = dirname(await realpath(fileURLToPath(import.meta.url)));
  const existingText = await effects.read(paths.env);
  const existing = existingText === null ? null : parseEnvironmentFile(existingText);
  const settings = await readSettings(flags, { needsAnswers: existing === null });

  // Settings given on this run; an existing file supplies the rest.
  const given = { ...requireMailSettings(settings.mail) };
  if (settings.publicUrl) {
    const origin = parsePublicUrl(settings.publicUrl).origin;
    given.APP_URL = origin;
    given.CAPACITYLENS_PUBLIC_URL = origin;
  }
  if (settings.ownerEmail) requireEmail(settings.ownerEmail, 'The owner email');

  let envText = null;
  if (existing === null) {
    if (!given.CAPACITYLENS_PUBLIC_URL)
      throw new InstallRefusal('A first install needs --public-url.');
    if (!settings.ownerEmail) throw new InstallRefusal('A first install needs --owner-email.');
    const example = await readFile(join(release, 'capacitylens.env.example'), 'utf8');
    const secrets = {
      APP_KEY: randomBytes(32).toString('base64url'),
      CAPACITYLENS_SECRET: randomBytes(32).toString('base64url'),
    };
    envText = buildEnvironmentFile(example, { ...secrets, ...given });
  } else if (Object.keys(given).some((key) => existing[key] !== given[key])) {
    const changed = Object.keys(given).filter((key) => existing[key] !== given[key]);
    if (!flags['update-env'])
      throw new InstallRefusal(
        `${paths.env} already sets ${changed.join(', ')} differently. Nothing was changed. ` +
          'Re-run with --update-env to replace those settings; secrets are always kept.',
      );
    envText = buildEnvironmentFile(existingText, given);
  }
  console.log(existing === null ? 'Installing CapacityLens.' : 'Upgrading CapacityLens.');
  if (envText === null) console.log(`  kept ${paths.env}`);
  else await effects.write(paths.env, envText, 0o600);
  const environment = parseEnvironmentFile(envText ?? existingText);
  const publicUrl = parsePublicUrl(environment.CAPACITYLENS_PUBLIC_URL);
  const upstream = `${environment.HOST || '127.0.0.1'}:${environment.PORT || '8787'}`;

  if (effects.simulated || spawnSync('id', ['-u', user]).status !== 0)
    effects.run([
      'useradd',
      '--system',
      '--home',
      paths.data,
      '--shell',
      '/usr/sbin/nologin',
      user,
    ]);
  // Scheduled backups run inside the service whenever CAPACITYLENS_BACKUP_DIR is set.
  await effects.directory(paths.data, 0o700);
  await effects.directory(paths.backups, 0o700);
  effects.run(['chown', `${user}:${user}`, paths.data, paths.backups]);

  await effects.write(paths.unit, await readFile(join(release, 'capacitylens.service')), 0o644);
  effects.run(['systemctl', 'daemon-reload']);
  effects.run(['systemctl', 'stop', 'capacitylens']);
  await effects.directory(dirname(paths.current), 0o755);
  await effects.link(paths.current, release);
  // Backs up an existing database before migrating; on failure the service stays stopped.
  effects.run(serviceCommand('app:upgrade'));
  effects.run(['systemctl', 'enable', '--now', 'capacitylens']);

  const site = (await readFile(join(release, 'Caddyfile.example'), 'utf8'))
    .replaceAll('capacity.example.com', publicUrl.host)
    .replaceAll('127.0.0.1:8787', upstream);
  if (flags.proxy === 'caddy') {
    await effects.write(paths.caddySite, site, 0o644);
    const caddyfile = (await effects.read(paths.caddyfile)) ?? '';
    const importLine = `import ${paths.caddySite}`;
    if (!caddyfile.split('\n').includes(importLine))
      await effects.write(
        paths.caddyfile,
        `${caddyfile}${caddyfile && !caddyfile.endsWith('\n') ? '\n' : ''}${importLine}\n`,
        0o644,
      );
    effects.run(['systemctl', 'enable', '--now', 'caddy']);
    effects.run(['systemctl', 'reload', 'caddy']);
  } else {
    console.log(
      `\nPoint your HTTPS proxy for ${publicUrl.host} at http://${upstream}. The Caddy equivalent:\n\n` +
        `${site}\nFor nginx, use ${paths.current}/capacitylens.nginx.conf.`,
    );
  }

  console.log(
    `\nCapacityLens runs as the ${user} service at ${publicUrl.origin}.` +
      `\nVerified backups are written at startup and every 24 hours to ${environment.CAPACITYLENS_BACKUP_DIR}.`,
  );
  if (!settings.ownerEmail)
    return console.log('No setup link printed. Pass --owner-email to print one.');
  const output = effects.run(
    serviceCommand('account-kit:admission:bootstrap', settings.ownerEmail, '--role=viewer'),
    { capture: true },
  );
  if (!effects.simulated) printSetupLink(output, settings.ownerEmail);
}

if (process.argv[1] && (await realpath(process.argv[1])) === fileURLToPath(import.meta.url)) {
  try {
    await install(process.argv.slice(2));
  } catch (error) {
    const refused = error instanceof InstallRefusal || error?.code?.startsWith('ERR_PARSE_ARGS');
    console.error(refused ? `Refused: ${error.message}` : error);
    if (error?.code?.startsWith('ERR_PARSE_ARGS')) console.error(`\n${usage}`);
    process.exitCode = refused ? 2 : 1;
  }
}
