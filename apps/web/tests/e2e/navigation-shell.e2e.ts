import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("mobile shell uses a drawer instead of the fixed side rail", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInViaApi(page, "/tasks");
  await page.goto("/tasks");

  await expect(page.locator("aside")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Open navigation menu" }),
  ).toBeVisible();

  const heading = page.getByRole("heading", { name: "Tasks" });
  await expect(heading).toBeVisible();
  const box = await heading.boundingBox();
  expect(box?.x ?? 0).toBeLessThan(32);

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(page.getByRole("heading", { name: "Navigation" })).toBeVisible();
  await page.getByRole("link", { name: "Library" }).click();

  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByRole("button", { name: "Rename note" })).toBeVisible();
});
