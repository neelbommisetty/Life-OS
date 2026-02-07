import { expect, test } from "@playwright/test";

test("switching threads keeps chat pinned to latest message", async ({ page }) => {
  await page.goto("/e2e/chat-scroll");

  const container = page.getByTestId("messages-container");

  await expect(page.getByTestId("active-thread")).toContainText("Thread A");

  await expect
    .poll(async () => {
      return container.evaluate((element) => {
        return element.scrollHeight > element.clientHeight;
      });
    })
    .toBe(true);

  await container.evaluate((element) => {
    element.scrollTop = 48;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await page.getByRole("button", { name: "Thread B" }).click();

  await expect(page.getByTestId("active-thread")).toContainText("Thread B");

  await expect
    .poll(async () => {
      return page.getByTestId("delayed-tail").getAttribute("data-expanded");
    })
    .toBe("true");

  await expect
    .poll(async () => {
      return container.evaluate((element) => {
        return element.scrollHeight - element.clientHeight - element.scrollTop;
      });
    })
    .toBeLessThanOrEqual(4);

  await expect(page.getByTestId("latest-message")).toContainText("Thread B message 14");
});
