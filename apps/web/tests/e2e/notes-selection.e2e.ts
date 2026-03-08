import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("notes page auto-selects first note when no noteId is provided", async ({
  page,
}) => {
  await signInViaApi(page, "/notes");
  await page.goto("/notes");

  await expect(page).toHaveURL(/\/notes\?noteId=c[a-z0-9]+$/);
  await expect(page.getByText("First note body sentinel").first()).toBeVisible();
  await expect(page.getByText("Second note body sentinel")).toHaveCount(0);
});

test("selecting a different note updates URL noteId and content", async ({ page }) => {
  await signInViaApi(page, "/notes");
  await page.goto("/notes");

  const secondNoteRow = page.getByText("Second note", { exact: true }).first();
  await secondNoteRow.click();

  await expect(page).toHaveURL(/\/notes\?noteId=c[a-z0-9]+$/);
  await expect(page.getByText("Second note body sentinel").first()).toBeVisible();
});

test("notes selector can delete the selected note", async ({ page }) => {
  await signInViaApi(page, "/notes");
  await page.goto("/notes");

  await page.getByText("Second note", { exact: true }).first().click();
  await page.getByRole("button", { name: "Delete Second note" }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Delete Note")).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByText("Second note", { exact: true })).toHaveCount(0);
  await expect(page.getByText("First note body sentinel").first()).toBeVisible();
});
