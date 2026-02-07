import { expect, test } from "@playwright/test";

test("chat model selector shows available models", async ({ page }) => {
  await page.goto("/chat");

  const modelButton = page.getByLabel("Select model").first();
  await expect(modelButton).toBeVisible();
  await modelButton.click();

  await expect(page.getByRole("button", { name: "OpenAI GPT-5 Mini" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Anthropic Claude Haiku 4.5" }),
  ).toBeVisible();
});
