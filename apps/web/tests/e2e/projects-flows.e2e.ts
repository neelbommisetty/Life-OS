import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("projects create flow handles error and navigates on success", async ({ page }) => {
  await signInViaApi(page, "/projects");
  await page.goto("/projects");

  await expect(
    page.getByText("Group assistant work, tasks, and notes.", { exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Create project" }).first().click();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await expect(page.getByRole("heading", { name: "Create project" })).toBeVisible();

  await page.getByLabel("Name").fill("Fail Project");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(/\/projects\/new$/);
  await expect(page.getByRole("heading", { name: "Create project" })).toBeVisible();
  await expect(
    page.locator('p[aria-live="polite"]').getByText("Project creation failed", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create project" })).toBeEnabled();
  await page.getByLabel("Name").fill("E2E Project Created");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(/\/projects\/c[a-z0-9]+$/, { timeout: 10000 });
  await expect(page.getByRole("heading", { name: "E2E Project Created" })).toBeVisible();

  await page.getByLabel("breadcrumb").getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByText("E2E Project Created", { exact: true }).first()).toBeVisible();
});
