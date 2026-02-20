import { expect, test } from "@playwright/test";
import { setUnauthenticatedSessionCookie } from "./helpers";

test.describe("auth flows", () => {
  test("sign in handles invalid credentials and redirects on success", async ({
    page,
  }) => {
    await setUnauthenticatedSessionCookie(page);
    await page.goto("/auth/sign-in?callbackURL=%2Fpricing");

    await page.getByLabel("Email").fill("invalid@lifeos.dev");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Invalid email or password").first()).toBeVisible();

    await page.getByLabel("Email").fill("demo@lifeos.dev");
    await page.getByLabel("Password").fill("demo12345");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByText("AI Model Pricing")).toBeVisible();
  });

  test("sign up handles duplicate email and redirects on success", async ({
    page,
  }) => {
    await setUnauthenticatedSessionCookie(page);
    await page.goto("/auth/sign-up?callbackURL=%2Fpricing");

    await page.getByLabel("Name").fill("New User");
    await page.getByLabel("Email").fill("new-user@taken.dev");
    await page.getByLabel("Password").fill("safe-password-123");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Email already exists").first()).toBeVisible();

    await page.getByLabel("Email").fill("new-user@lifeos.dev");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByText("AI Model Pricing")).toBeVisible();
  });

  test("forgot password shows error and success confirmation", async ({
    page,
  }) => {
    await setUnauthenticatedSessionCookie(page);
    await page.goto("/auth/forget-password");

    await page.getByLabel("Email").fill("missing@lifeos.dev");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("Account not found").first()).toBeVisible();

    await page.getByLabel("Email").fill("demo@lifeos.dev");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(
      page.getByText("If that email exists, a password reset link has been sent."),
    ).toBeVisible();
  });

  test("recover alias route renders forgot-password flow and submits request", async ({
    page,
  }) => {
    await setUnauthenticatedSessionCookie(page);
    await page.goto("/auth/recover");

    await expect(page).toHaveURL(/\/auth\/recover$/);
    await expect(page.getByText("Recover password")).toBeVisible();

    await page.getByLabel("Email").fill("demo@lifeos.dev");
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(
      page.getByText("If that email exists, a password reset link has been sent."),
    ).toBeVisible();
  });

  test("reset password validates mismatch and redirects after success", async ({
    page,
  }) => {
    await setUnauthenticatedSessionCookie(page);
    await page.goto("/auth/reset-password?token=valid-reset-token");

    await page.getByLabel("New password").fill("new-password-123");
    await page.getByLabel("Confirm password").fill("different-password");
    await page.getByRole("button", { name: "Update password" }).click();

    await expect(page.getByText("Passwords don't match.")).toBeVisible();

    await page.getByLabel("Confirm password").fill("new-password-123");
    await page.getByRole("button", { name: "Update password" }).click();

    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
