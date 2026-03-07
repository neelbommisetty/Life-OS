import { expect, test } from "@playwright/test";
import { signInViaApi } from "./helpers";

test("inbox supports capture, detail review, process, and archive actions", async ({
  page,
}) => {
  await signInViaApi(page, "/");
  await page.goto("/");

  const capturedText = "E2E inbox capture item";
  await page
    .getByPlaceholder("Capture a thought, reminder, or draft plan.")
    .fill(capturedText);
  await page.getByRole("button", { name: "Capture" }).click();
  await page.getByRole("link", { name: "Open Inbox" }).click();

  await expect(page.getByRole("button", { name: new RegExp(capturedText) })).toBeVisible();

  await page
    .getByRole("button", {
      name: /Review this inbox entry and decide on proposals\./,
    })
    .click();
  const resolveAllButton = page.getByRole("button", { name: "Resolve All as No" });
  await expect(page.getByText("Todo proposal: Buy groceries")).toBeVisible();
  await expect(resolveAllButton).toBeEnabled();
  await resolveAllButton.click();

  await expect(page.getByText("PROCESSED").first()).toBeVisible();

  await page.getByRole("button", { name: "Archive" }).click();

  await expect(page.getByRole("button", { name: /Review this inbox entry/ })).toHaveCount(0);
});
