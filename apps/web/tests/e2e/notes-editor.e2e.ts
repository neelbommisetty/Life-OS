import { expect, test } from "@playwright/test";
import { setScenarioCookie, signInViaApi } from "./helpers";

test("notes editor supports preview toggle, keyboard save, autosave debounce, and save on note switch", async ({
  page,
}) => {
  await signInViaApi(page, "/notes");
  await page.goto("/notes");

  const togglePreview = page.getByRole("button", { name: "Toggle preview" });
  const landingEditor = page
    .locator('textarea[placeholder="Write in Markdown..."]:visible')
    .first();
  await expect(landingEditor).toBeVisible();

  await togglePreview.click();
  await expect(
    page.locator('textarea[placeholder="Write in Markdown..."]:visible'),
  ).toHaveCount(0);
  await togglePreview.click();
  await expect(landingEditor).toBeVisible();

  await page.getByRole("button", { name: "Capture note" }).click();
  await expect(page).toHaveURL(/\/notes\??$/);

  const editor = page.locator('textarea[placeholder="Write in Markdown..."]:visible').first();
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
  await editor.fill(autosaveValue);
  await page.waitForTimeout(5600);
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();

  const unmountSaveValue = `Unmount save sentinel ${Date.now()}`;
  await editor.fill(unmountSaveValue);

  await page.getByText("Second note", { exact: true }).first().click();
  await page.getByText(shortcutTitle, { exact: true }).first().click();

  const editorAfterSwitch = page.locator('textarea[placeholder="Write in Markdown..."]:visible').first();
  await expect(editorAfterSwitch).toHaveValue(unmountSaveValue);
});

test("notes capture opens an editable draft even when no notes exist", async ({
  page,
}) => {
  await setScenarioCookie(page, "notes-empty");
  await signInViaApi(page, "/notes");
  await page.goto("/notes");

  await page.getByRole("button", { name: "Capture note" }).click();

  const editor = page.locator('textarea[placeholder="Write in Markdown..."]:visible').first();
  await expect(editor).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
  await expect(page.getByText("No notes here yet. Capture one.")).toBeVisible();

  const draftTitle = `Empty state note ${Date.now()}`;
  await page.getByRole("button", { name: "Rename note" }).click();
  const titleInput = page.getByLabel("Note title");
  await titleInput.fill(draftTitle);
  await titleInput.press("Enter");
  await editor.fill("Body copy");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");

  await expect(page.getByText(draftTitle, { exact: true }).first()).toBeVisible();
});

test("notes autosave and note-switch saves stay quiet", async ({ page }) => {
  await signInViaApi(page, "/notes");
  await page.goto("/notes");

  const editor = page
    .locator('textarea[placeholder="Write in Markdown..."]:visible')
    .first();
  const savedToast = page.getByText("Saved.").first();

  const autosaveValue = `Quiet autosave sentinel ${Date.now()}`;
  await editor.fill(autosaveValue);
  await page.waitForTimeout(5600);
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await expect(savedToast).toHaveCount(0);

  const switchSaveValue = `Quiet switch sentinel ${Date.now()}`;
  await editor.fill(switchSaveValue);
  await page.getByText("Second note", { exact: true }).first().click();
  await expect(savedToast).toHaveCount(0);
  await expect(page.getByText("Second note body sentinel").first()).toBeVisible();
});

test("notes editor keeps a constrained reading width on desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInViaApi(page, "/notes");
  await page.goto("/notes");

  const editor = page
    .locator('textarea[placeholder="Write in Markdown..."]:visible')
    .first();
  const surface = page.getByTestId("note-editor-surface").filter({
    has: editor,
  });

  await expect(surface).toBeVisible();
  await expect(editor).toBeVisible();

  const surfaceBox = await surface.boundingBox();
  const viewportWidth = page.viewportSize()?.width ?? 0;

  expect(surfaceBox).not.toBeNull();
  expect(surfaceBox!.width).toBeLessThan(viewportWidth * 0.85);
  expect(surfaceBox!.width).toBeGreaterThan(640);
});
