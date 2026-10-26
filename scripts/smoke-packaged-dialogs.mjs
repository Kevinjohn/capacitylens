/* global document, getComputedStyle, innerWidth, innerHeight, scrollY, requestAnimationFrame, window */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:https";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { runPackagedSmoke } from "./smoke-packaged-server.mjs";

/** Reject a deployment whose policy permits the stylesheet injection this journey guards. */
export function assertStrictStylePolicy(policy) {
  const directives = new Map(
    (policy ?? "").split(";").map((directive) => {
      const [name, ...values] = directive.trim().split(/\s+/);
      return [name, values];
    }),
  );
  assert.deepEqual(directives.get("style-src"), ["'self'"]);
  assert.deepEqual(directives.get("style-src-attr"), ["'unsafe-inline'"]);
  assert.ok(!directives.has("style-src-elem"), "An overriding style-element policy bypasses the strict guard.");
}

/** Fail on observed runtime style-policy violations without retaining document URLs or source text. */
export function assertNoStyleViolations(violations) {
  assert.deepEqual(violations, [], "The production browser blocked an application stylesheet.");
}

async function startTlsEdge(baseUrl, workDir) {
  const keyPath = join(workDir, "browser-key.pem");
  const certificatePath = join(workDir, "browser-certificate.pem");
  const certificate = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      keyPath,
      "-out",
      certificatePath,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (certificate.error) throw certificate.error;
  assert.equal(certificate.status, 0, "Could not create the disposable loopback TLS certificate (openssl required).");
  const edge = createServer(
    { key: await readFile(keyPath), cert: await readFile(certificatePath) },
    (incoming, outgoing) => {
      const upstream = request(
        new URL(incoming.url, baseUrl),
        {
          method: incoming.method,
          headers: incoming.headers,
        },
        (response) => {
          outgoing.writeHead(response.statusCode, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on("error", () => {
        outgoing.writeHead(502);
        outgoing.end("Native acceptance upstream unavailable");
      });
      incoming.pipe(upstream);
    },
  );
  edge.listen(0, "127.0.0.1");
  await once(edge, "listening");
  const address = edge.address();
  assert.ok(address && typeof address !== "string");
  return { edge, origin: `https://127.0.0.1:${address.port}` };
}

async function observeStyleViolations(page) {
  const violations = [];
  await page.exposeFunction("__recordPackagedStyleViolation", (violation) => violations.push(violation));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      if (event.effectiveDirective.startsWith("style-src")) {
        globalThis.__recordPackagedStyleViolation({ directive: event.effectiveDirective, blocked: event.blockedURI });
      }
    });
  });
  return violations;
}

async function proveCspGuard(context, origin) {
  // A separate page deliberately reproduces blocked injection. It cannot contaminate app observations.
  const probe = await context.newPage();
  try {
    const violations = await observeStyleViolations(probe);
    const response = await probe.goto(origin);
    assertStrictStylePolicy(response.headers()["content-security-policy"]);
    await probe.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = "body { --packaged-blocked-probe: applied; }";
      document.head.append(style);
    });
    await expect.poll(() => violations.length).toBeGreaterThan(0);
    assert.equal(
      await probe.evaluate(() => getComputedStyle(document.body).getPropertyValue("--packaged-blocked-probe")),
      "",
    );
    assert.throws(() => assertNoStyleViolations(violations));
  } finally {
    await probe.close();
  }
}

async function lockState(page) {
  return page.evaluate(() => ({
    count: document.body.getAttribute("data-scroll-locked"),
    overflow: getComputedStyle(document.body).overflow,
    gap: document.body.style.getPropertyValue("--removed-body-scroll-bar-size"),
    margin: getComputedStyle(document.body).marginRight,
    scrollY,
    styles: document.querySelectorAll("style").length,
  }));
}

async function expectLocked(page, count, baseline) {
  await expect(page.locator("body")).toHaveAttribute("data-scroll-locked", String(count));
  await expect
    .poll(async () => {
      const state = await lockState(page);
      return { ...state, gap: parseFloat(state.gap), margin: parseFloat(state.margin) };
    })
    .toMatchObject({
      count: String(count),
      overflow: "hidden",
      styles: baseline.styles,
      gap: baseline.scrollbar,
      margin: baseline.scrollbar,
    });
}

async function expectUnlocked(page, baseline) {
  await expect(page.locator("body")).not.toHaveAttribute("data-scroll-locked");
  // Chromium can resolve the restored margin after the lock attribute's effect cleanup.
  await expect
    .poll(() => lockState(page))
    .toMatchObject({
      gap: baseline.gap,
      overflow: baseline.overflow,
      margin: baseline.margin,
      styles: baseline.styles,
    });
}

async function proveDialogScrolling(page, dialog) {
  const box = await dialog.boundingBox();
  assert.ok(box);
  const viewport = page.viewportSize();
  assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 1, "Dialog extends outside the viewport.");
  const geometry = await dialog.evaluate((element) => ({
    height: element.clientHeight,
    content: element.scrollHeight,
  }));
  assert.ok(geometry.content > geometry.height, "This viewport did not exercise dialog overflow.");
  const before = await dialog.evaluate((element) => element.scrollTop);
  await dialog.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => dialog.evaluate((element) => element.scrollTop)).toBeGreaterThan(before);
  await dialog.getByRole("button", { name: "Save", exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
}

async function proveBackgroundLock(page, baseline) {
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(4, 4);
  await page.mouse.wheel(0, 500);
  // Two rendered frames allow the native wheel scroll to be applied before reading the position.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  assert.equal(await page.evaluate(() => window.scrollY), before);
  await expectLocked(page, 1, baseline);
}

async function exerciseDialogs(page, { origin, resourceName, outputDir }) {
  await page.goto(`${origin}/resources`);
  await expect(page.getByRole("button", { name: "Add resource", exact: true })).toBeVisible();
  const orientation = page.getByTestId("product-orientation");
  if (await orientation.isVisible()) await orientation.getByRole("button", { name: "Got it" }).click();

  // Real overflow makes scrollbar compensation measurable even on this one-person installation.
  // Only fixture geometry is added; native app controls, stylesheets and modal code stay unchanged.
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.id = "packaged-scroll-fixture";
    spacer.style.height = "2000px";
    spacer.setAttribute("aria-hidden", "true");
    document.body.append(spacer);
  });
  const baseline = {
    ...(await lockState(page)),
    scrollbar: await page.evaluate(() => innerWidth - document.documentElement.clientWidth),
  };
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight));
  assert.ok(baseline.scrollbar > 0, "Chromium must expose a real scrollbar to prove gap compensation.");

  const add = page.getByRole("button", { name: "Add resource", exact: true });
  await add.click();
  const dialog = page.getByRole("dialog", { name: "Add resource", exact: true });
  await expect(dialog).toBeVisible();
  await expectLocked(page, 1, baseline);
  await proveBackgroundLock(page, baseline);
  await proveDialogScrolling(page, dialog);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(add).toBeFocused();
  await expectUnlocked(page, baseline);
  await page.mouse.move(4, 4);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 0));

  await add.click();
  await page.setViewportSize({ width: 360, height: 560 });
  const hint = page.getByRole("dialog", { name: "Best in landscape" });
  await expect(hint).toBeVisible();
  await expectLocked(page, 2, baseline);
  await hint.getByRole("button", { name: "Got it" }).click();
  await expectLocked(page, 1, baseline);
  await proveDialogScrolling(page, dialog);
  if (outputDir) await page.screenshot({ path: join(outputDir, "production_resource_dialog_narrow_after.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expectUnlocked(page, baseline);
  await page.setViewportSize({ width: 1280, height: 600 });

  const archive = page.getByRole("button", { name: `Archive ${resourceName}`, exact: true });
  await archive.click();
  const confirmation = page.getByRole("alertdialog", { name: "Archive resource?" });
  await expect(confirmation).toBeVisible();
  await expectLocked(page, 1, baseline);
  await page.keyboard.press("Escape");
  await expect(confirmation).not.toBeVisible();
  await expectUnlocked(page, baseline);

  await page.evaluate(() => document.getElementById("packaged-scroll-fixture").remove());
  await page.goto(`${origin}/`);
  await page.getByRole("button", { name: `Add allocation for ${resourceName}`, exact: true }).click();
  const allocation = page.getByRole("dialog", { name: /^New allocation/ });
  await expect(allocation).toBeVisible();
  const allocationBaseline = {
    ...baseline,
    scrollbar: await page.evaluate(() =>
      parseFloat(document.body.style.getPropertyValue("--removed-body-scroll-bar-size")),
    ),
  };
  const project = allocation.getByLabel("Project", { exact: true });
  await expect(project).toHaveText("Internal");
  await project.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await expectLocked(page, 2, allocationBaseline);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).not.toBeVisible();
  await expect(allocation).toBeVisible();
  await expect(project).toBeFocused();
  await expectLocked(page, 1, allocationBaseline);
  if (outputDir) await page.screenshot({ path: join(outputDir, "production_allocation_dialog_after.png") });

  const repeat = allocation.getByRole("combobox", { name: "Repeat", exact: true });
  await expect(repeat).toHaveText("Doesn’t repeat");
  await repeat.click();
  await expectLocked(page, 2, allocationBaseline);
  await page.getByRole("option", { name: "Weekly", exact: true }).click();
  await expect(repeat).toHaveText("Weekly");
  await expect(allocation.getByLabel("Repeat until", { exact: true })).toBeVisible();
  await expectLocked(page, 1, allocationBaseline);
  await repeat.click();
  await expect(page.getByRole("option", { name: "Weekly", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).not.toBeVisible();
  await expect(repeat).toBeFocused();
  await expectLocked(page, 1, allocationBaseline);
  await page.keyboard.press("Escape");
  await expect(allocation).toBeVisible();
  await expect(
    page.getByText("You have unsaved changes — use Cancel or Save to close this dialog.", { exact: true }),
  ).toBeVisible();
  await allocation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(allocation).not.toBeVisible();
  await expectUnlocked(page, baseline);
}

async function launchBrowser(workDir) {
  const options = {
    ignoreDefaultArgs: ["--hide-scrollbars"],
    args: ["--disable-features=OverlayScrollbar"],
  };
  if (process.platform === "darwin") {
    // Cocoa's argument domain applies this preference only to the disposable browser process.
    // A launcher keeps Playwright from interpreting the separate preference value as a page URL.
    const launcher = join(workDir, "browser-launcher.sh");
    const executable = "'" + chromium.executablePath().replaceAll("'", "'\\''") + "'";
    await writeFile(launcher, `#!/bin/sh\nexec ${executable} -AppleShowScrollBars Always "$@"\n`, { mode: 0o700 });
    options.executablePath = launcher;
  }
  return chromium.launch(options);
}

/** Exercise native production dialogs through a disposable HTTPS edge and real Chromium. */
export async function acceptPackagedDialogs({ baseUrl, credentials, workDir, resourceName }) {
  const { edge, origin } = await startTlsEdge(baseUrl, workDir);
  let browser;
  const failures = [];
  try {
    browser = await launchBrowser(workDir);
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 600 },
      reducedMotion: "reduce",
    });
    await proveCspGuard(context, origin);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const violations = await observeStyleViolations(page);
    const response = await page.goto(origin);
    assert.equal(new URL(response.url()).origin, origin);
    assertStrictStylePolicy(response.headers()["content-security-policy"]);
    await page.getByLabel("Email", { exact: true }).fill(credentials.email);
    await page.getByLabel("Password", { exact: true }).fill(credentials.password);
    const signinResponse = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === "/api/auth/sign-in" && candidate.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const signin = await signinResponse;
    assert.equal(signin.status(), 200, "Native production browser sign-in failed.");
    const signinHeaders = await signin.request().allHeaders();
    assert.equal(signinHeaders.origin, origin);
    assert.equal(signinHeaders["sec-fetch-site"], "same-origin");
    const cookie = (await signin.headerValue("set-cookie")) ?? "";
    // Assert cookie protection without including the session bearer in assertion output.
    assert.ok(
      cookie.includes("__Host-adonis-session="),
      "Production sign-in did not set its host-only session cookie.",
    );
    assert.ok(/;\s*secure(?:;|$)/i.test(cookie), "Production session cookie is not Secure.");
    assert.ok(/;\s*httponly(?:;|$)/i.test(cookie), "Production session cookie is not HttpOnly.");
    assert.ok(/;\s*path=\/(?:;|$)/i.test(cookie), "Production session cookie does not cover the origin root.");
    await expect(page.getByRole("link", { name: "Schedule", exact: true })).toBeVisible();
    const outputDir = process.env.CAPACITYLENS_BROWSER_ARTIFACT_DIR;
    if (outputDir) await mkdir(outputDir, { recursive: true });
    await exerciseDialogs(page, { origin, resourceName, outputDir });
    assertNoStyleViolations(violations);
    assert.deepEqual(errors, [], "Uncaught production browser exceptions.");
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      if (browser) await browser.close();
    } catch (error) {
      failures.push(new Error("Production acceptance browser cleanup failed.", { cause: error }));
    }
    try {
      edge.closeAllConnections();
      await new Promise((done, reject) => edge.close((error) => (error ? reject(error) : done())));
    } catch (error) {
      failures.push(new Error("Production acceptance HTTPS edge cleanup failed.", { cause: error }));
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, "Production dialog acceptance failed.", { cause: failures[0] });
  }
  console.log(
    JSON.stringify({
      productionDialogs: "passed",
      cspFailureGuard: "proved",
      desktopAndNarrow: "verified",
      nestedLocksAndFocus: "verified",
    }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runPackagedSmoke({ acceptBrowser: acceptPackagedDialogs });
}
