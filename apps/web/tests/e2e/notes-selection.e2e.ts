import { expect, test } from "@playwright/test";

test("notes page auto-selects first note when no noteId is provided", async ({
  page,
}) => {
  await page.goto("/notes");

  const desktopLayout = page.locator("div.hidden.sm\\:grid").first();

  await expect(page).toHaveURL(/\/notes\?noteId=note-first$/);
  await expect(desktopLayout.getByText("First note body sentinel")).toBeVisible();
  await expect(desktopLayout.getByText("Second note body sentinel")).toHaveCount(0);
});
