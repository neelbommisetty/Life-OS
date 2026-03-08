import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("notes editor supports preview toggle, keyboard save, autosave debounce, and save on note switch", async ({
  page,
}) => {
  await signInViaApi(page, "/notes");
  await page.goto("/notes");

  await page.getByRole("button", { name: "Capture note" }).click();
  await expect(page).toHaveURL(/\/notes\??$/);

  const togglePreview = page.getByRole("button", { name: "Toggle preview" });
  const editor = page.getByPlaceholder("Write in Markdown...");
  if ((await editor.count()) === 0) {
    await togglePreview.click();
  }
  await expect(editor).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await expect(page.getByText("First note", { exact: true })).toBeVisible();
  await expect(page.getByText("Second note", { exact: true })).toBeVisible();

  const shortcutTitle = `Shortcut save sentinel ${Date.now()}`;
  const shortcutValue = `${shortcutTitle}\nSecond line`;
  await editor.fill(shortcutValue);
  await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();

  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  const savedToast = page.getByText("Saved.").first();
  await page.keyboard.press(`${modifier}+s`);
  await expect(savedToast).toBeVisible();
  await expect(page.getByText(shortcutTitle, { exact: true }).first()).toBeVisible();

  const autosaveValue = `Autosave sentinel ${Date.now()}`;
  if ((await editor.count()) === 0) {
    await togglePreview.click();
  }
  await editor.fill(autosaveValue);
  await page.waitForTimeout(5600);
  await expect(savedToast).toBeVisible();

  const unmountSaveValue = `Unmount save sentinel ${Date.now()}`;
  if ((await editor.count()) === 0) {
    await togglePreview.click();
  }
  await editor.fill(unmountSaveValue);

  await page.getByText("Second note", { exact: true }).first().click();
  await page.getByText("First note", { exact: true }).first().click();

  const editorAfterSwitch = page.getByPlaceholder("Write in Markdown...");
  if ((await editorAfterSwitch.count()) === 0) {
    await togglePreview.click();
  }
  await expect(page.getByPlaceholder("Write in Markdown...")).toHaveValue(unmountSaveValue);
});
