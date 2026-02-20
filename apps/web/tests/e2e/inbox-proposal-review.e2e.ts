import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("inbox proposal review applies resolve-all availability rules and todo preview fallbacks", async ({
  page,
}) => {
  await signInViaApi(page, "/inbox");
  await page.goto("/inbox");

  const resolveAllButton = page.getByRole("button", { name: "Resolve All as No" });

  await page.getByRole("button", { name: /Processed item should hide/ }).click();
  await expect(resolveAllButton).toHaveCount(0);

  await page.getByRole("button", { name: /Review item with all outputs already resolved/ }).click();
  await expect(resolveAllButton).toBeVisible();
  await expect(resolveAllButton).toBeDisabled();

  await page.getByRole("button", { name: /Review this inbox entry and decide on proposals/ }).click();
  await expect(resolveAllButton).toBeEnabled();
  await expect(page.getByText("Buy groceries", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Due")).toBeVisible();

  await page.getByRole("button", { name: /Review item with malformed todo payload/ }).click();
  await expect(page.getByText("Fallback preview from malformed todo payload")).toBeVisible();
  await expect(page.getByText("Proposal Outputs")).toBeVisible();
});
