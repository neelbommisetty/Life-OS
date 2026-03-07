import { expect, test } from "@playwright/test";
import { setScenarioCookie, signInViaApi } from "./helpers";

test("home dashboard renders populated cards by default", async ({ page }) => {
  await signInViaApi(page, "/");

  await page.goto("/");

  await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Inbox" })).toBeVisible();
  await expect(page.getByPlaceholder("Capture a thought, reminder, or draft plan.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent Projects" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upcoming Tasks" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Life Admin/i }).first()).toBeVisible();
});

test("home dashboard renders empty-state variants via scenario toggle", async ({
  page,
}) => {
  await signInViaApi(page, "/");
  await setScenarioCookie(page, "home-empty");

  await page.goto("/");

  await expect(page.getByText("No tasks due soon.")).toBeVisible();
  await expect(page.getByText("Add a task")).toBeVisible();
  await expect(page.getByText("Create project")).toBeVisible();
  await expect(page.getByText("Life Admin")).toHaveCount(0);
});
