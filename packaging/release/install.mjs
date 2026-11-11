#!/usr/bin/env node
// Installs or upgrades this release on a Linux systemd host. Run from the unpacked release:
//   sudo node install.mjs --public-url https://capacity.example.com --owner-email owner@example.com
// Run with --help for every option. Uses only Node built-ins, so it runs before anything else is set up.
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import {
  chmod,
  chown,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
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
  --proxy caddy|none      Write a same-machine Caddy site (the default) or print the proxy
                          settings; the choice is remembered for later runs
  --update-env            Change the given settings in an existing environment file
  --root <dir>            Write files under <dir> and print system commands instead of running them
  --dry-run               Print what would happen without changing anything
  --help                  Show this help

Unpack the release into /opt/capacitylens so the service user can read it.`;

const paths = {
  env: '/etc/capacitylens.env',
  // Root-owned record of the proxy choice and whether the first setup link was issued.
  state: '/etc/capacitylens.install',
  lock: '/run/capacitylens-install.lock',
  unit: '/etc/systemd/system/capacitylens.service',
  current: '/opt/capacitylens/current',
  data: '/var/lib/capacitylens',
  backups: '/var/lib/capacitylens/backups',
  caddyfile: '/etc/caddy/Caddyfile',
  caddySite: '/etc/caddy/capacitylens.caddy',
};
const releaseParent = '/opt/capacitylens';
const user = 'capacitylens';
// A fixed name, so systemd refuses a second migration while one is still running.
const upgradeUnit = 'capacitylens-upgrade';
const serviceReadyMs = 60_000;
// Certificate issuance can take a while on a first start.
const httpsReadyMs = 120_000;
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

/**
 * Parse the environment file format this command writes and accepts: comments, blank lines and
 * `KEY=value`, `KEY='value'` or `KEY="value"` without escapes. Anything else is refused before the
 * file is changed, because systemd may read it differently.
 * @throws InstallRefusal naming the first line outside that format.
 */
function parseEnvironmentFile(text, path) {
  const values = {};
  for (const [index, line] of text.split('\n').entries()) {
    if (/^\s*(?:[#;].*)?$/.test(line)) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(?:'([^']*)'|"([^"\\$`]*)"|([^\s'"\\]*))[ \t]*$/.exec(
      line,
    );
    if (!match)
      throw new InstallRefusal(
        `Line ${index + 1} of ${path} is not KEY=value, KEY='value' or KEY="value". ` +
          'Correct it with sudoedit, then run the command again.',
      );
    values[match[1]] = match[2] ?? match[3] ?? match[4];
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
    const active = lines.findLastIndex((existing) => existing.startsWith(`${key}=`));
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

/**
 * Return the mail settings to write: the supplied ones, checked together with those already in
 * the environment file. A newly configured host without a port gets port 587.
 * @throws InstallRefusal when the combined settings are incomplete or invalid.
 */
function requireMailChanges(supplied, current) {
  const changes = Object.fromEntries(Object.entries(supplied).filter(([, value]) => value));
  const combined = {
    ...Object.fromEntries(mailKeys.map((key) => [key, current[key] ?? ''])),
    ...changes,
  };
  if (!combined.CAPACITYLENS_MAIL_HOST) {
    const stray = Object.keys(changes);
    if (stray.length > 0)
      throw new InstallRefusal(
        `${stray.map((key) => mailOptions[key]).join(', ')} needs --mail-host.`,
      );
    return {};
  }
  if (!combined.CAPACITYLENS_MAIL_PORT)
    combined.CAPACITYLENS_MAIL_PORT = changes.CAPACITYLENS_MAIL_PORT = '587';
  const missing = mailKeys.filter((key) => !combined[key]);
  if (missing.length > 0)
    throw new InstallRefusal(
      `Mail delivery also needs ${missing.map((key) => mailOptions[key]).join(', ')}.`,
    );
  const port = Number(combined.CAPACITYLENS_MAIL_PORT);
  if (!/^\d+$/.test(combined.CAPACITYLENS_MAIL_PORT) || port < 1 || port > 65535)
    throw new InstallRefusal('The mail port must be a number from 1 to 65535.');
  requireEmail(combined.CAPACITYLENS_MAIL_FROM, 'The mail sender');
  return changes;
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
async function readSettings(flags, { askAll, askOwner }) {
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
  const prompter = askAll || askOwner ? createPrompter() : null;
  if (!prompter) return settings;
  const { mail } = settings;
  try {
    if (askAll) settings.publicUrl ||= await prompter.ask('Public HTTPS address (https://…): ');
    settings.ownerEmail ||= await prompter.ask('Owner email address for the setup link: ');
    if (askAll) {
      mail.CAPACITYLENS_MAIL_HOST ||= await prompter.ask(
        'SMTP host (leave blank to set up mail later): ',
      );
      if (mail.CAPACITYLENS_MAIL_HOST) {
        mail.CAPACITYLENS_MAIL_PORT ||= (await prompter.ask('SMTP port [587]: ')) || '587';
        mail.CAPACITYLENS_MAIL_USER ||= await prompter.ask('SMTP user name: ');
        mail.CAPACITYLENS_MAIL_PASSWORD ||= await prompter.ask('SMTP password: ', {
          secret: true,
        });
        mail.CAPACITYLENS_MAIL_FROM ||= await prompter.ask('Sender address: ');
      }
    }
  } finally {
    prompter.close();
  }
  return settings;
}

async function lstatOptional(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Map a host path into the staging root, refusing one whose existing parts resolve outside it. The
 * last part is not resolved for a link, which is replaced rather than followed.
 * @throws InstallRefusal when a symbolic link leads out of the staging root.
 */
async function requireStagedPath(root, path, { followLast = true } = {}) {
  const target = join(root, path);
  const parts = relative(root, target).split(sep);
  let current = root;
  for (const part of followLast ? parts : parts.slice(0, -1)) {
    current = join(current, part);
    if (!(await lstatOptional(current))) break;
    const actual = await realpath(current);
    if (actual !== root && !actual.startsWith(`${root}${sep}`))
      throw new InstallRefusal(`${current} leads outside the staging root ${root}.`);
  }
  return target;
}

export function bootstrapCommand(ownerEmail) {
  return serviceCommand(['account-kit:admission:bootstrap', ownerEmail, '--role=viewer']);
}

function upgradeCommand() {
  return serviceCommand(['app:upgrade'], { unit: upgradeUnit });
}

/**
 * Run an ace command as the service user with the service environment. systemd expands `$` in the
 * command line, so a literal one is written as `$$`.
 */
function serviceCommand(args, { unit } = {}) {
  return [
    'systemd-run',
    ...(unit ? [`--unit=${unit}`] : []),
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
    ...args.map((arg) => arg.replaceAll('$', () => '$$')),
  ];
}

/**
 * Decide whether root should hand a service folder to the service user. A folder created by this
 * run is handed over; so is one an interrupted first install left root-owned with mode 0700.
 * @returns false when the service user already owns it.
 * @throws InstallRefusal for any other owner or mode.
 */
export function isHandoverNeeded(stats, { uid, created, resumable }) {
  if (stats.uid === uid) return false;
  if (created || (resumable && stats.uid === 0 && (stats.mode & 0o7777) === 0o700)) return true;
  throw new InstallRefusal(
    `${paths.data} belongs to uid ${stats.uid} with mode ${(stats.mode & 0o7777).toString(8)}, ` +
      `not to ${user}. Correct its owner by hand, then run the command again.`,
  );
}

function readServiceIds() {
  const read = (flag) => {
    const result = spawnSync('id', [flag, user], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Could not look up the ${user} user.`);
    return Number(result.stdout.trim());
  };
  return { uid: read('-u'), gid: read('-g') };
}

/** Effects for a real host, for files under a staging root, or for a dry run. */
function createEffects({ root, dryRun }) {
  const simulated = dryRun || root !== '/';
  const at = (path, options) => (root === '/' ? path : requireStagedPath(root, path, options));
  const show = (line) => console.log(line);
  const shellWord = (word) => (/^[\w./=@:+-]+$/.test(word) ? word : `'${word}'`);
  const skip = (argv) => show(`  skipped: ${argv.map(shellWord).join(' ')}`);
  return {
    simulated,
    async read(path) {
      try {
        return await readFile(await at(path), 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        if (error?.code === 'EACCES')
          throw new InstallRefusal(`Cannot read ${path}. Run with sudo.`, { cause: error });
        throw error;
      }
    },
    /** Replace a file atomically, keeping the mode and owner of the file it replaces. */
    async write(path, content, mode) {
      if (dryRun) return show(`  would write ${path}`);
      const target = await at(path);
      const current = await lstatOptional(target);
      if (current && !current.isFile())
        throw new InstallRefusal(`${path} is not a regular file; replace it by hand.`);
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${process.pid}.tmp`;
      await rm(temporary, { force: true });
      await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
      if (current) await chown(temporary, current.uid, current.gid);
      await chmod(temporary, current ? current.mode & 0o7777 : mode);
      await rename(temporary, target);
      show(`  wrote ${path}`);
    },
    async remove(path) {
      if (dryRun) return show(`  would remove ${path}`);
      await rm(await at(path), { force: true });
    },
    /**
     * Create a root-owned directory, in a root-owned parent, with its final mode if it is missing.
     * @throws InstallRefusal when the path exists but is not a directory.
     */
    async directory(path, mode) {
      const target = await at(path);
      const current = await lstatOptional(target);
      if (current?.isDirectory()) return;
      if (current) throw new InstallRefusal(`${path} must be a directory, not a link or file.`);
      if (dryRun) return show(`  would create ${path}`);
      await mkdir(dirname(target), { recursive: true });
      await mkdir(target, { mode });
    },
    /**
     * Create the service's data folder in its root-owned parent and give it to the service user.
     * Ownership changes through a descriptor opened without following links, never by path.
     * @throws InstallRefusal when the path is a link or not a directory, or has an unexpected owner.
     */
    async serviceDirectory(path, { resumable }) {
      const target = await at(path);
      if (dryRun) {
        const current = await lstatOptional(target);
        if (current && !current.isDirectory())
          throw new InstallRefusal(`${path} must be a directory, not a link or file.`);
        return show(`  would create ${path} and give it to ${user}`);
      }
      await mkdir(dirname(target), { recursive: true });
      let created = true;
      try {
        await mkdir(target, { mode: 0o700 });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        created = false;
      }
      let handle;
      try {
        handle = await open(
          target,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
      } catch (error) {
        if (error?.code === 'ELOOP' || error?.code === 'ENOTDIR')
          throw new InstallRefusal(`${path} must be a directory, not a link or file.`, {
            cause: error,
          });
        throw error;
      }
      try {
        if (simulated) return show(`  skipped: give ${path} to ${user}`);
        const ids = readServiceIds();
        if (isHandoverNeeded(await handle.stat(), { ...ids, created, resumable }))
          await handle.chown(ids.uid, ids.gid);
      } finally {
        await handle.close();
      }
    },
    async link(path, target) {
      if (dryRun) return show(`  would link ${path} -> ${target}`);
      const destination = await at(path, { followLast: false });
      await mkdir(dirname(destination), { recursive: true });
      const temporary = `${destination}.${process.pid}.tmp`;
      await rm(temporary, { force: true });
      await symlink(target, temporary);
      await rename(temporary, destination);
      show(`  linked ${path} -> ${target}`);
    },
    /**
     * Hold the installer lock until the returned release function runs.
     * @throws InstallRefusal when another run holds it.
     */
    async lock(path) {
      if (dryRun) return async () => {};
      const target = await at(path);
      await mkdir(dirname(target), { recursive: true });
      try {
        await writeFile(target, `${process.pid}\n`, { flag: 'wx' });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        throw new InstallRefusal(
          `Another install is running (${path} exists). If none is, and ` +
            `\`systemctl is-active ${upgradeUnit}\` does not report active, remove that file and run again.`,
        );
      }
      return () => rm(target, { force: true });
    },
    run(argv) {
      if (simulated) return skip(argv);
      const result = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit' });
      if (result.error) throw new Error(`${argv[0]} could not start: ${result.error.message}`);
      if (result.status !== 0)
        throw new Error(`${argv.slice(0, 3).join(' ')} failed with status ${result.status}.`);
    },
    /** Run a command and return its exit status and standard output without judging either. */
    capture(argv) {
      if (simulated) {
        skip(argv);
        return { status: 0, stdout: '' };
      }
      const result = spawnSync(argv[0], argv.slice(1), {
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'inherit'],
      });
      if (result.error) throw new Error(`${argv[0]} could not start: ${result.error.message}`);
      return { status: result.status, stdout: result.stdout ?? '' };
    },
    async waitUntilReady(url, timeoutMs) {
      if (simulated) return show(`  skipped: wait for ${url}`);
      await waitUntilReady(url, { timeoutMs });
    },
  };
}

/**
 * Poll a readiness URL until it answers with success.
 * @throws Error naming the last response when the time runs out.
 */
export async function waitUntilReady(url, { timeoutMs, intervalMs = 1_000, fetch: get = fetch }) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try {
      const response = await get(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      last = `status ${response.status}`;
    } catch (error) {
      last = error.message;
    }
    if (Date.now() + intervalMs > deadline) break;
    await delay(intervalMs);
  }
  throw new Error(`${url} was not ready after ${timeoutMs / 1000} seconds (${last}).`);
}

/** Read the setup link from the bootstrap command's JSON result line, or null when it has none. */
export function readSetupLink(output) {
  for (const line of output.trim().split('\n').reverse()) {
    if (!line.startsWith('{')) continue;
    let result;
    try {
      result = JSON.parse(line);
    } catch {
      // Not the result line; keep looking.
      continue;
    }
    if (typeof result?.url === 'string') return result.url;
  }
  return null;
}

/**
 * Issue the Owner's invitation and print its link once. The command's output carries the bearer,
 * so it never goes into an error.
 * @throws Error when the command fails or prints no link, after printing any link it issued.
 */
export function issueSetupLink(capture, ownerEmail, log = console.log) {
  const { status, stdout } = capture(bootstrapCommand(ownerEmail));
  const url = readSetupLink(stdout);
  if (url) log(`\nSetup link for ${ownerEmail}. It works once; send it privately:\n\n  ${url}\n`);
  if (status !== 0)
    throw new Error(
      `The bootstrap command failed with status ${status}` +
        `${url ? '; the link above was still issued' : ''}.`,
    );
  if (!url) throw new Error('The bootstrap command printed no setup link.');
}

/**
 * Write the Caddy site and its import, then validate and reload Caddy. On any failure both files
 * are put back as they were before the error is raised.
 * @throws Error when a write, validation or the reload fails.
 */
export async function configureCaddy(effects, site) {
  const previous = {
    [paths.caddySite]: await effects.read(paths.caddySite),
    [paths.caddyfile]: await effects.read(paths.caddyfile),
  };
  const caddyfile = previous[paths.caddyfile] ?? '';
  const importLine = `import ${paths.caddySite}`;
  try {
    await effects.write(paths.caddySite, site, 0o644);
    if (!caddyfile.split('\n').includes(importLine))
      await effects.write(
        paths.caddyfile,
        `${caddyfile}${caddyfile && !caddyfile.endsWith('\n') ? '\n' : ''}${importLine}\n`,
        0o644,
      );
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

function parseState(text) {
  return Object.fromEntries(
    (text ?? '')
      .split('\n')
      .map((line) => /^(proxy|setup)=(\S+)$/.exec(line))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
}

function buildState({ proxy, setup }) {
  return `# Written by install.mjs: the proxy choice and whether the first setup link was issued.\nproxy=${proxy}\nsetup=${setup}\n`;
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
      proxy: { type: 'string' },
      'update-env': { type: 'boolean', default: false },
      root: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (flags.help) return console.log(usage);
  if (flags.proxy !== undefined && !['caddy', 'none'].includes(flags.proxy))
    throw new InstallRefusal('--proxy must be caddy or none.');
  const root = flags.root === undefined ? '/' : await resolveStagingRoot(flags.root);
  const effects = createEffects({ root, dryRun: flags['dry-run'] });
  if (!effects.simulated && process.getuid?.() !== 0)
    throw new InstallRefusal('Run as root: sudo node install.mjs …, or preview with --dry-run.');
  const release = dirname(await realpath(fileURLToPath(import.meta.url)));
  // The service user must be able to read the release; /opt/capacitylens is world-readable.
  if (root === '/' && dirname(release) !== releaseParent)
    throw new InstallRefusal(`Unpack the release into ${releaseParent}, not ${dirname(release)}.`);
  const unlock = await effects.lock(paths.lock);
  try {
    // A migration started by a run that was killed keeps running; never start a second one.
    if (
      !effects.simulated &&
      spawnSync('systemctl', ['is-active', '--quiet', upgradeUnit]).status === 0
    )
      throw new InstallRefusal(
        `A database migration from an earlier run is still running. Wait until ` +
          `\`systemctl is-active ${upgradeUnit}\` no longer reports active, then run again.`,
      );
    await installRelease({ flags, effects, release });
  } finally {
    await unlock();
  }
}

async function installRelease({ flags, effects, release }) {
  const state = parseState(await effects.read(paths.state));
  const existingText = await effects.read(paths.env);
  const existing = existingText === null ? null : parseEnvironmentFile(existingText, paths.env);
  // A first install that stopped before its setup link was issued is finished by the next run.
  const firstInstall = existing === null || state.setup === 'pending';
  const proxy = flags.proxy ?? state.proxy ?? 'caddy';
  if (!effects.simulated && proxy === 'caddy' && spawnSync('caddy', ['version']).error)
    throw new InstallRefusal('Caddy is not installed. Install it first, or use --proxy none.');
  const settings = await readSettings(flags, { askAll: existing === null, askOwner: firstInstall });

  // Settings given on this run; an existing file supplies the rest.
  const given = requireMailChanges(settings.mail, existing ?? {});
  if (settings.publicUrl) {
    const origin = parsePublicUrl(settings.publicUrl).origin;
    given.APP_URL = origin;
    given.CAPACITYLENS_PUBLIC_URL = origin;
  }
  if (settings.ownerEmail) requireEmail(settings.ownerEmail, 'The owner email');
  if (existing === null && !given.CAPACITYLENS_PUBLIC_URL)
    throw new InstallRefusal('A first install needs --public-url.');
  if (firstInstall && !settings.ownerEmail)
    throw new InstallRefusal(
      existing === null
        ? 'A first install needs --owner-email.'
        : 'The first install did not finish. Run the command again with --owner-email.',
    );

  let envText = null;
  if (existing === null) {
    const example = await readFile(join(release, 'capacitylens.env.example'), 'utf8');
    const secrets = {
      APP_KEY: randomBytes(32).toString('base64url'),
      CAPACITYLENS_SECRET: randomBytes(32).toString('base64url'),
    };
    envText = buildEnvironmentFile(example, { ...secrets, ...given });
  } else {
    const changed = Object.keys(given).filter((key) => existing[key] !== given[key]);
    if (changed.length > 0) {
      if (!flags['update-env'])
        throw new InstallRefusal(
          `${paths.env} already sets ${changed.join(', ')} differently. Nothing was changed. ` +
            'Re-run with --update-env to replace those settings; secrets are always kept.',
        );
      envText = buildEnvironmentFile(existingText, given);
    }
  }
  const environment = envText === null ? existing : parseEnvironmentFile(envText, paths.env);
  const publicUrl = parsePublicUrl(environment.CAPACITYLENS_PUBLIC_URL);
  const upstream = `${environment.HOST || '127.0.0.1'}:${environment.PORT || '8787'}`;

  console.log(
    existing === null
      ? 'Installing CapacityLens.'
      : firstInstall
        ? 'Finishing the first installation.'
        : 'Upgrading CapacityLens.',
  );
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
  // Root never creates or changes anything inside the service-owned data folder, so the backups
  // folder is made by the service user. runuser ships with util-linux on every systemd distribution.
  // Scheduled backups run inside the service whenever CAPACITYLENS_BACKUP_DIR is set.
  await effects.serviceDirectory(paths.data, { resumable: firstInstall });
  effects.run(['runuser', '-u', user, '--', 'mkdir', '-p', '-m', '0700', paths.backups]);

  const setup = firstInstall ? 'pending' : (state.setup ?? 'complete');
  if (state.proxy !== proxy || state.setup !== setup)
    await effects.write(paths.state, buildState({ proxy, setup }), 0o644);
  if (envText === null) console.log(`  kept ${paths.env}`);
  else await effects.write(paths.env, envText, 0o600);

  await effects.write(paths.unit, await readFile(join(release, 'capacitylens.service')), 0o644);
  effects.run(['systemctl', 'daemon-reload']);
  effects.run(['systemctl', 'stop', 'capacitylens']);
  await effects.directory(releaseParent, 0o755);
  await effects.link(paths.current, release);
  // Backs up an existing database before migrating; on failure the service stays stopped.
  effects.run(upgradeCommand());
  effects.run(['systemctl', 'enable', '--now', 'capacitylens']);

  const site = (await readFile(join(release, 'Caddyfile.example'), 'utf8'))
    .replaceAll('capacity.example.com', publicUrl.host)
    .replaceAll('127.0.0.1:8787', upstream);
  if (proxy === 'caddy') await configureCaddy(effects, site);
  else {
    console.log(
      `\nPoint your HTTPS proxy for ${publicUrl.host} at http://${upstream}. The Caddy equivalent:\n\n` +
        `${site}\nFor nginx, use ${paths.current}/capacitylens.nginx.conf.`,
    );
  }

  await effects.waitUntilReady(`http://${upstream}/health/ready`, serviceReadyMs);
  let httpsFailure = null;
  if (proxy === 'caddy') {
    try {
      await effects.waitUntilReady(`${publicUrl.origin}/health/ready`, httpsReadyMs);
    } catch (error) {
      httpsFailure = error;
    }
  }
  console.log(`\nCapacityLens runs as the ${user} service at ${publicUrl.origin}.`);
  console.log(
    environment.CAPACITYLENS_BACKUP_DIR
      ? `Verified backups are written at startup and every 24 hours to ${environment.CAPACITYLENS_BACKUP_DIR}.`
      : `Backups are not scheduled: ${paths.env} does not set CAPACITYLENS_BACKUP_DIR. Add ` +
          `CAPACITYLENS_BACKUP_DIR=${paths.backups} with sudoedit, then run: sudo systemctl restart capacitylens`,
  );

  // An upgrade prints a link only when one is asked for.
  if (settings.ownerEmail) {
    if (effects.simulated) effects.capture(bootstrapCommand(settings.ownerEmail));
    else issueSetupLink(effects.capture, settings.ownerEmail);
    if (firstInstall)
      await effects.write(paths.state, buildState({ proxy, setup: 'complete' }), 0o644);
  }
  if (httpsFailure)
    throw new Error(
      `CapacityLens is running, but HTTPS at ${publicUrl.origin} is not serving yet. Check that ` +
        'DNS points at this host, ports 80 and 443 are open and `journalctl -u caddy` shows a ' +
        'certificate, then open the address.',
      { cause: httpsFailure },
    );
}

/**
 * Resolve a staging root through its nearest existing ancestor, so a link anywhere above it is
 * followed once here and every later path compares against the same canonical root.
 * @throws InstallRefusal when the root is empty or names the real root.
 */
async function resolveStagingRoot(value) {
  if (!value) throw new InstallRefusal('--root needs a staging directory.');
  const missing = [];
  let existing = resolve(value);
  for (;;) {
    try {
      existing = await realpath(existing);
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      missing.unshift(basename(existing));
      existing = dirname(existing);
    }
  }
  const root = join(existing, ...missing);
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
