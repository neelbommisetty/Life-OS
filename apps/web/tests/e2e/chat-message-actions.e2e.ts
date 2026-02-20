import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("chat assistant message actions support copy, save-as-note, and regenerate", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {},
      },
    });
  });

  await signInViaApi(page, "/chat");
  await page.goto("/chat");

  await page.getByRole("button", { name: "Copy response to clipboard" }).first().click();
  await expect(page.getByText("Copied.")).toBeVisible();

  await page.getByRole("button", { name: /Save to library/i }).first().click();
  await expect(
    page.getByText(/Saved to library|Saved to Library\./i).first(),
  ).toBeVisible();

  await page.locator('button:has-text("Regenerate"):not([disabled])').first().click();
  await expect(
    page.getByText("Regenerated response based on the latest assistant message.").first(),
  ).toBeVisible();
});
