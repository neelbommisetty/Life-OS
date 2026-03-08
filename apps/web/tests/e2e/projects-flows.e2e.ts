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

test("projects header stacks cleanly on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInViaApi(page, "/projects");
  await page.goto("/projects");

  const heading = page.getByRole("heading", { name: "Projects" });
  const createButton = page.getByRole("link", { name: "Create project" }).first();

  await expect(heading).toBeVisible();
  await expect(createButton).toBeVisible();

  const headingBox = await heading.boundingBox();
  const buttonBox = await createButton.boundingBox();

  expect(buttonBox?.y ?? 0).toBeGreaterThan(headingBox?.y ?? 0);
  expect(buttonBox?.width ?? 0).toBeGreaterThan(250);
});
