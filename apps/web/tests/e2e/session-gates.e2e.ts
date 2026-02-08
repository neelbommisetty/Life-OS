import { expect, type Page, test } from "@playwright/test";

const protectedRoutes = [
  "/",
  "/chat",
  "/tasks",
  "/notes",
  "/account/profile",
];

async function signInViaApi(page: Page) {
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: {
      email: "demo@lifeos.dev",
      password: "demo12345",
      callbackURL: "/chat",
    },
  });

  expect(response.ok()).toBeTruthy();
}

test.describe("session-gated pages", () => {
  test("unauthenticated users are redirected to sign-in on protected routes", async ({
    page,
  }) => {
    await page.context().addCookies([
      {
        name: "mock-session",
        value: "invalid",
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    for (const route of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/auth\/sign-in$/);
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
    await page.goto("/pricing");

    const accountMenuButton = page.getByRole("button", {
      name: "Open account menu",
    });
    await expect(accountMenuButton).toBeVisible();
    await accountMenuButton.click();

    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
  });
});
