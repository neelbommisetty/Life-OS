import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("signed-in users are redirected away from auth sign-in and sign-up pages", async ({
  page,
}) => {
  await signInViaApi(page, "/");

  await page.goto("/auth/sign-in");
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/auth/sign-up");
  await expect(page).toHaveURL(/\/$/);
});
