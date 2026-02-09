import { expect, type Page, test } from "@playwright/test";

async function chooseModel(page: Page, modelName: "Auto routing" | "OpenAI GPT-5 Mini" | "Anthropic Claude Haiku 4.5") {
  const modelButton = page.locator('button[aria-label="Select model"]:visible').first();

  await modelButton.click();
  await page.getByRole("button", { name: modelName }).click();
  return modelButton;
}

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

test("chat model selector updates thread model and keeps it after reload", async ({
  page,
}) => {
  await page.goto("/chat");
  await page
    .locator("div.hidden.sm\\:grid")
    .first()
    .getByText("Thread B", { exact: true })
    .click();

  await chooseModel(page, "Auto routing");
  const modelButton = await chooseModel(page, "Anthropic Claude Haiku 4.5");
  await expect(modelButton).toContainText("Anthropic Claude Haiku 4.5");

  await page.reload();
  await expect(modelButton).toContainText("Anthropic Claude Haiku 4.5");
});

test("chat model selector shows an error when model update fails", async ({
  page,
}) => {
  await page.goto("/chat");
  const modelButton = await chooseModel(page, "Auto routing");
  await expect(modelButton).toContainText("Auto routing");
  await chooseModel(page, "OpenAI GPT-5 Mini");

  await expect(
    page.getByText("An error occurred in the Server Components render.").first(),
  ).toBeVisible();
  await expect(modelButton).toContainText("Auto routing");
});
