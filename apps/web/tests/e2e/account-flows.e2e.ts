import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("account profile update handles error and success states", async ({ page }) => {
  await signInViaApi(page, "/account/profile");
  await page.goto("/account/profile");

  await page.getByLabel("Name").fill("Error Profile Name");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile update failed").first()).toBeVisible();

  await page.getByLabel("Name").fill("Updated E2E User");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile updated.")).toBeVisible();
});

test("account security validates mismatch, handles API error, succeeds, and signs out", async ({
  page,
}) => {
  await signInViaApi(page, "/account/security");
  await page.goto("/account/security");

  await page.getByLabel("Current password").fill("demo12345");
  await page.getByLabel("New password", { exact: true }).fill("new-password-123");
  await page.getByLabel("Confirm new password").fill("different-password");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Passwords don't match.")).toBeVisible();

  await page.getByLabel("Current password").fill("wrong-password");
  await page.getByLabel("New password", { exact: true }).fill("new-password-123");
  await page.getByLabel("Confirm new password").fill("new-password-123");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Current password is incorrect").first()).toBeVisible();

  await page.getByLabel("Current password").fill("demo12345");
  await page.getByLabel("New password", { exact: true }).fill("new-password-123");
  await page.getByLabel("Confirm new password").fill("new-password-123");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Password updated.").first()).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
});
