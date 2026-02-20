import { expect, test, type Page } from "@playwright/test";
import { setScenarioCookie, signInViaApi } from "./helpers";

function taskCard(page: Page, title: string) {
  return page.locator("div.touch-none", {
    has: page.getByText(title, { exact: true }),
  }).first();
}

function column(page: Page, title: string) {
  return page.locator("div.flex-1", {
    has: page.getByRole("heading", { name: title }),
  }).first();
}

test("tasks page supports create, edit, search, and delete", async ({ page }) => {
  await signInViaApi(page, "/tasks");
  await page.goto("/tasks");

  await page.getByRole("button", { name: "Create task" }).click();
  const taskDialog = page.getByRole("dialog");
  await taskDialog.getByPlaceholder("Task title").fill("E2E Task Alpha");
  await taskDialog
    .getByPlaceholder("Task description")
    .fill("Created in e2e test");
  await taskDialog.getByRole("button", { name: "Create task" }).click();
  await page.reload();

  await expect(page.getByText("E2E Task Alpha")).toBeVisible();

  await taskCard(page, "E2E Task Alpha").click();
  const editDialog = page.getByRole("dialog");
  await editDialog.getByPlaceholder("Task title").fill("E2E Task Alpha Updated");
  await editDialog.getByRole("button", { name: "Save changes" }).click();
  await page.reload();

  await expect(page.getByText("E2E Task Alpha Updated")).toBeVisible();

  await page.getByPlaceholder("Search tasks...").fill("Alpha Updated");
  await expect(page.getByText("E2E Task Alpha Updated")).toBeVisible();

  await taskCard(page, "E2E Task Alpha Updated").getByRole("button").first().click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete" })
    .click();
  await page.reload();

  await expect(page.getByText("E2E Task Alpha Updated")).toHaveCount(0);
});

test("tasks drag/drop moves cards and rolls back on update failure", async ({ page }) => {
  await signInViaApi(page, "/tasks");
  await page.goto("/tasks");

  await taskCard(page, "Seed TODO task").dragTo(column(page, "In Progress"));
  await expect(column(page, "In Progress").getByText("Seed TODO task")).toBeVisible();

  await setScenarioCookie(page, "task-move-error");
  await taskCard(page, "Seed IN_PROGRESS task").dragTo(column(page, "Done"));

  await expect
    .poll(async () => {
      return column(page, "In Progress").getByText("Seed IN_PROGRESS task").count();
    })
    .toBeGreaterThan(0);
});
