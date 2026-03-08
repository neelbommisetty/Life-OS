import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("project detail supports metadata edit flows and embedded tabs", async ({
  page,
}) => {
  await signInViaApi(page, "/projects");
  await page.goto("/projects");

  await page.getByRole("link", { name: /Life Admin/i }).first().click();
  await expect(page).toHaveURL(/\/projects\/c[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: "Life Admin" })).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();
  let editDialog = page.getByRole("alertdialog", { name: "Edit Project" });
  await editDialog.getByLabel("Name").fill("Fail Project Rename");
  await editDialog.getByRole("button", { name: "Save Changes" }).click({ force: true });
  await expect(editDialog).toBeVisible();

  await expect(page.getByRole("heading", { name: "Life Admin" })).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();
  editDialog = page.getByRole("alertdialog", { name: "Edit Project" });
  await editDialog.getByLabel("Name").fill("Life Admin Updated");
  await editDialog.getByRole("button", { name: "Save Changes" }).click({ force: true });

  await expect(editDialog).toBeHidden();

  await expect(page.getByRole("heading", { name: "Life Admin Updated" })).toBeVisible();
  await expect(page.getByText("Continue work", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Assistant" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Tasks" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Library" })).toBeVisible();

  await page.getByRole("button", { name: "Open Tasks" }).click();
  await expect(page.getByRole("button", { name: "Create task" })).toBeVisible();

  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByText("Open tasks", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Assistant" }).click();
  await expect(page.getByLabel("Message input").first()).toBeVisible();

  await page.getByRole("tab", { name: "Tasks" }).click();
  await expect(page.getByRole("button", { name: "Create task" })).toBeVisible();

  await page.getByRole("tab", { name: "Library" }).click();
  await expect(page.getByRole("button", { name: "Capture note" })).toBeVisible();

  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByText("Project Details")).toBeVisible();
});
