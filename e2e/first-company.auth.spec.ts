import { expect, test } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

// This journey needs an empty native installation, independently of the shared role fixtures.
test("native first sign-in creates one company and opens a usable schedule", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const backend = fileURLToPath(new URL("../apps/backend/", import.meta.url));
  expect(existsSync(join(backend, "public/index.html")), "Build and sync the production SPA before this journey.").toBe(
    true,
  );
  const scratch = mkdtempSync(join(tmpdir(), "capacitylens-first-company-"));
  const listener = createServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${port}`;
  const token = "first-company-browser-setup-2026-0123456789";
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(port),
    LOG_LEVEL: "fatal",
    APP_KEY: "first-company-browser-key-0123456789abcdef",
    APP_URL: origin,
    SESSION_DRIVER: "database",
    CAPACITYLENS_DB: join(scratch, "native.db"),
    CAPACITYLENS_MODE: "password-only",
    CAPACITYLENS_PUBLIC_URL: origin,
    CAPACITYLENS_SECRET: "first-company-browser-secret-0123456789abcdef",
    CAPACITYLENS_SETUP_TOKEN: token,
    CAPACITYLENS_PASSWORD_BREACH_CHECK: "false",
    CAPACITYLENS_CREATE_ADMIN_ADMIN: "false",
    CAPACITYLENS_ALLOW_OPEN_SIGNUP: "true",
    CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: "",
    CAPACITYLENS_BACKUP_DIR: "",
  };
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const migrate = spawnSync(process.execPath, ["ace.js", "migration:run", "--force", "--no-schema-generate"], {
      cwd: backend,
      env: environment,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(migrate.status, `${migrate.stdout}\n${migrate.stderr}`).toBe(0);
    child = spawn(process.execPath, ["--import=@poppinss/ts-exec", "bin/server.ts"], {
      cwd: backend,
      env: environment,
      stdio: "ignore",
    });
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`${origin}/health/ready`)).ok;
          } catch {
            return false;
          }
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    await page.goto(origin);
    await page.getByTestId("owner-setup-name").fill("Bruce Wayne");
    await page.getByTestId("owner-setup-email").fill("bruce@wayne.example");
    await page.getByTestId("owner-setup-password").fill("first-company-password-2026");
    await page.getByTestId("owner-setup-token").fill(token);
    await page.getByTestId("owner-setup-submit").click();
    await expect(page.getByTestId("company-setup")).toBeVisible();
    const additionalIdentity = {
      name: "Clark Kent",
      email: "clark@wayne.example",
      password: "first-company-teammate-password-2026",
    };
    const prematureSignup = await request.post(`${origin}/api/auth/sign-up`, {
      data: additionalIdentity,
      headers: { "x-capacitylens-setup-token": token, "sec-fetch-site": "same-origin" },
    });
    expect(prematureSignup.status()).toBe(403);
    expect((await prematureSignup.json()).code).toBe("SIGN_UP_CLOSED");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill("bruce@wayne.example");
    await page.getByLabel("Password", { exact: true }).fill("first-company-password-2026");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByTestId("company-setup")).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(1);
    await page.getByLabel("Company name").fill("Wayne Enterprises");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: process.env.CAPACITYLENS_SETUP_CAPTURE_PATH ?? testInfo.outputPath("company_first_run_setup.png"),
    });
    await page.getByRole("button", { name: "Create company", exact: true }).click();
    await expect(page.getByTestId("company-setup")).toHaveCount(0);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    const companies = await page.request.get(`${origin}/api/accounts`);
    const accounts = (await companies.json()) as { id: string; role: string }[];
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.role).toBe("owner");
    const state = await page.request.get(`${origin}/api/state?accountId=${accounts[0]!.id}`);
    const data = await state.json();
    expect(data.accounts[0].name).toBe("Wayne Enterprises");
    expect(data.clients).toHaveLength(1);
    expect(data.clients[0].builtin).toBe(true);
    const duplicate = await page.request.post(`${origin}/api/installation/company`, {
      data: { name: "Stark Industries" },
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(duplicate.status()).toBe(409);
    const permittedSignup = await request.post(`${origin}/api/auth/sign-up`, {
      data: additionalIdentity,
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(permittedSignup.status()).toBe(201);
    await page.reload();
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect(page.getByTestId("company-setup")).toHaveCount(0);
  } finally {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const timer = setTimeout(() => child?.kill("SIGKILL"), 5_000);
      await exited.finally(() => clearTimeout(timer));
    }
    rmSync(scratch, { recursive: true, force: true });
  }
});
