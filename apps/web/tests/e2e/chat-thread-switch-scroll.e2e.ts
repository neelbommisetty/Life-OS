import { expect, test } from "@playwright/test";

test("switching threads after scrolling up returns to the latest message", async ({
  page,
}) => {
  await page.goto("/chat");

  const messagesContainer = page.locator('[aria-label="Chat messages"]:visible').first();
  await expect(messagesContainer).toBeVisible();

  await expect
    .poll(async () => {
      return messagesContainer.evaluate((element) => {
        return element.scrollHeight > element.clientHeight;
      });
    })
    .toBe(true);

  await messagesContainer.evaluate((element) => {
    element.scrollTop = 48;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  const desktopThreadList = page.locator("div.hidden.sm\\:grid").first();
  await desktopThreadList.getByText("Thread B", { exact: true }).click();

  await expect(messagesContainer.getByText("Thread B message 40")).toBeVisible();

  await expect
    .poll(async () => {
      return messagesContainer.evaluate((element) => {
        return element.scrollHeight - element.clientHeight - element.scrollTop;
      });
    })
    .toBeLessThanOrEqual(6);
});
