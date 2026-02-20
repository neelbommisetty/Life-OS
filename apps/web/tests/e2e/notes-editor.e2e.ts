import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("notes editor supports preview toggle, keyboard save, autosave debounce, and save on note switch", async ({
  page,
}) => {
  await signInViaApi(page, "/notes");
  await page.goto("/notes");

  const togglePreview = page.getByRole("button", { name: "Toggle preview" });
  await togglePreview.click();

  const editor = page.getByPlaceholder("Write in Markdown...");
  await expect(editor).toBeVisible();

  const shortcutValue = `Shortcut save sentinel ${Date.now()}`;
  await editor.fill(shortcutValue);

  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${modifier}+s`);
  await expect(page.getByText("Saved.")).toBeVisible();

  const autosaveValue = `Autosave sentinel ${Date.now()}`;
  await editor.fill(autosaveValue);
  await page.waitForTimeout(5600);
  await expect(page.getByText("Saved.")).toBeVisible();

  const unmountSaveValue = `Unmount save sentinel ${Date.now()}`;
  await editor.fill(unmountSaveValue);

  await page.getByText("Second note", { exact: true }).first().click();
  await page.getByText("First note", { exact: true }).first().click();

  const editorAfterSwitch = page.getByPlaceholder("Write in Markdown...");
  if ((await editorAfterSwitch.count()) === 0) {
    await togglePreview.click();
  }
  await expect(page.getByPlaceholder("Write in Markdown...")).toHaveValue(unmountSaveValue);
});
