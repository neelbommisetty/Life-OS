import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("chat message history paginates older messages when scrolling to top", async ({
  page,
}) => {
  await signInViaApi(page, "/chat");
  await page.goto("/chat");

  const messagesContainer = page.locator('[aria-label="Chat messages"]:visible').first();
  await expect(messagesContainer).toBeVisible();

  await expect(messagesContainer.getByText("Thread A message 40", { exact: true })).toBeVisible();
  await expect(messagesContainer.getByText("Thread A message 1", { exact: true })).toHaveCount(0);

  await messagesContainer.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(
    messagesContainer.getByText("Thread A message 1", { exact: true }).first(),
  ).toBeVisible();
});
