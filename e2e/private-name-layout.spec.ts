import { expect, test, type Locator, type Page } from "./fixtures";
import { openApp, selectShadOption } from "./helpers";

const OWNER_DESCRIPTION = "Only account owners can see the real name. Everyone else sees the code name.";
const CODE_NAME_HINT = "Quotation marks are added automatically.";

async function expectPrivacyLayout(dialog: Locator, stacked: boolean) {
  const privacy = dialog.getByRole("switch", { name: "Use a code name" });
  const description = dialog.getByText(OWNER_DESCRIPTION, { exact: true });
  const field = privacy.locator('xpath=ancestor::*[@data-product-layout="label-control"][1]');
  const controlColumn = description.locator("..");
  await expect(controlColumn.getByRole("switch", { name: "Use a code name" })).toBeVisible();

  const [fieldBox, controlBox, privacyBox, descriptionBox] = await Promise.all([
    field.boundingBox(),
    controlColumn.boundingBox(),
    privacy.boundingBox(),
    description.boundingBox(),
  ]);
  expect(fieldBox).not.toBeNull();
  expect(controlBox).not.toBeNull();
  expect(privacyBox).not.toBeNull();
  expect(descriptionBox).not.toBeNull();
  expect(descriptionBox!.y).toBeGreaterThanOrEqual(privacyBox!.y + privacyBox!.height);
  expect(await description.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  if (stacked) {
    expect(Math.abs(controlBox!.x - fieldBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(controlBox!.width - fieldBox!.width)).toBeLessThanOrEqual(1);
  } else {
    const nameBox = await dialog.getByLabel("Name", { exact: true }).boundingBox();
    expect(nameBox).not.toBeNull();
    expect(Math.abs(controlBox!.x - nameBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(controlBox!.width - nameBox!.width)).toBeLessThanOrEqual(1);
  }
}

async function expectCodeNameLayout(dialog: Locator, stacked: boolean) {
  const codeName = dialog.getByLabel("Code name", { exact: true });
  const hint = dialog.getByText(CODE_NAME_HINT, { exact: true });
  const field = codeName.locator('xpath=ancestor::*[@data-product-layout="label-control"][1]');
  const controlColumn = hint.locator("..");
  await expect(controlColumn.getByLabel("Code name", { exact: true })).toBeVisible();

  const [fieldBox, controlBox, inputBox, hintBox] = await Promise.all([
    field.boundingBox(),
    controlColumn.boundingBox(),
    codeName.boundingBox(),
    hint.boundingBox(),
  ]);
  expect(fieldBox).not.toBeNull();
  expect(controlBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(hintBox).not.toBeNull();
  expect(hintBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height);

  if (stacked) {
    expect(Math.abs(controlBox!.x - fieldBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(controlBox!.width - fieldBox!.width)).toBeLessThanOrEqual(1);
  } else {
    const nameBox = await dialog.getByLabel("Name", { exact: true }).boundingBox();
    expect(nameBox).not.toBeNull();
    expect(Math.abs(controlBox!.x - nameBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(controlBox!.width - nameBox!.width)).toBeLessThanOrEqual(1);
  }
}

async function openAddDialog(page: Page, section: "Clients" | "Projects") {
  await page.getByRole("link", { name: section, exact: true }).click();
  const singular = section === "Clients" ? "client" : "project";
  await page.getByRole("button", { name: `Add ${singular}` }).click();
  return page.getByRole("dialog", { name: `Add ${singular}` });
}

test("private-name explanations align with their controls in Client and Project forms", async ({ page }) => {
  await openApp(page, "Wayne Enterprises", "/clients");

  const clientDialog = await openAddDialog(page, "Clients");
  await expectPrivacyLayout(clientDialog, false);
  await expect(clientDialog.getByLabel("Code name", { exact: true })).toHaveCount(0);
  await clientDialog.getByRole("switch", { name: "Use a code name" }).click();
  await expectCodeNameLayout(clientDialog, false);

  await clientDialog.getByLabel("Name", { exact: true }).fill("Kane Industries Confidential");
  await clientDialog.getByRole("button", { name: "Save" }).click();
  const clientCodeName = clientDialog.getByLabel("Code name", { exact: true });
  const clientHint = clientDialog.getByText(CODE_NAME_HINT, { exact: true });
  const clientAlert = clientDialog.getByRole("alert");
  await expect(clientCodeName).toHaveAttribute("aria-invalid", "true");
  const describedBy = (await clientCodeName.getAttribute("aria-describedby"))?.split(" ") ?? [];
  expect(describedBy).toEqual(
    expect.arrayContaining([await clientHint.getAttribute("id"), await clientAlert.getAttribute("id")]),
  );

  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole("dialog", { name: "Best in landscape" }).getByRole("button", { name: "Got it" }).click();
  await expectPrivacyLayout(clientDialog, true);
  await expectCodeNameLayout(clientDialog, true);
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);

  await clientCodeName.fill("Nightwing");
  await clientDialog.getByRole("button", { name: "Save" }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  const clientRow = page.getByTestId("client-row").filter({ hasText: "Kane Industries Confidential" });
  await clientRow.getByRole("button", { name: /^Edit / }).click();
  const editClient = page.getByRole("dialog", { name: "Edit client" });
  await expect(editClient.getByRole("switch", { name: "Use a code name" })).toHaveAttribute("aria-checked", "true");
  await expectPrivacyLayout(editClient, false);
  await expectCodeNameLayout(editClient, false);
  await editClient.getByRole("button", { name: "Cancel" }).click();

  const projectDialog = await openAddDialog(page, "Projects");
  await expectPrivacyLayout(projectDialog, false);
  await projectDialog.getByRole("switch", { name: "Use a code name" }).click();
  await expectCodeNameLayout(projectDialog, false);
  await projectDialog.getByLabel("Name", { exact: true }).fill("Project Monarch");
  await projectDialog.getByLabel("Code name", { exact: true }).fill("Aurora");
  await selectShadOption(projectDialog.getByLabel("Client"), { label: "Queen Consolidated" });

  await page.setViewportSize({ width: 360, height: 800 });
  await expectPrivacyLayout(projectDialog, true);
  await expectCodeNameLayout(projectDialog, true);
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
  await projectDialog.getByRole("button", { name: "Save" }).click();

  await page.setViewportSize({ width: 1280, height: 720 });
  const projectRow = page.getByTestId("project-row").filter({ hasText: "Project Monarch" });
  await projectRow.getByRole("button", { name: /^Edit / }).click();
  const editProject = page.getByRole("dialog", { name: "Edit project" });
  await expect(editProject.getByRole("switch", { name: "Use a code name" })).toHaveAttribute("aria-checked", "true");
  await expectPrivacyLayout(editProject, false);
  await expectCodeNameLayout(editProject, false);
});
