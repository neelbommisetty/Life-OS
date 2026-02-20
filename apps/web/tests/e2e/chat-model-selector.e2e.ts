import { expect, type Page, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

async function chooseModel(page: Page, modelName: "Auto routing" | "OpenAI GPT-5 Mini" | "Anthropic Claude Haiku 4.5") {
  const modelButton = page.locator('button[aria-label="Select model"]:visible').first();

  await modelButton.click();
  await page.getByRole("button", { name: modelName }).click();
  return modelButton;
}

test("chat model selector shows available models", async ({ page }) => {
  await signInViaApi(page, "/chat");
  await page.goto("/chat");

  const modelButton = page.locator('button[aria-label="Select model"]:visible').first();
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
  await signInViaApi(page, "/chat");
  await page.goto("/chat");
  await page.getByText("Thread B", { exact: true }).first().click();

  await chooseModel(page, "Auto routing");
  const modelButton = await chooseModel(page, "Anthropic Claude Haiku 4.5");
  await expect(modelButton).toContainText("Anthropic Claude Haiku 4.5");

  await page.reload();
  await expect(
    page.locator('button[aria-label="Select model"]:visible').first(),
  ).toContainText("Anthropic Claude Haiku 4.5");
});

test("chat model selector shows an error when model update fails", async ({
  page,
}) => {
  await signInViaApi(page, "/chat");
  await page.goto("/chat");
  const modelButton = await chooseModel(page, "Auto routing");
  await expect(modelButton).toContainText("Auto routing");
  await chooseModel(page, "OpenAI GPT-5 Mini");

  await expect(modelButton).toContainText("Auto routing");
});
