import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("inbox archive supports load, search, and unarchive", async ({ page }) => {
  await signInViaApi(page, "/inbox/archive");
  await page.goto("/inbox/archive");

  await expect(page.getByRole("heading", { name: "Inbox Archive" })).toBeVisible();
  await expect(page.getByText("Archived inbox item")).toBeVisible();

  await page.getByPlaceholder("Search archive").fill("not-here");
  await expect(page.getByText("No archived items yet.")).toBeVisible();

  await page.getByPlaceholder("Search archive").fill("Archived inbox item");
  await expect(page.getByText("Archived inbox item")).toBeVisible();

  await page.getByRole("button", { name: "Unarchive" }).click();
  await expect(page.getByText("Archived inbox item")).toHaveCount(0);
});
