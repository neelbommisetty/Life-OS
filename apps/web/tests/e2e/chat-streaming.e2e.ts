import { expect, test, type Page } from "@playwright/test";
import { setScenarioCookie, signInViaApi } from "./helpers";

async function sendMessage(page: Page, content: string) {
  await page.getByLabel("Message input").first().fill(content);
  await page.getByRole("button", { name: "Send message" }).click();
}

test("chat input uses Enter to send and Shift+Enter for new lines", async ({
  page,
}) => {
  await signInViaApi(page, "/chat");
  await page.goto("/chat");

  const input = page.getByLabel("Message input").first();
  await input.click();
  await input.fill("Line one");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Line two");
  await expect(input).toHaveValue("Line one\nLine two");

  await page.keyboard.press("Enter");

  await expect(page.getByText(/Line one\s+Line two/).first()).toBeVisible();
});

test("chat streaming shows optimistic user message and streamed assistant output", async ({
  page,
}) => {
  await signInViaApi(page, "/chat");
  await page.goto("/chat");

  await sendMessage(page, "stream success test");

  await expect(page.getByText("stream success test", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText(/Mock assistant response for: stream success test/).first(),
  ).toBeVisible();
});

test("chat streaming can be canceled with stop action", async ({ page }) => {
  await signInViaApi(page, "/chat");
  await setScenarioCookie(page, "stream-slow");
  await page.goto("/chat");

  await sendMessage(page, "slow stream cancel test");

  const stopButton = page.getByRole("button", { name: "Stop" });
  await expect(stopButton).toBeVisible();
  await stopButton.click({ force: true });

  await expect(stopButton).toHaveCount(0);
});

test("chat streaming surfaces stream error badge", async ({ page }) => {
  await signInViaApi(page, "/chat");
  await setScenarioCookie(page, "stream-error");
  await page.goto("/chat");

  await sendMessage(page, "stream error test");

  await expect(page.getByText("Mock stream failure").first()).toBeVisible();
});
