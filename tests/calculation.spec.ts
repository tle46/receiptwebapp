import { test, expect } from "@playwright/test";
import {
  distribute,
  itemPreview,
  receiptPreview,
  capExact,
  setMethod,
} from "../src/allocation";
import { mergePhotoText, parseReceipt } from "../src/ocr";
import type { Item, Draft } from "../src/api";

test("cent rounding conserves money and exact allocations shrink safely", () => {
  const item: Item = {
    name: "Food",
    quantity: 1,
    unitPrice: 10,
    allocations: [1, 2, 3].map((userId) => ({
      userId,
      allocationType: "EQUAL",
      inputValue: 1,
    })),
  };
  expect(Object.values(itemPreview(item))).toEqual([3.34, 3.33, 3.33]);
  const exact = setMethod(item, "EXACT", [1, 2, 3]);
  expect(
    capExact({ ...exact, unitPrice: 3 }).allocations.map((a) => a.inputValue),
  ).toEqual([3, 0, 0]);
  expect(
    setMethod(item, "PERCENTAGE", [1, 2, 3]).allocations.reduce(
      (n, a) => n + a.inputValue,
      0,
    ),
  ).toBe(100);
  expect(distribute(0.01, [1, 1, 1])).toEqual([0.01, 0, 0]);
  const d: Draft = {
    merchantName: "Store",
    purchaseDate: "",
    currency: "USD",
    items: [item],
    participantUserIds: [1, 2, 3],
    discount: 1,
    tax: 0.5,
    tip: 3,
    fee: 0,
    adjustmentAllocations: [{ adjustmentType: "TIP", userId: 2, amount: 3 }],
  };
  expect(
    Object.values(receiptPreview(d).totals).reduce((n, v) => n + v, 0),
  ).toBeCloseTo(12.5, 2);
});

test("multi-photo parsing preserves genuine repeated items and trims overlap only", () => {
  const top = "MARKET\n2026-09-30\nAPPLES 3.00\nMILK 4.00\nMILK 4.00";
  const bottom =
    "MILK 4.00\nMILK 4.00\nBREAD 2.00\nSUBTOTAL 13.00\nTAX 1.00\nTOTAL 14.00\nCASH 20.00\nCHANGE 6.00";
  const result = parseReceipt(mergePhotoText([top, bottom]));
  expect(result.items.map((i) => i.name)).toEqual([
    "APPLES",
    "MILK",
    "MILK",
    "BREAD",
  ]);
  expect(result.total).toBe(14);
  expect(result.tax).toBe(1);
  const extra = parseReceipt(
    mergePhotoText([top + "\nTOTAL 11.00", "BREAD 2.00\nTOTAL 13.00"]),
  );
  expect(extra.items).toHaveLength(4);
  const weighted = parseReceipt(
    "MARKET\nBANANAS\n1.5 kg @ 2.00 3.00\nTOTAL 3.00",
  );
  expect(weighted.items[0]).toMatchObject({
    name: "BANANAS",
    quantity: 1.5,
    unitPrice: 2,
  });
});
