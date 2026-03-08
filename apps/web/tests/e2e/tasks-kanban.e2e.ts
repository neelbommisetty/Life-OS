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
  await expect(taskDialog.getByText("Capture the next step")).toBeVisible();
  await expect(taskDialog.getByText("Add a title to save this task.")).toBeVisible();
  await taskDialog.getByLabel("Title").fill("E2E Task Alpha");
  await taskDialog.getByLabel("Notes").fill("Created in e2e test");
  await taskDialog.getByRole("button", { name: "In progress" }).click();
  await taskDialog.getByRole("button", { name: "High" }).click();
  await expect(taskDialog.getByText("Active now. Needs attention. Add a deadline if timing matters.")).toBeVisible();
  await taskDialog.getByRole("button", { name: "Create task" }).click();

  await expect(page.getByText("Task created.").first()).toBeVisible();
  await expect(taskCard(page, "E2E Task Alpha")).toBeVisible();
  await expect(
    taskCard(page, "E2E Task Alpha").getByRole("button", {
      name: "Edit E2E Task Alpha",
    }),
  ).toBeVisible();

  await taskCard(page, "E2E Task Alpha")
    .getByRole("button", { name: "Edit E2E Task Alpha" })
    .click();
  const editDialog = page.getByRole("dialog");
  await expect(editDialog.getByText("Refine the next step")).toBeVisible();
  await expect(editDialog.getByText("Ready to save.")).toBeVisible();
  await editDialog.getByLabel("Title").fill("E2E Task Alpha Updated");
  await editDialog.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Task updated.").first()).toBeVisible();
  await expect(taskCard(page, "E2E Task Alpha Updated")).toBeVisible();

  await taskCard(page, "E2E Task Alpha Updated")
    .getByRole("button", { name: "Move E2E Task Alpha Updated" })
    .click();
  await page.getByRole("menuitem", { name: "Move to Done" }).click();
  await expect(column(page, "Done").getByText("E2E Task Alpha Updated")).toBeVisible();

  await page.getByPlaceholder("Search tasks...").fill("Alpha Updated");
  await expect(taskCard(page, "E2E Task Alpha Updated")).toBeVisible();

  await taskCard(page, "E2E Task Alpha Updated")
    .getByRole("button", { name: "Move E2E Task Alpha Updated" })
    .click();
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await page.reload();

  await expect(page.getByText("E2E Task Alpha Updated")).toHaveCount(0);

  await page.getByPlaceholder("Search tasks...").fill("No matches here");
  await expect(
    page.getByText("Drag a task here or use Move on a card.").first(),
  ).toBeVisible();
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

test("tasks header stacks controls on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInViaApi(page, "/tasks");
  await page.goto("/tasks");

  const search = page.getByPlaceholder("Search tasks...");
  const archive = page.getByRole("link", { name: "Archive" });
  const create = page.getByRole("button", { name: "Create task" });

  await expect(search).toBeVisible();
  await expect(archive).toBeVisible();
  await expect(create).toBeVisible();

  const searchBox = await search.boundingBox();
  const archiveBox = await archive.boundingBox();
  const createBox = await create.boundingBox();

  expect(searchBox).not.toBeNull();
  expect(archiveBox).not.toBeNull();
  expect(createBox).not.toBeNull();

  expect(searchBox!.width).toBeGreaterThan(280);
  expect(archiveBox!.y).toBeGreaterThan(searchBox!.y);
  expect(createBox!.y).toBeGreaterThan(archiveBox!.y);
});

test("tasks header stays stacked below the desktop breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await signInViaApi(page, "/tasks");
  await page.goto("/tasks");

  const heading = page.getByRole("heading", { name: "Tasks" });
  const create = page.getByRole("button", { name: "Create task" });

  await expect(heading).toBeVisible();
  await expect(create).toBeVisible();

  const headingBox = await heading.boundingBox();
  const createBox = await create.boundingBox();

  expect(headingBox).not.toBeNull();
  expect(createBox).not.toBeNull();

  const searchBox = await page.getByPlaceholder("Search tasks...").boundingBox();

  expect(searchBox).not.toBeNull();
  expect(searchBox!.width).toBeGreaterThan(240);
  expect(createBox!.y).toBeGreaterThan(headingBox!.y);
});

test("task editor shows save guidance on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInViaApi(page, "/tasks");
  await page.goto("/tasks");

  await page.getByRole("button", { name: "Create task" }).click();
  const taskDialog = page.getByRole("dialog");

  await expect(taskDialog.getByText("Add a title to save this task.")).toBeVisible();

  await taskDialog.getByLabel("Title").fill("Mobile guidance task");

  await expect(taskDialog.getByText("Ready to save.")).toBeVisible();
});
