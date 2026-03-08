import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("projects create flow handles error and navigates on success", async ({ page }) => {
  await signInViaApi(page, "/projects");
  await page.goto("/projects");

  const openCreateDialog = async () => {
    await page.getByRole("button", { name: "Create project" }).first().click();
    return page.getByRole("alertdialog", { name: "Create project" });
  };

  const createDialog = await openCreateDialog();
  await createDialog.getByLabel("Name").fill("Fail Project");
  await createDialog.getByRole("button", { name: "Create project" }).click({ force: true });

  await expect(page).toHaveURL(/\/projects$/);
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByRole("button", { name: "Create project" })).toBeEnabled();
  await createDialog.getByLabel("Name").fill("E2E Project Created");
  await createDialog.getByRole("button", { name: "Create project" }).click({ force: true });

  await expect(page).toHaveURL(/\/projects\/c[a-z0-9]+$/, { timeout: 10000 });
  await expect(page.getByRole("heading", { name: "E2E Project Created" })).toBeVisible();

  await page.getByLabel("breadcrumb").getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByText("E2E Project Created", { exact: true }).first()).toBeVisible();
});
