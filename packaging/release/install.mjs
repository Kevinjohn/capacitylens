#!/usr/bin/env node
// Installs or upgrades this release on a Linux systemd host. Run from the unpacked release:
//   sudo node install.mjs --public-url https://capacity.example.com --owner-email owner@example.com
// Run with --help for every option. Uses only Node built-ins, so it runs before anything else is set up.
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, realpath, rename, symlink, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const usage = `Usage: sudo node install.mjs [options]

Installs this release, or upgrades to it, and prints the first setup link.

  --public-url <url>      Public HTTPS address, for example https://capacity.example.com
  --owner-email <email>   Address that receives the setup link (asked on a first install)
  --mail-host <host>      SMTP host; leave out to set up mail later
  --mail-port <port>      SMTP port (default 587)
  --mail-user <user>      SMTP user name
  --mail-password-file <path>
                          File holding the SMTP password (asked, hidden, on a terminal)
  --mail-from <email>     Sender address
  --proxy caddy|none      Write a same-machine Caddy site (default) or print the proxy settings
  --update-env            Change the given settings in an existing environment file
  --root <dir>            Write files under <dir> and print system commands instead of running them
  --dry-run               Print what would happen without changing anything
  --help                  Show this help

Unpack the release into /opt/capacitylens so the service user can read it.`;

const paths = {
  env: '/etc/capacitylens.env',
  unit: '/etc/systemd/system/capacitylens.service',
  current: '/opt/capacitylens/current',
  data: '/var/lib/capacitylens',
  backups: '/var/lib/capacitylens/backups',
  caddyfile: '/etc/caddy/Caddyfile',
  caddySite: '/etc/caddy/capacitylens.caddy',
};
const releaseParent = '/opt/capacitylens';
const user = 'capacitylens';
const readyTimeoutMs = 60_000;
// Each mail setting and the option that supplies it.
const mailOptions = {
  CAPACITYLENS_MAIL_HOST: '--mail-host',
  CAPACITYLENS_MAIL_PORT: '--mail-port',
  CAPACITYLENS_MAIL_USER: '--mail-user',
  CAPACITYLENS_MAIL_PASSWORD: '--mail-password-file',
  CAPACITYLENS_MAIL_FROM: '--mail-from',
};
const mailKeys = Object.keys(mailOptions);

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

/**
 * Set each value in an environment file. The last active assignment wins, as in systemd, so that
 * one is replaced; a commented-out `# KEY=` line is enabled only when no active one exists.
 */
function buildEnvironmentFile(text, values) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const extra = [];
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${formatValue(key, value)}`;
    const active = lines.findLastIndex((existing) => existing.trim().startsWith(`${key}=`));
    const index =
      active >= 0 ? active : lines.findIndex((existing) => existing.startsWith(`# ${key}=`));
    if (index >= 0) lines[index] = line;
    else extra.push(line);
  }
  return [...lines, ...extra, ''].join('\n');
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
    if (stray.length > 0)
      throw new InstallRefusal(
        `${stray.map((key) => mailOptions[key]).join(', ')} needs --mail-host.`,
      );
    return {};
  }
  const settings = { ...mail, CAPACITYLENS_MAIL_PORT: mail.CAPACITYLENS_MAIL_PORT || '587' };
  const missing = mailKeys.filter((key) => !settings[key]);
  if (missing.length > 0)
    throw new InstallRefusal(
      `Mail delivery also needs ${missing.map((key) => mailOptions[key]).join(', ')}.`,
    );
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

/** Resolve each setting from its option, then from a prompt on a terminal. */
async function readSettings(flags, { needsAnswers }) {
  const passwordFile = flags['mail-password-file'];
  const settings = {
    publicUrl: flags['public-url'] ?? '',
    ownerEmail: flags['owner-email'] ?? '',
    mail: {
      CAPACITYLENS_MAIL_HOST: flags['mail-host'] ?? '',
      CAPACITYLENS_MAIL_PORT: flags['mail-port'] ?? '',
      CAPACITYLENS_MAIL_USER: flags['mail-user'] ?? '',
      // Read as given: the file belongs to the operator, not to the staging root.
      CAPACITYLENS_MAIL_PASSWORD: passwordFile
        ? (await readFile(passwordFile, 'utf8')).replace(/\r?\n$/, '')
        : '',
      CAPACITYLENS_MAIL_FROM: flags['mail-from'] ?? '',
    },
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
    if (error?.code === 'EACCES')
      throw new InstallRefusal(`Cannot read ${path}. Run with sudo.`, { cause: error });
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
    async remove(path) {
      if (dryRun) return show(`  would remove ${path}`);
      await rm(at(path), { force: true });
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
      if (result.status !== 0) {
        const failure = new Error(
          `${argv.slice(0, 3).join(' ')} failed with status ${result.status}.`,
        );
        // A captured command may have printed something the caller must still show.
        failure.stdout = result.stdout ?? '';
        throw failure;
      }
      return result.stdout ?? '';
    },
    async waitUntilReady(url) {
      if (dryRun || root !== '/') return show(`  skipped: wait for ${url}`);
      const deadline = Date.now() + readyTimeoutMs;
      let last = 'no response';
      while (Date.now() < deadline) {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
          if (response.ok) return;
          last = `status ${response.status}`;
        } catch (error) {
          last = error.message;
        }
        await delay(1_000);
      }
      throw new Error(
        `The service was not ready at ${url} after ${readyTimeoutMs / 1000} seconds (${last}). ` +
          'Check: sudo journalctl -u capacitylens',
      );
    },
    simulated: dryRun || root !== '/',
  };
}

/** Read the setup link from the bootstrap command's JSON result line, or null when it has none. */
export function readSetupLink(output) {
  for (const line of output.trim().split('\n').reverse()) {
    if (!line.startsWith('{')) continue;
    let result;
    try {
      result = JSON.parse(line);
    } catch {
      // Not the result line; the caller shows the raw output when no link is found.
      continue;
    }
    if (typeof result?.url === 'string') return result.url;
  }
  return null;
}

/**
 * Write the Caddy site and its import, then validate and reload Caddy. On any failure both files
 * are put back as they were before the error is raised.
 * @throws Error when validation or the reload fails.
 */
export async function configureCaddy(effects, site) {
  const previous = {
    [paths.caddySite]: await effects.read(paths.caddySite),
    [paths.caddyfile]: await effects.read(paths.caddyfile),
  };
  const caddyfile = previous[paths.caddyfile] ?? '';
  const importLine = `import ${paths.caddySite}`;
  await effects.write(paths.caddySite, site, 0o644);
  if (!caddyfile.split('\n').includes(importLine))
    await effects.write(
      paths.caddyfile,
      `${caddyfile}${caddyfile && !caddyfile.endsWith('\n') ? '\n' : ''}${importLine}\n`,
      0o644,
    );
  try {
    effects.run(['caddy', 'validate', '--config', paths.caddyfile, '--adapter', 'caddyfile']);
    effects.run(['systemctl', 'enable', '--now', 'caddy']);
    effects.run(['systemctl', 'reload', 'caddy']);
  } catch (error) {
    for (const [path, content] of Object.entries(previous)) {
      if (content === null) await effects.remove(path);
      else await effects.write(path, content, 0o644);
    }
    throw new Error(
      `Caddy refused the new configuration, so ${paths.caddyfile} and ${paths.caddySite} were ` +
        'restored. CapacityLens itself is running; fix Caddy and run the command again.',
      { cause: error },
    );
  }
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
      'mail-password-file': { type: 'string' },
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
  const root = flags.root === undefined ? '/' : await resolveStagingRoot(flags.root);
  const effects = createEffects({ root, dryRun: flags['dry-run'] });
  if (!effects.simulated && process.getuid?.() !== 0)
    throw new InstallRefusal('Run as root: sudo node install.mjs …, or preview with --dry-run.');
  const release = dirname(await realpath(fileURLToPath(import.meta.url)));
  // The service user must be able to read the release; /opt/capacitylens is world-readable.
  if (root === '/' && dirname(release) !== releaseParent)
    throw new InstallRefusal(`Unpack the release into ${releaseParent}, not ${dirname(release)}.`);
  if (!effects.simulated && flags.proxy === 'caddy' && spawnSync('caddy', ['version']).error)
    throw new InstallRefusal('Caddy is not installed. Install it first, or use --proxy none.');

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
  await effects.directory(releaseParent, 0o755);
  await effects.link(paths.current, release);
  // Backs up an existing database before migrating; on failure the service stays stopped.
  effects.run(serviceCommand('app:upgrade'));
  effects.run(['systemctl', 'enable', '--now', 'capacitylens']);

  const site = (await readFile(join(release, 'Caddyfile.example'), 'utf8'))
    .replaceAll('capacity.example.com', publicUrl.host)
    .replaceAll('127.0.0.1:8787', upstream);
  if (flags.proxy === 'caddy') await configureCaddy(effects, site);
  else {
    console.log(
      `\nPoint your HTTPS proxy for ${publicUrl.host} at http://${upstream}. The Caddy equivalent:\n\n` +
        `${site}\nFor nginx, use ${paths.current}/capacitylens.nginx.conf.`,
    );
  }

  console.log(`\nCapacityLens runs as the ${user} service at ${publicUrl.origin}.`);
  console.log(
    environment.CAPACITYLENS_BACKUP_DIR
      ? `Verified backups are written at startup and every 24 hours to ${environment.CAPACITYLENS_BACKUP_DIR}.`
      : `Backups are not scheduled: ${paths.env} does not set CAPACITYLENS_BACKUP_DIR. Add ` +
          `CAPACITYLENS_BACKUP_DIR=${paths.backups} with sudoedit, then run: sudo systemctl restart capacitylens`,
  );
  // An upgrade prints no link unless one is asked for.
  if (!settings.ownerEmail) return;
  await effects.waitUntilReady(`http://${upstream}/health/ready`);
  let output;
  let failure = null;
  try {
    output = effects.run(
      serviceCommand('account-kit:admission:bootstrap', settings.ownerEmail, '--role=viewer'),
      { capture: true },
    );
  } catch (error) {
    output = error.stdout ?? '';
    failure = error;
  }
  if (!effects.simulated) {
    const url = readSetupLink(output);
    // A link that was issued is shown even when a later step of the command failed.
    if (url)
      console.log(
        `\nSetup link for ${settings.ownerEmail}. It works once; send it privately:\n\n  ${url}\n`,
      );
    else console.log(output);
    if (!url && !failure) throw new Error('The bootstrap command printed no setup link.');
  }
  if (failure) throw failure;
}

/** Resolve a staging root, refusing one that is empty or names the real root. */
async function resolveStagingRoot(value) {
  if (!value) throw new InstallRefusal('--root needs a staging directory.');
  let root = resolve(value);
  try {
    root = await realpath(root);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (root === '/') throw new InstallRefusal('--root must be a staging directory, not /.');
  return root;
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
