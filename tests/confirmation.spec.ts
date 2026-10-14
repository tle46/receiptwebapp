import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  page.on("dialog", () => {
    throw new Error("Unexpected browser dialog");
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/guest")
      return route.fulfill({
        status: 201,
        json: {
          accessToken: "test-access",
          refreshToken: "test-refresh",
          expiresIn: 900,
          user: {
            id: 7,
            username: "guest7",
            displayName: "Guest",
            email: null,
            status: "GUEST",
            emailVerified: false,
            passwordEnabled: false,
            googleLinked: false,
          },
        },
      });
    if (path === "/api/auth/logout") return route.fulfill({ status: 204 });
    return route.fulfill({ json: [] });
  });
  await page.goto("http://localhost:5173");
  await page.getByRole("button", { name: "New receipt", exact: true }).click();
});

test("unsaved changes require approval; focus is contained and restored on Escape", async ({
  page,
}) => {
  await page.getByLabel("Merchant", { exact: true }).fill("Dinner");
  const navigation = page.getByRole("button", { name: "People", exact: true });
  await navigation.click();
  const dialog = page.getByRole("dialog", { name: "Discard changes?" });
  const cancel = dialog.getByRole("button", { name: "Keep editing" });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Discard changes" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close confirmation" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(navigation).toBeFocused();
  await expect(page.getByLabel("Merchant", { exact: true })).toHaveValue(
    "Dinner",
  );
  await navigation.click();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Merchant", { exact: true })).toHaveValue(
    "Dinner",
  );
  await navigation.click();
  await dialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(
    page.getByRole("heading", { name: "People", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Merchant", { exact: true })).toHaveCount(0);
});

test("item removal can be cancelled or approved on a phone", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Item 1 name", { exact: true }).fill("Apples");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByLabel("Item 2 name", { exact: true }).fill("Bread");
  const remove = page.getByRole("button", {
    name: "Remove item 2",
    exact: true,
  });
  await remove.click();
  const dialog = page.getByRole("dialog", { name: "Remove item?" });
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath("confirmation-mobile.png"),
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Item 2 name", { exact: true })).toHaveValue(
    "Bread",
  );
  await remove.click();
  await dialog
    .getByRole("button", { name: "Remove item", exact: true })
    .click();
  await expect(page.getByLabel("Item 2 name", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Item 1 name", { exact: true })).toHaveValue(
    "Apples",
  );
});

test("confirmation sits above the account modal and cancellation keeps it open", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  const account = page.getByRole("dialog").filter({
    has: page.getByRole("button", {
      name: "Deactivate account",
      exact: true,
    }),
  });
  await account
    .getByRole("button", { name: "Deactivate account", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Discard changes?" })
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Deactivate account?",
  });
  await expect(confirmation).toBeVisible();
  await expect(
    confirmation.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(account).toBeVisible();
  await expect(
    account.getByRole("button", { name: "Deactivate account", exact: true }),
  ).toBeFocused();
});
