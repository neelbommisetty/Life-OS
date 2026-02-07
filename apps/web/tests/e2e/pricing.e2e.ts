import { expect, test } from "@playwright/test";

test("pricing page renders model catalog", async ({ page }) => {
  await page.goto("/pricing");

  await expect(page.getByText("AI Model Pricing")).toBeVisible();
  await expect(page.getByText("Model pricing", { exact: true })).toBeVisible();
  await expect(page.getByText("All prices are per 1M tokens, USD.")).toBeVisible();
});
