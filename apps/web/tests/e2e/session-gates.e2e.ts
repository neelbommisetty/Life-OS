import { expect, test } from "@playwright/test";
import { setUnauthenticatedSessionCookie, signInViaApi } from "./helpers";

const protectedRoutes = [
  "/",
  "/chat",
  "/projects",
  "/tasks",
  "/tasks/archive",
  "/inbox",
  "/inbox/archive",
  "/notes",
  "/analytics",
  "/account/profile",
  "/account/security",
];

test.describe("session-gated pages", () => {
  test("unauthenticated users are redirected to sign-in on protected routes", async ({
    page,
  }) => {
    await setUnauthenticatedSessionCookie(page);

    for (const route of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/auth\/sign-in/);
    }
  });

  test("authenticated users can load chat without sign-in redirect", async ({
    page,
  }) => {
    await signInViaApi(page);

    await page.goto("/chat");

    await expect(page).toHaveURL(/\/chat/);
    await expect(page.getByLabel("Message input").first()).toBeVisible();
  });

  test("signed-in users can sign out from the shell menu", async ({ page }) => {
    await signInViaApi(page);
    await page.goto("/");

    const accountMenuButton = page
      .locator('button[aria-label="Open account menu"], button:has-text("EU")')
      .first();
    await expect(accountMenuButton).toBeVisible();
    await accountMenuButton.click();

    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
  });
});
