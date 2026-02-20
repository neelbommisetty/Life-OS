import { expect, test } from "@playwright/test";
import { setScenarioCookie, signInViaApi } from "./helpers";

test("analytics page renders populated dashboard sections", async ({ page }) => {
  await signInViaApi(page, "/analytics");
  await page.goto("/analytics");

  await expect(page.getByRole("heading", { name: "Usage analytics" })).toBeVisible();
  await expect(page.getByText("Usage by Model")).toBeVisible();
  await expect(page.getByText("Recent Activity")).toBeVisible();
  await expect(page.getByText("anthropic.claude-haiku-4-5").first()).toBeVisible();
});

test("analytics page renders empty-state dashboard with scenario toggle", async ({
  page,
}) => {
  await signInViaApi(page, "/analytics");
  await setScenarioCookie(page, "analytics-empty");
  await page.goto("/analytics");

  await expect(page.getByText("No activity yet. Use the assistant to see usage here.")).toBeVisible();
  await expect(page.getByText("No activity yet. Use the assistant to see recent calls.")).toBeVisible();
});
