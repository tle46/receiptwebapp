import { test, expect, type Page } from "@playwright/test";
import type { Friend } from "../src/api";

const account = (id = 1) => ({
  id,
  username: "alice",
  displayName: "Alice",
  email: "alice@example.com",
  status: "ACTIVE",
  emailVerified: true,
  passwordEnabled: true,
  googleLinked: false,
});
const person = (
  id: number,
  name: string,
  incoming: number,
  outgoing: number,
  net: number,
) => ({
  userId: id,
  username: name.toLowerCase(),
  displayName: name,
  owedToYou: incoming,
  youOwe: outgoing,
  netBalance: net,
});
const initialBalances = {
  userId: 1,
  currencies: [
    {
      currency: "CAD",
      totalOwed: 5,
      totalOwing: 0,
      netBalance: 5,
      people: [person(2, "Bob", 5, 0, 5)],
    },
    {
      currency: "USD",
      totalOwed: 12,
      totalOwing: 11,
      netBalance: 1,
      people: [
        person(2, "Bob", 10, 6, 4),
        person(3, "Carol", 2, 2, 0),
        person(4, "Dana", 0, 3, -3),
      ],
    },
  ],
};

test("people lookup accepts username or email and receipt additions leave items unselected", async ({
  page,
}) => {
  const people: Friend[] = [];
  const bodies: unknown[] = [];
  await signedIn(page, (path, method, route) => {
    if (path === "/api/users/1/friends") {
      if (method === "POST") {
        const body = route.request().postDataJSON();
        bodies.push(body);
        if (body.username === "missing")
          return route.fulfill({
            status: 404,
            json: { message: "Account not found." },
          });
        const added = {
          id: people.length + 1,
          userId: people.length + 2,
          displayName: body.displayName || (body.username ? "Sam" : "Jamie"),
          email: body.email || null,
          status: body.displayName ? "PLACEHOLDER" : "ACTIVE",
        };
        people.push(added);
        return route.fulfill({ status: 201, json: added });
      }
      return route.fulfill({ json: people });
    }
    return route.fulfill({ json: [] });
  });
  await page.getByRole("button", { name: "People", exact: true }).click();
  const form = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "Add a person" }) });
  await form.getByLabel("Username or email").fill("missing");
  await form.getByRole("button", { name: "Add person", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Account not found.");
  expect(people).toHaveLength(0);
  await form.getByLabel("Username or email").fill("  sam  ");
  await form.getByRole("button", { name: "Add person", exact: true }).click();
  await expect(
    page.locator(".panel").filter({ hasText: "Your people" }),
  ).toContainText("Sam");
  await form.getByLabel("Username or email").fill("  jamie@example.com  ");
  await form.getByRole("button", { name: "Add person", exact: true }).click();
  await expect(form.getByLabel("Username or email")).toHaveValue("");
  await form.getByLabel("Person type").selectOption("placeholder");
  await form.getByLabel("Name", { exact: true }).fill("Taylor");
  await form.getByRole("button", { name: "Add person", exact: true }).click();
  await expect(form.getByLabel("Name", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "My receipts", exact: true }).click();
  await page.getByRole("button", { name: "New receipt", exact: true }).click();
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  const inline = page.locator(".inline-person-form");
  await inline.getByLabel("Username or email").fill("  alex  ");
  await inline.getByRole("button", { name: "Add to receipt" }).click();
  await expect(inline).toHaveCount(0);
  await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(0);
  expect(bodies).toEqual([
    { username: "missing" },
    { username: "sam" },
    { email: "jamie@example.com" },
    { displayName: "Taylor" },
    { username: "alex" },
  ]);
});
function receipt(
  status: "DRAFT" | "FINALIZED" | "SETTLED" = "FINALIZED",
  bobPaid = false,
  samPaid = false,
) {
  return {
    id: 101,
    ownerId: 1,
    merchantName: "Dinner",
    purchaseDate: "2026-10-12T18:00:00",
    currency: "USD",
    status,
    subtotal: 18,
    total: 18,
    discount: 0,
    tax: 0,
    tip: 0,
    fee: 0,
    adjustmentAllocations: [],
    participants: [
      { id: 11, userId: 1, finalOwedAmount: 6, settled: true },
      { id: 12, userId: 2, finalOwedAmount: 10, settled: bobPaid },
      { id: 13, userId: 3, finalOwedAmount: 2, settled: samPaid },
      { id: 14, userId: 4, finalOwedAmount: 0, settled: true },
    ],
    items: [
      {
        id: 51,
        name: "Pizza",
        quantity: 1,
        unitPrice: 18,
        total: 18,
        allocations: [
          {
            participantId: 11,
            allocationType: "EXACT",
            inputValue: 6,
            finalAmount: 6,
          },
          {
            participantId: 12,
            allocationType: "EXACT",
            inputValue: 10,
            finalAmount: 10,
          },
          {
            participantId: 13,
            allocationType: "EXACT",
            inputValue: 2,
            finalAmount: 2,
          },
        ],
      },
    ],
  };
}
async function signedIn(
  page: Page,
  handler: (path: string, method: string, route: any) => unknown,
  userId = 1,
) {
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === "/api/auth/guest")
      return route.fulfill({
        json: {
          accessToken: "balances-access",
          refreshToken: "balances-refresh",
          expiresIn: 900,
          user: account(userId),
        },
      });
    expect(request.headers().authorization).toBe("Bearer balances-access");
    if (url.pathname.startsWith("/api/receipts"))
      expect(url.searchParams.get("userId")).toBe(String(userId));
    if (url.pathname.includes("/balances"))
      expect(url.pathname.startsWith(`/api/users/${userId}/balances`)).toBe(
        true,
      );
    return handler(url.pathname, request.method(), route);
  });
  await page.goto("http://localhost:5173");
  await expect(page.locator(".top-profile")).toBeVisible();
}

test("gross balances remain separate across currencies; settlement records all incoming payments only", async ({
  page,
}) => {
  let paid = false,
    writes = 0,
    lists = 0,
    reads = 0;
  await signedIn(page, async (path, method, route) => {
    if (path === "/api/users/1/friends") return route.fulfill({ json: [] });
    if (path === "/api/receipts") {
      lists++;
      return route.fulfill({
        json: [receipt(paid ? "SETTLED" : "FINALIZED", paid, paid)],
      });
    }
    if (path === "/api/receipts/101")
      return route.fulfill({
        json: receipt(paid ? "SETTLED" : "FINALIZED", paid, paid),
      });
    if (path === "/api/users/1/balances") {
      reads++;
      return route.fulfill({
        json: paid
          ? {
              userId: 1,
              currencies: [
                {
                  currency: "USD",
                  totalOwed: 2,
                  totalOwing: 11,
                  netBalance: -9,
                  people: [
                    person(2, "Bob", 0, 6, -6),
                    person(3, "Carol", 2, 2, 0),
                    person(4, "Dana", 0, 3, -3),
                  ],
                },
              ],
            }
          : initialBalances,
      });
    }
    expect(path).toBe("/api/users/1/balances/people/2/settle");
    expect(method).toBe("POST");
    expect(route.request().postData()).toBeNull();
    writes++;
    await new Promise((resolve) => setTimeout(resolve, 150));
    paid = true;
    return route.fulfill({
      json: {
        personUserId: 2,
        currencies: [
          { currency: "CAD", settledAmount: 5, participantCount: 1 },
          { currency: "USD", settledAmount: 10, participantCount: 2 },
        ],
        affectedReceiptIds: [101, 102, 103],
      },
    });
  });
  await page.getByRole("button", { name: "Balances", exact: true }).click();
  const usd = page.getByRole("region", { name: "USD balances" });
  const bob = page.getByRole("article", { name: "Bob USD", exact: true });
  await expect(bob).toContainText("Owed to you$10.00");
  await expect(bob).toContainText("You owe$6.00");
  await expect(bob).toContainText("Net owed to you$4.00");
  await expect(page.getByRole("article", { name: "Carol USD" })).toContainText(
    "Outstanding payments in both directions. Neither is settled.",
  );
  await expect(
    page
      .getByRole("article", { name: "Dana USD" })
      .getByRole("button", { name: "Mark all received" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "CAD balances" }),
  ).toContainText("CA$5.00");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/balances-${width}.png`,
      fullPage: true,
    });
  }
  await bob.getByRole("button", { name: "Mark all received" }).click();
  const dialog = page.getByRole("dialog", { name: "Mark all received?" });
  await expect(dialog).toContainText("CAD: CA$5.00");
  await expect(dialog).toContainText("USD: $10.00");
  await expect(dialog).toContainText(
    "Any money you owe this person remains outstanding.",
  );
  await dialog
    .getByRole("button", { name: "Mark all received", exact: true })
    .click();
  await expect(
    bob.getByRole("button", { name: "Mark all received" }),
  ).toBeDisabled();
  await expect(bob).toContainText("Net you owe$6.00");
  await expect(bob).toContainText("Owed to you$0.00");
  await expect(usd).toContainText("You owe$11.00");
  await expect(page.getByRole("region", { name: "CAD balances" })).toHaveCount(
    0,
  );
  expect(writes).toBe(1);
  expect(lists).toBeGreaterThanOrEqual(2);
  expect(reads).toBeGreaterThanOrEqual(2);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "3 receipt(s), 3 participant share(s)" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "My receipts", exact: true }).click();
  await page.getByRole("button", { name: /Dinner/ }).click();
  await expect(
    page.getByRole("button", { name: "Reopen", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".receipt-payments")).toContainText("$10.00");
});

test("individual receipt payments use participant record IDs and lock paid receipts", async ({
  page,
}) => {
  let bobPaid = false,
    samPaid = false,
    balanceReads = 0,
    listReads = 0;
  const writes: string[] = [];
  const current = () =>
    receipt(samPaid ? "SETTLED" : "FINALIZED", bobPaid, samPaid);
  await signedIn(page, (path, method, route) => {
    if (path.endsWith("/friends"))
      return route.fulfill({
        json: [
          {
            id: 1,
            userId: 2,
            displayName: "Bob",
            email: null,
            status: "PLACEHOLDER",
          },
          {
            id: 2,
            userId: 3,
            displayName: "Sam",
            email: null,
            status: "PLACEHOLDER",
          },
        ],
      });
    if (path === "/api/receipts") {
      listReads++;
      return route.fulfill({ json: [current()] });
    }
    if (path === "/api/users/1/balances") {
      balanceReads++;
      return route.fulfill({ json: { userId: 1, currencies: [] } });
    }
    if (method === "POST") {
      writes.push(path);
      expect(route.request().postData()).toBeNull();
      if (path === "/api/receipts/101/participants/12/settle") bobPaid = true;
      else if (path === "/api/receipts/101/unsettle") {
        bobPaid = false;
        samPaid = false;
      } else {
        expect(path).toBe("/api/receipts/101/participants/13/settle");
        samPaid = true;
      }
    }
    return route.fulfill({ json: current() });
  });
  await page.getByRole("button", { name: /Dinner/ }).click();
  await expect(
    page.getByRole("button", { name: "Reopen", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete receipt", exact: true }),
  ).toBeVisible();
  const bob = page.locator(".receipt-payment").filter({ hasText: "Bob" });
  await bob.getByRole("button", { name: "Mark received", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Mark payment received?" })
    .getByRole("button", { name: "Mark received", exact: true })
    .click();
  await expect(bob).toContainText("Paid");
  await expect(bob).toContainText("$10.00");
  await expect(
    page.getByRole("button", { name: "Reopen", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete receipt", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Mark settled", exact: true }),
  ).toBeVisible();
  const sam = page.locator(".receipt-payment").filter({ hasText: "Sam" });
  await sam.getByRole("button", { name: "Mark received", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Mark payment received?" })
    .getByRole("button", { name: "Mark received", exact: true })
    .click();
  await expect(
    page.locator(".receipt-payments .payment-status.paid"),
  ).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Mark settled", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Mark received", exact: true }),
  ).toHaveCount(0);
  expect(writes).toEqual([
    "/api/receipts/101/participants/12/settle",
    "/api/receipts/101/participants/13/settle",
  ]);
  expect(balanceReads).toBe(2);
  expect(listReads).toBeGreaterThanOrEqual(3);
  await page
    .getByRole("button", { name: "Unsettle receipt", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Unsettle receipt?" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(writes).toHaveLength(2);
  await page
    .getByRole("button", { name: "Unsettle receipt", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Unsettle receipt?" })
    .getByRole("button", { name: "Unsettle receipt", exact: true })
    .click();
  await expect(
    page.locator(".receipt-payments .payment-status.unpaid"),
  ).toHaveCount(2);
  await expect(
    page.locator(".receipt-payments .payment-status.paid"),
  ).toHaveCount(2);
  await expect(bob).toContainText("$10.00");
  await expect(
    page.getByRole("button", { name: "Reopen", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete receipt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Unsettle receipt", exact: true }),
  ).toHaveCount(0);
  expect(writes.at(-1)).toBe("/api/receipts/101/unsettle");
  expect(balanceReads).toBe(3);
});

test("balances retry handles empty debt and successful settlement with no remaining payments", async ({
  page,
}) => {
  let reads = 0,
    paid = false;
  await signedIn(page, (path, method, route) => {
    if (path === "/api/receipts" || path.endsWith("/friends"))
      return route.fulfill({ json: [] });
    if (path === "/api/users/1/balances") {
      reads++;
      if (reads === 1)
        return route.fulfill({
          status: 503,
          json: { message: "Balances temporarily unavailable." },
        });
      return route.fulfill({
        json: paid ? { userId: 1, currencies: [] } : initialBalances,
      });
    }
    expect(method).toBe("POST");
    paid = true;
    return route.fulfill({
      json: { personUserId: 2, currencies: [], affectedReceiptIds: [] },
    });
  });
  await page.getByRole("button", { name: "Balances", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Balances temporarily unavailable.",
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await page
    .getByRole("article", { name: "Bob USD" })
    .getByRole("button", { name: "Mark all received" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mark all received", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No outstanding balances" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "No outstanding incoming payments remained.",
  );
});

test("participant sees original shares and payment status with no settlement controls", async ({
  page,
}) => {
  let writes = 0;
  const namedReceipt = {
    ...receipt("FINALIZED", true),
    participants: receipt("FINALIZED", true).participants.map((p, i) => ({
      ...p,
      displayName: ["Alice Receipt", "Bob Receipt", "Carol Receipt", ""][i],
      username: i === 3 ? "dana.receipt" : `user${p.userId}`,
    })),
  };
  await signedIn(
    page,
    (path, method, route) => {
      if (method !== "GET") writes++;
      if (path.endsWith("/friends")) return route.fulfill({ json: [] });
      return route.fulfill({
        json: path === "/api/receipts" ? [namedReceipt] : namedReceipt,
      });
    },
    2,
  );
  await page
    .getByRole("button", { name: "Shared with me", exact: true })
    .click();
  await page.getByRole("button", { name: /Dinner/ }).click();
  const saved = page.locator(".saved-balances");
  await expect(saved).toContainText("Alice Receipt");
  await expect(saved).toContainText("Carol Receipt");
  await expect(saved).toContainText("dana.receipt");
  await expect(saved).not.toContainText("Person #");
  await expect(saved).toContainText("$10.00");
  await expect(saved.locator(".payment-status.paid")).toHaveCount(3);
  await expect(
    page.getByRole("button", {
      name: /Mark received|Mark settled|Unsettle receipt|Reopen|Delete receipt/,
    }),
  ).toHaveCount(0);
  expect(writes).toBe(0);
});

test("draft shares are labeled Draft and never enable a payment action", async ({
  page,
}) => {
  await signedIn(page, (path, _method, route) => {
    if (path.endsWith("/friends")) return route.fulfill({ json: [] });
    if (path === "/api/users/1/balances")
      return route.fulfill({ json: { userId: 1, currencies: [] } });
    return route.fulfill({
      json: path === "/api/receipts" ? [receipt("DRAFT")] : receipt("DRAFT"),
    });
  });
  await page.getByRole("button", { name: /Dinner/ }).click();
  await expect(
    page.locator(".receipt-payments .payment-status.draft"),
  ).toHaveCount(4);
  await expect(page.locator(".receipt-payments")).not.toContainText("Unpaid");
  await expect(
    page.getByRole("button", { name: "Mark received", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Balances", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No outstanding balances" }),
  ).toBeVisible();
});
