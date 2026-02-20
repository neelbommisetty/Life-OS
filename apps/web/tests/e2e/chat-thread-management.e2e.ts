import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("chat thread management supports create, select/url sync, search filter, and archive", async ({
  page,
}) => {
  await signInViaApi(page, "/chat");
  await page.goto("/chat");
  const threadPanel = page.locator("div.hidden.sm\\:grid").first();
  const messagesContainer = page.locator('[aria-label="Chat messages"]:visible').first();

  const createThreadButton = page.getByRole("button", {
    name: "Create new thread",
  });

  for (let i = 0; i < 4; i += 1) {
    await createThreadButton.click();
  }

  await expect(page.getByText("New thread").first()).toBeVisible();

  const searchInput = page.getByPlaceholder("Search threads...");
  await expect(searchInput).toBeVisible();
  await searchInput.fill("Thread B");
  await expect(threadPanel.getByText("Thread B", { exact: true })).toBeVisible();
  await expect(threadPanel.getByText("Thread A", { exact: true })).toHaveCount(0);

  await threadPanel.getByText("Thread B", { exact: true }).first().click();
  await expect(messagesContainer.getByText("Thread B message 40", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Archive thread" }).click();
  await expect(threadPanel.getByText("No matching threads.")).toBeVisible();

  await expect(threadPanel.getByText("Thread B", { exact: true })).toHaveCount(0);
});
