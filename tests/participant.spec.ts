import { test, expect } from "@playwright/test";
const fixture = {
  id: 42,
  ownerId: 1,
  merchantName: "Shared groceries",
  purchaseDate: "2026-10-01T12:00:00",
  currency: "USD",
  status: "FINALIZED",
  subtotal: 6,
  total: 6,
  discount: 0,
  tax: 0,
  fee: 0,
  tip: 0,
  adjustmentAllocations: [],
  participants: [
    { id: 11, userId: 1, finalOwedAmount: 0 },
    { id: 12, userId: 2, finalOwedAmount: 0 },
  ],
  items: [
    {
      id: 21,
      name: "Apples",
      quantity: 1,
      unitPrice: 6,
      total: 6,
      allocations: [
        {
          participantId: 11,
          allocationType: "EQUAL",
          inputValue: 1,
          finalAmount: 0,
        },
        {
          participantId: 12,
          allocationType: "EQUAL",
          inputValue: 1,
          finalAmount: 0,
        },
      ],
    },
  ],
};
test("owned and shared lists are separate; participant sees saved amounts and access revocation clears details", async ({
  page,
}) => {
  let writes = 0,
    revoked = false;
  const userIds: string[] = [];
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/guest")
      return route.fulfill({
        status: 201,
        json: {
          accessToken: "participant-access",
          refreshToken: "participant-refresh",
          expiresIn: 900,
          user: {
            id: 2,
            username: "Jamie",
            displayName: "Jamie",
            email: null,
            status: "GUEST",
            emailVerified: false,
            passwordEnabled: false,
            googleLinked: false,
          },
        },
      });
    if (route.request().method() !== "GET") writes++;
    expect(route.request().headers().authorization).toBe(
      "Bearer participant-access",
    );
    if (url.pathname.includes("/receipts"))
      userIds.push(url.searchParams.get("userId") || "");
    if (url.pathname === "/api/receipts/42" && revoked)
      return route.fulfill({
        status: 403,
        json: { message: "Receipt access was removed" },
      });
    return route.fulfill({
      json: url.pathname.endsWith("/friends")
        ? []
        : url.pathname === "/api/receipts"
          ? [
              {
                ...fixture,
                status: "DRAFT",
                id: 43,
                ownerId: 2,
                merchantName: "My groceries",
              },
              ...(revoked ? [] : [fixture, fixture]),
            ]
          : fixture,
    });
  });
  await page.goto("http://localhost:5173");
  await expect(
    page.getByRole("button", { name: /My groceries/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Shared groceries/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Drafts", exact: true }).click();
  await page
    .getByRole("button", { name: "Shared with me", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Shared groceries/ }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: /My groceries/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Drafts", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Shared groceries/ }).click();
  await expect(page.locator(".shared-detail input")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete receipt", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".saved-balances")).toContainText(
    "Jamie (you)$0.00",
  );
  expect(writes).toBe(0);
  expect(userIds.every((id) => id === "2")).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: "tests/shared-mobile.png", fullPage: true });
  revoked = true;
  await page
    .getByRole("button", { name: "Refresh receipt", exact: true })
    .click();
  await expect(page.locator(".shared-detail")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(
    "Receipt access was removed",
  );
  await expect(
    page.getByRole("heading", { name: "No shared receipts" }),
  ).toBeVisible();
});
