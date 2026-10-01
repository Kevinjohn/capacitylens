import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { AuthConfigError } from "../auth";
import { parsePublicUrl } from "../authConfig/publicUrlConfig";

// `init` generates a production environment file so an operator never has to invent or paste a
// secret by hand. It runs before the server reads any other setting or opens the database: it only
// writes text, so it must work on a host that has nothing configured yet.

export const INIT_USAGE = "Usage: node server/dist/index.mjs init --public-url <url> --db <path> [--out <file>]";

export interface InitOptions {
  publicUrl: string;
  db: string;
  out: string | undefined;
}

export interface InitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

class InitUsageError extends Error {}

export function parseInitArguments(args: readonly string[]): InitOptions {
  let values: { "public-url"?: string; db?: string; out?: string };
  try {
    ({ values } = parseArgs({
      args: [...args],
      options: { "public-url": { type: "string" }, db: { type: "string" }, out: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (cause) {
    throw new InitUsageError(cause instanceof Error ? cause.message : String(cause), { cause });
  }
  if (!values["public-url"]) throw new InitUsageError("--public-url is required.");
  if (!values.db) throw new InitUsageError("--db is required.");
  if (values.out === "") throw new InitUsageError("--out needs a file path.");
  try {
    // The generated file sets NODE_ENV=production, so apply the server's own production rule now
    // rather than hand the operator a file the server will refuse at first start.
    parsePublicUrl(values["public-url"], "production", AuthConfigError);
  } catch (cause) {
    throw new InitUsageError(cause instanceof Error ? cause.message : String(cause), { cause });
  }
  return { publicUrl: values["public-url"], db: values.db, out: values.out };
}

// 48 random bytes encode to 64 base64 characters without padding, well above the 32-character
// minimum for the session secret, and contain no character an environment file needs to quote.
function createSecret(): string {
  return randomBytes(48).toString("base64");
}

export function buildEnvironmentFile(options: Pick<InitOptions, "publicUrl" | "db">): {
  contents: string;
  setupToken: string;
} {
  const setupToken = createSecret();
  const contents = [
    "NODE_ENV=production",
    `CAPACITYLENS_PUBLIC_URL=${options.publicUrl}`,
    `CAPACITYLENS_SECRET=${createSecret()}`,
    `CAPACITYLENS_SETUP_TOKEN=${setupToken}`,
    `CAPACITYLENS_DB=${options.db}`,
    "",
  ].join("\n");
  return { contents, setupToken };
}

function describeSetupToken(setupToken: string): string {
  return `Setup token: ${setupToken}\nYou enter this once, to create the Owner.\n`;
}

export function runInitCommand(args: readonly string[]): InitResult {
  let options: InitOptions;
  try {
    options = parseInitArguments(args);
  } catch (error) {
    if (!(error instanceof InitUsageError)) throw error;
    return { exitCode: 2, stdout: "", stderr: `capacitylens-server init: ${error.message}\n${INIT_USAGE}\n` };
  }
  const { contents, setupToken } = buildEnvironmentFile(options);
  if (options.out === undefined) {
    // The file goes to stdout so it can be redirected or pasted; the reminder goes to stderr so a
    // redirect captures only the five settings.
    return { exitCode: 0, stdout: contents, stderr: `\n${describeSetupToken(setupToken)}` };
  }
  try {
    // "wx" fails if the file exists: a second run must never replace the secret of a live install.
    writeFileSync(options.out, contents, { mode: 0o600, flag: "wx" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const reason =
      code === "EEXIST"
        ? `${options.out} already exists; refusing to overwrite it. Remove it first or choose another --out.`
        : `could not write ${options.out}: ${error instanceof Error ? error.message : String(error)}`;
    return { exitCode: 1, stdout: "", stderr: `capacitylens-server init: ${reason}\n` };
  }
  return { exitCode: 0, stdout: `Wrote ${options.out} (mode 0600).\n${describeSetupToken(setupToken)}`, stderr: "" };
}

function writeAll(stream: NodeJS.WriteStream, text: string): Promise<void> {
  // Pipe writes can be asynchronous; wait for the flush so process.exit cannot truncate the output.
  return new Promise((resolve, reject) => stream.write(text, (error) => (error ? reject(error) : resolve())));
}

export async function runInitCli(args: readonly string[]): Promise<number> {
  const result = runInitCommand(args);
  await writeAll(process.stdout, result.stdout);
  await writeAll(process.stderr, result.stderr);
  return result.exitCode;
}
