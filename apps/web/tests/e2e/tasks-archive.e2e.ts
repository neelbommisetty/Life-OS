import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("tasks archive page loads archived tasks and filters client-side", async ({
  page,
}) => {
  await signInViaApi(page, "/tasks/archive");
  await page.goto("/tasks/archive");

  await expect(page.getByRole("heading", { name: "Archived Tasks" })).toBeVisible();
  await expect(page.getByText("Archived seed task")).toBeVisible();

  await page.getByPlaceholder("Search archive...").fill("does-not-exist");
  await expect(page.getByText("No archived tasks.")).toBeVisible();

  await page.getByPlaceholder("Search archive...").fill("Archived seed");
  await expect(page.getByText("Archived seed task")).toBeVisible();
});
