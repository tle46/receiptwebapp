import { test, expect } from "@playwright/test";
const user = {
  id: 7,
  username: "guest7",
  displayName: "Guest",
  email: null,
  status: "GUEST",
  emailVerified: false,
  passwordEnabled: false,
  googleLinked: false,
};
const credentials = (
  access = "access1",
  refresh = "refresh1",
  account = user,
) => ({
  accessToken: access,
  refreshToken: refresh,
  expiresIn: 900,
  user: account,
});
test("concurrent 401 responses serialize refresh and retry with the authenticated actor", async ({
  page,
}) => {
  let refreshes = 0;
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/session")
      return route.fulfill({ status: 204 });
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === "/api/auth/guest")
      return route.fulfill({ status: 201, json: credentials() });
    if (url.pathname === "/api/auth/refresh") {
      refreshes++;
      expect(request.headers().authorization).toBeUndefined();
      expect(request.postDataJSON()).toEqual({ refreshToken: "refresh1" });
      await new Promise((resolve) => setTimeout(resolve, 100));
      return route.fulfill({ json: credentials("access2", "refresh2") });
    }
    if (request.headers().authorization === "Bearer access1")
      return route.fulfill({ status: 401 });
    expect(request.headers().authorization).toBe("Bearer access2");
    if (url.pathname === "/api/receipts")
      expect(url.searchParams.get("userId")).toBe("7");
    return route.fulfill({ json: [] });
  });
  await page.goto("http://localhost:5173");
  await expect(
    page.getByRole("button", { name: "New receipt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No receipts yet", { exact: false }),
  ).toBeVisible();
  expect(refreshes).toBe(1);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "refresh1",
  );
});
test("registration upgrades guest in place, logout revokes session, reload does not replace guest", async ({
  page,
}) => {
  let guests = 0,
    logout = false;
  await page.route("**/api/**", (route) => {
    if (new URL(route.request().url()).pathname === "/api/session")
      return route.fulfill({ status: 204 });
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === "/api/auth/guest") {
      guests++;
      return route.fulfill({ status: 201, json: credentials() });
    }
    if (url.pathname === "/api/auth/register") {
      expect(request.headers().authorization).toBe("Bearer access1");
      expect(request.postDataJSON().password).toBe("correct horse battery");
      return route.fulfill({
        status: 201,
        json: credentials("registered", "registered-refresh", {
          ...user,
          status: "ACTIVE",
          username: "alice",
          displayName: "Alice",
          email: "alice@example.com",
          passwordEnabled: true,
        }),
      });
    }
    if (url.pathname === "/api/auth/email/send-verification")
      return route.fulfill({ status: 202 });
    if (url.pathname === "/api/auth/logout") {
      logout = true;
      expect(request.headers().authorization).toBe("Bearer registered");
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("http://localhost:5173");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill("alice");
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct horse battery");
  await page.getByLabel("Email", { exact: true }).fill("alice@example.com");
  await page.getByLabel("Display name").fill("Alice");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.locator(".entry-card")).toBeVisible();
  expect(logout).toBe(true);
  await page.reload();
  await expect(page.locator(".entry-card")).toBeVisible();
  expect(guests).toBe(1);
});
test("backend guest saves complete draft with actor and reloads server balances", async ({
  page,
}) => {
  let saved: Record<string, any> | null = null;
  let finalized = false;
  const receipt = () => ({
    id: 31,
    ownerId: 7,
    merchantName: saved?.merchantName || "Dinner",
    purchaseDate: "2026-10-06T18:00:00",
    currency: "USD",
    status: finalized ? "FINALIZED" : "DRAFT",
    discount: 0,
    tax: 0,
    fee: 0,
    tip: 0,
    total: 10,
    subtotal: 10,
    adjustmentAllocations: saved?.adjustmentAllocations || [],
    participants: [{ id: 71, userId: 7, finalOwedAmount: 10 }],
    items: [
      {
        id: 51,
        name: "Pizza",
        quantity: 1,
        unitPrice: 10,
        total: 10,
        allocations: [
          {
            participantId: 71,
            allocationType: "EQUAL",
            inputValue: 1,
            finalAmount: 10,
          },
        ],
      },
    ],
  });
  await page.route("**/api/**", (route) => {
    if (new URL(route.request().url()).pathname === "/api/session")
      return route.fulfill({ status: 204 });
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === "/api/auth/guest")
      return route.fulfill({ status: 201, json: credentials() });
    expect(request.headers().authorization).toBe("Bearer access1");
    if (url.pathname.endsWith("/friends")) return route.fulfill({ json: [] });
    expect(url.searchParams.get("userId")).toBe("7");
    if (url.pathname.endsWith("/finalize")) {
      finalized = true;
      return route.fulfill({
        json: {
          total: 10,
          participants: [
            {
              participantId: 71,
              userId: 7,
              username: "guest7",
              finalOwedAmount: 10,
            },
          ],
          allocations: [
            { itemName: "Pizza", participantId: 71, finalAmount: 10 },
          ],
        },
      });
    }
    if (url.pathname.endsWith("/draft")) {
      saved = request.postDataJSON();
      expect(saved!.participantUserIds).toEqual([]);
      expect(saved!.items[0].allocations).toEqual([
        { userId: 7, allocationType: "EQUAL", inputValue: 1 },
      ]);
      expect(saved!.adjustmentAllocations).toEqual([]);
      expect(saved).not.toHaveProperty("total");
    }
    return route.fulfill({
      json:
        url.pathname === "/api/receipts" && request.method() === "GET"
          ? [receipt()]
          : receipt(),
    });
  });
  await page.goto("http://localhost:5173");
  await page.getByRole("button", { name: /Dinner/ }).click();
  await page.getByLabel("Merchant", { exact: true }).fill("Updated dinner");
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  expect(saved?.merchantName).toBe("Updated dinner");
  await page.getByRole("button", { name: /Finalize receipt/i }).click();
  await expect(
    page.getByRole("button", { name: "Reopen", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Review your split", { exact: true }),
  ).toHaveCount(0);
});

test("email login, display name, default cents and readable mobile layout", async ({
  page,
}) => {
  const email = "Alice.With.A.Long.Email.Address@example.com";
  await page.addInitScript(() =>
    localStorage.setItem("gather.session-used", "true"),
  );
  await page.route("**/api/**", (route) => {
    if (new URL(route.request().url()).pathname === "/api/session")
      return route.fulfill({ status: 204 });
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/login") {
      expect(route.request().postDataJSON()).toEqual({
        username: email,
        password: "correct horse battery",
      });
      return route.fulfill({
        json: credentials("signed-in", "refresh", {
          ...user,
          status: "ACTIVE",
          username: "alice_username",
          displayName: "Alice Display",
          passwordEnabled: true,
        }),
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("http://localhost:5173");
  await page.getByLabel("Username or email").fill("  " + email + "  ");
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct horse battery");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".top-profile")).toContainText("Alice Display");
  await expect(page.locator(".top-profile .avatar")).toHaveText("A");
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByText("Username: alice_username")).toBeVisible();
  await page.getByRole("button", { name: "Close account" }).click();
  await page.getByRole("button", { name: "New receipt", exact: true }).click();
  const firstParticipant = page.getByRole("button", {
    name: "Toggle Alice Display (you) for item 1",
    exact: true,
  });
  await expect(firstParticipant).toHaveAttribute("aria-pressed", "false");
  await expect(firstParticipant).toContainText("$0.00");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  const secondParticipant = page.getByRole("button", {
    name: "Toggle Alice Display (you) for item 2",
    exact: true,
  });
  await expect(secondParticipant).toHaveAttribute("aria-pressed", "false");
  await expect(secondParticipant).toContainText("$0.00");
  await expect(page.getByLabel("Fast cents entry")).toBeChecked();
  await page.getByLabel("Item 1 price", { exact: true }).fill("1223");
  await expect(page.getByLabel("Item 1 price", { exact: true })).toHaveValue(
    "12.23",
  );
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .getByLabel("Item 1 price", { exact: true })
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    await page.screenshot({
      path: `test-results/readability-${width}.png`,
      fullPage: true,
    });
  }
});

test("zero allocation stays selected through autosave and can be retyped", async ({
  page,
}) => {
  let item = {
    name: "Pizza",
    quantity: 1,
    unitPrice: 10,
    allocations: [{ userId: 7, allocationType: "EXACT", inputValue: 10 }],
  };
  let saves = 0;
  const receipt = () => ({
    id: 31,
    ownerId: 7,
    merchantName: "Dinner",
    purchaseDate: "2026-10-07T12:00:00",
    currency: "USD",
    status: "DRAFT",
    subtotal: 10,
    total: 10,
    discount: 0,
    tax: 0,
    fee: 0,
    tip: 0,
    adjustmentAllocations: [],
    participants: [{ id: 71, userId: 7, finalOwedAmount: 0 }],
    items: [
      {
        ...item,
        id: 51,
        total: 10,
        allocations: item.allocations.map((a) => ({
          participantId: 71,
          allocationType: a.allocationType,
          inputValue: a.inputValue,
          finalAmount: 0,
        })),
      },
    ],
  });
  await page.route("**/api/**", (route) => {
    if (new URL(route.request().url()).pathname === "/api/session")
      return route.fulfill({ status: 204 });
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/guest")
      return route.fulfill({ status: 201, json: credentials() });
    if (url.pathname.endsWith("/friends")) return route.fulfill({ json: [] });
    if (url.pathname.endsWith("/draft")) {
      item = route.request().postDataJSON().items[0];
      saves++;
    }
    return route.fulfill({
      json: url.pathname === "/api/receipts" ? [receipt()] : receipt(),
    });
  });
  await page.goto("http://localhost:5173");
  await page.getByRole("button", { name: /Dinner/ }).click();
  await page.getByRole("button", { name: "Edit shares for item 1" }).click();
  const input = page.getByLabel("Item 1 allocation for Guest (you)", {
    exact: true,
  });
  const selected = page.locator('.compact-allocation input[type="checkbox"]');
  await input.fill("");
  await expect.poll(() => saves).toBe(1);
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await expect(selected).toBeChecked();
  const chip = page.getByRole("button", {
    name: "Toggle Guest (you) for item 1",
    exact: true,
  });
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(input).toBeVisible();
  await input.fill("1000");
  await expect(input).toHaveValue("10.00");
  await expect.poll(() => saves).toBe(2);
  await expect(selected).toBeChecked();
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect(chip).toContainText("$0.00");
  await expect(selected).not.toBeChecked();
  await expect(input).toHaveCount(0);
  await chip.focus();
  await page.keyboard.press("Space");
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(selected).toBeChecked();
  await expect(input).toBeVisible();
});

test("Google sign-in omits guest bearer while explicit linking authenticates both requests", async ({
  page,
}) => {
  const calls: { path: string; authorization: string | undefined }[] = [];
  await page.route("**/api/**", (route) => {
    if (new URL(route.request().url()).pathname === "/api/session")
      return route.fulfill({ status: 204 });
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path === "/api/auth/guest")
      return route.fulfill({ status: 201, json: credentials() });
    if (path.startsWith("/api/auth/google")) {
      calls.push({ path, authorization: request.headers().authorization });
      return route.fulfill({
        json: path.endsWith("/nonce")
          ? { nonce: "server-nonce" }
          : credentials("google-access", "google-refresh"),
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("http://localhost:5173");
  await expect(
    page.getByRole("button", { name: "New receipt", exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const { auth } = await import("/src/api.ts");
    const login = await auth.nonce();
    await auth.google("google-id-token", login.nonce);
    const link = await auth.nonce(true);
    await auth.google("google-id-token", link.nonce, true);
  });
  expect(calls).toEqual([
    { path: "/api/auth/google/nonce", authorization: undefined },
    { path: "/api/auth/google", authorization: undefined },
    { path: "/api/auth/google/nonce", authorization: "Bearer access1" },
    { path: "/api/auth/google", authorization: "Bearer access1" },
  ]);
});

test("entry page emphasizes guest access and separates account recovery", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("gather.session-used", "true"),
  );
  await page.route("**/api/**", (route) =>
    new URL(route.request().url()).pathname === "/api/session"
      ? route.fulfill({ status: 204 })
      : route.fulfill({
          json:
            new URL(route.request().url()).pathname === "/api/auth/guest"
              ? credentials()
              : [],
        }),
  );
  await page.goto("http://localhost:5173");
  await expect(
    page.getByRole("button", {
      name: "Continue without an account",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".account-primary-tabs button")).toHaveCount(2);
  await expect(
    page.getByText("Sign in to return to your receipts.", { exact: false }),
  ).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/entry-${width}.png`,
      fullPage: true,
    });
  }
  await page
    .getByRole("button", { name: "Forgot password?", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Recover password" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Have a reset token?", exact: true })
    .click();
  await expect(page.getByLabel("Email token")).toBeVisible();
  await page
    .getByRole("button", { name: "Continue without an account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "New receipt", exact: true }),
  ).toBeVisible();
});

test("remembered cookie session restores after reload and logout stops restoration", async ({
  page,
}) => {
  let available = true,
    restores = 0,
    refreshes = 0,
    guests = 0;
  const remembered = () => ({
    ...credentials("remembered-access", "", {
      ...user,
      status: "ACTIVE",
      displayName: "Remembered Alice",
    }),
    browserSession: true,
  });
  await page.route("**/api/**", (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path === "/api/session") {
      restores++;
      expect(request.headers().authorization).toBeUndefined();
      return available
        ? route.fulfill({ json: { ...remembered(), expiresIn: 0 } })
        : route.fulfill({ status: 204 });
    }
    if (path === "/api/auth/refresh") {
      refreshes++;
      expect(request.headers().authorization).toBeUndefined();
      expect(request.postData()).toBeNull();
      return route.fulfill({ json: remembered() });
    }
    if (path === "/api/auth/guest") guests++;
    if (path === "/api/auth/logout") {
      available = false;
      return route.fulfill({ status: 204 });
    }
    expect(request.headers().authorization).toBe("Bearer remembered-access");
    return route.fulfill({ json: [] });
  });
  await page.goto("http://localhost:5173");
  await expect(page.locator(".top-profile")).toContainText("Remembered Alice");
  await expect.poll(() => refreshes).toBe(1);
  await page.reload();
  await expect(page.locator(".top-profile")).toContainText("Remembered Alice");
  await expect.poll(() => refreshes).toBe(2);
  expect(restores).toBe(2);
  expect(guests).toBe(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "remembered-access",
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.locator(".entry-card")).toBeVisible();
  await page.reload();
  await expect(page.locator(".entry-card")).toBeVisible();
  expect(guests).toBe(0);
});
