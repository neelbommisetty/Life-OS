import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("shell navigation, theme menu, and account menu render expected controls", async ({
  page,
}) => {
  await signInViaApi(page, "/");
  await page.goto("/");

  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.getByRole("link", { name: "Tasks" }).click();
  await expect(page).toHaveURL(/\/tasks$/);

  await page.getByRole("link", { name: "Inbox" }).click();
  await expect(page).toHaveURL(/\/inbox$/);

  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.getByRole("menuitem", { name: "Light" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Dark" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "System" })).toBeVisible();
  await page.keyboard.press("Escape");

  const accountMenuButton = page
    .locator('button[aria-label="Open account menu"], button:has-text("EU")')
    .first();
  await accountMenuButton.click();

  await expect(page.getByRole("menuitem", { name: "Account" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
});
